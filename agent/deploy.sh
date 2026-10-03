#!/usr/bin/env bash
# Updates an existing Nex Pi Control agent. Backs up first, replaces only changed files
# and restarts hal-agent only when code changed. Timers keep running.
#
#   sudo bash agent/deploy.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP=/opt/hal-agent
ETC=/etc/hal-agent
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP="/opt/hal-agent-backups/premigrate-$TS"
SHELL_USER="$(awk -F= '/^User=/{print $2}' /etc/systemd/system/hal-shell.service 2>/dev/null || true)"
SHELL_USER="${SHELL_USER:-${SUDO_USER:-}}"
[[ -n "$SHELL_USER" ]] || { echo "Run via sudo from your normal account." >&2; exit 1; }
SHELL_GROUP="$(id -gn "$SHELL_USER")"

[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
[[ -d "$APP" ]] || { echo "No existing install. Use setup.sh." >&2; exit 1; }

install -d -m 0700 /opt/hal-agent-backups
install -d -m 0700 "$BACKUP"
cp -a "$APP" "$BACKUP/opt-hal-agent"
cp -a "$ETC" "$BACKUP/etc-hal-agent"
mkdir -p "$BACKUP/systemd"
cp -a /etc/systemd/system/hal-*.service /etc/systemd/system/hal-*.timer "$BACKUP/systemd/" 2>/dev/null || true
cp -a /etc/systemd/system/hal-agent.service.d "$BACKUP/systemd/" 2>/dev/null || true
cp -a /etc/polkit-1/rules.d/50-hal-agent.rules "$BACKUP/" 2>/dev/null || true
echo "Backup: $BACKUP"
# Nooit meer stil stoppen: toon de regel waar het misging en hoe je terugdraait.
set -E
trap 'echo "deploy.sh stopped at line $LINENO (exit $?). Roll back: sudo bash $APP/rollback.sh $BACKUP" >&2' ERR

CHANGED=(); SAME=0; CODE_CHANGED=0; UNITS_CHANGED=0; REQ_CHANGED=0; POLKIT_CHANGED=0; SMART_CHANGED=0; DISCOVER_CHANGED=0

place() { # bron doel modus
  local src=$1 dst=$2 mode=$3
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then SAME=$((SAME + 1)); return 1; fi
  install -D -o root -g root -m "$mode" "$src" "$dst"
  CHANGED+=("${dst#/}")
  return 0
}

for pkg in hal_common hal_agent hal_agent/collectors hal_shell; do
  for f in "$SRC/$pkg"/*.py; do
    place "$f" "$APP/$pkg/$(basename "$f")" 0644 && CODE_CHANGED=1 || true
  done
done
for f in requirements.txt requirements-pi.txt; do
  place "$SRC/$f" "$APP/$f" 0644 && REQ_CHANGED=1 || true
done
place "$SRC/README.md" "$APP/README.md" 0644 || true
place "$SRC/docker/docker-compose.yml" "$APP/docker/docker-compose.yml" 0644 || true
for b in "$SRC"/bin/*; do
  [[ -f "$b" ]] || continue
  place "$b" "$APP/bin/$(basename "$b")" 0755 && {
    [[ "$(basename "$b")" == hal-apply-config ]] && POLKIT_CHANGED=1
    [[ "$(basename "$b")" == hal-smart-collect ]] && SMART_CHANGED=1
    [[ "$(basename "$b")" == hal-sites-discover ]] && DISCOVER_CHANGED=1
  } || true
done
place "$SRC/deploy.sh" "$APP/deploy.sh" 0755 || true
place "$SRC/rollback.sh" "$APP/rollback.sh" 0755 || true
for u in hal-agent.service hal-smart-collect.service hal-smart-collect.timer hal-sites-discover.service hal-sites-discover.timer 'hal-cmd@.service' 'hal-container@.service' \
         hal-apt-check.service hal-apt-check.timer hal-apt-upgrade.service hal-agent-update.service; do
  place "$SRC/systemd/$u" "/etc/systemd/system/$u" 0644 && UNITS_CHANGED=1 || true
done
TMPU="$(mktemp)"
sed -e "s/@SHELL_USER@/$SHELL_USER/g" -e "s/@SHELL_GROUP@/$SHELL_GROUP/g" "$SRC/systemd/hal-shell.service" > "$TMPU"
place "$TMPU" /etc/systemd/system/hal-shell.service 0644 && UNITS_CHANGED=1 || true
rm -f "$TMPU"
# Only add new example config that does not exist yet; your changes stay.
for f in "$SRC"/config/*.yml; do
  n="$(basename "$f")"
  if [[ ! -f "$ETC/$n" ]]; then install -o root -g halagent -m 0640 "$f" "$ETC/$n"; CHANGED+=("etc/hal-agent/$n (new)"); fi
done

# Folders for newer features (only created when missing).
[[ -d /var/lib/hal-agent/apt ]] || { install -d -o root -g halagent -m 0750 /var/lib/hal-agent/apt; CHANGED+=("var/lib/hal-agent/apt (new)"); }
[[ -d /var/lib/hal-agent/sites ]] || { install -d -o root -g halagent -m 0750 /var/lib/hal-agent/sites; CHANGED+=("var/lib/hal-agent/sites (new)"); }

if ((REQ_CHANGED)); then
  "$APP/venv/bin/pip" install -q --no-cache-dir -r "$APP/requirements.txt"
  "$APP/venv/bin/pip" install -q --no-cache-dir -r "$APP/requirements-pi.txt" || echo "GPIO library not updated (not critical)"
  CODE_CHANGED=1
fi
find "$APP" -name '__pycache__' -prune -exec rm -rf {} +
((POLKIT_CHANGED)) && "$APP/bin/hal-apply-config"
((UNITS_CHANGED)) && systemctl daemon-reload
# New timers are enabled once; timers you already had keep running as they were.
if [[ -f /etc/systemd/system/hal-apt-check.timer ]] && ! systemctl is-enabled --quiet hal-apt-check.timer 2>/dev/null; then
  systemctl enable --now hal-apt-check.timer >/dev/null && CHANGED+=("hal-apt-check.timer enabled")
fi
if [[ -f /etc/systemd/system/hal-sites-discover.timer ]] && ! systemctl is-enabled --quiet hal-sites-discover.timer 2>/dev/null; then
  systemctl enable --now hal-sites-discover.timer >/dev/null && CHANGED+=("hal-sites-discover.timer enabled")
fi
# Nieuwe SMART-collector: één meting nu (enkel lezen), zodat de app niet 5 minuten op nieuwe gegevens wacht.
if ((SMART_CHANGED)); then
  systemctl start --no-block hal-smart-collect.service && CHANGED+=("hal-smart-collect: measuring now")
fi
# Site discovery: enkel lezen (cloudflared-configs), meteen één keer zodat de app alle sites toont.
if ((DISCOVER_CHANGED)); then
  if systemctl start hal-sites-discover.service; then
    N="$("$APP/venv/bin/python" -c 'import json; print(len(json.load(open("/var/lib/hal-agent/sites/discovered.json"))["sites"]))' 2>/dev/null || echo "?")"
    CHANGED+=("hal-sites-discover: $N hostnames found")
  else
    CHANGED+=("hal-sites-discover: error, see journalctl -u hal-sites-discover")
  fi
fi
if ((CODE_CHANGED || UNITS_CHANGED)); then
  systemctl restart hal-agent.service
  AHOST="$( { grep -E '^HAL_AGENT_HOST=' "$ETC/agent.env" 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ')"
  HEALTH="http://${AHOST:-127.0.0.1}:8120/health"
  for _ in $(seq 1 20); do curl -fsS "$HEALTH" >/dev/null 2>&1 && break; sleep 1; done
  if ! curl -fsS "$HEALTH" >/dev/null; then
    echo "ERROR: hal-agent does not start after the update. Roll back with:"
    echo "  sudo bash $APP/rollback.sh $BACKUP"
    exit 1
  fi
  RESTARTED="hal-agent restarted and healthy"
else
  RESTARTED="nothing restarted (no code change)"
fi

echo
echo "Changed (${#CHANGED[@]}):"
for c in "${CHANGED[@]}"; do echo "  - /$c"; done
echo "Unchanged: $SAME files"
echo "Services: $RESTARTED. hal-shell and the timers keep running as they were."
echo "Your configuration in $ETC and your tokens were not touched."
echo
echo "Roll back: sudo bash $APP/rollback.sh $BACKUP"
