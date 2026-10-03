// Eerste start: het zwevende icoon (de draaiende Pi-behuizing boven je startscherm) staat standaard aan.
// Heeft de app al "Weergeven over andere apps" (install-usb.sh geeft dat via adb), dan start het meteen.
// Anders één keer een vraag met een knop naar het Android-scherm; bij terugkeer start het vanzelf.
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ConfirmSheet, toast, type ConfirmSpec } from '@/components/overlays';
import { t } from '@/i18n';
import { firstRunFloatingPi, floatingPi } from '@/lib/floatingPi';
import { prefsStore, savePrefs } from '@/state/settings';

export function FloatingIconPrompt() {
  const [spec, setSpec] = useState<ConfirmSpec | null>(null);
  const waiting = useRef(false);

  useEffect(() => {
    const asked = prefsStore.get().floatingAskedV2;
    const r = firstRunFloatingPi(asked);
    if (!asked) void savePrefs({ floatingAskedV2: true });
    if (r === 'ask') {
      setSpec({
        title: t.floating.title,
        effect: t.floating.askBody,
        confirmLabel: t.floating.allow,
        icon: 'layers',
        onConfirm: () => {
          waiting.current = true;
          floatingPi.openPermission();
        },
      });
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !waiting.current) return;
      waiting.current = false;
      if (floatingPi.canDraw() && floatingPi.start()) toast.success(t.floating.started);
      else toast.error(t.floating.denied);
    });
    return () => sub.remove();
  }, []);

  return <ConfirmSheet spec={spec} onClose={() => setSpec(null)} />;
}
