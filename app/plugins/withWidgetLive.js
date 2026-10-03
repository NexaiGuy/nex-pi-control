// Live widgets (modules/widget-live): houdt de widgets vers zolang je naar je startscherm kijkt.
//
// Aan (standaard): voegt de voorgrondservice (specialUse), de opstart-ontvanger (na een herstart of update van de app
// start de dienst vanzelf opnieuw) en hun rechten toe aan het manifest.
// Uit ({ "enabled": false }): niets van dat alles. De app verbergt de optie dan zelf en de widgets verversen enkel nog
// om de 30 minuten (Android) en wanneer je de app opent.
// "Toegang tot gebruiksgegevens" (enkel op het startscherm verversen) komt uit plugins/withFloatingIcon.js. Zonder dat
// recht verversen de widgets zolang je gsm ontgrendeld is.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.RECEIVE_BOOT_COMPLETED',
];
const SERVICE = 'be.nexai.widgetlive.WidgetLiveService';
const RECEIVER = 'be.nexai.widgetlive.WidgetLiveBootReceiver';

function withWidgetLive(config, props = {}) {
  const enabled = props.enabled !== false;
  config.android = config.android ?? {};
  if (enabled) {
    config.android.permissions = [...new Set([...(config.android.permissions ?? []), ...PERMISSIONS])];
  }
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.service = (app.service ?? []).filter((s) => s.$['android:name'] !== SERVICE);
    app.receiver = (app.receiver ?? []).filter((r) => r.$['android:name'] !== RECEIVER);
    if (!enabled) return c;
    app.service.push({
      $: { 'android:name': SERVICE, 'android:exported': 'false', 'android:foregroundServiceType': 'specialUse' },
      property: [
        {
          $: {
            'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE',
            'android:value': "Keeps the user's home screen widgets showing the current status of their own Raspberry Pi while the phone is unlocked",
          },
        },
      ],
    });
    app.receiver.push({
      $: { 'android:name': RECEIVER, 'android:exported': 'false' },
      'intent-filter': [
        {
          action: [
            { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
            { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
          ],
        },
      ],
    });
    return c;
  });
}

module.exports = withWidgetLive;
