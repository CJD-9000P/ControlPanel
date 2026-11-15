"""Empaqueta fuentes y referencias; excluye datos, secretos y cachés."""
import hashlib
import json
from pathlib import Path
import sys
import tarfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from cjd_panel import __version__


def build():
    output = ROOT / "dist"
    output.mkdir(exist_ok=True)
    filename = output / f"cjd-control-panel-{__version__}.tar.gz"
    paths = [ROOT / n for n in ["cjd_panel", "fuentes_referencia", "tests", "docs", "packaging", "ui_reference", "scripts"]]
    paths += list(ROOT.glob("*.md")) + [ROOT / "requirements.txt", ROOT / "requirements-mqtt.txt", ROOT / "mqtt.example.json", ROOT / "modbus.example.json", ROOT / "requirements-modbus.txt", ROOT / "requirements-bootstrap.txt", ROOT / "installer-wheels.json", ROOT / "instalar.sh", ROOT / "instalar-fedora.sh", ROOT / "iniciar.sh", ROOT / ".gitignore"]
    files = sorted({f for p in paths for f in (p.rglob("*") if p.is_dir() else [p])
                    if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc"
                    and f.name not in {"CJD9000P_Fedora_CJD_V7_3.py", ".mqtt.json", ".modbus.json", ".panel.json", ".web-auth.json", ".env"}
                    and ".mqtt-deps" not in f.parts and ".serial-deps" not in f.parts})
    manifest = {"version": __version__, "sha256": {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}}
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+"\n")
    prefix = f"cjd-control-panel-{__version__}"
    with tarfile.open(filename, "w:gz") as archive:
        for p in files:
            archive.add(p, arcname=f"{prefix}/{p.relative_to(ROOT)}", recursive=False)
        archive.add(manifest_path, arcname=f"{prefix}/manifest.json")
    print(filename)
    print("SHA-256:", hashlib.sha256(filename.read_bytes()).hexdigest())


if __name__ == "__main__":
    build()
