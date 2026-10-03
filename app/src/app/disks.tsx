// Schijven: elke fysieke schijf (SD-kaart, NVMe, SATA, USB-SSD) met partities, gebruik en SMART-gezondheid.
// Oudere agents (zonder `disks`) tonen de SMART-lijst zoals voorheen.
import { useState } from 'react';
import { View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useAckCrc, useDisks } from '@/api/hooks';
import type { Mount, PhysicalDisk, SmartDisk } from '@/api/types';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, ErrorState, SkeletonList, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Card, Divider, Icon, KeyValue, ProgressBar, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { levelFromPercent } from '@/lib/alerts';
import { ago, bytes, num, pct } from '@/lib/format';
import { colors, levelColor, space, type Level } from '@/theme/tokens';

function lvl(s: SmartDisk['status']): Level {
  return s === 'failing' ? 'critical' : s === 'warning' ? 'warning' : s === 'ok' ? 'ok' : 'unknown';
}

function statusLabel(s: SmartDisk['status']): string {
  return s === 'failing' ? t.disk.failing : s === 'warning' ? t.disk.warning : s === 'ok' ? t.disk.ok : t.disk.unknown;
}

const ATTR_LABELS: Record<string, string> = {
  reallocated_sectors: t.disk.reallocated,
  pending_sectors: t.disk.pending,
  offline_uncorrectable: t.disk.uncorrectable,
  reported_uncorrectable: t.disk.reportedUncorrectable,
  crc_errors: t.disk.crc,
  media_errors: t.disk.mediaErrors,
  percentage_used: t.disk.wear,
  life_left: t.disk.lifeLeft,
};

const PERCENT_ATTRS = new Set(['percentage_used', 'life_left']);

/** Rood enkel als de waarde echt slecht is: tellers boven 0, slijtage vanaf 90 %, levensduur tot 10 %. */
function attrBad(k: string, v: number): boolean {
  if (k === 'life_left') return v <= 10;
  if (k === 'percentage_used') return v >= 90;
  return v > 0;
}

function transportLabel(d: PhysicalDisk): string | null {
  const tr = (d.transport || d.protocol || '').toLowerCase();
  if (!tr && d.device.includes('mmcblk')) return t.disk.transport.sd ?? 'SD';
  return tr ? (t.disk.transport[tr] ?? tr.toUpperCase()) : null;
}

