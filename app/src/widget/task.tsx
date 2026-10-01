// Headless taak van de widget: Android roept dit aan bij toevoegen, vergroten en het periodieke bijwerken (30 min).
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { loadWidgetData } from './data';
import { StatusWidget, WIDGET_NAME } from './StatusWidget';

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  if (props.widgetInfo.widgetName !== WIDGET_NAME) return;
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const data = await loadWidgetData();
      props.renderWidget(StatusWidget({ data }));
      break;
    }
    default:
      break;
  }
}
