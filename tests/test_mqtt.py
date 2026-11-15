"""Contrato MQTT histórico sobre simulador; sin broker ni horno físico."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest

from cjd_panel.mqtt_bridge import MQTTBridge, MQTTConfig, CommandJournal, decode_command
from cjd_panel.modbus import SimulatedRTU
from cjd_panel.store import Store
from cjd_panel.worker import Worker


class FakeClient:
    def __init__(self):
        self.messages = []
        self.subscriptions = []
    def publish(self, topic, payload, qos=0, retain=False):
        self.messages.append((topic,payload,qos,retain))
        return SimpleNamespace(rc=0,wait_for_publish=lambda **kw:None,is_published=lambda:True)
    def subscribe(self, topics):
        self.subscriptions = topics
        return 0, 1
    def disconnect(self):pass
    def loop_stop(self):pass


def envelope(command, **extra):
    return dict(command=command, command_id='test-'+str(time.monotonic_ns()),
                issued_at=datetime.now(timezone.utc).isoformat(),ttl_seconds=30,**extra)


class MQTTTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=Store(Path(self.tmp.name)/'app.sqlite3')
        self.adapter=SimulatedRTU(timeout=.1,segment_seconds=60)
        self.worker=Worker(self.adapter,self.store,interval=.05)
        self.worker.start()
        self.worker.submit('read').result(3)
        self.client=FakeClient()
        self.config=MQTTConfig(host='127.0.0.1')
        self.bridge=MQTTBridge(self.worker,self.store,self.config,Path(self.tmp.name)/'commands.sqlite3',self.client)
        self.bridge._set_connection(True)
        self.bridge.ready=True

    def tearDown(self):
        self.worker.close()
        self.bridge.close()
        self.store.close()
        self.tmp.cleanup()

    def send(self,suffix,data,retain=False):
        message=SimpleNamespace(topic=self.config.topic_prefix+'/'+suffix,
                                payload=json.dumps(data).encode(),retain=retain)
        self.bridge._on_message(self.client,None,message)
        for f in list(self.bridge.pending.values()):
            try:f.result(4)
            except Exception:pass
        self.bridge._drain_results()

    def results(self):
        return [json.loads(payload) for topic,payload,_,_ in self.client.messages if topic.endswith('/event')]

    def test_cycle_commands_and_observed_origins(self):
        for suffix,cmd,expected,extra in [('run/set','run',1,{'memoria':2}),
             ('pause/set','pause',2,{}),('resume/set','resume',1,{}),('stop/set','stop',0,{})]:
            data=envelope(cmd,**extra)
            self.send(suffix,data)
            self.assertEqual(self.worker.snapshot()['state'],expected)
            self.assertTrue(any(r['command_id']==data['command_id'] and r['status']=='succeeded' for r in self.results()))
        firing=self.store.firings()[0]
        self.assertEqual(firing['origin'],'mqtt')
        self.assertEqual(firing['status'],'ended')
        self.assertTrue(all(e['origin']=='mqtt' for e in self.store.events(firing['id']) if e['kind']=='state'))

    def test_duplicate_does_not_write_again(self):
        data=envelope('run',memoria=1)
        self.send('run/set',data)
        count=len(self.adapter.furnace.write_log)
        self.send('run/set',data)
        self.assertEqual(len(self.adapter.furnace.write_log),count)
        self.assertEqual(self.results()[-1]['status'],'duplicate')

    def test_rejected_retained_expired_missing_memory_mismatch(self):
        cases=[(envelope('run',memoria=1),True),
               ({**envelope('run',memoria=1),'issued_at':'2000-01-01T00:00:00Z'},False),
               (envelope('run'),False),(envelope('stop'),False),
               (envelope('run',memoria=1,segmentos=[]),False),
               ({**envelope('run',memoria=1),'ttl_seconds':True},False)]
        for data,retained in cases:
            self.send('run/set',data,retained)
            r=self.results()[-1]
            self.assertEqual(r['status'],'rejected')
            self.assertEqual(r['command_id'],data['command_id'])
        self.assertEqual(self.adapter.furnace.write_log,[])

    def test_curve_load_is_verified_and_does_not_run_or_add_profile(self):
        segments=[dict(segmento=i+1,temperatura=25+i*10,tiempo=10 if i<19 else 0) for i in range(20)]
        self.send('curva/set',envelope('escritura_curva',memoria_destino=3,segmentos=segments))
        self.assertEqual(self.results()[-1]['status'],'succeeded')
        self.assertEqual(self.worker.snapshot()['state'],0)
        self.assertEqual(self.worker.snapshot()['memories'][3][1]['temperature'],35)
        self.assertEqual(self.store.profiles(),[])

    def test_cannot_load_while_running(self):
        self.send('run/set',envelope('run',memoria=1))
        count=len(self.adapter.furnace.write_log)
        segments=[dict(temperatura=100,tiempo=10 if i<19 else 0) for i in range(20)]
        self.send('curva/set',envelope('escritura_curva',memoria=1,segmentos=segments))
        self.assertEqual(self.results()[-1]['status'],'rejected')
        self.assertEqual(len(self.adapter.furnace.write_log),count)

    def test_get_forces_memories_response_and_uses_only_worker(self):
        self.bridge.publish_state()
        self.client.messages.clear()
        self.send('curvas/get',{})
        topic,payload,_,retain=next(m for m in self.client.messages if m[0].endswith('/curva'))
        self.assertTrue(retain)
        curve=json.loads(payload)
        self.assertEqual(len(curve['memorias']),4)
        self.assertEqual(curve['memorias']['1'][0]['segmento'],1)

    def test_offline_rejects_actions_without_writes(self):
        self.adapter.simulate('offline')
        with self.assertRaises(Exception):self.worker.submit('read').result(2)
        self.send('run/set',envelope('run',memoria=1))
        self.assertEqual(self.results()[-1]['status'],'rejected')
        self.assertEqual(self.adapter.furnace.write_log,[])
        self.assertFalse(self.worker.snapshot()['online'])

    def test_deadline_and_generation_guard_before_write(self):
        for kwargs in [dict(deadline=time.monotonic()-1),dict(guard=lambda:False)]:
            with self.assertRaises(ValueError):
                self.worker.submit('run',{'memory':1},origin='mqtt',**kwargs).result(2)
        self.assertEqual(self.adapter.furnace.write_log,[])

    def test_all_requests_run_on_single_rtu_thread(self):
        import threading
        callers=set()
        read=self.adapter.read
        def traced(*args):callers.add(threading.get_ident());return read(*args)
        self.adapter.read=traced
        self.send('run/set',envelope('run',memoria=1))
        self.worker.submit('pause').result(2)
        self.send('resume/set',envelope('resume'))
        self.assertEqual(callers,{self.worker.thread.ident})

    def test_discovery_has_templates_fresh_ids_and_no_credentials(self):
        self.bridge._discovery()
        configs=[json.loads(m[1]) for m in self.client.messages if m[0].endswith('/config')]
        buttons=[c for c in configs if 'command_topic' in c]
        self.assertEqual(len(buttons),7)
        for b in buttons:
            self.assertIn('now()',b['command_template'])
            self.assertIn('ttl_seconds',b['command_template'])
            self.assertFalse(b['retain'])
            self.assertEqual(b['availability_mode'],'all')
        self.assertTrue(all(c['device']['identifiers']==['cjd9000p_local'] for c in configs))

    def test_reconnect_requires_subscription_ack(self):
        self.bridge._on_disconnect(self.client,None,None,0,None)
        self.assertFalse(self.bridge.ready)
        self.bridge._on_connect(self.client,None,None,0,None)
        self.assertFalse(self.bridge.ready)
        self.bridge._on_subscribe(self.client,None,1,[0]*8,None)
        self.assertTrue(self.bridge.ready)
        self.assertIn(('horno/cjd9000p/run/set',1),self.client.subscriptions)

    def test_publication_is_historical_format_and_current_version(self):
        from cjd_panel import __version__
        self.bridge.publish_state()
        state=json.loads(next(m[1] for m in self.client.messages if m[0]=='horno/cjd9000p/state'))
        for key in ('pv','sv','segmento','estado','estado_texto','tiempo_cjd','timestamp'):
            self.assertIn(key,state)
        self.assertEqual(state['version'],__version__)
        self.assertEqual(state['mode'],'simulator')
        config=json.loads(next(m[1] for m in self.client.messages if m[0]=='horno/cjd9000p/config'))
        self.assertEqual(config['spc'],1)
        self.assertEqual(config['dp'],0)
        self.assertIn('cyc',config)

    def test_disconnect_cancels_waiting_command_without_writing(self):
        import threading
        entered, release = threading.Event(), threading.Event()
        execute = self.worker._execute
        def blocked(operation, data, **kwargs):
            if operation == 'read':
                entered.set()
                release.wait(2)
            return execute(operation,data,**kwargs)
        self.worker._execute = blocked
        blocking = self.worker.submit('read')
        self.assertTrue(entered.wait(1))
        data = envelope('run',memoria=1)
        try:
            self.bridge._on_message(self.client,None,SimpleNamespace(
                topic=self.config.topic_prefix+'/run/set',payload=json.dumps(data).encode(),retain=False))
            self.bridge._on_disconnect(self.client,None,None,0,None)
        finally:
            release.set()
        blocking.result(3)
        self.bridge._drain_results()
        self.assertEqual(self.adapter.furnace.write_log,[])
        row=self.bridge.journal.db.execute('SELECT status FROM commands WHERE id=?',(data['command_id'],)).fetchone()
        self.assertEqual(row[0],'cancelled')

    def test_api_reports_mqtt_without_credentials(self):
        from cjd_panel.server import Application
        app=Application(self.worker,self.store,mqtt_bridge=self.bridge)
        status,headers,raw=app.handle(dict(REQUEST_METHOD='GET',PATH_INFO='/api/state',HTTP_HOST='localhost'))
        result=json.loads(raw)
        self.assertEqual(status,200)
        self.assertTrue(result['mqtt']['enabled'])
        self.assertEqual(result['mqtt']['topic_prefix'],'horno/cjd9000p')
        self.assertNotIn('password',result['mqtt'])
        self.assertNotIn('username',result['mqtt'])

    def test_ha_birth_republishes_discovery_and_current_state(self):
        self.client.messages.clear()
        self.bridge._on_message(self.client,None,SimpleNamespace(topic='homeassistant/status',payload=b'online',retain=False))
        self.assertTrue(any(t.startswith('homeassistant/') for t,_,_,_ in self.client.messages))
        self.assertTrue(any(t.endswith('/state') for t,_,_,_ in self.client.messages))


class MQTTValidationTest(unittest.TestCase):
    def test_deduplication_survives_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'journal.sqlite3'
            journal=CommandJournal(path)
            self.assertTrue(journal.claim('same'))
            journal.close()
            journal=CommandJournal(path)
            self.assertFalse(journal.claim('same'))
            self.assertEqual(journal.db.execute('SELECT status FROM commands').fetchone()[0],'outcome_unknown')
            journal.close()

    def test_secret_is_not_in_config_representation(self):
        cfg=MQTTConfig('127.0.0.1',username='private-user',password='private-password')
        self.assertNotIn('private-',repr(cfg))

    def test_strict_envelope_validation(self):
        for data in [[],None,{'command':'run'},
                     {**envelope('run',memoria=1),'issued_at':'2026-11-15T10:00:00'},
                     {**envelope('run',memoria=1),'memoria':True},
                     {**envelope('run',memoria=1),'issued_at':(datetime.now(timezone.utc)+timedelta(minutes=2)).isoformat()}]:
            with self.assertRaises((ValueError,TypeError)):
                decode_command('run/set',json.dumps(data).encode())

    def test_credential_extraction_does_not_execute_source(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('configure_mqtt_test',Path(__file__).resolve().parent.parent/'scripts/configure_mqtt.py')
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'legacy.py'
            source.write_text("raise RuntimeError('no ejecutar')\nMQTT_USER = os.getenv('X', 'private-user')\nMQTT_PASSWORD = os.getenv('Y', 'private-password')\nMQTT_PORT = int(os.getenv('Z', '1883'))\n")
            output=Path(tmp)/'private.json'
            module.create(source,output,'127.0.0.1')
            data=json.loads(output.read_text())
            self.assertEqual(data['username'],'private-user')
            self.assertEqual(data['password'],'private-password')
            self.assertEqual(output.stat().st_mode & 0o777,0o600)
            with self.assertRaises(FileExistsError):module.create(source,output,'127.0.0.1')


if __name__=='__main__':unittest.main()
