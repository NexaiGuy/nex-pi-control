#!/usr/bin/env bash
# Nex Pi Control agent installer. Downloads the latest source from GitHub and runs agent/setup.sh
# (first install) or agent/deploy.sh (update). Everything it does is in this repository, read it first:
#   https://github.com/NexaiGuy/nex-pi-control
#
#   curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash -s -- --tailscale
#   curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash -s -- --lan
#   curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash
set -euo pipefail

REPO="${NEX_PI_REPO:-https://github.com/NexaiGuy/nex-pi-control.git}"
BRANCH="${NEX_PI_BRANCH:-main}"

die() { printf '\033[31mERROR\033[0m %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Run with sudo: curl -fsSL <url> | sudo bash -s -- [--tailscale|--lan]"
[[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]] || die "Run from your normal user account with sudo, not as root. The admin shell runs as that user."

if ! command -v git >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q git
fi

WORK="$(mktemp -d /tmp/nex-pi-control.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$WORK/src"
echo "Nex Pi Control agent, commit $(git -C "$WORK/src" rev-parse --short HEAD)"

ARGS=()
for a in "$@"; do [[ "$a" == "--reinstall" ]] || ARGS+=("$a"); done
if [[ -f /opt/hal-agent/hal_agent/__init__.py && -f /etc/hal-agent/agent.env && $# -eq 0 ]]; then
  echo "Existing installation found: updating (backup first, configuration and tokens stay)."
  bash "$WORK/src/agent/deploy.sh"
else
  # First install, or a change of connection method (setup.sh is idempotent and keeps your tokens).
  bash "$WORK/src/agent/setup.sh" "${ARGS[@]}"
fi
