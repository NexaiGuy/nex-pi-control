// Flex Window (cover-scherm van de Galaxy Z Flip): zet de widget "PiCover" op het cover-scherm.
//
// Samsung toont een widget van een andere app op de Flex Window als zijn ontvanger twee meta-data heeft
// (developer.samsung.com/galaxy-z/flex_window.html):
//   - android.appwidget.provider: widgetCategory "keyguard", minstens 352 x 339 dp;
//   - com.samsung.android.appwidget.provider: <samsung-appwidget-provider display="sub_screen" />.
// react-native-android-widget schrijft altijd widgetCategory "home_screen" en één meta-data. Daarom wijst deze plugin
// de ontvanger van PiCover naar eigen XML-bestanden (flexwindow_picover.xml en samsung_meta_info_picover.xml) die de
// bibliotheek nooit overschrijft. De Java-klasse, de voorbeeldafbeelding en de beschrijving komen nog wel uit de
// widgetlijst in app.json (react-native-android-widget).
//
// Ook de Java-klasse van de ontvanger schrijft deze plugin zelf (PiCover.java, met een native eerste beeld zodat het
// vak nooit leeg is). Daarvoor moet hij in app.json VOOR react-native-android-widget staan: Expo voert de bestanden-
// stap van latere plugins eerst uit, dus dan schrijven wij als laatste. Staat hij erna, dan blijft de kale klasse van
// de bibliotheek staan en komt het eerste beeld uit de JS-taak (werkt ook, iets later).
// De ontvanger in het manifest werkt in beide volgordes: bestaat hij nog niet, dan maken we hem zelf en slaat de
// bibliotheek hem over (zelfde naam); bestaat hij al, dan passen we hem aan.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const DEFAULTS = { name: 'PiCover', label: 'Flex Window', minWidth: '352dp', minHeight: '339dp' };

const xmlName = (name) => `flexwindow_${name.toLowerCase()}`;
const samsungName = (name) => `samsung_meta_info_${name.toLowerCase()}`;

function providerXml(w) {
  const lower = w.name.toLowerCase();
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Gemaakt door plugins/withFlexWindow.js: widget voor de Flex Window (cover-scherm). -->
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="${w.minWidth}"
    android:minHeight="${w.minHeight}"
    android:resizeMode="horizontal|vertical"
    android:description="@string/widget_${lower}_description"
    android:initialLayout="@layout/rn_widget"
    android:previewImage="@drawable/${lower}_preview"
    android:updatePeriodMillis="1800000"
    android:widgetCategory="keyguard">
</appwidget-provider>
`;
}

const SAMSUNG_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Gemaakt door plugins/withFlexWindow.js: toon deze widget op de Flex Window. -->
<samsung-appwidget-provider display="sub_screen">
</samsung-appwidget-provider>
`;

// Eigen ontvanger: dezelfde als die van react-native-android-widget, maar zonder JS-taak al meteen iets op het
// cover-scherm (het logo) als de widget nog nooit cijfers toonde. Zo is het vak nooit leeg. Een tik op de widget
// (CoverScreen.ACTION_REPLAY) speelt het intro opnieuw en vraagt verse cijfers.
function providerJava(pkg, name) {
  return `package ${pkg}.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;

import be.nexai.widgetlive.CoverScreen;
import com.reactnativeandroidwidget.RNWidgetProvider;

// Gemaakt door plugins/withFlexWindow.js (Flex Window, cover-scherm van de Galaxy Z Flip).
public class ${name} extends RNWidgetProvider {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent != null && CoverScreen.ACTION_REPLAY.equals(intent.getAction())) {
            CoverScreen.INSTANCE.replay(context);
            return;
        }
        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        CoverScreen.INSTANCE.paintIfEmpty(context);
        super.onUpdate(context, appWidgetManager, appWidgetIds);
    }

    @Override
    public void onDeleted(Context context, int[] appWidgetIds) {
        super.onDeleted(context, appWidgetIds);
        CoverScreen.INSTANCE.forgetDrawn(context);
    }
}
`;
}

function withFlexWindow(config, props = {}) {
  const w = { ...DEFAULTS, ...props };
  const pkg = config.android?.package;
  if (!pkg) throw new Error('withFlexWindow: android.package ontbreekt in app.json');
  const receiverName = `.widget.${w.name}`;

  config = withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.receiver = app.receiver ?? [];
    let r = app.receiver.find((x) => x.$['android:name'] === receiverName);
    if (!r) {
      // Zelfde vorm als react-native-android-widget, zodat die hem herkent en overslaat.
      r = {
        $: { 'android:name': receiverName, 'android:exported': 'false', 'android:label': w.label },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } },
              { $: { 'android:name': `${pkg}.WIDGET_CLICK` } },
            ],
          },
        ],
      };
      app.receiver.push(r);
    }
    r['meta-data'] = [
      { $: { 'android:name': 'android.appwidget.provider', 'android:resource': `@xml/${xmlName(w.name)}` } },
      { $: { 'android:name': 'com.samsung.android.appwidget.provider', 'android:resource': `@xml/${samsungName(w.name)}` } },
    ];
    return c;
  });

  config = withDangerousMod(config, [
    'android',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${xmlName(w.name)}.xml`), providerXml(w));
      fs.writeFileSync(path.join(dir, `${samsungName(w.name)}.xml`), SAMSUNG_XML);
      // Na react-native-android-widget (die schrijft een kale versie): onze ontvanger met het native logo.
      const javaDir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/java', ...`${pkg}.widget`.split('.'));
      fs.mkdirSync(javaDir, { recursive: true });
      fs.writeFileSync(path.join(javaDir, `${w.name}.java`), providerJava(pkg, w.name));
      return c;
    },
  ]);

  return config;
}

module.exports = withFlexWindow;
module.exports.providerXml = providerXml;
module.exports.providerJava = providerJava;
