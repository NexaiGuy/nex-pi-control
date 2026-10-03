#!/usr/bin/env bash
# Meet of Nex Pi Control een overlayvenster boven je bank-app legt. Drie getallen, geen gevoel:
#   1. overlayvensters van Nex Pi Control op het startscherm
#   2. met de bank-app open (plus een tijdlijn van de eerste seconden, want we pollen elke 0,7 s)
#   3. na terugkeer naar het startscherm
#
# Gebruik (gsm via USB, ontgrendeld en opengeklapt, zwevend icoon aan):
#   bash scripts/measure-overlay.sh                       (KBC)
#   bash scripts/measure-overlay.sh be.belfius.directmobile.android
#
# Het resultaat komt ook in metingen/overlay-<tijd>.txt in de projectmap.
set -uo pipefail

PKG="be.nexai.picontrol"
BANK="${1:-com.kbc.mobile.android.phone.kbc}"
APP_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$(cd "$APP_SRC/.." && pwd)"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$SDK/platform-tools:$PATH"

command -v adb >/dev/null || { echo "adb ontbreekt. Draai eerst: bash scripts/kali-bootstrap.sh" >&2; exit 1; }
[[ "$(adb get-state 2>/dev/null)" == "device" ]] || { echo "Geen gsm gevonden (adb devices). Kabel, USB-foutopsporing en goedkeuring op de gsm nakijken." >&2; exit 1; }

mkdir -p "$PROJECT/metingen"
OUT="$PROJECT/metingen/overlay-$(date +%Y%m%d-%H%M%S).txt"
exec > >(tee "$OUT") 2>&1

# Telt de vensters van type APPLICATION_OVERLAY die bij $PKG horen. Een venster dat met removeView weg is, staat hier
# niet meer in. Een venster met setVisibility(GONE) zou er nog wel staan: precies het verschil dat we willen zien.
count() {
  adb shell dumpsys window windows 2>/dev/null | tr -d '\r' | awk -v pkg="$PKG" '
    function flush() { if (inwin && own && ov) n++ }
    /Window #[0-9]+ Window\{/ { flush(); inwin = 1; own = 0; ov = 0; next }
    inwin && index($0, "package=" pkg " ") { own = 1 }
    inwin && $0 ~ ("package=" pkg "$") { own = 1 }
    inwin && /ty=APPLICATION_OVERLAY/ { ov = 1 }
    END { flush(); print n + 0 }'
}

# Pakket van de app die nu bovenaan staat (wat Android zelf zegt, los van onze eigen meting).
front() {
  adb shell dumpsys activity activities 2>/dev/null | tr -d '\r' | grep -m1 -E "topResumedActivity=" |
    grep -oE "u[0-9]+ [A-Za-z0-9_.]+/" | head -1 | awk '{print $2}' | tr -d '/'
}

now_ms() { date +%s%3N; }

echo "== Nex Pi Control overlaymeting $(date '+%Y-%m-%d %H:%M:%S')"
echo "toestel      : $(adb shell getprop ro.product.model | tr -d '\r') (Android $(adb shell getprop ro.build.version.release | tr -d '\r'))"
echo "app          : $(adb shell dumpsys package "$PKG" | tr -d '\r' | grep -m1 -oE 'versionName=[^ ]+') $(adb shell dumpsys package "$PKG" | tr -d '\r' | grep -m1 -oE 'versionCode=[0-9]+')"
echo "bank-app     : $BANK $(adb shell pm path "$BANK" >/dev/null 2>&1 && echo '(geinstalleerd)' || echo '(NIET gevonden)')"
echo "dienst       : $(adb shell dumpsys activity services "$PKG" | tr -d '\r' | grep -c 'ServiceRecord') ServiceRecord(s) van $PKG"
echo "appops       : SYSTEM_ALERT_WINDOW $(adb shell appops get "$PKG" SYSTEM_ALERT_WINDOW | tr -d '\r' | grep -oE 'allow|deny|ignore|default' | head -1), GET_USAGE_STATS $(adb shell appops get "$PKG" GET_USAGE_STATS | tr -d '\r' | grep -oE 'allow|deny|ignore|default' | head -1)"
# Als één argument doorgeven, anders splitst adb shell de spatie ("date: Max 1 argument") en blijft de log leeg.
LOGSTART="$(adb shell "date '+%m-%d %H:%M:%S.000'" | tr -d '\r')"
echo

adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1

# 1. Startscherm ----------------------------------------------------------------------------------------
adb shell input keyevent KEYCODE_HOME
sleep 2.5
N_HOME="$(count)"
FRONT_HOME="$(front)"
echo "1. startscherm      : $N_HOME overlayvenster(s) van $PKG   (vooraan: $FRONT_HOME)"
[[ "$FRONT_HOME" == *launcher* ]] || echo "   LET OP: niet het startscherm vooraan (gsm vergrendeld of dichtgeklapt?). Getal 1 telt dan niet."

# 2. Bank-app open, met tijdlijn ------------------------------------------------------------------------
echo "2. $BANK starten ..."
T0="$(now_ms)"
adb shell monkey -p "$BANK" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
GONE_AT=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  c="$(count)"; t=$(( $(now_ms) - T0 ))
  printf '   +%5d ms : %s venster(s)\n' "$t" "$c"
  [[ -z "$GONE_AT" && "$c" == "0" ]] && GONE_AT="$t"
done
sleep 1
N_BANK="$(count)"
FRONT_BANK="$(front)"
echo "   met bank-app open : $N_BANK overlayvenster(s) van $PKG   (vooraan: $FRONT_BANK)"
[[ -n "$GONE_AT" ]] && echo "   eerste meting met 0 vensters: na ongeveer $GONE_AT ms (incl. de trage dumpsys zelf)"
echo
read -r -p "   Kijk naar je gsm: opent $BANK normaal (inlogscherm, geen foutmelding)? [j/n] " OPENS </dev/tty || OPENS="?"
echo "   jouw antwoord: $OPENS"

# 3. Terug naar het startscherm ---------------------------------------------------------------------------
adb shell input keyevent KEYCODE_HOME
T1="$(now_ms)"
BACK_AT=""
for _ in 1 2 3 4 5 6; do
  c="$(count)"; t=$(( $(now_ms) - T1 ))
  [[ -z "$BACK_AT" && "$c" != "0" ]] && BACK_AT="$t"
done
sleep 1
N_BACK="$(count)"
echo "3. na terugkeer     : $N_BACK overlayvenster(s) van $PKG   (vooraan: $(front))"
[[ -n "$BACK_AT" ]] && echo "   terug na ongeveer $BACK_AT ms"
echo

echo "== Log van de bubbel sinds de start van deze meting (adb logcat -s FloatingPi)"
adb logcat -d -s FloatingPi -T "$LOGSTART" 2>/dev/null | tr -d '\r' | grep -v '^-----' | tail -20
echo

echo "== Samenvatting"
echo "startscherm: $N_HOME   bank-app open: $N_BANK   na terugkeer: $N_BACK   bank opent normaal: $OPENS"
if [[ "$FRONT_BANK" != "$BANK"* ]]; then
  echo "LET OP: tijdens stap 2 stond niet $BANK vooraan maar '$FRONT_BANK'. Getal 2 zegt dan niets over de bank-app."
fi
echo "Opgeslagen in: $OUT"
