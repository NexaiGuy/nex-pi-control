import { useState } from 'react';
import { View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useInfo, usePower } from '@/api/hooks';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, toast, type ConfirmSpec } from '@/components/overlays';
import { Card, Icon, Row, T } from '@/components/primitives';
import { t } from '@/i18n';
import { connectionStore, serverName } from '@/state/settings';
import { colors, space } from '@/theme/tokens';

export default function PowerScreen() {
  const info = useInfo();
  const power = usePower();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const name = info.data?.confirm_name ?? info.data?.hostname ?? serverName(connectionStore.get());

  const go = (action: 'reboot' | 'poweroff') =>
    power.mutate(
      { action, confirm: name },
      { onSuccess: (r) => toast.info(r.message ?? t.common.done), onError: (e) => toast.error(errorMessage(e)) },
    );

  const ask = (action: 'reboot' | 'poweroff', icon: 'rotate-cw' | 'power', label: string, effect: string) =>
    setConfirm({ title: `${label}: ${name}`, effect, confirmLabel: label, dangerous: true, icon, onConfirm: () => go(action) });

  return (
    <DetailScreen title={t.power.title}>
      <View style={{ gap: space.md }}>
        <PowerItem icon="rotate-cw" label={t.power.reboot} effect={t.power.rebootEffect(name)} onPress={() => ask('reboot', 'rotate-cw', t.power.reboot, t.power.rebootEffect(name))} />
        <PowerItem icon="power" label={t.power.poweroff} effect={t.power.poweroffEffect(name)} onPress={() => ask('poweroff', 'power', t.power.poweroff, t.power.poweroffEffect(name))} />
      </View>
      <T v="caption" style={{ marginTop: space.lg }}>
        {t.power.note}
      </T>
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}

function PowerItem({ icon, label, effect, onPress }: { icon: 'rotate-cw' | 'power'; label: string; effect: string; onPress: () => void }) {
  return (
    <Card onPress={onPress} accessibilityLabel={label}>
      <Row gap={space.md}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: colors.redSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={24} color={colors.red} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T v="h2">{label}</T>
          <T v="caption">{effect}</T>
        </View>
      </Row>
    </Card>
  );
}
