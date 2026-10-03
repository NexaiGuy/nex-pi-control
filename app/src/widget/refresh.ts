// Werkt de widgets bij vanuit de app zelf, zodra er een vers overzicht is (hooguit één keer per minuut).
// Gebruikt het verse overzicht plus de cache van de app: geen extra netwerkverkeer.
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';

import type { Overview } from '@/api/types';
import { floatingPi } from '@/lib/floatingPi';

import { loadSnapshot } from './data';
import { renderWidget, WIDGETS } from './registry';

let last = 0;

export function refreshWidget(o: Overview): void {
  if (Platform.OS !== 'android' || Date.now() - last < 60_000) return;
  last = Date.now();
  floatingPi.setStatus(o.health.status);
  for (const def of WIDGETS) {
    void requestWidgetUpdate({
      widgetName: def.name,
      renderWidget: async (info) => renderWidget(def, await loadSnapshot(def.needs, { overview: o, cacheOnly: true }), info),
      widgetNotFound: () => undefined,
    }).catch(() => undefined);
  }
}
