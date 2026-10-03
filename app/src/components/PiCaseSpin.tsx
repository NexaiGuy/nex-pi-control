// De Raspberry Pi-behuizing die continu ronddraait (Overzicht, rechtsboven onder het tandwiel).
//
// Geen live 3D: dat houdt de GPU constant bezig. Het model uit "Raspberry Pi Case.dc.html" is vooraf
// gerenderd naar 120 beelden (3° per stap) op één sprite-sheet (scripts/pi-case/). Reanimated schuift
// het juiste beeld in een venster op de UI-thread: geen re-renders, geen JS-werk per frame.
// Stopt op schermen buiten beeld en bij "beweging verminderen" (dan een stilstaand beeld).
import { memo, useEffect } from 'react';
import { View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useScreenInView } from './odyssey';

const SHEET = require('../../assets/pi-case-spin.webp') as number;
const FRAMES = 120;
const COLS = 12;
const ROWS = 10;
/** Eén volledige draai. */
const PERIOD_MS = 9000;

function PiCaseSpinImpl({ size = 56 }: { size?: number }) {
  const reduced = useReducedMotion();
  const inView = useScreenInView();
  const p = useSharedValue(0);

  useEffect(() => {
    if (reduced || !inView) {
      cancelAnimation(p);
      return;
    }
    // Verder vanaf het huidige beeld, zodat pauzeren en hervatten geen sprong geeft.
    const start = Math.floor(p.get()) % FRAMES;
    p.set(start);
    p.set(withRepeat(withTiming(start + FRAMES, { duration: PERIOD_MS, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(p);
  }, [reduced, inView, p]);

  const sheet = useAnimatedStyle(() => {
    const f = Math.floor(p.get()) % FRAMES;
    return { transform: [{ translateX: -(f % COLS) * size }, { translateY: -Math.floor(f / COLS) * size }] };
  });

  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }} accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none">
      <Animated.Image source={SHEET} style={[{ width: COLS * size, height: ROWS * size }, sheet]} resizeMode="stretch" fadeDuration={0} />
    </View>
  );
}

export const PiCaseSpin = memo(PiCaseSpinImpl);
