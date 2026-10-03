// Zwevend icoon (modules/floating-pi): de draaiende Pi-behuizing boven andere apps.
//
// Aan (standaard): voegt "Weergeven over andere apps" (SYSTEM_ALERT_WINDOW), de voorgrondservice (specialUse),
// "Toegang tot gebruiksgegevens" (enkel op het startscherm tonen), zicht op de startscherm-apps (<queries>) en de
// service zelf toe aan het manifest, en haalt SYSTEM_ALERT_WINDOW uit blockedPermissions.
// Uit ({ "enabled": false }): niets van dat alles, SYSTEM_ALERT_WINDOW blijft geblokkeerd. Gebruik dat voor een
// Play Store-build als je geen verklaring voor die rechten wilt indienen. De app verbergt de optie dan zelf.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const SAW = 'android.permission.SYSTEM_ALERT_WINDOW';
const PERMISSIONS = [SAW, 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE'];
const SERVICE = 'be.nexai.floatingpi.FloatingPiService';
// "Enkel op het startscherm": zien welke app op de voorgrond staat (toegang geeft de gebruiker zelf in Android).
const USAGE = 'android.permission.PACKAGE_USAGE_STATS';

function withFloatingIcon(config, props = {}) {
  const enabled = props.enabled !== false;
  config.android = config.android ?? {};
  const blocked = config.android.blockedPermissions ?? [];
  if (!enabled) {
    if (!blocked.includes(SAW)) config.android.blockedPermissions = [...blocked, SAW];
    return withAndroidManifest(config, (c) => {
      const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
      app.service = (app.service ?? []).filter((s) => s.$['android:name'] !== SERVICE);
      c.modResults.manifest['uses-permission'] = (c.modResults.manifest['uses-permission'] ?? []).filter((p) => p.$['android:name'] !== USAGE);
      return c;
    });
  }
  config.android.blockedPermissions = blocked.filter((p) => p !== SAW);
  config.android.permissions = [...new Set([...(config.android.permissions ?? []), ...PERMISSIONS])];
  return withAndroidManifest(config, (c) => {
    const m = AndroidConfig.Manifest.ensureToolsAvailable(c.modResults);
    c.modResults = m;
    // PACKAGE_USAGE_STATS is een "speciale toegang": Android vraagt het niet zelf, de gebruiker zet het aan.
    const perms = (m.manifest['uses-permission'] ?? []).filter((p) => p.$['android:name'] !== USAGE);
    perms.push({ $: { 'android:name': USAGE, 'tools:ignore': 'ProtectedPermissions' } });
    m.manifest['uses-permission'] = perms;
    // Zicht op de startscherm-apps (Android 11+ verbergt andere apps standaard).
    const queries = m.manifest.queries ?? [];
    if (!queries.length) queries.push({});
    const q = queries[0];
    const hasHome = (q.intent ?? []).some((i) => (i.category ?? []).some((cat) => cat.$['android:name'] === 'android.intent.category.HOME'));
    if (!hasHome) {
      q.intent = [
        ...(q.intent ?? []),
        { action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.HOME' } }] },
      ];
    }
    m.manifest.queries = queries;
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(m);
    const others = (app.service ?? []).filter((s) => s.$['android:name'] !== SERVICE);
    app.service = [
      ...others,
      {
        $: { 'android:name': SERVICE, 'android:exported': 'false', 'android:foregroundServiceType': 'specialUse' },
        property: [
          {
            $: {
              'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
              'android:value': 'Floating status icon of the user\'s Raspberry Pi that opens the app when tapped',
            },
          },
        ],
      },
    ];
    return c;
  });
}

module.exports = withFloatingIcon;
