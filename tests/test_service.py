"""Comprueba que el servicio conserva datos y no incorpora credenciales."""
import importlib.util
from pathlib import Path
import tempfile
import unittest


class ServiceUnitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        root=Path(__file__).resolve().parent.parent
        spec=importlib.util.spec_from_file_location('cjd_install_service_test',root/'scripts/install_service.py')
        cls.module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.module)

    def test_preserves_project_data_and_uses_private_config_by_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            secret='DO_NOT_PUBLISH_THIS_PASSWORD'
            (root/'.mqtt.json').write_text(secret)
            unit=self.module.render_unit(root)
            self.assertIn(str(root/'data'),unit)
            self.assertIn(str(root/'.mqtt.json'),unit)
            self.assertIn(str(root/'.modbus.json'),unit)
            self.assertNotIn(secret,unit)
            self.assertNotIn('.local/share',unit)
            self.assertIn('WantedBy=default.target',unit)
            self.assertNotIn('After=default.target',unit)
            self.assertIn('Restart=on-failure',unit)
            self.assertNotIn('PrivateTmp=true',unit)

    def test_unit_quotes_paths_without_shell_or_specifier_expansion(self):
        unit=self.module.render_unit(Path('/tmp/Panel con espacios % prueba $valor'))
        self.assertIn('WorkingDirectory=/tmp/Panel con espacios %% prueba $valor',unit)
        self.assertIn('"/tmp/Panel con espacios %% prueba $$valor/data"',unit)
        self.assertNotIn('/bin/sh',unit)
        for invalid in ['/tmp/bad\nExecStart=malicious','/tmp/bad\0name']:
            with self.assertRaises(ValueError):self.module.quote(invalid)


if __name__=='__main__':unittest.main()
