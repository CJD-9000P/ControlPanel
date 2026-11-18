"""Adaptador físico probado contra PTY propio, nunca contra /dev/ttyUSB1."""
from dataclasses import replace
from pathlib import Path
import tempfile
import threading
import time
import unittest

from cjd_panel.modbus import SimulatedRTU, CommunicationError
from cjd_panel.serial_adapter import PhysicalRTU, SerialConfig, serial_client
from cjd_panel.store import Store
from cjd_panel.worker import Worker


class SerialPTYTest(unittest.TestCase):
    def setUp(self):
        try:serial_client(SerialConfig())
        except CommunicationError as exc:self.skipTest(str(exc))
        self.sim=SimulatedRTU(segment_seconds=60)
        self.config=SerialConfig(port=self.sim.server.port,timeout=.15,settle_seconds=0,reconnect_seconds=0)
        self.physical=PhysicalRTU(self.config)
    def tearDown(self):
        if hasattr(self,'physical'):self.physical.close()
        if hasattr(self,'sim'):self.sim.close()

    def test_already_present_port_reads_only_and_parameters_match_reference(self):
        values=self.physical.read(0xC9,6)
        self.assertEqual(values[1],0)
        self.assertEqual(values[4],25)
        self.assertEqual(self.sim.furnace.write_log,[])
        p=self.physical.client.comm_params
        self.assertEqual((p.baudrate,p.bytesize,p.parity,p.stopbits),(9600,8,'N',2))
        self.assertEqual(self.physical.client.transaction.retries,0)

    def test_fc16_control_ack_and_readback_on_pty(self):
        self.physical.read(0xCA)
        for command,state in [(1,1),(3,2),(4,1),(2,0)]:
            self.physical.write(0xC4,[command])
            self.assertEqual(self.physical.read(0xCA),[state])

    def test_no_write_opens_port_implicitly(self):
        with self.assertRaises(CommunicationError):self.physical.write(0xC4,[1])
        self.assertEqual(self.sim.furnace.write_log,[])

    def test_exclusive_client_blocks_second_client(self):
        self.physical.read(0xCA)
        second=PhysicalRTU(self.config)
        try:
            with self.assertRaises(CommunicationError):second.read(0xCA)
            self.assertEqual(self.sim.furnace.write_log,[])
        finally:second.close()

    def test_missing_port_and_reappearance_at_same_path(self):
        # Enlace de /dev/pts reservado a la prueba; no se modifica ningún /dev.
        missing=PhysicalRTU(replace(self.config,port='/dev/cjd-test-port-that-does-not-exist'))
        try:
            with self.assertRaisesRegex(CommunicationError,'ausente'):missing.read(0xCA)
            missing.port=self.sim.server.port
            missing.config=self.config
            self.assertEqual(missing.read(0xCA),[0])
        finally:missing.close()

    def test_lost_write_ack_does_not_repeat_write(self):
        self.physical.read(0xCA)
        self.sim.simulate('lost_ack')
        with self.assertRaises(CommunicationError):self.physical.write(0xC4,[1])
        self.assertEqual(self.physical.read(0xCA),[1])
        self.assertEqual(len([x for x in self.sim.furnace.write_log if x[0]==0xC4 and x[1]==[1]]),1)

    def test_settle_delay_does_not_claim_valid_reading(self):
        self.physical.config=replace(self.config,settle_seconds=.15)
        with self.assertRaisesRegex(CommunicationError,'estabilización'):self.physical.read(0xCA)
        time.sleep(.2)
        self.assertEqual(self.physical.read(0xCA),[0])

    def test_legacy_dynamic_block_fallback_is_read_only(self):
        read=self.physical._read
        calls=[]
        def fallback(address,count=1):
            calls.append((address,count))
            if address==0xC9 and count==6:raise CommunicationError('Bloque no soportado')
            return read(address,count)
        self.physical._read=fallback
        values=self.physical.read(0xC9,6)
        self.assertEqual(values[1],0)
        self.assertEqual(values[4],25)
        self.assertEqual(calls,[(0xC9,6),(0xC9,2),(0xCC,1),(0xCD,2)])
        self.assertEqual(self.sim.furnace.write_log,[])

    def test_physical_adapter_detects_already_running_without_writes(self):
        self.sim.simulate('run')
        before=list(self.sim.furnace.write_log)
        with tempfile.TemporaryDirectory() as tmp:
            store=Store(Path(tmp)/'test.sqlite3')
            worker=Worker(self.physical,store,interval=.1)
            worker.start()
            try:
                worker.submit('read').result(3)
                self.assertEqual(worker.snapshot()['state'],1)
                self.assertEqual(store.firings()[0]['mode'],'physical')
                self.assertEqual(self.sim.furnace.write_log,before)
            finally:
                worker.close()
                store.close()


class ModeSwitchTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.store=Store(Path(self.tmp.name)/'app.sqlite3')
        self.adapters=[]
        def factory(mode, port=None):
            if self.adapters:self.assertTrue(self.adapters[-1].stop_event.is_set())
            adapter=SimulatedRTU(segment_seconds=60,timeout=.1)
            adapter.mode=mode
            adapter.port=(port or '/dev/pts/test-only') if mode=='physical' else None
            self.adapters.append(adapter)
            return adapter
        self.factory=factory
        self.worker=Worker(factory('simulator'),self.store,interval=.05,
            adapter_factory=factory,settings_path=Path(self.tmp.name)/'connection.json',
            serial_ports=lambda: ['/dev/ttyUSB0', '/dev/ttyUSB1'])
        self.worker.start()
        self.worker.submit('read').result(3)
    def tearDown(self):
        self.worker.close()
        self.store.close()
        self.tmp.cleanup()

    def test_switch_closes_before_open_clears_cached_program_and_writes_nothing(self):
        self.worker.submit('set_mode',{'mode':'physical'}).result(4)
        state=self.worker.snapshot()
        self.assertEqual(state['mode'],'physical')
        self.assertFalse(state['simulator_enabled'])
        self.assertTrue(state['physical_usb_supported'])
        self.assertTrue(state['online'])
        self.assertTrue(all(a.furnace.write_log==[] for a in self.adapters))
        import json
        self.assertEqual(json.loads((Path(self.tmp.name)/'connection.json').read_text())['mode'],'physical')
        self.worker.submit('set_mode',{'mode':'simulator'}).result(4)
        self.assertEqual(self.worker.snapshot()['mode'],'simulator')
        self.assertEqual(len(self.adapters),3)

    def test_selected_usb_port_is_validated_and_saved_across_mode_changes(self):
        import json

        settings = Path(self.tmp.name) / 'connection.json'
        self.assertEqual(self.worker.snapshot()['serial_ports'], ['/dev/ttyUSB0', '/dev/ttyUSB1'])
        with self.assertRaises(ValueError):
            self.worker.submit('set_mode', {'mode': 'physical', 'port': '/dev/null'}).result(3)
        for port in ('/dev/ttyUSB0', '/dev/ttyUSB1'):
            self.worker.submit('set_mode', {'mode': 'physical', 'port': port}).result(3)
            self.assertEqual(self.worker.snapshot()['port'], port)
            self.assertEqual(json.loads(settings.read_text()), {'mode': 'physical', 'port': port})
        self.worker.submit('set_mode', {'mode': 'simulator'}).result(3)
        self.worker.submit('set_mode', {'mode': 'physical'}).result(3)
        self.assertEqual(self.worker.snapshot()['port'], '/dev/ttyUSB1')
        self.assertTrue(all(adapter.furnace.write_log == [] for adapter in self.adapters))

    def test_switch_while_running_or_paused_is_rejected_without_stop(self):
        self.worker.submit('run',{'memory':1}).result(3)
        for pause in (False,True):
            if pause:self.worker.submit('pause').result(3)
            count=len(self.adapters[0].furnace.write_log)
            with self.assertRaises(ValueError):self.worker.submit('set_mode',{'mode':'physical'}).result(3)
            self.assertEqual(len(self.adapters),1)
            self.assertEqual(len(self.adapters[0].furnace.write_log),count)

    def test_old_queued_run_cannot_execute_after_mode_switch(self):
        gate,entered=threading.Event(),threading.Event()
        execute=self.worker._execute
        def blocked(op,data,**kwargs):
            if op=='read':entered.set();gate.wait(2)
            return execute(op,data,**kwargs)
        self.worker._execute=blocked
        first=self.worker.submit('read')
        self.assertTrue(entered.wait(1))
        change=self.worker.submit('set_mode',{'mode':'physical'})
        oldrun=self.worker.submit('run',{'memory':1},origin='mqtt')
        gate.set()
        first.result(3);change.result(3)
        with self.assertRaisesRegex(ValueError,'origen de comunicación'):oldrun.result(3)
        self.assertTrue(all(not a.furnace.write_log for a in self.adapters))

    def test_physical_session_and_history_have_correct_mode(self):
        self.store.enable_mqtt_history()
        self.worker.submit('set_mode',{'mode':'physical'}).result(3)
        self.worker.submit('run',{'memory':1}).result(3)
        self.worker.submit('stop').result(3)
        session=self.store.firings()[0]
        self.assertEqual(session['mode'],'physical')
        import json
        self.assertTrue(all(json.loads(r['payload'])['mode']=='physical' for r in self.store.mqtt_history_batch()))


if __name__=='__main__':unittest.main()
