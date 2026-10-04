// Komt de app op het cover-scherm (Flex Window), dan meteen het cover-dashboard (/cover). Ga je zelf naar de volledige
// app, dan laten we je daar: we schakelen enkel op het moment dat de app op het cover-scherm verschijnt. Gaat de gsm
// open terwijl /cover openstaat, dan terug naar de gewone app.
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';

import { isCoverWindow } from './coverWindow';

export function CoverSwitch({ enabled }: { enabled: boolean }) {
  const { width, height } = useWindowDimensions();
  const pathname = usePathname();
  const wasOnCover = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const onCover = isCoverWindow(width, height);
    if (onCover && !wasOnCover.current && pathname !== '/cover') router.push('/cover');
    if (!onCover && pathname === '/cover') {
      if (router.canGoBack()) router.back();
      else router.replace('/');
    }
    wasOnCover.current = onCover;
  }, [enabled, width, height, pathname]);

  return null;
}
