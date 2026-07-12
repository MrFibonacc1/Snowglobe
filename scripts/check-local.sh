#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="$ROOT/.venv-check/bin/python"

cd "$ROOT"
"$PYTHON" -m unittest discover -s automation/tests -v
"$PYTHON" -m unittest discover -s perception/tests -v
npm --prefix dashboard test -- --run
npm --prefix dashboard run build
docker compose config --quiet
