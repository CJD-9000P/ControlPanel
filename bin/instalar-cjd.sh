#!/bin/sh
# Generado por packaging/generate_launcher.py; editar la plantilla, no este archivo.
# CJD_LAUNCHER_VERSION=0.7.9
set -eu
CJD_VERSION='0.7.9'
case "${1:-}" in
    --version) printf '%s\n' "$CJD_VERSION"; exit 0;;
    --check|'') ;;
    *) echo 'Uso: instalar-cjd.sh [--check | --version]'; exit 2;;
esac
if [ "$(uname -s)" != Linux ]; then echo 'Se requiere Linux.' >&2; exit 1; fi
if [ "$(id -u)" -eq 0 ]; then echo 'Ejecuta este lanzador como usuario normal, sin sudo.' >&2; exit 1; fi
if [ ! -r /etc/os-release ]; then echo 'No se puede identificar la distribución.' >&2; exit 1; fi
. /etc/os-release
case "${ID:-}" in
    fedora|debian|ubuntu) ;;
    *) echo 'Distribución pendiente de comprobar. Usa Fedora, Debian o Ubuntu.' >&2; exit 1;;
esac
if [ -e /run/ostree-booted ]; then echo 'Fedora Atomic/Silverblue requiere otro procedimiento.' >&2; exit 1; fi
check_requirements() {
    cjd_missing=''
    for cjd_tool in curl tar mktemp; do
        command -v "$cjd_tool" >/dev/null 2>&1 || cjd_missing="$cjd_missing $cjd_tool"
    done
    if ! python3 -c 'import sys,sqlite3,ssl,venv; assert sys.version_info >= (3,11)' 2>/dev/null; then
        cjd_missing="$cjd_missing Python>=3.11/SQLite/SSL/venv"
    fi
    [ -z "$cjd_missing" ]
}
if ! check_requirements; then
    echo "Requisitos pendientes:$cjd_missing"
    if [ "${1:-}" = --check ]; then exit 1; fi
    if [ ! -t 0 ]; then echo 'Abre una terminal interactiva para instalar los requisitos.' >&2; exit 1; fi
    printf '¿Instalar los paquetes base con sudo? [s/N]: '
    read -r cjd_answer
    case "$cjd_answer" in s|S|si|sí) ;; *) exit 1;; esac
    command -v sudo >/dev/null 2>&1 || { echo 'Falta sudo; un administrador debe instalar los requisitos.' >&2; exit 1; }
    case "$ID" in
        fedora) sudo dnf install -y curl tar python3 python3-pip ca-certificates;;
        debian|ubuntu)
            sudo apt-get update
            sudo apt-get install -y curl tar python3 python3-venv python3-pip ca-certificates;;
    esac
    check_requirements || { echo "Siguen faltando requisitos:$cjd_missing" >&2; exit 1; }
fi
printf 'Requisitos mínimos correctos · CJD Control Panel %s · %s\n' "$CJD_VERSION" "$ID"
if [ "${1:-}" = --check ]; then exit 0; fi
if [ ! -t 0 ]; then echo 'Ejecuta el script en una terminal para responder al asistente; evita curl | sh.' >&2; exit 1; fi
cjd_download=$(mktemp -d "${TMPDIR:-/tmp}/cjd-install.XXXXXXXX")
printf 'Descargando instalador en %s\n' "$cjd_download"
curl --fail --location --proto '=https' --tlsv1.2 --connect-timeout 20 --max-time 300 \
    "https://github.com/CJD-9000P/ControlPanel/archive/refs/heads/version/$CJD_VERSION.tar.gz" \
    --output "$cjd_download/app.tar.gz"
mkdir "$cjd_download/source"
tar -xzf "$cjd_download/app.tar.gz" -C "$cjd_download/source" --strip-components=1
python3 - "$cjd_download/source/cjd_panel/__init__.py" "$CJD_VERSION" <<'PY'
import ast
from pathlib import Path
import sys
version=None
for node in ast.parse(Path(sys.argv[1]).read_text()).body:
    if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='__version__' for t in node.targets):
        version=ast.literal_eval(node.value)
if version!=sys.argv[2]:raise SystemExit('La versión descargada no coincide; instalación cancelada.')
PY
# Los archivos descargados se conservan para diagnóstico; no contienen credenciales.
cd "$cjd_download/source"
sh ./instalar.sh
