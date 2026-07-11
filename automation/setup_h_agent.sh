#!/usr/bin/env bash
# Set up H Company's Surfer-H agent for the h_agent step (client mode — no
# vllm/GPU; calls the hosted Holo API). Idempotent: safe to re-run.
#
#   bash automation/setup_h_agent.sh
#   export H_AGENT_MODE=surfer_cli HAI_API_KEY=<your key from portal.hcompany.ai>
#
set -euo pipefail

REPO_URL="https://github.com/hcompai/surfer-h-cli.git"
# Clone as a sibling of automation/ -> companyH/surfer-h-cli (matches h_agent.py default)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${SURFER_H_CLI_DIR:-$ROOT/surfer-h-cli}"

command -v uv >/dev/null || { echo "❌ 'uv' not found — install: https://docs.astral.sh/uv/"; exit 1; }

if [ ! -d "$CLI_DIR/.git" ]; then
  echo "📥 Cloning surfer-h-cli → $CLI_DIR"
  git clone --depth 1 "$REPO_URL" "$CLI_DIR"
else
  echo "✅ surfer-h-cli already present at $CLI_DIR"
fi

cd "$CLI_DIR"
echo "🐍 Creating client venv (no vllm — hosted API only)"
uv venv --python 3.12
# requirements.txt is the light client set; --no-deps installs the console
# script without pulling the heavy self-hosting stack (vllm/transformers).
uv pip install -r requirements.txt
uv pip install -e . --no-deps

[ -f .env ] || { cp .env.example .env; echo "📝 Wrote $CLI_DIR/.env (fill in HAI_API_KEY)"; }

echo
echo "✅ Done. Verify:  $CLI_DIR/.venv/bin/surfer-h-cli --help"
echo "Then run the automation service with:"
echo "    export H_AGENT_MODE=surfer_cli"
echo "    export HAI_API_KEY=<your key>"
echo "  (Chrome required for the browser; keep H_AGENT_HEADLESS=1 on a server.)"
