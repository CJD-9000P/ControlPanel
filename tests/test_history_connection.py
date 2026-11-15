"""Regresiones de históricos completos y arranque/reconexión RTU simulados."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

from cjd_panel.analysis import chart_data, summarize
from cjd_panel.modbus import CommunicationError, SimulatedRTU
from cjd_panel.store import Store
from cjd_panel.worker import Worker


class HistoryTimelineTest(unittest.TestCase):
    def rows(self, count=4001):
        base = datetime(2026, 11, 15, tzinfo=timezone.utc)
        return [dict(id=i, timestamp=(base+timedelta(seconds=i)).isoformat(),
                     pv=90, sv=100, memory=1, step=1, state=1) for i in range(count)]

    def test_first_and_brief_segments_survive_reduction(self):
        rows = self.rows()
        rows[1]['step'] = 2  # Se perdería con stride=3.
        reduced, timeline = chart_data(rows, reduced=True)
        self.assertLess(len(reduced), len(rows))
        self.assertEqual([s['step'] for s in timeline['segments']], [1, 2, 1])
        self.assertEqual(timeline['segments'][1]['timestamp'], rows[1]['timestamp'])

    def test_gap_boundaries_survive_and_do_not_split_normal_sampling(self):
        rows = self.rows()
        # Conservar un hueco de un minuto en medio de miles de puntos.
        for r in rows[1001:]:
            r['timestamp'] = (datetime.fromisoformat(r['timestamp'])+timedelta(seconds=60)).isoformat()
        reduced, timeline = chart_data(rows, reduced=True)
        self.assertEqual(len(timeline['gaps']), 1)
        by_id = {r['id']: r for r in reduced}
        self.assertIn(1000, by_id)
        self.assertIn(1001, by_id)
        self.assertNotEqual(by_id[1000]['plot_group'], by_id[1001]['plot_group'])
        self.assertEqual(by_id[0]['plot_group'], by_id[999]['plot_group'])

    def test_pauses_use_explicit_state_not_flat_sv(self):
        rows = self.rows(8)
        self.assertEqual(chart_data(rows)[1]['pauses'], [])
        rows[1]['state'] = rows[2]['state'] = 2
        rows[-1]['state'] = 2
        pauses = chart_data(rows)[1]['pauses']
        self.assertEqual(pauses, [dict(start=rows[1]['timestamp'], end=rows[3]['timestamp'], open=False),
                                 dict(start=rows[-1]['timestamp'], end=rows[-1]['timestamp'], open=True)])

    def test_signed_deviation_retains_sign_and_all_samples(self):
        rows = self.rows(3)
        rows[1]['pv'] = 120
        result = summarize(rows)
        self.assertEqual(result['mean_deviation'], 0)
        self.assertAlmostEqual(result['mean_abs_deviation'], 40/3)
        self.assertEqual(result['segments'][0]['mean_deviation'], 0)
        self.assertIsNone(summarize([])['mean_deviation'])

    def test_empty_and_duplicate_timestamps(self):
        self.assertEqual(chart_data([]), ([], dict(segments=[], gaps=[], pauses=[])))
        rows = self.rows(2)
        rows[1]['timestamp'] = rows[0]['timestamp']
        reduced, timeline = chart_data(rows)
        self.assertNotEqual(reduced[0]['plot_group'], reduced[1]['plot_group'])
        self.assertEqual(timeline['gaps'][0]['seconds'], 0)


class StartupCommunicationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name)/'test.sqlite3')
        self.adapter = SimulatedRTU(segment_seconds=60, timeout=.05)
        self.worker = Worker(self.adapter, self.store, interval=.05)

    def tearDown(self):
        if self.worker.thread.is_alive():
            self.worker.close()
        else:
            self.adapter.close()
        self.store.close()
        self.temp.cleanup()

    def wait_for(self, predicate, timeout=2):
        limit = time.monotonic()+timeout
        while time.monotonic() < limit:
            if predicate():
                return
            time.sleep(.01)
        self.fail('Condición de comunicación no alcanzada')

    def test_start_with_already_running_controller_is_read_only(self):
        self.adapter.simulate('run')
        writes = list(self.adapter.furnace.write_log)
        self.worker.start()
        self.worker.submit('read').result(2)
        state = self.worker.snapshot()
        self.assertTrue(state['online'])
        self.assertEqual(state['state'], 1)
        self.assertEqual(self.adapter.furnace.write_log, writes)
        self.assertEqual(len(self.store.firings()), 1)
        self.assertEqual(self.store.firings()[0]['origin'], 'observed')
        self.assertFalse(state['physical_usb_supported'])

    def test_start_with_already_paused_controller(self):
        self.adapter.simulate('run')
        self.adapter.simulate('pause')
        writes = list(self.adapter.furnace.write_log)
        self.worker.start()
        self.worker.submit('read').result(2)
        self.assertEqual(self.worker.snapshot()['state'], 2)
        self.assertEqual(self.store.firings()[0]['status'], 'paused')
        self.assertEqual(self.adapter.furnace.write_log, writes)

    def test_initial_offline_reports_once_then_recovers_without_writes(self):
        self.adapter.simulate('offline')
        self.worker.start()
        self.wait_for(lambda: self.worker.snapshot()['communication_status'] == 'offline')
        with self.assertRaises(CommunicationError):
            self.worker.submit('read').result(2)
        self.assertEqual(len([e for e in self.store.events() if e['kind']=='offline']), 1)
        self.assertEqual(self.store.firings(), [])
        self.adapter.simulate('online')
        self.worker.submit('read').result(2)
        self.assertTrue(self.worker.snapshot()['online'])
        self.assertEqual(self.adapter.furnace.write_log, [])

    def test_stale_or_dead_worker_cannot_appear_online(self):
        self.worker.start()
        self.worker.submit('read').result(2)
        with self.worker.lock:
            with patch('cjd_panel.worker.time.monotonic', return_value=self.worker.last_success+self.worker.freshness_limit+1):
                state = self.worker.snapshot()
        self.assertFalse(state['online'])
        self.assertEqual(state['communication_status'], 'stale')
        with patch.object(self.worker.thread, 'is_alive', return_value=False):
            self.assertFalse(self.worker.snapshot()['online'])

    def test_partial_memory_sync_is_not_published(self):
        read = self.adapter.read
        def incomplete(address, count=1):
            if address == 0x50 and count == 40:
                raise CommunicationError('Memoria no disponible')
            return read(address, count)
        self.adapter.read = incomplete
        self.worker.start()
        self.wait_for(lambda: self.worker.snapshot()['communication_status'] == 'offline')
        self.assertEqual(self.worker.snapshot()['memories'], {})
        self.adapter.read = read
        self.worker.submit('read').result(2)
        self.assertEqual(len(self.worker.snapshot()['memories']), 4)

    def test_state_is_rechecked_after_memory_sync(self):
        # Cambio externo justo antes de leer memorias: publicar el estado final.
        read = self.adapter.read
        triggered = False
        def changing(address, count=1):
            nonlocal triggered
            if address == 0 and count == 40 and not triggered:
                triggered = True
                self.adapter.simulate('run')
            return read(address, count)
        self.adapter.read = changing
        self.worker.start()
        self.worker.submit('read').result(2)
        self.assertEqual(self.worker.snapshot()['state'], 1)
        self.assertEqual(len(self.store.firings()), 1)

    def test_io_error_is_reported_as_communication_error_and_recovers(self):
        read = self.adapter.read
        self.worker.start()
        self.worker.submit('read').result(2)
        def unavailable(*args):
            raise OSError('PTY no disponible')
        self.adapter.read = unavailable
        with self.assertRaises(CommunicationError):
            self.worker.submit('read').result(2)
        self.assertFalse(self.worker.snapshot()['online'])
        self.adapter.read = read
        self.worker.submit('read').result(2)
        self.assertTrue(self.worker.snapshot()['online'])

    def test_memory_change_during_sync_is_rejected(self):
        read = self.adapter.read
        count = 0
        def changing(address, size=1):
            nonlocal count
            values = read(address, size)
            if address == 0xA0:
                count += 1
                return [1 if count % 2 else 2]
            return values
        self.adapter.read = changing
        self.worker.start()
        with self.assertRaises(CommunicationError):
            self.worker.submit('read').result(2)
        self.assertFalse(self.worker.snapshot()['online'])
        self.assertEqual(self.store.firings(), [])
        self.assertEqual(self.adapter.furnace.write_log, [])
        self.adapter.read = read
        self.worker.submit('read').result(2)
        self.assertTrue(self.worker.snapshot()['online'])


if __name__ == '__main__':
    unittest.main()
