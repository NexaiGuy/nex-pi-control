// Config plugin: ondertekent de release-APK met je eigen keystore uit omgevingsvariabelen.
// Nooit wachtwoorden in bestanden: scripts/install-usb.sh leest ze uit keys/signing.env (chmod 600, niet in git).
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const RELEASE_SIGNING = `
        release {
            def ks = System.getenv('HAL_KEYSTORE_PATH')
            if (ks) {
                storeFile file(ks)
                storePassword System.getenv('HAL_KEYSTORE_PASSWORD')
                keyAlias System.getenv('HAL_KEY_ALIAS') ?: 'halcontrol'
                keyPassword System.getenv('HAL_KEY_PASSWORD') ?: System.getenv('HAL_KEYSTORE_PASSWORD')
            }
        }`;

function withSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes("System.getenv('HAL_KEYSTORE_PATH')")) {
      src = src.replace(/signingConfigs\s*\{\s*\n(\s*debug\s*\{[^}]*\})/, (m, debugBlock) => `signingConfigs {\n        ${debugBlock.trim()}${RELEASE_SIGNING}`);
      src = src.replace(
        /(release\s*\{\s*\n(?:\s*\/\/[^\n]*\n)*)\s*signingConfig signingConfigs\.debug/,
        `$1            // Zonder HAL_KEYSTORE_PATH valt de release terug op debug-signing (enkel voor lokaal testen). scripts/install-usb.sh zet ze altijd.\n            signingConfig System.getenv('HAL_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug`,
      );
    }
    cfg.modResults.contents = src;
    return cfg;
  });
}

function withArm64(config) {
  return withGradleProperties(config, (cfg) => {
    const set = (key, value) => {
      const item = cfg.modResults.find((p) => p.type === 'property' && p.key === key);
      if (item) item.value = value;
      else cfg.modResults.push({ type: 'property', key, value });
    };
    // Je gsm is arm64: enkel die architectuur bouwen maakt de APK kleiner en de build veel sneller.
    set('reactNativeArchitectures', 'arm64-v8a');
    set('org.gradle.jvmargs', '-Xmx4096m -XX:MaxMetaspaceSize=1024m');
    return cfg;
  });
}

module.exports = function withReleaseSigning(config) {
  return withArm64(withSigning(config));
};
