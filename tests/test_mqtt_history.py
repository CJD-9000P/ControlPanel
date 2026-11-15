"""Sesiones MQTT: orden, persistencia y compatibilidad del contrato histórico."""
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest

from cjd_panel.mqtt_bridge import MQTTBridge, MQTTConfig
from cjd_panel.store import Store, SCHEMA_VERSION
from test_mqtt import FakeClient


def snapshot():
    return [dict(temperature=25+i*10,minutes=10 if i<19 else 0) for i in range(20)]


def reading(state=1,second=0):
    return dict(timestamp=f'2026-11-15T10:00:{second:02d}+00:00',state=state,
                pv=30+second,sv=50,step=1,minutes=second,memory=1)


class HistoryOutboxFixture(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)/'app.sqlite3'
        self.store=Store(self.path)
    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()
    def messages(self):
        return [(r['topic'],json.loads(r['payload'])) for r in self.store.mqtt_history_batch(100)]
    def cycle(self):
        self.store.enable_mqtt_history()
        ident=self.store.start('Ensayo',1,snapshot(),'mqtt')
        for i,state in enumerate([1,2,1,0]):self.store.record(ident,reading(state,i))
        self.store.finish(ident)
        return ident



class HistoryOutboxTest(HistoryOutboxFixture):
    def test_full_cycle_has_same_run_id_snapshot_and_order(self):
        ident=self.cycle()
        messages=self.messages()
        events=[p for topic,p in messages if topic=='coccion/event']
        states=[p for topic,p in messages if topic=='coccion/state']
        self.assertEqual([p['tipo'] for p in events],['INICIO','PAUSA','REANUDACION','FIN'])
        self.assertEqual([p['estado'] for p in states],[1,2,1])
        self.assertTrue(all(p['run_id']==ident for _,p in messages))
        self.assertEqual(len(events[0]['segmentos']),20)
        self.assertEqual(events[0]['segmentos'][0],dict(segmento=1,temperatura=25,tiempo=10))
        self.assertEqual(events[0]['nombre_curva'],'Ensayo')
        self.assertTrue(events[-1]['confirmado'])
        self.assertFalse(events[-1]['descartada'])
        self.assertEqual(events[-1]['motivo'],'parado')
        self.assertEqual(len({p['event_id'] for _,p in messages}),len(messages))
        self.assertEqual(messages[0][1]['tipo'],'INICIO')
        self.assertEqual(messages[-1][1]['tipo'],'FIN')

    def test_very_short_cycle_and_double_finish(self):
        self.store.enable_mqtt_history()
        ident=self.store.start('Breve',1,snapshot(),'app')
        self.store.record(ident,reading())
        self.store.finish(ident)
        self.store.finish(ident)
        self.assertEqual([p.get('tipo') for _,p in self.messages()],['INICIO',None,'FIN'])

    def test_local_mode_does_not_accumulate_outbox(self):
        ident=self.store.start('Solo local',1,snapshot(),'app')
        self.store.record(ident,reading())
        self.store.finish(ident)
        self.assertEqual(self.store.mqtt_history_pending(),0)

    def test_enabling_with_active_session_announces_once(self):
        ident=self.store.start('En marcha',1,snapshot(),'observed')
        self.store.record(ident,reading(2))
        self.store.enable_mqtt_history()
        self.store.enable_mqtt_history()
        self.assertEqual(len(self.messages()),1)
        self.assertEqual(self.messages()[0][1]['run_id'],ident)
        self.store.record(ident,reading(2,1))
        self.assertEqual(self.messages()[-1][1]['estado'],2)

    def test_restart_preserves_pending_and_marks_interrupted_end(self):
        self.store.enable_mqtt_history()
        ident=self.store.start('Interrumpida',1,snapshot(),'app')
        self.store.record(ident,reading())
        before=self.messages()
        self.store.close()
        self.store=Store(self.path)
        after=self.messages()
        self.assertEqual(after[:len(before)],before)
        end=after[-1][1]
        self.assertEqual(end['tipo'],'FIN')
        self.assertEqual(end['run_id'],ident)
        self.assertFalse(end['confirmado'])
        self.assertEqual(end['motivo'],'servicio_reiniciado')
        self.store.close()
        self.store=Store(self.path)
        self.assertEqual(self.messages(),after)

    def test_record_and_outbox_roll_back_together(self):
        self.store.enable_mqtt_history()
        ident=self.store.start('Atómica',1,snapshot(),'app')
        queue=self.store._queue_mqtt
        def fail(*args):raise RuntimeError('Fallo SQLite simulado')
        self.store._queue_mqtt=fail
        with self.assertRaises(RuntimeError):self.store.record(ident,reading())
        self.store._queue_mqtt=queue
        self.assertEqual(self.store.firing(ident)['samples'],0)
        self.assertEqual(len(self.messages()),1)

    def test_delete_local_session_does_not_destroy_unpublished_messages(self):
        ident=self.cycle()
        before=self.messages()
        self.store.delete_firing(ident)
        self.assertEqual(self.messages(),before)

    def test_schema_two_migrates_with_backup_and_preserves_data(self):
        ident=self.store.start('Esquema anterior',1,snapshot(),'app')
        self.store.finish(ident)
        self.store.close()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('DROP TABLE mqtt_history_runs')
            db.execute('DROP TABLE mqtt_history_outbox')
            db.execute('PRAGMA user_version=2')
        self.store=Store(self.path)
        self.assertEqual(self.store.firing(ident)['name'],'Esquema anterior')
        self.assertEqual(self.store.db.execute('PRAGMA user_version').fetchone()[0],SCHEMA_VERSION)
        self.assertTrue(self.path.with_name(self.path.name+f'.pre-schema-{SCHEMA_VERSION}.bak').exists())


class HistoryPublisherTest(HistoryOutboxFixture):
    def test_delivery_removes_only_after_puback(self):
        self.cycle()
        client=FakeClient()
        bridge=MQTTBridge(SimpleNamespace(),self.store,MQTTConfig('localhost'),Path(self.tmp.name)/'journal.sqlite3',client)
        bridge.connected=bridge.ready=True
        try:
            count=self.store.mqtt_history_pending()
            bridge._publish_history()
            self.assertEqual(self.store.mqtt_history_pending(),0)
            self.assertEqual(len(client.messages),count)
            self.assertTrue(all(qos==1 and not retain for _,_,qos,retain in client.messages))
        finally:
            bridge.connected=False
            bridge.close()

    def test_no_ack_retains_same_message_and_does_not_republish_inflight(self):
        self.cycle()
        client=FakeClient()
        original=client.publish
        acknowledged=[False]
        def delayed(*args,**kwargs):
            info=original(*args,**kwargs)
            info.is_published=lambda:acknowledged[0]
            return info
        client.publish=delayed
        bridge=MQTTBridge(SimpleNamespace(),self.store,MQTTConfig('localhost'),Path(self.tmp.name)/'journal.sqlite3',client)
        bridge.connected=bridge.ready=True
        try:
            count=self.store.mqtt_history_pending()
            bridge._publish_history()
            bridge._publish_history()
            self.assertEqual(self.store.mqtt_history_pending(),count)
            self.assertEqual(len(client.messages),1)
            acknowledged[0]=True
            bridge._publish_history()
            self.assertEqual(self.store.mqtt_history_pending(),0)
            self.assertEqual(len(client.messages),count)
        finally:
            bridge.connected=False
            bridge.close()
