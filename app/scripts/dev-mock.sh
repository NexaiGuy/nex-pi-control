#!/usr/bin/env bash
# Ontwikkelen zonder Pi: start hal-agent en hal-shell in mock-modus op je Kali en maak ze via USB bereikbaar
# voor je gsm (adb reverse). Stel in de app (debug-build) als API-URL http://127.0.0.1:8120 in.
# Tokens: mock-token-for-local-development-only-000000 en mock-shell-token-for-local-development-00000
set -euo pipefail
AGENT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../agent" && pwd)"
SCENARIO="${1:-disk}"   # ok | disk | busy

if [[ ! -x "$AGENT/.venv/bin/python" ]]; then
  python3 -m venv "$AGENT/.venv"
  "$AGENT/.venv/bin/pip" install -q -r "$AGENT/requirements-dev.txt"
fi
command -v adb >/dev/null && adb reverse tcp:8120 tcp:8120 >/dev/null 2>&1 && adb reverse tcp:8121 tcp:8121 >/dev/null 2>&1 && echo "adb reverse actief (8120, 8121)"

cd "$AGENT"
HAL_SHELL_MOCK=1 .venv/bin/python -m hal_shell &
SHELL_PID=$!
trap 'kill $SHELL_PID 2>/dev/null || true' EXIT
echo "Mock-agent scenario: $SCENARIO  (API-docs: http://127.0.0.1:8120/docs)"
HAL_AGENT_MOCK=1 HAL_AGENT_MOCK_SCENARIO="$SCENARIO" HAL_AGENT_SHELL_URL=http://127.0.0.1:8121 .venv/bin/python -m hal_agent
