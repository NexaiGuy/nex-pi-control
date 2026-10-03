// Werkt de widget bij vanuit de app zelf, zodra er een vers overzicht is (hooguit één keer per minuut).
import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';

import type { Overview } from '@/api/types';
import { floatingPi } from '@/lib/floatingPi';
import { connectionStore, prefsStore, serverName } from '@/state/settings';

import { toWidgetData } from './data';
import { StatusWidget, WIDGET_NAME } from './StatusWidget';

let last = 0;

export function refreshWidget(o: Overview): void {
  if (Platform.OS !== 'android' || Date.now() - last < 60_000) return;
  last = Date.now();
  floatingPi.setStatus(o.health.status);
  const data = { ...toWidgetData(o, serverName(connectionStore.get()), Date.now(), false), design: prefsStore.get().design };
  void requestWidgetUpdate({ widgetName: WIDGET_NAME, renderWidget: () => StatusWidget({ data }) }).catch(() => undefined);
}
