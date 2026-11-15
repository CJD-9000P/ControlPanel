"""Genera bin/instalar-cjd.sh únicamente si cambia la versión fuente del producto."""
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT))
from cjd_panel import __version__


def generate(root=ROOT,version=__version__):
    if not re.fullmatch(r'\d+\.\d+\.\d+',version):
        raise ValueError('La versión del lanzador debe ser numérica: mayor.menor.parche.')
    target=Path(root)/'bin/instalar-cjd.sh'
    marker='# CJD_LAUNCHER_VERSION='+version
    if target.exists() and marker in target.read_text().splitlines():return False
    content=(Path(root)/'packaging/instalar-cjd.sh.in').read_text().replace('@VERSION@',version)
    target.parent.mkdir(parents=True,exist_ok=True)
    temporary=target.with_suffix('.tmp')
    temporary.write_text(content)
    temporary.chmod(0o755)
    temporary.replace(target)
    return True


if __name__=='__main__':
    print('Lanzador generado.' if generate() else 'Misma versión: se conserva el lanzador existente.')
