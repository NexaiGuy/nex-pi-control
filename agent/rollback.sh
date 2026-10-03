#!/usr/bin/env bash
# Restores a backup made by deploy.sh.
#   sudo bash /opt/hal-agent/rollback.sh /opt/hal-agent-backups/premigrate-YYYYMMDD-HHMMSS
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo." >&2; exit 1; }
B="${1:-}"
if [[ -z "$B" ]]; then
  echo "Available backups:"; ls -1d /opt/hal-agent-backups/premigrate-* 2>/dev/null || echo "  (none)"
  echo "Usage: sudo bash $0 <backup-folder>"; exit 1
fi
[[ -d "$B/opt-hal-agent" && -d "$B/etc-hal-agent" ]] || { echo "Invalid backup folder: $B" >&2; exit 1; }

systemctl stop hal-agent.service hal-shell.service 2>/dev/null || true
rm -rf /opt/hal-agent.rollback-tmp
cp -a "$B/opt-hal-agent" /opt/hal-agent.rollback-tmp
rm -rf /opt/hal-agent && mv /opt/hal-agent.rollback-tmp /opt/hal-agent
rm -rf /etc/hal-agent && cp -a "$B/etc-hal-agent" /etc/hal-agent
if [[ -d "$B/systemd" ]]; then
  cp -a "$B/systemd/"hal-* /etc/systemd/system/ 2>/dev/null || true
  [[ -d "$B/systemd/hal-agent.service.d" ]] && cp -a "$B/systemd/hal-agent.service.d" /etc/systemd/system/
  # Timers die er bij de backup nog niet waren (en hun service) weer weghalen.
  for t in /etc/systemd/system/hal-*.timer; do
    [[ -f "$t" ]] || continue
    n="$(basename "$t" .timer)"
    if [[ ! -f "$B/systemd/$n.timer" ]]; then
      systemctl disable --now "$n.timer" 2>/dev/null || true
      rm -f "$t" "/etc/systemd/system/$n.service"
      echo "Removed new timer $n.timer"
    fi
  done
fi
[[ -f "$B/50-hal-agent.rules" ]] && cp -a "$B/50-hal-agent.rules" /etc/polkit-1/rules.d/50-hal-agent.rules
systemctl daemon-reload
systemctl start hal-agent.service
AHOST="$( { grep -E '^HAL_AGENT_HOST=' /etc/hal-agent/agent.env 2>/dev/null || true; } | tail -n1 | cut -d= -f2- | tr -d '"'"'"' ')"
for _ in $(seq 1 20); do curl -fsS "http://${AHOST:-127.0.0.1}:8120/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://${AHOST:-127.0.0.1}:8120/health" && echo && echo "Restored $B"
