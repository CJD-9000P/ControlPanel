"""Verifica la exclusión real de configuración privada en el paquete distribuido."""
import importlib.util
import json
from pathlib import Path
import tarfile
import tempfile
import unittest


class PackagingPrivacyTest(unittest.TestCase):
    def test_private_config_excluded_and_example_distributed(self):
        root=Path(__file__).resolve().parent.parent
        spec=importlib.util.spec_from_file_location('cjd_packaging_test',root/'packaging/build.py')
        build=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(build)
        with tempfile.TemporaryDirectory() as tmp:
            work=Path(tmp)
            for name in ['cjd_panel','docs','scripts']:(work/name).mkdir()
            for name in ['requirements.txt','requirements-mqtt.txt','requirements-modbus.txt','.gitignore']:(work/name).write_text('')
            example=json.loads((root/'mqtt.example.json').read_text())
            (work/'mqtt.example.json').write_text(json.dumps(example))
            (work/'modbus.example.json').write_text((root/'modbus.example.json').read_text())
            marker='PRIVATE_CONFIG_MUST_NEVER_SHIP'
            for path in [work/'.mqtt.json',work/'docs/.mqtt.json',work/'scripts/.env',work/'docs/.modbus.json']:
                path.write_text(marker)
            (work/'scripts/.mqtt-deps').mkdir()
            (work/'scripts/.mqtt-deps/secret.py').write_text(marker)
            (work/'docs/public.md').write_text('Contenido público')
            build.ROOT=work
            build.build()
            manifest=json.loads((work/'dist/manifest.json').read_text())
            self.assertIn('mqtt.example.json',manifest['sha256'])
            self.assertIn('docs/public.md',manifest['sha256'])
            archive_path=next((work/'dist').glob('*.tar.gz'))
            with tarfile.open(archive_path) as archive:
                for member in archive:
                    self.assertNotIn('/.mqtt.json',member.name)
                    self.assertNotIn('/.env',member.name)
                    self.assertNotIn('/.modbus.json',member.name)
                    self.assertNotIn('/.mqtt-deps/',member.name)
                    self.assertNotIn(marker.encode(),archive.extractfile(member).read())


if __name__=='__main__':unittest.main()
