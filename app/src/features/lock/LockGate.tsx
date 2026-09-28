// Vergrendelt de app met biometrie bij opstarten en na X minuten in de achtergrond.
// Tijdens vergrendeling worden de schermen niet gerenderd (geen data zichtbaar in de app-switcher).
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HealthRing } from '@/features/charts/Charts';
import { Button, Icon, T } from '@/components/primitives';
import { t } from '@/i18n';
import { colors, space } from '@/theme/tokens';

export async function authenticate(reason: string): Promise<boolean> {
  const hasHw = await LocalAuthentication.hasHardwareAsync();
  const enrolled = hasHw && (await LocalAuthentication.isEnrolledAsync());
  if (!enrolled) {
    // Geen biometrie ingesteld op de gsm: val terug op de schermvergrendeling van het toestel.
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (level === LocalAuthentication.SecurityLevel.NONE) return true;
  }
  const res = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: t.common.cancel,
    disableDeviceFallback: false,
  });
  return res.success;
}

export function LockGate({ enabled, autoLockMinutes, children }: { enabled: boolean; autoLockMinutes: number; children: ReactNode }) {
  const [locked, setLocked] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  const insets = useSafeAreaInsets();

  const unlock = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (await authenticate(t.lock.reason)) setLocked(false);
    } finally {
      setBusy(false);
    }
  }, [busy]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (!enabled) return;
      if (state === 'background') backgroundAt.current = Date.now();
      if (state === 'active' && backgroundAt.current !== null) {
        const away = (Date.now() - backgroundAt.current) / 60000;
        backgroundAt.current = null;
        if (away >= autoLockMinutes) setLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled, autoLockMinutes]);

  useEffect(() => {
    // Vraag de vingerafdruk meteen zodra de app vergrendelt (bij opstart of terugkeer). Bewust in een effect: het start een systeemdialoog.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (locked && enabled) void unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, enabled]);

  if (!enabled || !locked) return <>{children}</>;
  return (
    <Animated.View entering={FadeIn} style={[l.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={l.center}>
        <HealthRing level="ok" size={120} progress={0.72}>
          <View style={l.core}>
            <Icon name="lock" size={28} color={colors.purple} />
          </View>
        </HealthRing>
        <T v="h1" style={{ marginTop: space.xl }}>
          {t.app.name}
        </T>
        <T v="bodyMuted">{t.lock.title}</T>
      </View>
      <View style={{ padding: space.xl }}>
        <Button label={t.lock.unlock} icon="unlock" onPress={unlock} loading={busy} />
      </View>
    </Animated.View>
  );
}

const l = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  core: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' },
});
