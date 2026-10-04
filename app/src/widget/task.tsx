// Headless taak van de widgets: Android roept dit aan bij toevoegen, vergroten en het periodieke bijwerken (30 min).
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { widgetLive } from '@/lib/widgetLive';

import { afterIntro, rememberCoverCaption } from './cover';
import { buildCoverModel } from './coverModel';
import { ensureHydrated, loadSnapshot, loadingSnapshot, type Snapshot } from './data';
import { COVER_WIDGET, renderWidget, widgetByName, type WidgetDef } from './registry';

/**
 * Flex Window: de cijfers gaan naar de native layout (Samsung toont daar geen vooraf getekende afbeelding). Lukt dat
 * niet (build zonder de native module), dan de gewone weergave als reserve.
 */
export function drawCover(def: WidgetDef, snap: Snapshot, fallback: () => void): void {
  rememberCoverCaption(snap.server);
  if (!widgetLive.renderCover(JSON.stringify(buildCoverModel(snap)))) fallback();
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  const def = widgetByName(props.widgetInfo.widgetName);
  if (!def) return;
  if (def.name === COVER_WIDGET) {
    if (props.widgetAction === 'WIDGET_DELETED' || props.widgetAction === 'WIDGET_CLICK') return;
    // Net geplaatst: meteen het logo en de draaiende behuizing, terwijl de gegevens laden.
    if (props.widgetAction === 'WIDGET_ADDED') widgetLive.playCoverIntro();
    const snap = await afterIntro(() => loadSnapshot(def.needs));
    drawCover(def, snap, () => props.renderWidget(renderWidget(def, snap, props.widgetInfo)));
    return;
  }
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
