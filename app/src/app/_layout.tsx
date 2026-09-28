import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import {
  SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { SplashScreen, Stack, ThemeProvider, DarkTheme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useRef } from 'react';
import { AppState, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { registerBackgroundAlerts } from '@/background/alerts';
import { ToastHost } from '@/components/overlays';
import { LockGate } from '@/features/lock/LockGate';
import { connectionStore, hydrate, hydratedStore, isConfigured, prefsStore } from '@/state/settings';
import { useStore } from '@/state/store';
import { colors } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();
void SystemUI.setBackgroundColorAsync(colors.bg);

// Pollen pauzeert als de app naar de achtergrond gaat.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
  return () => sub.remove();
});
onlineManager.setOnline(true);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: true, gcTime: 10 * 60 * 1000 },
    mutations: { retry: false },
  },
});

const navTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.surface, border: colors.line, primary: colors.purple, text: colors.text },
};

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
  });
  const hydrated = useStore(hydratedStore);
  const conn = useStore(connectionStore);
  const prefs = useStore(prefsStore);
  const started = useRef(false);

  useEffect(() => {
    void hydrate();
  }, []);

  useEffect(() => {
    if (fontsLoaded && hydrated) {
      void SplashScreen.hideAsync();
      if (!started.current) {
        started.current = true;
        if (Platform.OS === 'android') void registerBackgroundAlerts();
      }
    }
  }, [fontsLoaded, hydrated]);

  if (!fontsLoaded || !hydrated) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const ready = prefs.onboarded && isConfigured(conn);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider value={navTheme}>
            <StatusBar style="light" />
            <LockGate enabled={ready && prefs.biometric} autoLockMinutes={prefs.autoLockMinutes}>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade_from_bottom' }}>
                <Stack.Protected guard={ready}>
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="metric/[metric]" />
                  <Stack.Screen name="service/[name]" />
                  <Stack.Screen name="container/[id]" />
                  <Stack.Screen name="site/[host]" />
                  <Stack.Screen name="files" />
                  <Stack.Screen name="editor" />
                  <Stack.Screen name="gpio" />
                  <Stack.Screen name="sensors" />
                  <Stack.Screen name="commands" />
                  <Stack.Screen name="power" />
                  <Stack.Screen name="wol" />
                  <Stack.Screen name="backups" />
                  <Stack.Screen name="ports" />
                  <Stack.Screen name="pinout" />
                  <Stack.Screen name="audit" />
                  <Stack.Screen name="device" />
                  <Stack.Screen name="disks" />
                  <Stack.Screen name="settings" />
                </Stack.Protected>
                <Stack.Protected guard={!ready}>
                  <Stack.Screen name="onboarding" />
                </Stack.Protected>
                {/* Altijd bereikbaar (ook vóór de onboarding), maar nooit het startscherm: staat daarom als laatste. */}
                <Stack.Screen name="about" />
              </Stack>
            </LockGate>
            <ToastHost />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
