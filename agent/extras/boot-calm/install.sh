#!/usr/bin/env bash
# Installeert "rustige opstart" op de Pi. Maakt eerst een back-up, verandert niets aan draaiende diensten:
# de grens werkt pas vanaf de volgende herstart.
#   sudo bash install.sh                      70% gedurende 5 minuten na het opstarten
#   sudo bash install.sh --percent 60 --minutes 8
#   sudo bash install.sh --uninstall          alles weer weg
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERCENT=70; MINUTES=5; UNINSTALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --percent) PERCENT="$2"; shift 2 ;;
    --minutes) MINUTES="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "Onbekende optie: $1" >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Draai met sudo." >&2; exit 1; }
[[ "$PERCENT" =~ ^[0-9]+$ && "$PERCENT" -ge 30 && "$PERCENT" -le 100 ]] || { echo "--percent moet tussen 30 en 100 liggen" >&2; exit 2; }
[[ "$MINUTES" =~ ^[0-9]+$ && "$MINUTES" -ge 1 && "$MINUTES" -le 30 ]] || { echo "--minutes moet tussen 1 en 30 liggen" >&2; exit 2; }

FILES=(/usr/local/sbin/hal-boot-calm /etc/hal-boot-calm.conf /etc/systemd/system/hal-boot-calm.service
       /etc/systemd/system/hal-boot-calm-release.service /etc/systemd/system/hal-boot-calm-release.timer
       /usr/local/share/doc/hal-boot-calm/README.md /usr/local/share/doc/hal-boot-calm/install.sh)
BACKUP="/root/hal-boot-calm-premigrate-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP"
for f in "${FILES[@]}"; do [[ -e "$f" ]] && cp -a --parents "$f" "$BACKUP/"; done
echo "Back-up: $BACKUP"

if ((UNINSTALL)); then
  systemctl disable hal-boot-calm.service hal-boot-calm-release.timer >/dev/null 2>&1 || true
  /usr/local/sbin/hal-boot-calm stop 2>/dev/null || true
  rm -f "${FILES[@]}"
  rmdir /usr/local/share/doc/hal-boot-calm 2>/dev/null || true
  systemctl daemon-reload
  echo "Rustige opstart verwijderd. Er is niets herstart."
  exit 0
fi

install -D -o root -g root -m 0755 "$SRC/hal-boot-calm" /usr/local/sbin/hal-boot-calm
printf '# Rustige opstart: CPU-grens voor systeemdiensten en containers tijdens de eerste %s minuten na het opstarten.\nCPU_PERCENT=%s\n' "$MINUTES" "$PERCENT" > /etc/hal-boot-calm.conf
chmod 0644 /etc/hal-boot-calm.conf
install -D -m 0644 "$SRC/hal-boot-calm.service" /etc/systemd/system/hal-boot-calm.service
install -D -m 0644 "$SRC/hal-boot-calm-release.service" /etc/systemd/system/hal-boot-calm-release.service
sed "s/@MINUTES@/$MINUTES/" "$SRC/hal-boot-calm-release.timer" > /etc/systemd/system/hal-boot-calm-release.timer
chmod 0644 /etc/systemd/system/hal-boot-calm-release.timer
install -D -m 0644 "$SRC/README.md" /usr/local/share/doc/hal-boot-calm/README.md
install -D -m 0755 "$SRC/install.sh" /usr/local/share/doc/hal-boot-calm/install.sh
systemctl daemon-reload
systemctl enable hal-boot-calm.service hal-boot-calm-release.timer >/dev/null

DRIVER="$(docker info --format '{{.CgroupDriver}}' 2>/dev/null || echo onbekend)"
echo
echo "Geïnstalleerd: na elke herstart maximaal ${PERCENT}% CPU voor diensten en containers, ${MINUTES} minuten lang."
echo "Nu is er niets veranderd en niets herstart. Het werkt vanaf de volgende herstart."
if [[ "$DRIVER" != "systemd" ]]; then
  echo "LET OP: Docker gebruikt cgroup-driver '$DRIVER'. Dan vallen containers buiten de grens (enkel de diensten worden begrensd)."
fi
echo "Controleren na een herstart:  journalctl -t hal-boot-calm -b"
echo "Terugdraaien:                 sudo bash /usr/local/share/doc/hal-boot-calm/install.sh --uninstall"
