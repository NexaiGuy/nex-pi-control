#!/usr/bin/env bash
# Stillere ventilator voor de Raspberry Pi 5 (officiële Active Cooler of een fan op de fan-aansluiting).
#
# Meet eerst hoeveel toeren jouw ventilator draait bij elke stand (ongeveer 40 seconden, daarna staat alles terug),
# kiest de hoogste stand die onder --max-rpm blijft en zet een fan-curve in config.txt die nooit boven die stand gaat.
# Eén uitzondering voor de veiligheid: vanaf 78 °C mag hij volle kracht, net voor de Pi bij 80 °C zelf vertraagt.
# Dat gebeurt enkel bij zware, langdurige belasting. Werkt vanaf de volgende herstart.
#
#   sudo bash install.sh                      onder 3000 rpm
#   sudo bash install.sh --max-rpm 2500
#   sudo bash install.sh --no-safety          ook boven 78 °C onder de grens (niet aangeraden: de Pi vertraagt dan zelf)
#   sudo bash install.sh --profile balanced   standaardcurve van Raspberry Pi, geen meting
#   sudo bash install.sh --uninstall          blok weer weg
set -euo pipefail
PROFILE=quiet; MAX_RPM=3000; SAFETY=1; UNINSTALL=0; FORCE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --max-rpm) MAX_RPM="$2"; shift 2 ;;
    --no-safety) SAFETY=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --force) FORCE=1; shift ;;
    *) echo "Onbekende optie: $1" >&2; exit 2 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Draai met sudo." >&2; exit 1; }
[[ "$MAX_RPM" =~ ^[0-9]+$ && "$MAX_RPM" -ge 1000 && "$MAX_RPM" -le 10000 ]] || { echo "--max-rpm tussen 1000 en 10000" >&2; exit 2; }
[[ "$PROFILE" == quiet || "$PROFILE" == balanced ]] || { echo "Profiel moet quiet of balanced zijn." >&2; exit 2; }

CFG=/boot/firmware/config.txt
[[ -f "$CFG" ]] || CFG=/boot/config.txt
[[ -f "$CFG" ]] || { echo "config.txt niet gevonden." >&2; exit 1; }
MODEL="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || true)"
[[ "$MODEL" == *"Raspberry Pi 5"* ]] || { echo "Dit is voor een Raspberry Pi 5 (gevonden: ${MODEL:-onbekend})." >&2; exit 1; }

BEGIN="# >>> hal-quiet-fan (beheerd door Nex Pi Control, niet met de hand aanpassen)"
END="# <<< hal-quiet-fan"
MIN_SPEED=75   # laagste stand (op 255) waarbij de Active Cooler betrouwbaar blijft draaien

cpu_temp() { awk '{printf "%d", $1/1000}' /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0; }

# --- 1. Meten: toerental per stand ---------------------------------------------------------------------
CAP=255
if ((UNINSTALL == 0)) && [[ "$PROFILE" == quiet ]]; then
  HW="$(ls -d /sys/devices/platform/cooling_fan/hwmon/hwmon* 2>/dev/null | head -1 || true)"
  if [[ -n "$HW" && -w "$HW/pwm1" && -r "$HW/fan1_input" ]]; then
    T="$(cpu_temp)"
    if ((T >= 70)); then
      echo "CPU is ${T} °C. Meten doe ik enkel onder 70 °C, want tijdens de meting draait de ventilator even trager. Probeer later opnieuw." >&2
      exit 1
    fi
    ORIG="$(cat "$HW/pwm1")"
    trap 'echo "$ORIG" > "$HW/pwm1" 2>/dev/null || true' EXIT INT TERM
    echo "Meten (ongeveer 40 s, CPU nu ${T} °C):"
    CAP=0
    for v in 60 75 90 105 120 135 150 170 190 215 255; do
      echo "$v" > "$HW/pwm1"; sleep 3
      R="$(cat "$HW/fan1_input" 2>/dev/null || echo 0)"
      printf "  stand %3s  %5s rpm\n" "$v" "$R"
      if ((R > 0 && R <= MAX_RPM - 150 && v >= MIN_SPEED)); then CAP=$v; fi
    done
    echo "$ORIG" > "$HW/pwm1"; trap - EXIT INT TERM
    if ((CAP == 0)); then
      CAP=$MIN_SPEED
      echo "Let op: zelfs de laagste veilige stand ($MIN_SPEED) zit boven ${MAX_RPM} rpm. Ik gebruik $MIN_SPEED, lager valt de ventilator stil."
    fi
  else
    echo "Geen ventilator met toerentalmeting gevonden; ik gebruik een vaste stille curve." >&2
    CAP=150
  fi
fi

# --- 2. Curve -----------------------------------------------------------------------------------------
# temp in milligraden : stand 0-255
if [[ "$PROFILE" == balanced ]]; then
  CURVE=(50000:75 60000:125 67500:175 75000:250)
else
  MID=$(( (MIN_SPEED + CAP) / 2 ))
  TOP=$CAP; ((SAFETY)) && TOP=255
  CURVE=(55000:$MIN_SPEED 63000:$MID 70000:$CAP 78000:$TOP)
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
cp -a "$CFG" "$CFG.hal-bak-$STAMP"
echo "Back-up: $CFG.hal-bak-$STAMP"

OUTSIDE="$(awk -v b="$BEGIN" -v e="$END" '$0==b{s=1;next} $0==e{s=0;next} !s && /^[[:space:]]*dtparam=fan_temp/' "$CFG")"
if [[ -n "$OUTSIDE" && $FORCE -eq 0 && $UNINSTALL -eq 0 ]]; then
  echo "Er staan al eigen fan-instellingen in $CFG:" >&2
  echo "$OUTSIDE" >&2
  echo "Niets aangepast. Verwijder ze zelf of draai opnieuw met --force (ons blok komt erna en wint)." >&2
  exit 1
fi

TMP="$(mktemp)"
awk -v b="$BEGIN" -v e="$END" '$0==b{s=1;next} $0==e{s=0;next} !s' "$CFG" > "$TMP"
if ((UNINSTALL == 0)); then
  {
    echo "$BEGIN"
    echo "[all]"
    i=0
    for p in "${CURVE[@]}"; do
      echo "dtparam=fan_temp${i}=${p%%:*},fan_temp${i}_hyst=5000,fan_temp${i}_speed=${p##*:}"
      i=$((i + 1))
    done
    echo "$END"
  } >> "$TMP"
fi
cat "$TMP" > "$CFG"
rm -f "$TMP"
sync

echo
if ((UNINSTALL)); then
  echo "Fan-curve verwijderd: na de volgende herstart weer de standaardcurve."
else
  echo "Fan-curve '$PROFILE' gezet in $CFG:"
  sed -n "/^# >>> hal-quiet-fan/,/^# <<< hal-quiet-fan/p" "$CFG"
  if [[ "$PROFILE" == quiet ]]; then
    echo "Normaal nooit boven stand $CAP (gemeten onder ${MAX_RPM} rpm)."
    ((SAFETY)) && echo "Enkel vanaf 78 °C volle kracht, zodat de Pi niet zelf hoeft te vertragen."
  fi
fi
echo "Nu: $(cpu_temp) °C. Werkt vanaf de volgende herstart."
echo "Terugzetten: sudo bash install.sh --uninstall (of kopieer de back-up terug)."
