#!/usr/bin/env bash
# Eenmalige voorbereiding op je Kali: JDK 17, Android SDK, adb, Node-afhankelijkheden en je release-keystore.
# Veilig om opnieuw te draaien. Gebruik:  bash scripts/kali-bootstrap.sh
set -euo pipefail

APP_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="$(cd "$APP_SRC/.." && pwd)"
KEYS="$PROJECT/keys"
BUILD_ROOT="${HAL_BUILD_DIR:-$HOME/nex-pi-control-build}"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"

ok()   { printf '\033[32mOK\033[0m   %s\n' "$*"; }
info() { printf '\033[36m..\033[0m   %s\n' "$*"; }
warn() { printf '\033[33m!!\033[0m   %s\n' "$*"; }
die()  { printf '\033[31mFOUT\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -ne 0 ]] || die "Draai dit als je gewone gebruiker, niet met sudo. Het script vraagt zelf sudo voor apt."

# 1. Systeempakketten ----------------------------------------------------------------------
info "Systeempakketten controleren"
PKGS=(unzip curl rsync adb)
command -v node >/dev/null 2>&1 || PKGS+=(nodejs)
command -v npm >/dev/null 2>&1 || PKGS+=(npm)
JDK_PKG=""
for v in 17 21; do
  if apt-cache show "openjdk-$v-jdk-headless" >/dev/null 2>&1; then JDK_PKG="openjdk-$v-jdk-headless"; break; fi
done
[[ -n "$JDK_PKG" ]] || die "Geen openjdk-17 of -21 gevonden in apt"
PKGS+=("$JDK_PKG")
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${PKGS[@]}"
JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")"
export JAVA_HOME
ok "Pakketten klaar (JDK: $JAVA_HOME)"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  die "Node $NODE_MAJOR is te oud. Installeer Node 20 of nieuwer (bv. via nvm) en draai dit opnieuw."
fi
ok "Node $(node -v)"

# 2. Android SDK -------------------------------------------------------------------------------
if [[ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]]; then
  info "Android command-line tools downloaden naar $SDK"
  mkdir -p "$SDK/cmdline-tools"
  URL="$(curl -fsSL https://developer.android.com/studio 2>/dev/null | grep -oE 'https://dl.google.com/android/repository/commandlinetools-linux-[0-9]+_latest\.zip' | head -n1 || true)"
  URL="${URL:-https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip}"
  TMP="$(mktemp -d)"
  curl -fL --progress-bar "$URL" -o "$TMP/clt.zip"
  unzip -q "$TMP/clt.zip" -d "$TMP"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$TMP/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$TMP"
fi
export ANDROID_HOME="$SDK" ANDROID_SDK_ROOT="$SDK"
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:$PATH"
yes | sdkmanager --licenses >/dev/null 2>&1 || true
sdkmanager --install "platform-tools" >/dev/null
ok "Android SDK in $SDK (Gradle haalt de juiste platform-, build-tools- en NDK-versie zelf op)"

# 3. Bouwmap zonder spaties --------------------------------------------------------------------
# Je projectmap heeft spaties in de naam; de NDK en CMake kunnen daar niet mee om. We bouwen in een kopie.
info "Bouwmap synchroniseren: $BUILD_ROOT/app"
mkdir -p "$BUILD_ROOT"
rsync -a --delete --exclude node_modules --exclude android --exclude .expo "$APP_SRC/" "$BUILD_ROOT/app/"
(cd "$BUILD_ROOT/app" && npm ci --no-audit --no-fund)
ok "Node-afhankelijkheden geïnstalleerd"

# 4. Release-keystore ----------------------------------------------------------------------------
mkdir -p "$KEYS"
chmod 700 "$KEYS"
if [[ ! -f "$KEYS/halcontrol-release.jks" ]]; then
  PASS="$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
  keytool -genkeypair -v -storetype JKS -keystore "$KEYS/halcontrol-release.jks" -alias halcontrol \
    -keyalg RSA -keysize 4096 -validity 10000 -storepass "$PASS" -keypass "$PASS" \
    -dname "CN=Nex Pi Control, O=Nex AI, L=Gent, C=BE" >/dev/null 2>&1
  umask 077
  cat > "$KEYS/signing.env" <<EOF
# Release-signing (upload key voor Google Play). Bewaar deze map (keys/) veilig en maak een backup.
# Zonder deze keystore kan je de app niet meer updaten, enkel verwijderen en opnieuw installeren.
HAL_KEYSTORE_PATH="$KEYS/halcontrol-release.jks"
HAL_KEYSTORE_PASSWORD=$PASS
HAL_KEY_ALIAS=halcontrol
HAL_KEY_PASSWORD=$PASS
EOF
  chmod 600 "$KEYS/signing.env" "$KEYS/halcontrol-release.jks"
  ok "Nieuwe keystore gemaakt in $KEYS"
  warn "Maak NU een backup van de map keys/ (bv. naar je wachtwoordbeheerder of een versleutelde USB-stick)."
else
  ok "Keystore bestaat al, niets aangepast"
fi

cat <<EOF

Klaar. Volgende stap:
  1. Zet USB-foutopsporing aan op je gsm en verbind hem met de kabel.
  2. bash "$APP_SRC/scripts/install-usb.sh"
EOF
