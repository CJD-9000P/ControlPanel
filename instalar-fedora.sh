#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ ! -r /etc/os-release ]; then
    echo 'No se puede identificar Fedora.'; exit 1
fi
. /etc/os-release
if [ "${ID:-}" != fedora ]; then
    echo 'Este lanzador es para Fedora. En Debian/Ubuntu usa ./instalar.sh.'; exit 1
fi
if [ -e /run/ostree-booted ]; then
    echo 'Fedora Atomic/Silverblue requiere un procedimiento específico, pendiente de comprobar.'; exit 1
fi
exec ./instalar.sh "$@"
