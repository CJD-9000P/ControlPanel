import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from cjd_panel.auth import PasswordVerifier,password_record,supplied_password
from cjd_panel.config import PanelConfig
from cjd_panel.server import Application

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('installer',ROOT/'scripts/install.py')
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_unicode_password_and_api(self):
        password='contraseña á:1234'
        record=password_record(password)
        self.assertNotIn(password,json.dumps(record))
        self.assertNotEqual(record['salt'],password_record(password)['salt'])
        header='Basic '+base64.b64encode((':'+password).encode()).decode()
        self.assertEqual(supplied_password(header),password)
        app=Application(None,None,password_record=record)
        for path,authorization,expected in [('/api/state','',401),('/api/state','Bearer incorrecta',401),('/healthz','',200)]:
            result=[]
            env={'PATH_INFO':path,'REQUEST_METHOD':'GET','HTTP_AUTHORIZATION':authorization,'HTTP_HOST':'127.0.0.1','wsgi.input':io.BytesIO()}
            b''.join(app(env,lambda status,headers:result.append(int(status.split()[0]))))
            self.assertEqual(result[0],expected)
        self.assertTrue(app.password_verifier.verify(supplied_password(header)))
        self.assertFalse(app.password_verifier.verify('incorrecta'))

    def test_private_config_and_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            installer.private_json(root/'.panel.json',PanelConfig(auth_required=True).as_dict())
            self.assertEqual(os.stat(root/'.panel.json').st_mode&0o777,0o600)
            self.assertTrue(PanelConfig.read(root/'.panel.json').auth_required)
            installer.copy_sources(ROOT,root)
            self.assertFalse((root/'.mqtt.json').exists())
            self.assertFalse((root/'.web-auth.json').exists())
            self.assertFalse((root/'data').exists())
            self.assertTrue((root/'instalar.sh').exists())
            self.assertTrue(PanelConfig.read(root/'.panel.json').auth_required)

    def test_service_respects_auth_and_port(self):
        spec=importlib.util.spec_from_file_location('service_installer',ROOT/'scripts/install_service.py')
        service=importlib.util.module_from_spec(spec);spec.loader.exec_module(service)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            installer.private_json(root/'.panel.json',PanelConfig(auth_required=True,port=8124).as_dict())
            unit=service.render_unit(root,str(root/'.venv/bin/python'))
            self.assertIn('--config',unit)
            self.assertNotIn('--no-auth',unit)
            self.assertIn('.venv/bin/python',unit)

    def test_reject_invalid_config(self):
        for options in ({'port':True},{'auth_required':'false'},{'host':'other'}):
            with self.assertRaises(ValueError):PanelConfig(**options)

    def test_wizard_basic_install(self):
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'panel'
            answers=iter([str(target),'n','n','18765','n','n','n','s'])
            with patch('builtins.input',lambda prompt:next(answers)),patch('sys.argv',['install.py']):
                installer.main()
            self.assertTrue((target/'data/cjd.sqlite3').exists())
            settings=PanelConfig.read(target/'.panel.json')
            self.assertFalse(settings.mqtt_enabled)
            self.assertFalse(settings.auth_required)
            self.assertTrue((target/'.venv/bin/python').exists())
