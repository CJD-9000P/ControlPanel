import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('launcher_generator',ROOT/'packaging/generate_launcher.py')
generator=importlib.util.module_from_spec(spec);spec.loader.exec_module(generator)


class LauncherTests(unittest.TestCase):
    def test_generate_only_on_version_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'packaging').mkdir()
            template=root/'packaging/instalar-cjd.sh.in'
            shutil.copyfile(ROOT/'packaging/instalar-cjd.sh.in',template)
            self.assertTrue(generator.generate(root,'1.2.3'))
            target=root/'bin/instalar-cjd.sh'
            before=target.stat().st_mtime_ns
            template.write_text(template.read_text()+'\n# plantilla modificada\n')
            self.assertFalse(generator.generate(root,'1.2.3'))
            self.assertEqual(before,target.stat().st_mtime_ns)
            self.assertNotIn('plantilla modificada',target.read_text())
            self.assertTrue(generator.generate(root,'1.2.4'))
            self.assertIn('CJD_LAUNCHER_VERSION=1.2.4',target.read_text())
            self.assertIn('plantilla modificada',target.read_text())
            self.assertEqual(target.stat().st_mode&0o777,0o755)
            with self.assertRaises(ValueError):generator.generate(root,"bad'; exit 0")

    def test_report_version_without_network(self):
        from cjd_panel import __version__
        result=subprocess.run(['sh',str(ROOT/'bin/instalar-cjd.sh'),'--version'],capture_output=True,text=True)
        self.assertEqual(result.returncode,0)
        self.assertEqual(result.stdout.strip(),__version__)

    def test_check_missing_python_never_installs_or_downloads(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for command,body in {
                'uname':'echo Linux','id':'echo 1000','python3':'exit 1',
                'curl':'exit 99','tar':'exit 99','mktemp':'exit 99',
                'sudo':'echo UNEXPECTED_INSTALL; exit 99',
            }.items():
                file=root/command;file.write_text('#!/bin/sh\n'+body+'\n');file.chmod(0o755)
            result=subprocess.run(['/bin/sh',str(ROOT/'bin/instalar-cjd.sh'),'--check'],env=dict(os.environ,PATH=str(root)),capture_output=True,text=True)
            self.assertEqual(result.returncode,1)
            self.assertIn('Requisitos pendientes:',result.stdout)
            self.assertNotIn('UNEXPECTED_INSTALL',result.stdout)

    def test_root_rejected_before_download(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for command,body in {'uname':'echo Linux','id':'echo 0'}.items():
                file=root/command;file.write_text('#!/bin/sh\n'+body+'\n');file.chmod(0o755)
            result=subprocess.run(['/bin/sh',str(ROOT/'bin/instalar-cjd.sh')],env=dict(os.environ,PATH=str(root)),capture_output=True,text=True)
            self.assertEqual(result.returncode,1)
            self.assertIn('sin sudo',result.stderr)
