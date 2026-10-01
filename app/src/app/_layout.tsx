import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import {
  SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, SplashScreen, Stack, ThemeProvider, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useRef } from 'react';
import { AppState, Platform, View, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { registerBackgroundAlerts } from '@/background/alerts';
import { ToastHost } from '@/components/overlays';
import { activateServer } from '@/features/servers/ServerSwitcher';
import { LockGate } from '@/features/lock/LockGate';
import { connectionStore, hydrate, hydratedStore, isConfigured, prefsStore, serversStore } from '@/state/settings';
import { useStore } from '@/state/store';
import { setThemeReturn, takeThemeReturn } from '@/lib/themeReturn';
import { applyTheme, colors, resolveTheme } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();

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

function navTheme(dark: boolean) {
  const base = dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: { ...base.colors, background: colors.bg, card: colors.surface, border: colors.line, primary: colors.purple, text: colors.text },
  };
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular, SpaceGrotesk_500Medium, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
  });
  const hydrated = useStore(hydratedStore);
  const conn = useStore(connectionStore);
  const prefs = useStore(prefsStore);
  const activeId = useStore(serversStore, (s) => s.activeId);
  const started = useRef(false);
  const system = useColorScheme();
  const themeName = resolveTheme(prefs.theme, system);
  // Bewust tijdens het renderen, vóór de kinderen: zo tekent elk scherm meteen in het juiste thema.
  applyTheme(themeName);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.bg);
    // Na een wissel vanuit Instellingen: terug naar dat scherm (de navigatie is net opnieuw opgebouwd).
    const back = takeThemeReturn();
    if (back) {
      const id = setTimeout(() => router.push(back as never), 0);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [themeName, activeId]);

  useEffect(() => {
    void hydrate();
  }, []);

  // Tik op een melding: naar de juiste server en het juiste scherm.
  const ready0 = hydrated && prefs.onboarded;
  useEffect(() => {
    if (!ready0) return undefined;
    const open = async (resp: Notifications.NotificationResponse | null) => {
      const data = resp?.notification.request.content.data as { serverId?: string; url?: string } | undefined;
      if (!data?.url) return;
      if (data.serverId && data.serverId !== serversStore.get().activeId) {
        // De schermen worden na een serverwissel opnieuw opgebouwd; daarna pas navigeren (zie het effect hieronder).
        setThemeReturn(data.url);
        await activateServer(data.serverId, queryClient);
      } else {
        router.push(data.url as never);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) {
        void open(r);
        void Notifications.clearLastNotificationResponseAsync();
      }
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void open(r));
    return () => sub.remove();
  }, [ready0]);

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
          <ThemeProvider value={navTheme(themeName === 'dark')}>
            <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
            <LockGate enabled={ready && prefs.biometric} autoLockMinutes={prefs.autoLockMinutes}>
              {/* key: na een themawissel of serverwissel worden alle schermen opnieuw opgebouwd. */}
              <Stack key={`${themeName}-${activeId ?? 'none'}`} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade_from_bottom' }}>
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
                  <Stack.Screen name="updates" />
                  <Stack.Screen name="events" />
                  <Stack.Screen name="add-server" />
                </Stack.Protected>
                <Stack.Protected guard={!ready}>
                  <Stack.Screen name="onboarding" />
                </Stack.Protected>
                {/* Altijd bereikbaar (ook vóór de onboarding), maar nooit het startscherm: staat daarom als laatste. */}
                <Stack.Screen name="about" />
              </Stack>
            </LockGate>
            <ToastHost key={themeName} />
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
