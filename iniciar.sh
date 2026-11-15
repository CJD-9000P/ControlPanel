#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec .venv/bin/python -m cjd_panel --config .panel.json "$@"
