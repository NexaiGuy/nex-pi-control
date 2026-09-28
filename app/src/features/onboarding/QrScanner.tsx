import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, T } from '@/components/primitives';
import { t } from '@/i18n';
import { parseQr, type Connection } from '@/state/settings';
import { colors, radius, space } from '@/theme/tokens';

export function QrScanner({ onResult, onInvalid }: { onResult: (c: Connection) => void; onInvalid: () => void }) {
  const [perm, request] = useCameraPermissions();
  const done = useRef(false);
  const lastInvalid = useRef(0);
  if (!perm) return null;
  if (!perm.granted) {
    return (
      <View style={{ gap: space.md }}>
        <T v="bodyMuted">{perm.canAskAgain ? t.onboarding.cameraNeeded : t.onboarding.cameraDenied}</T>
        {perm.canAskAgain ? <Button label={t.onboarding.allowCamera} icon="camera" onPress={() => void request()} /> : null}
      </View>
    );
  }
  return (
    <View style={q.wrap}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={({ data }) => {
          if (done.current) return;
          const c = parseQr(data);
          if (c) {
            done.current = true;
            onResult(c);
          } else if (Date.now() - lastInvalid.current > 3000) {
            lastInvalid.current = Date.now();
            onInvalid();
          }
        }}
      />
      <View style={q.frame} pointerEvents="none" />
    </View>
  );
}

const q = StyleSheet.create({
  wrap: { height: 320, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  frame: { width: 220, height: 220, borderRadius: radius.lg, borderWidth: 3, borderColor: colors.mint },
});
