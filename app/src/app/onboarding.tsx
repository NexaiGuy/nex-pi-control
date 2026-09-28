import * as LocalAuthentication from 'expo-local-authentication';
import * as ScreenCapture from 'expo-screen-capture';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/overlays';
import { Button, Icon, Row, T } from '@/components/primitives';
import { HealthRing } from '@/features/charts/Charts';
import { authenticate } from '@/features/lock/LockGate';
import { ConnectionForm } from '@/features/onboarding/ConnectionForm';
import { QrScanner } from '@/features/onboarding/QrScanner';
import { t } from '@/i18n';
import { LINKS } from '@/lib/links';
import { DEMO_CONNECTION, DEFAULT_CONNECTION, connectionStore, isConfigured, saveConnection, savePrefs, type Connection } from '@/state/settings';
import { colors, space } from '@/theme/tokens';

type Step = 0 | 1 | 2 | 3;

function Dots({ step }: { step: Step }) {
  return (
    <Row gap={6} style={{ justifyContent: 'center' }}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ width: i === step ? 22 : 8, height: 8, borderRadius: 4, backgroundColor: i <= step ? colors.purple : colors.surface3 }} />
      ))}
    </Row>
  );
}

export default function Onboarding() {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(0);
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [draft, setDraft] = useState<Connection>(() => (connectionStore.get().demo ? DEFAULT_CONNECTION : { ...DEFAULT_CONNECTION, ...connectionStore.get() }));
  const [hasBio, setHasBio] = useState(false);

  useEffect(() => {
    void ScreenCapture.preventScreenCaptureAsync('onboarding');
    void (async () => setHasBio((await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())))();
    return () => void ScreenCapture.allowScreenCaptureAsync('onboarding');
  }, []);

  const startDemo = async () => {
    await saveConnection(DEMO_CONNECTION);
    await savePrefs({ onboarded: true, biometric: false });
  };

  const finish = async (biometric: boolean) => {
    await saveConnection(draft);
    await savePrefs({ onboarded: true, biometric });
    setStep(3);
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[o.root, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]} keyboardShouldPersistTaps="handled">
        <Dots step={step} />
        {step === 0 ? (
          <Animated.View entering={FadeInRight} style={o.step}>
            <View style={{ alignItems: 'center', marginVertical: space.xxl }}>
              <HealthRing level="ok" size={148} progress={0.78}>
                <View style={o.logo}>
                  <Icon name="cpu" size={38} color={colors.purple} />
                </View>
              </HealthRing>
            </View>
            <T v="display">{t.onboarding.welcomeTitle}</T>
            <T v="bodyMuted">{t.onboarding.welcomeBody}</T>
            <View style={{ gap: space.sm, marginTop: space.lg }}>
              {[t.onboarding.feature1, t.onboarding.feature2, t.onboarding.feature3].map((x) => (
                <Row key={x} style={{ alignItems: 'flex-start' }}>
                  <Icon name="check" size={16} color={colors.mint} />
                  <T style={{ flex: 1 }}>{x}</T>
                </Row>
              ))}
            </View>
            <Button label={t.onboarding.start} icon="arrow-right" onPress={() => setStep(1)} style={{ marginTop: space.xl }} />
            <Button label={t.onboarding.demo} kind="secondary" icon="play" onPress={() => void startDemo()} />
            <T v="caption" style={{ textAlign: 'center' }}>
              {t.onboarding.needAgent}
            </T>
            <Row style={{ justifyContent: 'center' }}>
              <Button label={t.onboarding.howTo} kind="ghost" icon="book-open" onPress={() => void Linking.openURL(LINKS.install)} />
              <Button label={t.about.title} kind="ghost" icon="info" onPress={() => router.push('/about')} />
            </Row>
          </Animated.View>
        ) : null}
        {step === 1 ? (
          <Animated.View entering={FadeInRight} style={o.step}>
            <T v="h1">{t.onboarding.connectTitle}</T>
            <T v="bodyMuted">{t.onboarding.connectBody}</T>
            {mode === 'scan' ? (
              <>
                <QrScanner
                  onResult={(c) => {
                    setDraft(c);
                    setMode('manual');
                    toast.success(t.onboarding.qrOk);
                  }}
                  onInvalid={() => toast.error(t.onboarding.invalidQr)}
                />
                <Button label={t.onboarding.paste} kind="ghost" icon="edit-3" onPress={() => setMode('manual')} />
              </>
            ) : (
              <>
                <ConnectionForm value={draft} onChange={setDraft} />
                <Button label={t.settings.scan} kind="ghost" icon="camera" onPress={() => setMode('scan')} />
              </>
            )}
            <Button label={t.onboarding.next} icon="arrow-right" disabled={!isConfigured(draft)} onPress={() => setStep(2)} />
          </Animated.View>
        ) : null}
        {step === 2 ? (
          <Animated.View entering={FadeInRight} style={o.step}>
            <View style={{ alignItems: 'center', marginVertical: space.xl }}>
              <View style={[o.logo, { width: 96, height: 96, borderRadius: 48 }]}>
                <Icon name="lock" size={40} color={colors.purple} />
              </View>
            </View>
            <T v="h1">{t.onboarding.lockTitle}</T>
            <T v="bodyMuted">{t.onboarding.lockBody}</T>
            {!hasBio ? (
              <T v="caption" style={{ color: colors.amber }}>
                {t.onboarding.noBio}
              </T>
            ) : null}
            <Button
              label={t.onboarding.enable}
              icon="shield"
              onPress={async () => {
                if (await authenticate(t.lock.reason)) await finish(true);
              }}
              style={{ marginTop: space.lg }}
            />
            <Button label={t.onboarding.skip} kind="ghost" onPress={() => void finish(false)} />
          </Animated.View>
        ) : null}
        {step === 3 ? (
          <Animated.View entering={FadeInRight} style={[o.step, { alignItems: 'center' }]}>
            <HealthRing level="ok" size={120}>
              <Icon name="check" size={44} color={colors.mint} />
            </HealthRing>
            <T v="h1" style={{ marginTop: space.lg }}>
              {t.onboarding.doneTitle}
            </T>
            <T v="bodyMuted">{t.onboarding.doneBody}</T>
            <T v="caption" style={{ textAlign: 'center' }}>
              {t.onboarding.doneHint}
            </T>
          </Animated.View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const o = StyleSheet.create({
  root: { flexGrow: 1, paddingHorizontal: space.xl, gap: space.xl },
  step: { gap: space.md },
  logo: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' },
});
