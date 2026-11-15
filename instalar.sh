#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ "$(id -u)" -eq 0 ]; then
    echo 'Ejecuta este instalador como usuario normal, sin sudo.'; exit 1
fi
if [ -e /run/ostree-booted ]; then
    echo 'Fedora Atomic/Silverblue requiere un procedimiento específico, pendiente de comprobar.'; exit 1
fi
if ! python3 -c 'import sys,sqlite3,ssl,venv; assert sys.version_info >= (3,11)' 2>/dev/null; then
    printf 'Falta Python >= 3.11 con SQLite, SSL o venv. ¿Instalar paquetes del sistema? [s/N]: '
    read -r answer
    case "$answer" in s|S|si|sí)
        if command -v apt-get >/dev/null; then
            sudo apt-get update
            sudo apt-get install -y python3 python3-venv python3-pip ca-certificates
        elif command -v dnf >/dev/null; then
            sudo dnf install -y python3 python3-pip ca-certificates
        else
            echo 'Instala Python >= 3.11, SQLite, SSL y venv con el gestor de tu distribución.'; exit 1
        fi;;
        *) exit 1;;
    esac
fi
python3 -c 'import sys,sqlite3,ssl,venv; assert sys.version_info >= (3,11)' || {
    echo 'Python >= 3.11 con SQLite, SSL y venv sigue sin estar disponible.'; exit 1;
}
exec python3 scripts/install.py "$@"
