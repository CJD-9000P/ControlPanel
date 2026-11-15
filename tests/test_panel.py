import csv
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import time
import unittest

from cjd_panel import __version__
from cjd_panel.model import profile
from cjd_panel.modbus import CommunicationError, SimulatedRTU
from cjd_panel.server import Application, CSV_FIELDS, csv_bytes
from cjd_panel.store import Store
from cjd_panel.worker import Worker


def sample(name="Ensayo"):
    return {"name": name, "notes": "Prueba ficticia", "segments": [
        {"temperature": 25 if i == 0 else 100+i*5, "minutes": 0 if i == 19 else 10}
        for i in range(20)]}


class PanelTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name)/"cjd.sqlite3")
        self.adapter = SimulatedRTU(timeout=.15, segment_seconds=60)
        self.worker = Worker(self.adapter, self.store, interval=.05)
        self.worker.start()
        self.worker.submit('read').result(3)
        self.app = Application(self.worker, self.store)

    def tearDown(self):
        self.worker.close()
        self.store.close()
        self.temp.cleanup()

    def order(self, operation, **data):
        return self.worker.submit(operation, data).result(5)

    def request(self, path, method='GET', body=None, headers=None):
        if isinstance(body, dict):
            raw=json.dumps(body).encode()
            content_type='application/json'
        else:
            raw=(body or '').encode()
            content_type='text/csv'
        env={'REQUEST_METHOD':method,'PATH_INFO':'/api/'+path,
             'HTTP_HOST':'127.0.0.1:8080','CONTENT_TYPE':content_type,
             'CONTENT_LENGTH':str(len(raw)),'wsgi.input':io.BytesIO(raw),
             'HTTP_X_CJD_REQUEST':'1',**(headers or {})}
        result={}
        def start(status, h): result.update(status=int(status.split()[0]),headers=dict(h))
        result['body']=b''.join(self.app(env,start))
        if 'application/json' in result['headers'].get('Content-Type',''):
            result['json']=json.loads(result['body'])
        return result

    def test_full_cycle_snapshot_and_export_import(self):
        saved=self.store.save_profile(sample())
        self.order('load',memory=3,profile_id=saved['id'])
        self.assertEqual(self.adapter.furnace.segments(3)[1][0],105)
        self.order('run',memory=3,profile_id=saved['id'])
        self.order('pause');self.assertEqual(self.worker.snapshot()['state'],2)
        self.order('resume');self.order('stop')
        firing=self.store.firings()[0]
        self.assertEqual(firing['status'],'ended')
        self.assertGreater(firing['samples'],3)
        self.store.delete_profile(saved['id'])
        detail=self.store.firing(firing['id'])
        self.assertEqual(len(detail['snapshot']),20)
        exported=self.request('firings/'+firing['id']+'/csv')
        imported=self.request('firings/import','POST',exported['body'].decode('utf-8-sig'))
        self.assertEqual(imported['status'],201)
        self.assertEqual(imported['json']['samples'],firing['samples'])
        rows=self.store.firing(imported['json']['id'])['readings']
        self.assertEqual([r['pv'] for r in rows],[r['pv'] for r in detail['readings']])

    def test_c01_adaptation_does_not_edit_library(self):
        p=sample();p['segments'][0]['temperature']=50
        p=self.store.save_profile(p)
        self.order('load',memory=2,profile_id=p['id'])
        self.assertEqual(self.adapter.furnace.segments(2)[0][0],25)
        self.assertEqual(self.store.get_profile(p['id'])['segments'][0]['temperature'],50)
        self.assertEqual(self.worker.snapshot()['state'],0)

    def test_no_memory_writes_while_running(self):
        p=self.store.save_profile(sample())
        self.order('run',memory=1)
        before=len(self.adapter.furnace.write_log)
        with self.assertRaises(ValueError): self.order('load',memory=1,profile_id=p['id'])
        with self.assertRaises(ValueError): self.order('select',memory=2)
        self.assertEqual(len(self.adapter.furnace.write_log),before)

    def test_lost_ack_confirms_without_repeating_command(self):
        self.order('run',memory=1)
        self.order('simulate',action='lost_ack')
        self.order('pause')
        writes=[v for addr,v,_ in self.adapter.furnace.write_log if addr==0xC4 and v==[3]]
        self.assertEqual(len(writes),1)
        self.assertEqual(self.worker.snapshot()['state'],2)
        self.assertTrue(any(e['kind']=='ack_recovered' for e in self.store.events()))

    def test_offline_does_not_record_fake_samples_and_recovers(self):
        self.order('run',memory=1)
        self.order('simulate',action='offline')
        time.sleep(.4)
        self.assertFalse(self.worker.snapshot()['online'])
        count=self.store.firings()[0]['samples']
        time.sleep(.2)
        self.assertEqual(self.store.firings()[0]['samples'],count)
        self.order('simulate',action='online')
        self.order('read')
        self.assertTrue(self.worker.snapshot()['online'])
        self.assertEqual(len(self.store.firings()),1)

    def test_external_buttons_observed_not_attributed(self):
        self.order('simulate',action='run')
        self.order('read')
        self.assertEqual(self.store.firings()[0]['origin'],'observed')
        self.order('simulate',action='pause')
        self.order('read')
        self.assertEqual(self.worker.snapshot()['state'],2)
        self.order('simulate',action='stop')
        self.order('read')
        events=self.store.events(self.store.firings()[0]['id'])
        self.assertTrue(all(e['origin']=='observed' for e in events if e['kind']=='state'))

    def test_single_worker_owns_all_rtu_requests(self):
        threads=set()
        read=self.adapter.read
        def traced(*args):
            threads.add(threading.get_ident());return read(*args)
        self.adapter.read=traced
        futures=[self.worker.submit('read') for _ in range(8)]
        for future in futures: future.result(4)
        self.assertEqual(threads,{self.worker.thread.ident})

    def test_invalid_decimal_scale_blocks_writes(self):
        read=self.adapter.read
        def decimal(address,count=1): return [1] if address==0xA3 else read(address,count)
        self.adapter.read=decimal
        before=len(self.adapter.furnace.write_log)
        with self.assertRaises(CommunicationError): self.order('run',memory=1)
        self.assertEqual(len(self.adapter.furnace.write_log),before)

    def test_bad_full_readback_blocks_run(self):
        p=self.store.save_profile(sample())
        read=self.adapter.read
        calls=0
        def corrupt(address,count=1):
            nonlocal calls
            values=read(address,count)
            if address==0 and count==40:
                calls+=1
                # Después del sondeo y lectura inicial de _load, corromper la verificación.
                if calls>=3: values[2]+=1
            return values
        self.adapter.read=corrupt
        with self.assertRaises(CommunicationError): self.order('run',memory=1,profile_id=p['id'])
        self.assertFalse(any(a==0xC4 and v==[1] for a,v,_ in self.adapter.furnace.write_log))

    def test_api_profiles_csv_roundtrip_and_validation(self):
        result=self.request('profiles','POST',sample('Ámbar'))
        self.assertEqual(result['status'],201)
        ident=result['json']['id']
        exported=self.request('profiles/'+ident+'/csv')['body'].decode('utf-8-sig')
        imported=self.request('profiles/import','POST',exported)
        self.assertEqual(imported['status'],201)
        self.assertEqual(imported['json']['segments'],result['json']['segments'])
        invalid=sample();invalid['segments'][0]['temperature']=1201
        self.assertEqual(self.request('profiles','POST',invalid)['status'],400)
        invalid=sample();invalid['segments'][0]['temperature']=True
        self.assertEqual(self.request('profiles','POST',invalid)['status'],400)

    def test_import_invalid_rows_is_atomic(self):
        data='timestamp,pv,sv,state,step,minutes,memory\n2026-11-15T10:00:00+00:00,25,30,1,1,0,1\n2026-11-15T10:01:00,26,30,1,1,1,1\n'
        self.assertEqual(self.request('firings/import','POST',data)['status'],400)
        self.assertEqual(self.store.firings(),[])
        self.assertEqual(self.request('firings/import','POST','wrong,header\n1,2')['status'],400)

    def test_auth_csrf_host_and_versions(self):
        self.assertEqual(self.request('state')['json']['version'],__version__)
        self.assertEqual(self.request('profiles','POST',sample(),{'HTTP_X_CJD_REQUEST':''})['status'],403)
        self.assertEqual(self.request('profiles','POST',sample(),{'HTTP_ORIGIN':'https://example.org'})['status'],403)
        self.assertEqual(self.request('state',headers={'HTTP_HOST':'attacker.example'})['status'],403)
        self.app.token='test-token-1234567890123456789'
        self.assertEqual(self.request('state')['status'],401)
        self.assertEqual(self.request('state',headers={'HTTP_AUTHORIZATION':'Bearer '+self.app.token})['status'],200)

    def test_backup_is_consistent(self):
        p=self.store.save_profile(sample())
        self.order('run',memory=1)
        response=self.request('backup')
        backup=Path(self.temp.name)/'backup.sqlite3';backup.write_bytes(response['body'])
        with sqlite3.connect(backup) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')
            self.assertEqual(db.execute('SELECT id FROM profiles').fetchone()[0],p['id'])
            self.assertEqual(db.execute('SELECT count(*) FROM firings').fetchone()[0],1)

    def test_terminal_point_and_empty_curve_rejected(self):
        p=sample();p['segments'][-1]['minutes']=1
        with self.assertRaises(ValueError): profile(p)
        p=sample()
        for s in p['segments']:s['minutes']=0
        with self.assertRaises(ValueError): profile(p)

    def test_unknown_command_writes_nothing(self):
        before=len(self.adapter.furnace.write_log)
        self.assertEqual(self.request('commands','POST',{'operation':'destroy'})['status'],400)
        self.assertEqual(len(self.adapter.furnace.write_log),before)


class RecoveryTest(unittest.TestCase):
    def test_restart_preserves_library_and_marks_session_interrupted(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'test.sqlite3'
            s=Store(path);p=s.save_profile(sample());ident=s.start('Ensayo',1,p['segments'],'app');s.close()
            s=Store(path)
            try:
                self.assertEqual(s.get_profile(p['id'])['name'],'Ensayo')
                f=s.firing(ident)
                self.assertEqual(f['status'],'interrupted')
                self.assertIsNotNone(f['ended_at'])
                self.assertEqual(f['events'][0]['kind'],'interrupted')
            finally:s.close()


if __name__=='__main__': unittest.main()
