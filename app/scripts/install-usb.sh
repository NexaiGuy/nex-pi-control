#!/usr/bin/env bash
# Bouwt Nex Pi Control en zet hem via USB op je gsm (adb install -r), of maakt de AAB voor Google Play.
# Gebruik:  bash scripts/install-usb.sh            (bouwen + installeren)
#           bash scripts/install-usb.sh --clean    (native project volledig opnieuw genereren)
#           bash scripts/install-usb.sh --no-build (enkel de laatste APK opnieuw installeren)
#           bash scripts/install-usb.sh --aab      (Android App Bundle voor de Play Console, geen gsm nodig. Zonder zwevend
#                                                   icoon en live widgets, dus geen verklaring voor voorgronddiensten nodig)
#           bash scripts/install-usb.sh --aab --full  (App Bundle met zwevend icoon en live widgets: enkel als die in de
#                                                   Play Console verklaard zijn, zie store/PLAY-CONSOLE.md stap 3b)
set -euo pipefail

APP_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$(cd "$APP_SRC/.." && pwd)"
KEYS="$PROJECT/keys"
BUILD_ROOT="${HAL_BUILD_DIR:-$HOME/nex-pi-control-build}"
BUILD="$BUILD_ROOT/app"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
PKG="be.nexai.picontrol"
CLEAN=0; BUILD_IT=1; AAB=0; FULL=0
for a in "$@"; do
  case "$a" in
    --clean) CLEAN=1 ;;
    --no-build) BUILD_IT=0 ;;
    --aab) AAB=1 ;;
    --full) FULL=1 ;;
    *) echo "Onbekende optie: $a" >&2; exit 2 ;;
  esac
done

# Smaak van de build: "play" (App Bundle zonder zwevend icoon en live widgets) of "full" (alles, zoals de APK op de site).
FLAVOR=full
if (( AAB )) && (( ! FULL )); then FLAVOR=play; fi
if [[ "$FLAVOR" == play ]]; then export NEX_PLAY_BUILD=1; else unset NEX_PLAY_BUILD; fi
# Certificaat van de release-sleutel (APK op nex-ai.be, en met eigen sleutel in Play App Signing ook de Play-versie).
EXPECTED_CERT="f733da3416bb7d064d814e37e48a189c15ca59192e2bc57d7e2f4a89f3a0b067"

ok()   { printf '\033[32mOK\033[0m   %s\n' "$*"; }
info() { printf '\033[36m..\033[0m   %s\n' "$*"; }
die()  { printf '\033[31mFOUT\033[0m %s\n' "$*" >&2; exit 1; }

export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export PATH="$SDK/platform-tools:$SDK/cmdline-tools/latest/bin:$PATH"
if [[ -z "${JAVA_HOME:-}" ]] && command -v javac >/dev/null; then
  JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  export JAVA_HOME
fi
command -v adb >/dev/null || die "adb ontbreekt. Draai eerst: bash scripts/kali-bootstrap.sh"
[[ -f "$KEYS/signing.env" ]] || die "Geen keystore gevonden in $KEYS. Draai eerst: bash scripts/kali-bootstrap.sh"

prepare_build() {
  info "Broncode synchroniseren naar $BUILD (map zonder spaties)"
  mkdir -p "$BUILD_ROOT"
  rsync -a --delete --exclude node_modules --exclude /android --exclude /ios --exclude .expo --exclude /dist "$APP_SRC/" "$BUILD/"
  cd "$BUILD"
  if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
    info "npm ci"
    npm ci --no-audit --no-fund
  fi
  # Andere smaak dan de vorige build: native project volledig opnieuw, anders blijven permissies of diensten hangen.
  if [[ -d android ]] && [[ "$(cat android/.nex-flavor 2>/dev/null || echo full)" != "$FLAVOR" ]]; then
    info "Andere build-smaak ($FLAVOR): native project wordt volledig opnieuw gemaakt"
    CLEAN=1
  fi
  if (( CLEAN )) || [[ ! -d android ]] || [[ app.json -nt android/app/build.gradle ]] \
    || [[ -n "$(find plugins -type f -newer android/app/build.gradle -print -quit 2>/dev/null)" ]]; then
    info "Native Android-project genereren (expo prebuild)"
    PREBUILD_ARGS=(-p android --no-install)
    (( CLEAN )) && PREBUILD_ARGS+=(--clean)
    CI=1 npx expo prebuild "${PREBUILD_ARGS[@]}"
  fi
  echo "$FLAVOR" > android/.nex-flavor
}

