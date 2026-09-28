import { useState } from 'react';
import { View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useAckCrc, useDisks } from '@/api/hooks';
import type { SmartDisk } from '@/api/types';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, ErrorState, SkeletonList, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Card, Icon, KeyValue, ProgressBar, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { levelFromPercent } from '@/lib/alerts';
import { ago, bytes, num, pct } from '@/lib/format';
import { colors, levelColor, space, type Level } from '@/theme/tokens';

function lvl(s: SmartDisk['status']): Level {
  return s === 'failing' ? 'critical' : s === 'warning' ? 'warning' : s === 'ok' ? 'ok' : 'unknown';
}

const ATTR_LABELS: Record<string, string> = {
  reallocated_sectors: t.disk.reallocated,
  pending_sectors: t.disk.pending,
  offline_uncorrectable: t.disk.uncorrectable,
  reported_uncorrectable: t.disk.reportedUncorrectable,
  crc_errors: t.disk.crc,
  media_errors: t.disk.mediaErrors,
  percentage_used: t.disk.wear,
};

export default function DisksScreen() {
  const d = useDisks();
  const ack = useAckCrc();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  return (
    <DetailScreen title={t.disk.title} onRefresh={() => void d.refetch()} refreshing={d.isRefetching}>
      {!d.data && d.isLoading ? <SkeletonList /> : null}
      {!d.data && d.error ? <ErrorState error={d.error} onRetry={() => void d.refetch()} /> : null}
      {d.data?.disk_alarms.length ? (
        <Card style={{ borderColor: colors.red, backgroundColor: colors.redBanner, gap: space.sm }}>
          <Row>
            <Icon name="alert-octagon" size={20} color={colors.red} />
            <T v="h3" style={{ color: '#FFD9DB', flex: 1 }}>
              {t.disk.safetyTitle}
            </T>
          </Row>
          <T v="body" style={{ color: '#F4A6AA' }}>
            {t.disk.safetyBody}
          </T>
        </Card>
      ) : null}
      {d.data?.smart.map((s) => (
        <View key={s.device}>
          <SectionTitle right={<StatusPill level={lvl(s.status)} label={s.status === 'failing' ? t.disk.failing : s.status === 'warning' ? t.disk.warning : s.status === 'ok' ? t.disk.ok : t.disk.unknown} />}>
            <T v="mono" style={{ color: colors.textMuted }}>{s.device}</T>
          </SectionTitle>
          <Card style={{ gap: space.xs }}>
            <T v="h3">{s.model || t.disk.unknownModel}</T>
            {s.reasons.length ? (
              <View style={{ gap: 6, marginVertical: space.sm }}>
                {s.reasons.map((r, i) => (
                  <Row key={i} style={{ alignItems: 'flex-start' }}>
                    <Icon name="alert-triangle" size={14} color={levelColor[lvl(s.status)]} />
                    <T v="body" style={{ flex: 1, fontSize: 14 }}>
                      {r}
                    </T>
                  </Row>
                ))}
              </View>
            ) : null}
            {s.smart_supported !== false ? (
              <>
                {Object.entries(s.attributes).map(([k, v]) => (
                  <KeyValue key={k} k={ATTR_LABELS[k] ?? k} v={<T v="mono" style={{ color: v > 0 && k !== 'percentage_used' ? colors.red : colors.text }}>{k === 'percentage_used' ? `${v}%` : num(v, 0)}</T>} />
                ))}
                <KeyValue k={t.disk.temp} v={s.temperature_c !== null && s.temperature_c !== undefined ? `${s.temperature_c} °C` : '–'} />
                <KeyValue k={t.disk.hours} v={s.power_on_hours ? `${num(s.power_on_hours, 0)} ${t.disk.hoursUnit}` : '–'} />
                <KeyValue k={t.disk.capacity} v={bytes(s.capacity_bytes ?? null, 0)} />
                <KeyValue k={t.disk.firmware} v={s.firmware || '–'} />
                <KeyValue k={t.disk.serial} v={s.serial || '–'} />
                <KeyValue k={t.disk.collected} v={s.collected_at ? t.common.ago(ago(s.collected_at)) : '–'} />
              </>
            ) : null}
            {s.reasons.some((r) => r.includes('CRC')) ? (
              <Button
                label={t.disk.ackCrc}
                kind="secondary"
                icon="refresh-ccw"
                style={{ marginTop: space.md }}
                loading={ack.isPending}
                onPress={() =>
                  setConfirm({
                    title: t.disk.ackCrc,
                    effect: t.disk.ackCrcEffect,
                    confirmLabel: t.common.confirm,
                    onConfirm: () => ack.mutate(undefined, { onSuccess: () => toast.success(t.common.done), onError: (e) => toast.error(errorMessage(e)) }),
                  })
                }
              />
            ) : null}
          </Card>
        </View>
      ))}
      {d.data ? (
        <>
          <SectionTitle>{t.disk.mounts}</SectionTitle>
          <Card style={{ gap: space.lg }}>
            {d.data.mounts.map((m) => {
              const l = levelFromPercent(m.percent, 80, 90);
              return (
                <View key={m.mountpoint} style={{ gap: 6 }}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T v="mono">{m.mountpoint}</T>
                    <T v="monoSmall">
                      {m.device} · {m.fstype}
                    </T>
                  </Row>
                  <ProgressBar value={m.percent} level={l} />
                  <Row style={{ justifyContent: 'space-between' }}>
                    <T v="monoSmall">
                      {`${bytes(m.used)} ${t.disk.used} · ${bytes(m.free)} ${t.disk.free}`}
                    </T>
                    <T v="monoSmall">{pct(m.percent)}</T>
                  </Row>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}
