// Werkt de widgets bij vanuit de app zelf, zodra er een vers overzicht is (hooguit één keer per minuut),
// en meteen als je in de app het thema wisselt. Gebruikt de cache van de app: geen extra netwerkverkeer.
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';

import type { Overview } from '@/api/types';
import { floatingPi } from '@/lib/floatingPi';
import { prefsStore } from '@/state/settings';

import { afterIntro } from './cover';
import { loadSnapshot } from './data';
import { COVER_WIDGET, renderWidget, WIDGETS, type WidgetDef } from './registry';
import { drawCover } from './task';

let last = 0;

function viaLibrary(def: WidgetDef, overview?: Overview): void {
  void requestWidgetUpdate({
    widgetName: def.name,
    renderWidget: async (info) => renderWidget(def, await loadSnapshot(def.needs, { overview, cacheOnly: true }), info),
    widgetNotFound: () => undefined,
  }).catch(() => undefined);
}

function updateAll(overview?: Overview): void {
  for (const def of WIDGETS) {
    if (def.name === COVER_WIDGET) {
      // Flex Window: native layout, en nooit door het intro heen tekenen.
      void afterIntro(() => loadSnapshot(def.needs, { overview, cacheOnly: true }))
        .then((snap) => drawCover(def, snap, () => viaLibrary(def, overview)))
        .catch(() => undefined);
      continue;
    }
    viaLibrary(def, overview);
  }
}

export function refreshWidget(o: Overview): void {
  if (Platform.OS !== 'android' || Date.now() - last < 60_000) return;
  last = Date.now();
  floatingPi.setStatus(o.health.status);
  updateAll(o);
}

/** Thema gewisseld in Instellingen: alle widgets meteen opnieuw tekenen, zonder op het volgende overzicht te wachten. */
let lastTheme = prefsStore.get().theme;
export function onPrefsChanged(): void {
  const theme = prefsStore.get().theme;
  if (theme === lastTheme) return;
  lastTheme = theme;
  if (Platform.OS === 'android') updateAll();
}
prefsStore.subscribe(onPrefsChanged);
