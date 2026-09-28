#!/usr/bin/env bash
# Nex Pi Control agent: one-time install on a Raspberry Pi (Debian / Raspberry Pi OS, bookworm or trixie).
# Idempotent: safe to run again.
#
#   sudo bash setup.sh                 # agent on 127.0.0.1 (use with Cloudflare Tunnel + Access)
#   sudo bash setup.sh --tailscale     # also publish over HTTPS inside your tailnet (tailscale serve)
#   sudo bash setup.sh --lan           # listen on this Pi's LAN address (home network only, unencrypted)
#
# Never touches: UFW, fail2ban, SSH, cloudflared.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP=/opt/hal-agent
ETC=/etc/hal-agent
STATE=/var/lib/hal-agent
SHELL_USER="${HAL_SHELL_USER:-${SUDO_USER:-}}"
PORT_AGENT=8120
PORT_SHELL=8121
PORT_PROXY=2375
MODE=local
for arg in "$@"; do
  case "$arg" in
    --tailscale) MODE=tailscale ;;
    --lan) MODE=lan ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

c_ok()   { printf '\033[32mOK\033[0m    %s\n' "$*"; }
c_info() { printf '\033[36m..\033[0m    %s\n' "$*"; }
c_warn() { printf '\033[33m!!\033[0m    %s\n' "$*"; }
c_err()  { printf '\033[31mERROR\033[0m %s\n' "$*" >&2; }

[[ $EUID -eq 0 ]] || { c_err "Run with sudo: sudo bash $0"; exit 1; }
[[ -n "$SHELL_USER" ]] || { c_err "Run via sudo from your normal account, or set HAL_SHELL_USER=<name>."; exit 1; }
id "$SHELL_USER" >/dev/null 2>&1 || { c_err "User $SHELL_USER does not exist."; exit 1; }
[[ "$SHELL_USER" != "root" ]] || { c_err "The admin shell never runs as root. Run setup via sudo from your own account."; exit 1; }
SHELL_GROUP="$(id -gn "$SHELL_USER")"
SHELL_HOME="$(getent passwd "$SHELL_USER" | cut -d: -f6)"
HOST="$(hostname)"
FIRST_INSTALL=0

echo
echo "Nex Pi Control agent on $HOST (admin shell user: $SHELL_USER, mode: $MODE)"
echo

# 0. Disk health first ---------------------------------------------------------------------------
if command -v smartctl >/dev/null 2>&1; then
  BAD=""
  while read -r name type; do
    [[ "$type" == "disk" ]] || continue
    [[ "$name" == mmcblk* || "$name" == zram* || "$name" == loop* ]] && continue
    out="$(smartctl -H -A "/dev/$name" 2>/dev/null || true)"
    if grep -qiE 'FAILED|FAILING_NOW' <<<"$out"; then BAD+=" /dev/$name(health)"; fi
    for attr in Reallocated_Sector_Ct Current_Pending_Sector Offline_Uncorrectable Reported_Uncorrect; do
      raw="$(awk -v a="$attr" '$2==a {print $10}' <<<"$out" | head -n1)"
      if [[ -n "$raw" && "$raw" =~ ^[0-9]+$ && "$raw" -gt 0 ]]; then BAD+=" /dev/$name($attr=$raw)"; fi
    done
  done < <(lsblk -dn -o NAME,TYPE)
  if [[ -n "$BAD" ]]; then
    c_warn "DISK SHOWS SIGNS OF FAILURE:$BAD"
    c_warn "Back up everything to healthy storage first. This install writes little, but never work on top of a failing disk."
    ans=""
    if [[ -r /dev/tty ]]; then read -r -p "Type 'I have a backup' to continue anyway: " ans </dev/tty || ans=""; fi
    [[ "$ans" == "I have a backup" ]] || { c_err "Stopped. Back up first."; exit 1; }
  else
    c_ok "Quick SMART check: no bad sectors found"
  fi
fi

