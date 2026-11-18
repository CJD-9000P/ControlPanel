from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from cjd_panel.modbus import SimulatedRTU
from cjd_panel.store import Store
from cjd_panel.worker import Worker
from scripts import apply_update


class UpdateWorkerTests(unittest.TestCase):
    def test_update_requires_idle_and_blocks_new_starts(self):
        with tempfile.TemporaryDirectory() as folder:
            store = Store(Path(folder) / 'cjd.sqlite3')
            adapter = SimulatedRTU()
            worker = Worker(adapter, store, interval=0.1)
            worker.start()
            try:
                worker.submit('read').result(3)
                self.assertTrue(worker.snapshot()['update_idle'])
                worker.submit('run', {'memory': 1}).result(3)
                self.assertFalse(worker.snapshot()['update_idle'])
                launches = []
                request = {'launch': lambda: launches.append(True)}
                with self.assertRaises(ValueError):
                    worker.submit('prepare_update', request).result(3)
                worker.submit('pause').result(3)
                self.assertFalse(worker.snapshot()['update_idle'])
                worker.submit('stop').result(3)
                worker.submit('prepare_update', request).result(3)
                self.assertEqual(launches, [True])
                self.assertTrue(worker.snapshot()['update_pending'])
                with self.assertRaisesRegex(ValueError, 'Actualización'):
                    worker.submit('run', {'memory': 1}).result(3)
            finally:
                worker.close()
                store.close()


class ApplyUpdateTests(unittest.TestCase):
    def test_restart_failure_restores_sources_and_preserves_data(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            workspace = root / '.cjd-update'
            prepared = workspace / 'prepared'
            prepared.mkdir(parents=True)
            data = root / 'data'
            data.mkdir()
            settings = root / '.panel.json'
            settings.write_text('private')
            (root / 'program.py').write_text('old')
            (prepared / 'program.py').write_text('new')
            (prepared / 'new.py').write_text('added')
            db = sqlite3.connect(data / 'cjd.sqlite3')
            db.execute('CREATE TABLE curves (name TEXT)')
            db.execute("INSERT INTO curves VALUES ('Test curve')")
            db.commit()
            db.close()
            with (
                patch.object(apply_update, 'systemctl', side_effect=[str(root), '', '', '', '', '']) as service,
                patch.object(apply_update, 'wait_for_version', side_effect=RuntimeError('health failure')),
                self.assertRaisesRegex(RuntimeError, 'health failure'),
            ):
                apply_update.apply(root, data, 8080, '0.7.11', workspace)
            self.assertEqual([call.args[0] for call in service.call_args_list],
                             ['show', 'stop', 'start', 'stop', 'reset-failed', 'start'])
            self.assertEqual((root / 'program.py').read_text(), 'old')
            self.assertFalse((root / 'new.py').exists())
            self.assertEqual(settings.read_text(), 'private')
            backup, = data.glob('cjd.pre-update-*.bak')
            db = sqlite3.connect(backup)
            self.assertEqual(db.execute('SELECT name FROM curves').fetchone(), ('Test curve',))
            db.close()
