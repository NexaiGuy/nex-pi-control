#!/usr/bin/env bash
# Bouwt Nex Pi Control en zet hem via USB op je gsm (adb install -r), of maakt de AAB voor Google Play.
# Gebruik:  bash scripts/install-usb.sh            (bouwen + installeren)
#           bash scripts/install-usb.sh --clean    (native project volledig opnieuw genereren)
#           bash scripts/install-usb.sh --no-build (enkel de laatste APK opnieuw installeren)
#           bash scripts/install-usb.sh --aab      (Android App Bundle voor de Play Console, geen gsm nodig)
set -euo pipefail

APP_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$(cd "$APP_SRC/.." && pwd)"
KEYS="$PROJECT/keys"
BUILD_ROOT="${HAL_BUILD_DIR:-$HOME/nex-pi-control-build}"
BUILD="$BUILD_ROOT/app"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
PKG="be.nexai.picontrol"
CLEAN=0; BUILD_IT=1; AAB=0
for a in "$@"; do
  case "$a" in
    --clean) CLEAN=1 ;;
    --no-build) BUILD_IT=0 ;;
    --aab) AAB=1 ;;
    *) echo "Onbekende optie: $a" >&2; exit 2 ;;
  esac
done

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
  rsync -a --delete --exclude node_modules --exclude android --exclude .expo --exclude dist "$APP_SRC/" "$BUILD/"
  cd "$BUILD"
  if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then
    info "npm ci"
    npm ci --no-audit --no-fund
  fi
  if (( CLEAN )) || [[ ! -d android ]] || [[ app.json -nt android/app/build.gradle ]] || [[ plugins/withReleaseSigning.js -nt android/app/build.gradle ]]; then
    info "Native Android-project genereren (expo prebuild)"
    PREBUILD_ARGS=(-p android --no-install)
    (( CLEAN )) && PREBUILD_ARGS+=(--clean)
    CI=1 npx expo prebuild "${PREBUILD_ARGS[@]}"
  fi
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

# 0. Enkel de App Bundle voor Google Play ---------------------------------------------------------
if (( AAB )); then
  prepare_build
  VERSION="$(node -p "require('./app.json').expo.version")"
  VCODE="$(node -p "require('./app.json').expo.android.versionCode")"
  info "App Bundle bouwen (versie $VERSION, versionCode $VCODE)"
  gradle_release bundleRelease
  OUT_AAB="android/app/build/outputs/bundle/release/app-release.aab"
  [[ -f "$OUT_AAB" ]] || die "AAB niet gevonden na de build"
  mkdir -p "$PROJECT/releases"
  cp "$OUT_AAB" "$PROJECT/releases/nex-pi-control-$VERSION-$VCODE.aab"
  ok "Klaar: releases/nex-pi-control-$VERSION-$VCODE.aab ($(du -h "$OUT_AAB" | cut -f1))"
  echo "     Upload dit bestand in de Play Console. Verhoog android.versionCode in app.json voor elke nieuwe upload."
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
adb -s "$SERIAL" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true
ok "App gestart op je gsm. Zet USB-foutopsporing weer uit als je klaar bent."
