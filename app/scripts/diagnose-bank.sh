#!/usr/bin/env bash
# Zoekt met metingen waarom een bank-app niet normaal opent. Geen gissen: twee rondes, zelfde meting.
#   A. normaal: bank-app starten en meten wat er boven en naast draait.
#   B. zonder Nex Pi Control: de app volledig gestopt (am force-stop: geen proces, geen dienst, geen venster).
#      Opent de bank-app ook dan niet, dan ligt het niet aan Nex Pi Control.
# Daarna start Nex Pi Control weer zoals voorheen.
#
# Gebruik (gsm ontgrendeld en opengeklapt):  bash scripts/diagnose-bank.sh [pakket]   (standaard KBC)
# Resultaat en schermafdrukken: metingen/bank-<tijd>.txt en .png in de projectmap.
set -uo pipefail

PKG="be.nexai.picontrol"
BANK="${1:-com.kbc.mobile.android.phone.kbc}"
APP_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$(cd "$APP_SRC/.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$SDK/platform-tools:$PATH"

command -v adb >/dev/null || { echo "adb ontbreekt." >&2; exit 1; }
[[ "$(adb get-state 2>/dev/null)" == "device" ]] || { echo "Geen gsm gevonden (adb devices)." >&2; exit 1; }

TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$PROJECT/metingen"
OUT="$PROJECT/metingen/bank-$TS.txt"
exec > >(tee "$OUT") 2>&1

ash() { adb shell "$@" 2>/dev/null | tr -d '\r'; }
# Tijd op de gsm, als één argument doorgegeven (anders splitst adb shell de spatie: "date: Max 1 argument").
devtime() { adb shell "date '+%m-%d %H:%M:%S.000'" 2>/dev/null | tr -d '\r'; }

# Alle vensters die boven apps kunnen liggen, per type en pakket, van elke app (niet enkel de onze).
overlays() {
  ash dumpsys window windows | awk '
    function flush() { if (p != "" && t != "") print "   " t "  " p; p = ""; t = "" }
    /Window #[0-9]+ Window\{/ { flush(); next }
    match($0, /package=[^ ]+/) { p = substr($0, RSTART + 8, RLENGTH - 8) }
    match($0, /ty=[A-Z_]+/) { x = substr($0, RSTART + 3, RLENGTH - 3)
      if (x ~ /APPLICATION_OVERLAY|ACCESSIBILITY_OVERLAY|SYSTEM_ALERT|SYSTEM_OVERLAY|SYSTEM_ERROR|PHONE|TOAST/) t = x }
    END { flush() }' | sort | uniq -c
}

top_line() { ash dumpsys activity activities | grep -m1 -E "topResumedActivity=" | sed 's/^ *//'; }
front() { top_line | grep -oE "u[0-9]+ [A-Za-z0-9_.]+/" | head -1 | awk '{print $2}' | tr -d '/'; }
# Eerst vangen, dan pas een standaard: met pipefail gaf "grep -m1 ... || echo" twee regels (grep sluit de pijp vroeg,
# adb krijgt SIGPIPE, de pijplijn "faalt" en echo draaide er nog achteraan). Daardoor bleef het script vragen.
keyguard() {
  local k
  k="$(ash dumpsys activity activities | grep -oE "mKeyguardShowing=(true|false)" | head -1)"
  echo "${k:-mKeyguardShowing=?}"
}

ensure_home() {
  for _ in 1 2 3; do
    adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
    adb shell input keyevent KEYCODE_HOME >/dev/null 2>&1
    sleep 2
    local f; f="$(front)"
    if [[ "$f" == *launcher* && "$(keyguard)" != *true ]]; then echo "   startscherm ok ($f)"; return 0; fi
    echo "   niet op het startscherm (vooraan: ${f:-?}, $(keyguard)). Ontgrendel en klap de gsm open, druk dan Enter."
    read -r _ </dev/tty || true
  done
  echo "   LET OP: startscherm niet bevestigd, meting gaat toch door."
}

round() {
  local tag="$1"
  echo
  echo "== Ronde $tag"
  ensure_home
  echo "   overlayvensters op het startscherm, alle apps:"
  overlays
  adb shell am force-stop "$BANK" >/dev/null 2>&1
  local t0; t0="$(devtime)"
  adb shell monkey -p "$BANK" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 5
  local pid; pid="$(ash pidof "$BANK" | awk '{print $1}')"
  echo "   bovenaan na 5 s     : $(top_line)"
  echo "   proces $BANK : ${pid:-NIET actief}"
  echo "   overlayvensters met de bank-app open, alle apps:"
  local ov; ov="$(overlays)"; [[ -n "$ov" ]] && echo "$ov" || echo "   (geen)"
  adb exec-out screencap -p > "$PROJECT/metingen/bank-$TS-$tag.png" 2>/dev/null && echo "   schermafdruk: metingen/bank-$TS-$tag.png (zwart = de app blokkeert schermafdrukken, dat is normaal)"
  echo "   log van de bank-app sinds de start (fouten, waarschuwingen, afsluiten):"
  {
    [[ -n "$pid" ]] && adb logcat -d -T "$t0" --pid="$pid" '*:W' 2>/dev/null
    adb logcat -d -T "$t0" 2>/dev/null | grep -iE "$BANK|AndroidRuntime|FATAL" | grep -iE "kbc|$BANK|FATAL|AndroidRuntime"
  } | tr -d '\r' | grep -v '^-----' | sort -u | tail -40 | sed 's/^/   /'
  read -r -p "   Wat zie je op je gsm (kort, bv. 'opent normaal', 'melding: ...', 'sluit meteen')? " SEEN </dev/tty || SEEN="?"
  echo "   jouw antwoord ($tag): $SEEN"
  eval "SEEN_$tag=\"\$SEEN\""
}

echo "== Bank-app diagnose $(date '+%Y-%m-%d %H:%M:%S')"
echo "toestel        : $(ash getprop ro.product.model) (Android $(ash getprop ro.build.version.release))"
echo "bank-app       : $BANK $(ash dumpsys package "$BANK" | grep -m1 -oE 'versionName=[^ ]+')"
echo "Nex Pi Control : $(ash dumpsys package "$PKG" | grep -m1 -oE 'versionName=[^ ]+')"
echo "USB-foutopsporing (adb_enabled)     : $(ash settings get global adb_enabled)"
echo "ontwikkelaarsopties                 : $(ash settings get global development_settings_enabled)"
echo "toegankelijkheidsdiensten (aan)     : $(ash settings get secure enabled_accessibility_services)"
echo "apps met 'Weergeven over andere apps': $(ash cmd appops query-op --user 0 SYSTEM_ALERT_WINDOW allow | tr '\n' ' ')"

round A

echo
echo "== Nex Pi Control volledig stoppen voor ronde B"
adb shell input keyevent KEYCODE_HOME >/dev/null 2>&1
adb shell am force-stop "$PKG"
sleep 1
echo "   proces $PKG: $(ash pidof "$PKG" || true) $( [[ -z "$(ash pidof "$PKG")" ]] && echo '(gestopt, geen proces)')"

round B

echo
echo "== Nex Pi Control weer starten"
adb shell am force-stop "$BANK" >/dev/null 2>&1
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 3
adb shell input keyevent KEYCODE_HOME >/dev/null 2>&1
sleep 2
echo "   dienst: $(ash dumpsys activity services "$PKG" | grep -c ServiceRecord) ServiceRecord(s)"

echo
echo "== Samenvatting"
echo "A (Nex Pi Control actief) : ${SEEN_A:-?}"
echo "B (Nex Pi Control gestopt): ${SEEN_B:-?}"
echo "Opgeslagen in: $OUT"