gradle_release() {
  set -a
  # shellcheck disable=SC1091
  source "$KEYS/signing.env"
  set +a
  # Pad altijd vanuit keys/ zetten: werkt ook met oude signing.env zonder aanhalingstekens.
  export HAL_KEYSTORE_PATH="$KEYS/halcontrol-release.jks"
  (cd android && ./gradlew --no-daemon "$1")
  unset HAL_KEYSTORE_PASSWORD HAL_KEY_PASSWORD
}

# Controle van de App Bundle voor Play: sleutel, targetSdk en permissies die een verklaring of afwijzing kosten.
check_play_bundle() {
  local aab="$1" kt cert man target p extra=""
  local bad=()
  kt="$(command -v keytool || echo "${JAVA_HOME:-/nonexistent}/bin/keytool")"
  if [[ -x "$kt" ]]; then
    cert="$("$kt" -printcert -jarfile "$aab" 2>/dev/null | awk '/SHA256:/ && !f {print $2; f=1}' | tr -d ':' | tr 'A-F' 'a-f' || true)"
    [[ "$cert" == "$EXPECTED_CERT" ]] || die "Bundle is niet met de release-sleutel ondertekend (gevonden: ${cert:-geen}). Niet uploaden."
    ok "Ondertekend met de release-sleutel (SHA-256 ${cert:0:8}...${cert: -4})"
  else
    printf '\033[33m!!\033[0m   %s\n' "keytool niet gevonden, handtekening niet gecontroleerd"
  fi
  man="$(find android/app/build/intermediates -path '*merged_manifest*' -path '*release*' -name AndroidManifest.xml -print -quit 2>/dev/null || true)"
  if [[ -z "$man" ]]; then
    printf '\033[33m!!\033[0m   %s\n' "Samengevoegd manifest niet gevonden, permissies niet gecontroleerd"
    return 0
  fi
  target="$(grep -o -m1 'android:targetSdkVersion="[0-9]*"' "$man" | tr -dc '0-9' || true)"
  if [[ -z "$target" ]]; then
    printf '\033[33m!!\033[0m   %s\n' "targetSdk niet gevonden in het manifest, niet gecontroleerd"
  elif (( target < 36 )); then
    die "targetSdk $target: Google Play vraagt minstens 36"
  fi
  local forbidden=(READ_MEDIA_IMAGES READ_MEDIA_VIDEO QUERY_ALL_PACKAGES REQUEST_INSTALL_PACKAGES com.google.android.gms.permission.AD_ID)
  if [[ "$FLAVOR" == play ]]; then forbidden+=(SYSTEM_ALERT_WINDOW FOREGROUND_SERVICE_SPECIAL_USE PACKAGE_USAGE_STATS); fi
  for p in "${forbidden[@]}"; do
    [[ "$p" == *.* ]] || p="android.permission.$p"
    if grep -q "android:name=\"$p\"" "$man"; then bad+=("$p"); fi
  done
  (( ${#bad[@]} == 0 )) || die "Permissies die niet in deze Play-build horen: ${bad[*]} (manifest: $man)"
  if [[ "$FLAVOR" == full ]]; then extra=", voorgronddiensten aanwezig (verklaring nodig)"; fi
  ok "Manifest in orde: targetSdk ${target:-?}, geen permissies die een extra verklaring vragen$extra"
}

# 0. Enkel de App Bundle voor Google Play ---------------------------------------------------------
if (( AAB )); then
  prepare_build
  VERSION="$(node -p "require('./app.json').expo.version")"
  VCODE="$(node -p "require('./app.json').expo.android.versionCode")"
  info "App Bundle bouwen (versie $VERSION, versionCode $VCODE, smaak $FLAVOR)"
  gradle_release bundleRelease
  OUT_AAB="android/app/build/outputs/bundle/release/app-release.aab"
  [[ -f "$OUT_AAB" ]] || die "AAB niet gevonden na de build"
  check_play_bundle "$OUT_AAB"
  SUFFIX=""
  if [[ "$FLAVOR" == full ]]; then SUFFIX="-full"; fi
  mkdir -p "$PROJECT/releases"
  cp "$OUT_AAB" "$PROJECT/releases/nex-pi-control-$VERSION-$VCODE$SUFFIX.aab"
  ok "Klaar: releases/nex-pi-control-$VERSION-$VCODE$SUFFIX.aab ($(du -h "$OUT_AAB" | cut -f1))"
  echo "     Upload dit bestand in de Play Console. Verhoog android.versionCode in app.json voor elke nieuwe upload."
  if [[ "$FLAVOR" == full ]]; then
    echo "     Deze bundle bevat voorgronddiensten (specialUse): dien eerst de verklaring in (store/PLAY-CONSOLE.md, stap 3b)."
  fi
  exit 0
fi

# 1. Toestel controleren -------------------------------------------------------------------------
adb start-server >/dev/null 2>&1 || true
mapfile -t LINES < <(adb devices | tail -n +2 | awk 'NF')
DEVICES=(); UNAUTH=0
for l in "${LINES[@]:-}"; do
  [[ -z "$l" ]] && continue
  state="$(awk '{print $2}' <<<"$l")"
  if [[ "$state" == "device" ]]; then DEVICES+=("$(awk '{print $1}' <<<"$l")"); fi
  if [[ "$state" == "unauthorized" ]]; then UNAUTH=1; fi
done
if (( ${#DEVICES[@]} == 0 )); then
  if (( UNAUTH )); then
    die "Je gsm is verbonden maar nog niet goedgekeurd. Ontgrendel je gsm en tik op 'USB-foutopsporing toestaan'. Probeer daarna opnieuw."
  fi
  die "Geen gsm gevonden. Controleer: kabel verbonden, 'Bestandsoverdracht' gekozen, USB-foutopsporing aan (Instellingen, Systeem, Ontwikkelaarsopties)."
fi
(( ${#DEVICES[@]} == 1 )) || die "Meer dan één toestel verbonden (${DEVICES[*]}). Koppel de andere los of zet ANDROID_SERIAL."
SERIAL="${DEVICES[0]}"
MODEL="$(adb -s "$SERIAL" shell getprop ro.product.model | tr -d '\r')"
ok "Toestel: $MODEL ($SERIAL)"

APK="$BUILD/android/app/build/outputs/apk/release/app-release.apk"

# 2. Bouwen -------------------------------------------------------------------------------------------
if (( BUILD_IT )); then
  prepare_build
  info "Release-APK bouwen (eerste keer 5 tot 15 minuten)"
  gradle_release assembleRelease
  [[ -f "$APK" ]] || die "APK niet gevonden na de build"
  ok "APK: $APK ($(du -h "$APK" | cut -f1))"
  mkdir -p "$PROJECT/releases"
  VERSION="$(node -p "require('$BUILD/app.json').expo.version")"
  cp "$APK" "$PROJECT/releases/nex-pi-control-$VERSION.apk"
  ok "Kopie bewaard in releases/nex-pi-control-$VERSION.apk"
fi
[[ -f "$APK" ]] || die "Nog geen APK gebouwd. Draai zonder --no-build."

# 3. Installeren ---------------------------------------------------------------------------------------
info "Installeren op $MODEL"
set +e
OUT="$(adb -s "$SERIAL" install -r "$APK" 2>&1)"
RC=$?
set -e
if (( RC != 0 )) || ! grep -q "Success" <<<"$OUT"; then
  echo "$OUT"
  if grep -q "INSTALL_FAILED_UPDATE_INCOMPATIBLE" <<<"$OUT"; then
    die "De geïnstalleerde versie is met een andere sleutel ondertekend. Verwijder de app eerst: adb uninstall $PKG (je instellingen gaan dan verloren)."
  fi
  die "Installatie mislukt"
fi
ok "Nex Pi Control geïnstalleerd"
# Zwevend icoon: geef meteen "Weergeven over andere apps", dan staat het icoon er bij de eerste start zonder vragen.
if adb -s "$SERIAL" shell dumpsys package "$PKG" 2>/dev/null | grep -q "android.permission.SYSTEM_ALERT_WINDOW"; then
  if adb -s "$SERIAL" shell appops set "$PKG" SYSTEM_ALERT_WINDOW allow >/dev/null 2>&1; then
    ok "Zwevend icoon: 'Weergeven over andere apps' toegestaan"
  fi
fi
# Enkel op het startscherm: "Toegang tot gebruiksgegevens", zodat het icoon zich verbergt als een andere app open is.
if adb -s "$SERIAL" shell dumpsys package "$PKG" 2>/dev/null | grep -q "android.permission.PACKAGE_USAGE_STATS"; then
  if adb -s "$SERIAL" shell appops set "$PKG" GET_USAGE_STATS allow >/dev/null 2>&1; then
    ok "Zwevend icoon: 'Toegang tot gebruiksgegevens' toegestaan (enkel op het startscherm)"
  fi
fi
adb -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
ok "App gestart op je gsm. Zet USB-foutopsporing weer uit als je klaar bent."
