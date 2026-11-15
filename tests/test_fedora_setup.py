import unittest
import os
from pathlib import Path
import subprocess
import tempfile
from unittest.mock import patch
from scripts import fedora_setup as fedora


class FedoraSetupTest(unittest.TestCase):
    def test_platform_is_detected_without_assuming_like(self):
        for identity,expected in [('fedora',True),('debian',False),('rhel',False)]:
            with patch('platform.freedesktop_os_release',return_value={'ID':identity}):
                self.assertEqual(fedora.is_fedora(),expected)

    def test_no_changes_when_not_requested(self):
        self.assertEqual(fedora.commands({},8080),[])
        with patch.object(fedora,'is_fedora',return_value=False):
            self.assertEqual(fedora.collect(lambda *a: self.fail('No preguntar'),True,True),{})

    def test_explicit_group_and_scoped_firewall_no_shell(self):
        commands=fedora.commands({'serial_user':'operador','zone':'home'},8123)
        self.assertEqual(commands[0],['sudo','usermod','--append','--groups','dialout','--','operador'])
        self.assertEqual(commands[1],['sudo','firewall-cmd','--zone=home','--add-port=8123/tcp'])
        self.assertEqual(commands[2],['sudo','firewall-cmd','--permanent','--zone=home','--add-port=8123/tcp'])
        self.assertFalse(any('--reload' in command for command in commands))
        with self.assertRaises(ValueError):fedora.commands({},True)

    def test_apply_runs_only_approved_actions(self):
        with patch.object(fedora.subprocess,'run') as run:
            fedora.apply({'zone':'home'},8080)
            self.assertEqual(run.call_count,2)
            for call in run.call_args_list:self.assertEqual(call.kwargs,{'check':True})

    def test_dnf_bootstrap_commands_with_fake_tools(self):
        root=Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            (folder/'scripts').mkdir()
            (folder/'instalar.sh').write_bytes((root/'instalar.sh').read_bytes())
            log=folder/'commands'
            tools={
                'id':'#!/bin/sh\necho 1000\n',
                'python3':'#!/bin/sh\nif [ ! -e "$TEST_DIR/checked" ]; then touch "$TEST_DIR/checked"; exit 1; fi\nprintf "%s\\n" "$*" >> "$TEST_DIR/commands"\n',
                'dnf':'#!/bin/sh\nexit 0\n',
                'sudo':'#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_DIR/commands"\n',
                'apt-get':'#!/bin/sh\nexit 99\n',
            }
            # El lanzador prioriza apt si existe: ocultarlo usando un PATH mínimo.
            del tools['apt-get']
            bin_dir=folder/'bin';bin_dir.mkdir()
            for name,body in tools.items():
                file=bin_dir/name;file.write_text(body);file.chmod(0o755)
            for name in ('dirname','touch'):
                (bin_dir/name).symlink_to('/usr/bin/'+name)
            env=dict(os.environ,PATH=str(bin_dir),TEST_DIR=str(folder))
            result=subprocess.run(['/bin/sh',str(folder/'instalar.sh')],input='s\n',text=True,capture_output=True,env=env)
            self.assertEqual(result.returncode,0,result.stderr)
            calls=log.read_text()
            self.assertIn('dnf install -y python3 python3-pip ca-certificates',calls)
            self.assertIn('scripts/install.py',calls)
            self.assertNotIn('apt-get',calls)

    def test_collect_requires_existing_firewall_zone(self):
        def query(args,**kwargs):
            output={'--state':'running','--get-zones':'home public','--get-active-zones':'home\n  interfaces: test0'}[args[1]]
            return subprocess.CompletedProcess(args,0,output,'')
        with patch.object(fedora,'is_fedora',return_value=True),patch.object(fedora.Path,'exists',return_value=False),patch.object(fedora.shutil,'which',return_value='/usr/bin/firewall-cmd'),patch.object(fedora.subprocess,'run',side_effect=query):
            with patch('builtins.input',return_value='home'):
                self.assertEqual(fedora.collect(lambda *a:True,True,False),{'zone':'home'})
            with patch('builtins.input',return_value='not-a-zone'):
                with self.assertRaises(ValueError):fedora.collect(lambda *a:True,True,False)