function UsageLine({ mountpoint, device, fstype, used, total, percent }: { mountpoint: string; device: string; fstype: string; used: number; total: number; percent: number }) {
  const l = levelFromPercent(percent, 80, 90);
  return (
    <View style={{ gap: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="mono" numberOfLines={1} style={{ flexShrink: 1 }}>
          {mountpoint}
        </T>
        <T v="monoSmall" numberOfLines={1}>
          {device.replace('/dev/', '')} · {fstype}
        </T>
      </Row>
      <ProgressBar value={percent} level={l} />
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="monoSmall">{`${bytes(used)} ${t.disk.used} · ${bytes(total - used)} ${t.disk.free}`}</T>
        <T v="monoSmall" style={l !== 'ok' ? { color: levelColor[l] } : undefined}>
          {pct(percent)}
        </T>
      </Row>
    </View>
  );
}

function DiskCard({ s, onAckCrc, acking }: { s: PhysicalDisk; onAckCrc: () => void; acking: boolean }) {
  const level = lvl(s.status);
  const via = transportLabel(s);
  const sub = [via, bytes(s.capacity_bytes ?? s.size_bytes ?? null, 0), s.removable ? t.disk.removable : null].filter(Boolean).join(' · ');
  const parts = s.partitions ?? [];
  return (
    <View>
      <SectionTitle right={<StatusPill level={level} label={statusLabel(s.status)} />}>
        <T v="mono" style={{ color: colors.textMuted }}>
          {s.device}
        </T>
      </SectionTitle>
      <Card style={{ gap: space.xs }} severity={level}>
        <T v="h3">{s.model || t.disk.unknownModel}</T>
        <T v="monoSmall">{sub}</T>
        {s.reasons.length ? (
          <View style={{ gap: 6, marginVertical: space.sm }}>
            {s.reasons.map((r, i) => (
              <Row key={i} style={{ alignItems: 'flex-start' }}>
                <Icon name={level === 'unknown' ? 'help-circle' : 'alert-triangle'} size={14} color={levelColor[level]} />
                <T v="body" style={{ flex: 1 }}>
                  {r}
                </T>
              </Row>
            ))}
            {level === 'unknown' && s.smart_supported === false ? <T v="caption">{t.disk.noSmartNote}</T> : null}
          </View>
        ) : null}
        {s.smart_supported !== false ? (
          <>
            {Object.entries(s.attributes ?? {}).map(([k, v]) => (
              <KeyValue key={k} k={ATTR_LABELS[k] ?? k} v={<T v="mono" style={{ color: attrBad(k, v) ? colors.red : colors.text }}>{PERCENT_ATTRS.has(k) ? `${v}%` : num(v, 0)}</T>} />
            ))}
            <KeyValue k={t.disk.temp} v={s.temperature_c !== null && s.temperature_c !== undefined ? `${s.temperature_c} °C` : '–'} />
            <KeyValue k={t.disk.hours} v={s.power_on_hours ? `${num(s.power_on_hours, 0)} ${t.disk.hoursUnit}` : '–'} />
            <KeyValue k={t.disk.firmware} v={s.firmware || '–'} />
          </>
        ) : null}
        {s.serial ? <KeyValue k={t.disk.serial} v={s.serial} /> : null}
        {s.device_type ? <KeyValue k={t.disk.readVia} v={`smartctl -d ${s.device_type}`} /> : null}
        {s.health_source === 'attributes' ? <KeyValue k={t.disk.health} v={<T v="monoSmall">{t.disk.healthViaAttrs}</T>} /> : null}
        {s.error_log_available === false ? <KeyValue k={t.disk.errorLog} v={<T v="monoSmall">{t.disk.errorLogNA}</T>} /> : null}
        <KeyValue k={t.disk.collected} v={s.collected_at ? t.common.ago(ago(s.collected_at)) : '–'} />
        {parts.length ? (
          <>
            <Divider />
            <T v="label">{t.disk.partitions}</T>
            <View style={{ gap: space.md, marginTop: space.xs }}>
              {parts.map((p) => {
                const mp = p.mountpoint ?? p.mountpoints[0];
                if (mp && p.total && p.used !== null && p.used !== undefined && p.percent !== null && p.percent !== undefined) {
                  return <UsageLine key={p.device} mountpoint={mp} device={p.device} fstype={p.fstype} used={p.used} total={p.total} percent={p.percent} />;
                }
                return (
                  <Row key={p.device} style={{ justifyContent: 'space-between' }}>
                    <T v="mono" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {mp ?? p.device.replace('/dev/', '')}
                    </T>
                    <T v="monoSmall" numberOfLines={1}>
                      {[p.fstype || null, bytes(p.size_bytes, 0), mp ? null : t.disk.notMounted].filter(Boolean).join(' · ')}
                    </T>
                  </Row>
                );
              })}
            </View>
          </>
        ) : null}
        {s.reasons.some((r) => r.includes('CRC')) ? (
          <Button label={t.disk.ackCrc} kind="secondary" icon="refresh-ccw" style={{ marginTop: space.md }} loading={acking} onPress={onAckCrc} />
        ) : null}
      </Card>
    </View>
  );
}

export default function DisksScreen() {
  const d = useDisks();
  const ack = useAckCrc();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const list: PhysicalDisk[] = d.data?.disks ?? d.data?.smart ?? [];
  const covered = new Set(list.flatMap((x) => (x.partitions ?? []).map((p) => p.device)));
  // Mounts die bij geen enkele schijf horen (netwerk, bind mounts) of een oudere agent zonder partitielijst.
  const rest: Mount[] = (d.data?.mounts ?? []).filter((m) => !covered.has(m.device));
  const askAck = () =>
    setConfirm({
      title: t.disk.ackCrc,
      effect: t.disk.ackCrcEffect,
      confirmLabel: t.common.confirm,
      onConfirm: () => ack.mutate(undefined, { onSuccess: () => toast.success(t.common.done), onError: (e) => toast.error(errorMessage(e)) }),
    });
  return (
    <DetailScreen title={t.disk.title} onRefresh={() => void d.refetch()} refreshing={d.isRefetching} diskBanner={false}>
      {!d.data && d.isLoading ? <SkeletonList /> : null}
      {!d.data && d.error ? <ErrorState error={d.error} onRetry={() => void d.refetch()} /> : null}
      {d.data?.disk_alarms.length ? (
        <Card style={{ borderColor: colors.red, backgroundColor: colors.redBanner, gap: space.sm }} severity="critical">
          <Row>
            <Icon name="alert-octagon" size={20} color={colors.red} />
            <T v="h3" style={{ color: colors.bannerTitle, flex: 1 }}>
              {t.disk.safetyTitle}
            </T>
          </Row>
          <T v="body" style={{ color: colors.bannerText }}>
            {t.disk.safetyBody}
          </T>
        </Card>
      ) : null}
      {list.map((s) => (
        <DiskCard key={s.device} s={s} onAckCrc={askAck} acking={ack.isPending} />
      ))}
      {d.data && rest.length ? (
        <>
          <SectionTitle>{d.data.disks ? t.disk.otherMounts : t.disk.mounts}</SectionTitle>
          <Card style={{ gap: space.lg }}>
            {rest.map((m) => (
              <UsageLine key={m.mountpoint} mountpoint={m.mountpoint} device={m.device} fstype={m.fstype} used={m.used} total={m.total} percent={m.percent} />
            ))}
          </Card>
        </>
      ) : null}
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}
