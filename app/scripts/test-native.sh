#!/usr/bin/env bash
# Draait de JVM-unit-tests van de native module floating-pi (BankAppsTest) in het gebouwde Android-project.
#   bash scripts/test-native.sh          tests draaien (moet slagen)
#   bash scripts/test-native.sh --bewijs  eerst met opzet breken (KBC uit de lijst) en tonen dat de test faalt,
#                                         dan herstellen en tonen dat hij weer slaagt. Je broncode blijft ongemoeid:
#                                         de breuk gebeurt enkel in de buildmap.
set -euo pipefail

APP_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${HAL_BUILD_DIR:-$HOME/nex-pi-control-build}/app"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
if [[ -z "${JAVA_HOME:-}" ]] && command -v javac >/dev/null; then
  JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
  export JAVA_HOME
fi
[[ -x "$BUILD/android/gradlew" ]] || { echo "Nog geen Android-project in $BUILD. Draai eerst: npm run install:usb" >&2; exit 1; }

# Enkel de modules-map bijwerken (zelfde bron als install-usb.sh), zodat de test de code van nu test.
rsync -a --delete "$APP_SRC/modules/" "$BUILD/modules/"
LIST="$BUILD/modules/floating-pi/android/src/main/java/be/nexai/floatingpi/BankApps.kt"

cd "$BUILD/android"
PROJ="$(./gradlew -q projects 2>/dev/null | grep -oE "':[^']*floating-pi'" | head -1 | tr -d "'")"
PROJ="${PROJ:-:floating-pi}"
run() { ./gradlew --no-daemon -q "$PROJ:testReleaseUnitTest"; }

if [[ "${1:-}" == "--bewijs" ]]; then
  echo "== 1. Met opzet gebroken: \"com.kbc.\" uit de lijst gehaald (enkel in de buildmap)"
  sed -i '/"com.kbc.", \/\/ KBC/d' "$LIST"
  set +e
  OUT="$(run 2>&1)"
  RC=$?
  set -e
  echo "$OUT" | grep -E "BankAppsTest|tests completed|FAILED|failing tests" | head -20
  rsync -a --delete "$APP_SRC/modules/" "$BUILD/modules/"
  if (( RC == 0 )); then
    echo "FOUT: de test slaagde terwijl KBC uit de lijst was. De test bewijst dan niets." >&2
    exit 1
  fi
  # Faalde hij om een andere reden (compileerfout, gradle), dan is dat geen bewijs.
  echo "$OUT" | grep -qE "There were failing tests|BankAppsTest > .* FAILED" || { echo "$OUT" | tail -30; echo "FOUT: de build faalde, niet de test. Geen bewijs." >&2; exit 1; }
  echo "OK: de test faalde op de gebroken lijst, zoals het hoort."
  echo
  echo "== 2. Hersteld (originele modules-map terug in de buildmap)"
fi
run
echo "OK: BankAppsTest geslaagd ($PROJ:testReleaseUnitTest)"