# 1. Ports -----------------------------------------------------------------------------------------
port_owner() { ss -Hltnp "sport = :$1" 2>/dev/null | head -n1; }
for p in $PORT_AGENT $PORT_SHELL $PORT_PROXY; do
  owner="$(port_owner "$p")"
  if [[ -n "$owner" ]] && ! grep -qE 'hal_agent|hal_shell|python|docker-proxy|haproxy' <<<"$owner"; then
    c_err "Port $p is already in use: $owner"
    exit 1
  fi
done
c_ok "Ports $PORT_AGENT, $PORT_SHELL and $PORT_PROXY are free or already ours"

# 2. Packages --------------------------------------------------------------------------------------
NEED=()
command -v python3 >/dev/null || NEED+=(python3)
python3 -c 'import venv, ensurepip' 2>/dev/null || NEED+=(python3-venv)
command -v smartctl >/dev/null || NEED+=(smartmontools)
command -v qrencode >/dev/null || NEED+=(qrencode)
[[ -d /etc/polkit-1/rules.d || -x /usr/lib/polkit-1/polkitd ]] || NEED+=(polkitd)
command -v curl >/dev/null || NEED+=(curl)
if ((${#NEED[@]})); then
  c_info "Installing: ${NEED[*]}"
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q "${NEED[@]}"
fi
python3 - <<'PY' || { c_err "Python 3.11 or newer required"; exit 1; }
import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)
PY
c_ok "Packages present"

# 3. Service user --------------------------------------------------------------------------------------
if ! id halagent >/dev/null 2>&1; then
  useradd --system --user-group --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin halagent
  c_ok "System user halagent created (no login, no sudo)"
else
  c_ok "System user halagent exists"
fi
EXTRA_GROUPS=(systemd-journal)
for g in gpio i2c; do getent group "$g" >/dev/null && EXTRA_GROUPS+=("$g"); done

# 4. Folders and code ----------------------------------------------------------------------------------
install -d -o root -g root -m 0755 "$APP" "$APP/bin" "$APP/docker"
install -d -o root -g root -m 0755 "$ETC"
install -d -o halagent -g halagent -m 0750 "$STATE"
install -d -o root -g halagent -m 0750 "$STATE/smart"
for pkg in hal_common hal_agent hal_agent/collectors hal_shell; do
  install -d -o root -g root -m 0755 "$APP/$pkg"
  find "$SRC/$pkg" -maxdepth 1 -type f -name '*.py' -exec install -o root -g root -m 0644 {} "$APP/$pkg/" \;
done
for f in requirements.txt requirements-pi.txt README.md; do install -o root -g root -m 0644 "$SRC/$f" "$APP/$f"; done
install -o root -g root -m 0644 "$SRC/docker/docker-compose.yml" "$APP/docker/docker-compose.yml"
for b in "$SRC"/bin/*; do install -o root -g root -m 0755 "$b" "$APP/bin/$(basename "$b")"; done
install -o root -g root -m 0755 "$SRC/deploy.sh" "$APP/deploy.sh"
install -o root -g root -m 0755 "$SRC/rollback.sh" "$APP/rollback.sh"
c_ok "Code installed in $APP (owned by root, read-only for the agent)"

# 5. Python venv ----------------------------------------------------------------------------------------
[[ -x "$APP/venv/bin/python" ]] || python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q --no-cache-dir -r "$APP/requirements.txt"
if "$APP/venv/bin/pip" install -q --no-cache-dir -r "$APP/requirements-pi.txt"; then
  c_ok "Python environment ready (including GPIO)"
else
  c_warn "GPIO library could not be installed. Everything else works; GPIO shows as unavailable."
fi
chown -R root:root "$APP/venv"
find "$APP" -name '__pycache__' -prune -exec rm -rf {} +

# 6. Secrets --------------------------------------------------------------------------------------------
gen() { "$APP/venv/bin/python" -c 'import secrets; print(secrets.token_urlsafe(48))'; }
if [[ ! -f "$ETC/agent.env" ]]; then
  FIRST_INSTALL=1
  umask 077
  cat > "$ETC/agent.env" <<EOF
# Agent secrets. root:halagent 0640. Never commit or paste these.
HAL_AGENT_TOKEN=$(gen)
# Cloudflare Access (optional). While empty, every request that arrives through a Cloudflare Tunnel is refused.
CF_ACCESS_TEAM_DOMAIN=
CF_ACCESS_AUD=
# Public URL of the admin shell as the app should reach it (filled by --tailscale, or set it yourself)
HAL_AGENT_SHELL_URL=
# Optional: markdown port registry with rows "| port | address | service |"
HAL_AGENT_PORTS_FILE=$ETC/ports.md
EOF
  umask 022
fi
if [[ ! -f "$ETC/shell.env" ]]; then
  umask 077
  cat > "$ETC/shell.env" <<EOF
# Admin shell secrets. root:$SHELL_GROUP 0640.
HAL_SHELL_TOKEN=$(gen)
# Separate Cloudflare Access application for the shell hostname (different AUD than the API)
CF_ACCESS_TEAM_DOMAIN=
CF_ACCESS_AUD=
HAL_SHELL_IDLE_SECONDS=900
EOF
  umask 022
fi

set_env() { # file key value
  if grep -q "^$2=" "$1"; then sed -i "s#^$2=.*#$2=$3#" "$1"; else echo "$2=$3" >> "$1"; fi
}
LAN_IP=""
if [[ "$MODE" == "lan" ]]; then
  LAN_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -n1)"
  [[ -n "$LAN_IP" ]] || { c_err "Could not detect this Pi's LAN address."; exit 1; }
  for f in agent.env shell.env; do set_env "$ETC/$f" HAL_ALLOW_LAN 1; done
  set_env "$ETC/agent.env" HAL_AGENT_HOST "$LAN_IP"
  set_env "$ETC/shell.env" HAL_SHELL_HOST "$LAN_IP"
  set_env "$ETC/agent.env" HAL_AGENT_SHELL_URL "http://$LAN_IP:$PORT_SHELL"
else
  for f in agent.env shell.env; do sed -i '/^HAL_ALLOW_LAN=/d;/^HAL_AGENT_HOST=/d;/^HAL_SHELL_HOST=/d' "$ETC/$f"; done
fi
chown root:halagent "$ETC/agent.env";       chmod 0640 "$ETC/agent.env"
chown root:"$SHELL_GROUP" "$ETC/shell.env"; chmod 0640 "$ETC/shell.env"
c_ok "Tokens stored in $ETC (not readable by other users)"

# 7. Configuration ---------------------------------------------------------------------------------------
for f in allowed-actions.yml commands.yml wol.yml gpio.yml sensors.yml shell-roots.yml; do
  if [[ ! -f "$ETC/$f" ]]; then
    install -o root -g halagent -m 0640 "$SRC/config/$f" "$ETC/$f"
    c_info "Example $f installed"
    [[ "$f" == commands.yml ]] && sed -i "s#^default_user: pi#default_user: $SHELL_USER#" "$ETC/$f"
    [[ "$f" == shell-roots.yml ]] && sed -i "s#path: /home/pi#path: $SHELL_HOME#" "$ETC/$f"
  fi
done
chown root:halagent "$ETC"/{allowed-actions,commands,wol,gpio,sensors}.yml
chmod 0640 "$ETC"/{allowed-actions,commands,wol,gpio,sensors}.yml
chown root:"$SHELL_GROUP" "$ETC/shell-roots.yml"; chmod 0640 "$ETC/shell-roots.yml"

if [[ ! -f "$ETC/sites.yml" ]]; then
  "$APP/venv/bin/python" - "$ETC/sites.yml" <<'PY'
import glob, re, sys, yaml
sites, seen = [], set()
for path in sorted(glob.glob("/etc/cloudflared/*.yml")) + sorted(glob.glob("/etc/cloudflared/*.yaml")):
    try:
        data = yaml.safe_load(open(path)) or {}
    except Exception:
        continue
    for rule in data.get("ingress") or []:
        host = str(rule.get("hostname") or "").lower()
        if not host or "*" in host or host in seen:
            continue
        seen.add(host)
        svc = str(rule.get("service") or "")
        local = svc.replace("localhost", "127.0.0.1") if re.match(r"^http://(127\.0\.0\.1|localhost):\d+", svc) else None
        sites.append({"hostname": host, **({"local": local} if local else {})})
with open(sys.argv[1], "w") as f:
    f.write("# Generated from /etc/cloudflared (read only). Edit freely.\n")
    yaml.safe_dump({"sites": sites}, f, sort_keys=False, allow_unicode=True)
print(f"{len(sites)} hostnames found")
PY
  chown root:halagent "$ETC/sites.yml"; chmod 0640 "$ETC/sites.yml"
  c_ok "sites.yml created (cloudflared itself untouched)"
fi
if [[ ! -f "$ETC/ports.md" ]]; then
  printf '| Port | Address | Service |\n|---|---|---|\n| %s | 127.0.0.1 | hal-agent |\n| %s | 127.0.0.1 | hal-shell (off by default) |\n| %s | 127.0.0.1 | docker-socket-proxy (GET only) |\n' "$PORT_AGENT" "$PORT_SHELL" "$PORT_PROXY" > "$ETC/ports.md"
  chown root:halagent "$ETC/ports.md"; chmod 0640 "$ETC/ports.md"
fi

# 8. polkit ------------------------------------------------------------------------------------------------
install -d -m 0755 /etc/polkit-1/rules.d
"$APP/bin/hal-apply-config"
c_ok "polkit rule: halagent may only run the fixed actions from allowed-actions.yml and commands.yml"

# 9. systemd -------------------------------------------------------------------------------------------------
for u in hal-agent.service hal-smart-collect.service hal-smart-collect.timer 'hal-cmd@.service'; do
  install -o root -g root -m 0644 "$SRC/systemd/$u" "/etc/systemd/system/$u"
done
sed -e "s/@SHELL_USER@/$SHELL_USER/g" -e "s/@SHELL_GROUP@/$SHELL_GROUP/g" "$SRC/systemd/hal-shell.service" > /etc/systemd/system/hal-shell.service
chmod 0644 /etc/systemd/system/hal-shell.service
install -d -m 0755 /etc/systemd/system/hal-agent.service.d
{
  echo "# Generated by setup.sh: groups and hardware access for hal-agent"
  echo "[Service]"
  echo "SupplementaryGroups=${EXTRA_GROUPS[*]}"
  for d in /dev/gpiochip* /dev/i2c-*; do [[ -e "$d" ]] && echo "DeviceAllow=$d rw"; done
} > /etc/systemd/system/hal-agent.service.d/10-hardware.conf
chmod 0644 /etc/systemd/system/hal-agent.service.d/10-hardware.conf
systemctl daemon-reload
c_ok "systemd units installed (the admin shell stays off until you start it from the app)"

# 10. Docker socket proxy ---------------------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose -f "$APP/docker/docker-compose.yml" up -d --quiet-pull >/dev/null
  c_ok "docker-socket-proxy on 127.0.0.1:$PORT_PROXY (GET on containers only)"
else
  c_warn "Docker (compose) not found: the Containers tab stays empty"
fi

# 11. Start ------------------------------------------------------------------------------------------------------
systemctl enable --now hal-smart-collect.timer >/dev/null
systemctl start hal-smart-collect.service || c_warn "First SMART run reported an error: journalctl -u hal-smart-collect"
systemctl enable hal-agent.service >/dev/null
systemctl restart hal-agent.service

# 12. Tailscale -------------------------------------------------------------------------------------------------
TS_URL=""
if [[ "$MODE" == "tailscale" ]]; then
  if command -v tailscale >/dev/null 2>&1 && tailscale status >/dev/null 2>&1; then
    tailscale serve --bg --https=443 "http://127.0.0.1:$PORT_AGENT" >/dev/null
    tailscale serve --bg --https=8443 "http://127.0.0.1:$PORT_SHELL" >/dev/null
    TS_HOST="$(tailscale status --json | "$APP/venv/bin/python" -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
    TS_URL="https://$TS_HOST"
    set_env "$ETC/agent.env" HAL_AGENT_SHELL_URL "$TS_URL:8443"
    systemctl restart hal-agent.service
    c_ok "Published in your tailnet: $TS_URL (shell: $TS_URL:8443)"
  else
    c_warn "Tailscale is not installed or not logged in. Install it (curl -fsSL https://tailscale.com/install.sh | sh), run 'sudo tailscale up' and run this setup again with --tailscale."
  fi
fi

# 13. Smoke test --------------------------------------------------------------------------------------------------
BASE="http://127.0.0.1:$PORT_AGENT"
[[ -n "$LAN_IP" ]] && BASE="http://$LAN_IP:$PORT_AGENT"
TOKEN="$(grep -E '^HAL_AGENT_TOKEN=' "$ETC/agent.env" | cut -d= -f2-)"
for _ in $(seq 1 30); do curl -fsS "$BASE/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$BASE/health" >/dev/null || { c_err "hal-agent does not respond. Check: journalctl -u hal-agent -n 50 --no-pager"; exit 1; }
HTTP=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE/v1/overview")
NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/v1/overview")
[[ "$HTTP" == 200 ]] && c_ok "Smoke test: /v1/overview with token returns 200" || { c_err "Smoke test failed ($HTTP)"; exit 1; }
[[ "$NOAUTH" == 401 ]] && c_ok "Smoke test: without token 401" || c_warn "Without token returned $NOAUTH (expected 401)"

echo
echo "──────────────────────────────────────────────────────────────"
case "$MODE" in
  tailscale) API_URL="${TS_URL:-https://<your-pi>.<tailnet>.ts.net}"; SHELL_URL="${TS_URL:+$TS_URL:8443}" ;;
  lan) API_URL="http://$LAN_IP:$PORT_AGENT"; SHELL_URL="http://$LAN_IP:$PORT_SHELL" ;;
  *) API_URL="https://<your-api-hostname>"; SHELL_URL="https://<your-shell-hostname>" ;;
esac
cat <<EOF
Done. Connect the app:
  sudo $APP/bin/hal-qr --api "$API_URL" --shell "$SHELL_URL"
  and scan the QR code in Nex Pi Control. The tokens never need to be typed or pasted.

EOF
if [[ "$MODE" == "local" ]]; then
cat <<EOF
Cloudflare Tunnel + Access (reach your Pi from anywhere):
  1. Add two ingress rules to your tunnel: <api-hostname> -> http://127.0.0.1:$PORT_AGENT
     and <shell-hostname> -> http://127.0.0.1:$PORT_SHELL
  2. In Zero Trust: create a service token and two self-hosted applications with a Service Auth policy
  3. Put the team domain and each AUD tag in $ETC/agent.env and $ETC/shell.env, then:
     sudo systemctl restart hal-agent
  Until then every request through the tunnel is refused (503). That is on purpose.
EOF
fi
if [[ "$MODE" == "lan" ]]; then
  c_warn "LAN mode: traffic inside your home network is not encrypted. Use --tailscale for encrypted access."
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
    CIDR="$(ip -o -f inet addr show | awk -v ip="$LAN_IP" '$4 ~ "^"ip"/" {print $4; exit}')"
    SUBNET="$(python3 -c 'import ipaddress,sys; print(ipaddress.ip_interface(sys.argv[1]).network)' "$CIDR" 2>/dev/null || true)"
    c_warn "UFW is active and this setup never changes your firewall. To allow the app from your home network, run:"
    echo "     sudo ufw allow from ${SUBNET:-192.168.0.0/16} to any port $PORT_AGENT proto tcp comment 'Nex Pi Control'"
    echo "     sudo ufw allow from ${SUBNET:-192.168.0.0/16} to any port $PORT_SHELL proto tcp comment 'Nex Pi Control shell'"
  fi
fi
cat <<EOF

Allowed actions: edit $ETC/allowed-actions.yml and commands.yml, then: sudo $APP/bin/hal-apply-config
Status: systemctl status hal-agent   Logs: journalctl -u hal-agent -f
EOF
[[ $FIRST_INSTALL -eq 1 ]] && c_info "Tokens were generated and are only shown inside the QR code."
exit 0
