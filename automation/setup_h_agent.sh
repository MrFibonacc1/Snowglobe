#!/usr/bin/env bash
# H Company agent setup.
#
# PRIMARY PATH (recommended) — the hosted Computer-Use Agent API. No clone,
# no browser, no venv beyond the automation service's own deps (httpx):
#
#     export H_AGENT_MODE=agent_api
#     export HAI_API_KEY=hk-...        # from portal.hcompany.ai
#
# That's it — see automation/NOTES.md. This script only sets up the LEGACY
# surfer-h-cli backend (deprecated upstream; for self-hosting Holo via vLLM
# with a local Selenium browser). Most teams do NOT need this.
#
#     bash automation/setup_h_agent.sh          # only for surfer_cli mode
#
set -euo pipefail

REPO_URL="https://github.com/hcompai/surfer-h-cli.git"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI_DIR="${SURFER_H_CLI_DIR:-$ROOT/surfer-h-cli}"

echo "⚠️  surfer-h-cli is DEPRECATED upstream. For the supported path use"
echo "    H_AGENT_MODE=agent_api (just needs HAI_API_KEY). See automation/NOTES.md."
echo

command -v uv >/dev/null || { echo "❌ 'uv' not found — install: https://docs.astral.sh/uv/"; exit 1; }

if [ ! -d "$CLI_DIR/.git" ]; then
  echo "📥 Cloning surfer-h-cli → $CLI_DIR"
  git clone --depth 1 "$REPO_URL" "$CLI_DIR"
else
  echo "✅ surfer-h-cli already present at $CLI_DIR"
fi

cd "$CLI_DIR"
echo "🐍 Creating client venv (no vllm)"
uv venv --python 3.12
uv pip install -r requirements.txt
uv pip install -e . --no-deps
[ -f .env ] || cp .env.example .env

echo
echo "✅ Legacy CLI ready: $CLI_DIR/.venv/bin/surfer-h-cli --help"
echo "   Needs a self-hosted Holo (vLLM) + working local Chrome; see NOTES.md gotcha."
