// Headless taak van de widgets: Android roept dit aan bij toevoegen, vergroten en het periodieke bijwerken (30 min).
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { ensureHydrated, loadSnapshot, loadingSnapshot } from './data';
import { renderWidget, widgetByName } from './registry';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const def = widgetByName(props.widgetInfo.widgetName);
  if (!def) return;
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
      // Eerst haarlijnen, nooit verzonnen getallen; daarna de echte toestand. Voorkeuren eerst, voor het juiste thema.
      await ensureHydrated();
      props.renderWidget(renderWidget(def, loadingSnapshot(), props.widgetInfo));
      props.renderWidget(renderWidget(def, await loadSnapshot(def.needs), props.widgetInfo));
      break;
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(renderWidget(def, await loadSnapshot(def.needs), props.widgetInfo));
      break;
    default:
      break;
  }
}
