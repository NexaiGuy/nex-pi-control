// Ingang van de app: Expo Router, plus de headless taak van de Android-widget.
import 'expo-router/entry';
import { registerWidgetTaskHandler } from 'react-native-android-widget';

import { widgetTaskHandler } from './src/widget/task';

registerWidgetTaskHandler(widgetTaskHandler);
