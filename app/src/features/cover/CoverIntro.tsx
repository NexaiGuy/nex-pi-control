// Het intro van het cover-scherm: 3 s het Nex AI-logo (met een korte glitch in de Nex-kleuren), daarna de draaiende
// Pi-behuizing als laadscherm. Bij "beweging verminderen" staan beide stil, de tijden blijven gelijk.
// Alles staat iets hoger dan het midden: rechtsonder heeft het cover-scherm van de Flip een uitsparing.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming,
} from 'react-native-reanimated';

import { PiCaseSpin } from '@/components/PiCaseSpin';
import { T } from '@/components/primitives';
import { colors } from '@/theme/tokens';

const LOGO = require('../../../assets/nex-ai-logo.png') as number;

/** Nex-kleuren voor de glitch (zelfde magenta en cyaan als in het logo). */
const MAGENTA = '#F472B6';
const CYAN = '#22D3EE';
const MINT = '#34F5C5';

/** Duur van het logo (ms), gelijk aan de widget (modules/widget-live, CoverScreen.LOGO_MS). */
export const LOGO_MS = 3000;
/** Minimale duur van het laadscherm (ms), gelijk aan CoverScreen.SPIN_MIN_MS. */
export const SPIN_MIN_MS = 1800;
/** Langer dan dit wachten we niet op de Pi: dan het dashboard met wat er is (offline-melding). */
export const SPIN_MAX_MS = 9000;

/** Weg van de uitsparing rechtsonder, zoals het intro op de widget. */
const NUDGE = { paddingBottom: 24 } as const;

export function CoverLogo({ size }: { size: number }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(reduced ? 1 : 0);
  const scale = useSharedValue(reduced ? 1 : 0.94);
  const jolt = useSharedValue(0);
  const ghost = useSharedValue(0);
  const scan = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    const shake = () =>
      withSequence(withTiming(-6, { duration: 40 }), withTiming(5, { duration: 40 }), withTiming(-3, { duration: 40 }), withTiming(0, { duration: 60 }));
    const flicker = () => withSequence(withTiming(0.55, { duration: 40 }), withTiming(0.25, { duration: 60 }), withTiming(0, { duration: 80 }));
    // Opkomen, twee korte glitches, een scanlijn erover, en op 2,6 s rustig weg.
    opacity.set(withSequence(withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) }), withDelay(2200, withTiming(0, { duration: 300 }))));
    scale.set(withSequence(withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }), withDelay(2050, withTiming(1.03, { duration: 300 }))));
    jolt.set(withSequence(withDelay(950, shake()), withDelay(820, shake())));
    ghost.set(withSequence(withDelay(950, flicker()), withDelay(840, flicker())));
    scan.set(withDelay(420, withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) })));
  }, [reduced, opacity, scale, jolt, ghost, scan]);

  const main = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ translateX: jolt.get() }, { scale: scale.get() }] }));
  const left = useAnimatedStyle(() => ({ opacity: ghost.get(), transform: [{ translateX: jolt.get() - 5 }, { scale: scale.get() }] }));
  const right = useAnimatedStyle(() => ({ opacity: ghost.get(), transform: [{ translateX: jolt.get() + 5 }, { scale: scale.get() }] }));
  const line = useAnimatedStyle(() => {
    const p = scan.get();
    return { opacity: p > 0 && p < 1 ? 0.55 * opacity.get() : 0, transform: [{ translateY: (p - 0.5) * size }] };
  });

  const img = { width: size, height: size };
  return (
    <View style={[st.fill, NUDGE]} accessible accessibilityRole="image" accessibilityLabel="Nex AI">
      <View style={img}>
        <Animated.Image source={LOGO} style={[st.abs, img, { tintColor: MAGENTA }, left]} fadeDuration={0} />
        <Animated.Image source={LOGO} style={[st.abs, img, { tintColor: CYAN }, right]} fadeDuration={0} />
        <Animated.Image source={LOGO} style={[st.abs, img, main]} fadeDuration={0} />
        <Animated.View pointerEvents="none" style={[st.abs, { top: size / 2, left: -size * 0.06, width: size * 1.12, height: 1.5, backgroundColor: MINT }, line]} />
      </View>
    </View>
  );
}

export function CoverSpin({ server, label }: { server: string; label: string }) {
  return (
    <Animated.View entering={FadeIn.duration(250)} style={[st.fill, NUDGE]} accessibilityRole="progressbar" accessibilityLabel={`${server} · ${label}`}>
      <PiCaseSpin size={132} periodMs={2400} />
      <T v="mono" numberOfLines={1} style={{ marginTop: 10, color: colors.text }}>
        {server}
      </T>
      <T v="label" style={{ marginTop: 4 }}>
        {label}
      </T>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute', left: 0, top: 0 },
});
