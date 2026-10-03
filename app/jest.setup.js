/* global jest */
jest.mock('expo-secure-store', () => {
  const store = {};
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1,
    getItemAsync: jest.fn(async (k) => store[k] ?? null),
    setItemAsync: jest.fn(async (k, v) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k) => { delete store[k]; }),
  };
});
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn(async () => {}),
  impactAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-file-system', () => {
  class File {
    constructor(...p) { this.uri = p.map(String).join('/'); this.exists = false; }
    textSync() { return '{}'; }
    write() {}
    delete() {}
  }
  class Directory { constructor() { this.exists = true; } create() {} }
  return { File, Directory, Paths: { document: 'doc', cache: 'cache' }, UploadType: { MULTIPART: 1 } };
});
jest.mock('expo-screen-capture', () => ({ preventScreenCaptureAsync: jest.fn(async () => {}), allowScreenCaptureAsync: jest.fn(async () => {}) }));
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true), isEnrolledAsync: jest.fn(async () => true),
  getEnrolledLevelAsync: jest.fn(async () => 2), authenticateAsync: jest.fn(async () => ({ success: true })), SecurityLevel: { NONE: 0 },
}));
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(), scheduleNotificationAsync: jest.fn(async () => 'id'), dismissNotificationAsync: jest.fn(async () => {}), setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })), requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  AndroidImportance: { HIGH: 4 }, AndroidNotificationPriority: { MAX: 'max', HIGH: 'high' },
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskRegisteredAsync: jest.fn(async () => false) }));
jest.mock('expo-background-task', () => ({ registerTaskAsync: jest.fn(), getStatusAsync: jest.fn(async () => 2), BackgroundTaskStatus: { Available: 2 }, BackgroundTaskResult: { Success: 1, Failed: 2 } }));
jest.mock('react-native-webview', () => {
  const { View } = require('react-native');
  return { WebView: View };
});
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-router', () => {
  const React = require('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
    useLocalSearchParams: jest.fn(() => ({})),
    useFocusEffect: (cb) => React.useEffect(cb, []),
    Link: ({ children }) => children,
  };
});
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
// De officiële mock heeft geen useReducedMotion; Odyssey gebruikt die (gloed, oog, lichtstroom).
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return { ...mock, default: mock.default ?? mock, useReducedMotion: () => false };
});
// Taal van de gsm: standaard Nederlands in de tests; een testbestand kan dit overschrijven met jest.mock.
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'nl', languageTag: 'nl-BE' }] }));
jest.mock('react-native-android-widget', () => {
  const React = require('react');
  const el = (name) => (props) => React.createElement(name, props, props.children);
  return {
    FlexWidget: el('FlexWidget'),
    TextWidget: el('TextWidget'),
    requestWidgetUpdate: jest.fn(async () => {}),
    registerWidgetTaskHandler: jest.fn(),
  };
});
