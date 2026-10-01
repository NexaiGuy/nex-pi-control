import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useGpio, useGpioAction } from '@/api/hooks';
import type { GpioPin } from '@/api/types';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, ErrorState, Sheet, Skeleton, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Card, Chip, KeyValue, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { KIND_COLOR, PinHeader } from '@/components/PinHeader';
import { space, themed } from '@/theme/tokens';

export default function GpioScreen() {
  const q = useGpio();
  const act = useGpioAction();
  const [sel, setSel] = useState<GpioPin | null>(null);
  const [dur, setDur] = useState(500);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const pin = sel ? q.data?.pins.find((p) => p.pin === sel.pin) ?? sel : null;

  const run = (action: 'on' | 'off' | 'pulse' | 'read' | 'release') => {
    if (!pin || pin.bcm === undefined) return;
    act.mutate(
      { pin: pin.bcm, action, duration_ms: dur },
      {
        onSuccess: (r) => toast.success(action === 'read' ? `GPIO${pin.bcm} = ${r.value}` : `GPIO${pin.bcm}: ${action === 'pulse' ? `puls ${dur} ms` : action}`),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <DetailScreen title={t.gpio.title} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {!q.data && q.isLoading ? <Skeleton height={600} radius={16} /> : null}
      {!q.data && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && !q.data.available ? <StatusPill level="warning" label={`${t.gpio.unavailable}: ${q.data.error ?? ''}`} /> : null}
      {q.data ? (
        <>
          <SectionTitle>{t.gpio.header}</SectionTitle>
          <Card style={{ padding: space.sm }}>
            <PinHeader pins={q.data.pins} onPress={setSel} selected={pin?.pin} />
          </Card>
          <Row style={{ flexWrap: 'wrap', marginTop: space.md }}>
            {(Object.keys(KIND_COLOR) as GpioPin['kind'][]).map((k) => (
              <Row key={k} gap={4}>
                <View style={[g.legend, { backgroundColor: KIND_COLOR[k] }]} />
                <T v="caption">{k.toUpperCase()}</T>
              </Row>
            ))}
          </Row>
        </>
      ) : null}
      <Sheet visible={!!pin} onClose={() => setSel(null)} title={pin ? `Pin ${pin.pin} · ${pin.name}` : ''}>
        {pin ? (
          <View style={{ gap: space.sm }}>
            {pin.label ? <T v="h3">{pin.label}</T> : null}
            <KeyValue k="BCM" v={pin.bcm !== undefined ? `GPIO${pin.bcm}` : '–'} />
            <KeyValue k={t.gpio.mode} v={pin.mode ?? '–'} />
            <KeyValue k={t.gpio.value} v={pin.value === null || pin.value === undefined ? '–' : pin.value ? t.gpio.high : t.gpio.low} />
            <KeyValue k={t.gpio.usedBy} v={pin.owner ?? t.common.nobody} />
            {pin.protected_reason ? <StatusPill level="warning" label={`${t.gpio.protected}: ${pin.protected_reason}`} /> : null}
            {pin.allowed ? (
              <>
                <Row style={{ marginTop: space.md }}>
                  <Button label={t.gpio.on} icon="toggle-right" onPress={() => run('on')} style={{ flex: 1 }} loading={act.isPending} />
                  <Button label={t.gpio.off} icon="toggle-left" kind="secondary" onPress={() => run('off')} style={{ flex: 1 }} />
                </Row>
                <T v="label" style={{ marginTop: space.md }}>
                  {t.gpio.duration.toUpperCase()}
                </T>
                <Row style={{ flexWrap: 'wrap' }}>
                  {[100, 250, 500, 1000, 2000, 5000].map((d) => (
                    <Chip key={d} label={`${d} ms`} active={dur === d} onPress={() => setDur(d)} />
                  ))}
                </Row>
                <Button
                  label={`${t.gpio.pulse} ${dur} ms`}
                  icon="activity"
                  kind="secondary"
                  onPress={() => setConfirm({ title: `${t.gpio.pulse} GPIO${pin.bcm}`, effect: t.gpio.pulseEffect(pin.bcm ?? 0, dur), confirmLabel: t.gpio.pulse, icon: 'activity', onConfirm: () => run('pulse') })}
                />
                <Row>
                  <Button label={t.gpio.read} icon="eye" kind="ghost" onPress={() => run('read')} style={{ flex: 1 }} />
                  <Button label={t.gpio.release} icon="unlock" kind="ghost" onPress={() => run('release')} style={{ flex: 1 }} />
                </Row>
              </>
            ) : (
              <T v="caption" style={{ marginTop: space.md }}>
                {pin.bcm !== undefined ? t.gpio.allowHint(pin.bcm) : t.gpio.powerPin}
              </T>
            )}
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}

const g = themed(() => StyleSheet.create({
  legend: { width: 10, height: 10, borderRadius: 5 },
}));
