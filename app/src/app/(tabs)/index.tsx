import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useDevice, useHistory, useOverview } from '@/api/hooks';
import type { Overview, SmartStatus } from '@/api/types';
import { Screen } from '@/components/layout';
import { ErrorState, Skeleton } from '@/components/overlays';
import { Card, Icon, ProgressBar, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { Tile } from '@/components/Tile';
import { CoreBars, HealthRing } from '@/features/charts/Charts';
import { t } from '@/i18n';
import { levelFromPercent } from '@/lib/alerts';
import { bytes, duration, num, pct, rate } from '@/lib/format';
import { connectionStore, serverName } from '@/state/settings';
import { useStore } from '@/state/store';
import { colors, type Level, levelColor, space, themed } from '@/theme/tokens';

const SPARK = ['cpu', 'ram', 'temp', 'fan', 'load1', 'net.rx', 'disk.write'];

function smartLevel(s: SmartStatus): Level {
  return s === 'failing' ? 'critical' : s === 'warning' ? 'warning' : s === 'ok' ? 'ok' : 'unknown';
}
function smartLabel(s: SmartStatus): string {
  return s === 'failing' ? t.disk.failing : s === 'warning' ? t.disk.warning : s === 'ok' ? t.disk.ok : t.disk.unknown;
}

export default function OverviewScreen() {
  const q = useOverview();
  const hist = useHistory(SPARK, '1h');
  const { width } = useWindowDimensions();
  const wide = width >= 720;
  const sparks = useMemo(() => {
    const m: Record<string, number[]> = {};
    for (const s of hist.data ?? []) m[s.metric] = s.points.map((p) => p[1] ?? 0).slice(-60);
    return m;
  }, [hist.data]);

  const o = q.data;
  return (
    <Screen title={t.tabs.overview} onRefresh={() => void Promise.all([q.refetch(), hist.refetch()])} refreshing={q.isRefetching} dataUpdatedAt={q.dataUpdatedAt}>
      {!o && q.isLoading ? <OverviewSkeleton /> : null}
      {!o && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {o ? (
        <View style={wide ? { flexDirection: 'row', gap: space.lg, alignItems: 'flex-start' } : undefined}>
          <View style={wide ? { flex: 1 } : undefined}>
            <HealthHero o={o} />
            <Counts o={o} />
            <Disks o={o} />
          </View>
          <View style={wide ? { flex: 1.2 } : undefined}>
            <Metrics o={o} sparks={sparks} />
            <DeviceCard o={o} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function HealthHero({ o }: { o: Overview }) {
  const level = o.health.status;
  const color = levelColor[level];
  const icon = level === 'ok' ? 'check' : level === 'warning' ? 'alert-triangle' : 'alert-octagon';
  return (
    <Animated.View entering={FadeInDown.duration(350)}>
      <Card style={[hs.hero, { borderColor: level === 'ok' ? colors.line : color }]} accessibilityLabel={`${o.health.title}`}>
        <Row gap={space.lg} style={{ alignItems: 'center' }}>
          <HealthRing level={level} size={84} progress={level === 'ok' ? 1 : level === 'warning' ? 0.66 : 0.33}>
            <Icon name={icon} size={28} color={color} />
          </HealthRing>
          <View style={{ flex: 1, gap: 4 }}>
            <T v="label">STATUS</T>
            <T v="h1" style={{ color }}>
              {level === 'ok' ? t.overview.allGood : o.health.title}
            </T>
            <T v="caption">
              {t.overview.uptime} {duration(o.system.uptime_seconds)} · {o.counts.services.active} {t.overview.services.toLowerCase()}
            </T>
          </View>
        </Row>
        {o.health.reasons.length ? (
          <View style={hs.reasons}>
            {o.health.reasons.slice(0, 5).map((r, i) => (
              <Row key={i} gap={space.sm} style={{ alignItems: 'flex-start' }}>
                <View style={{ paddingTop: 3 }}>
                  <Icon name={r.level === 'critical' ? 'alert-octagon' : 'alert-triangle'} size={14} color={levelColor[r.level]} />
                </View>
                <T v="body" style={{ flex: 1, fontSize: 14 }}>
                  {r.text}
                </T>
              </Row>
            ))}
          </View>
        ) : null}
      </Card>
    </Animated.View>
  );
}

function CountTile({ icon, label, main, sub, level, onPress }: { icon: 'server' | 'box' | 'globe' | 'archive'; label: string; main: string; sub: string; level: Level; onPress: () => void }) {
  return (
    <Card onPress={onPress} style={hs.count} accessibilityLabel={`${label}: ${main}, ${sub}`}>
      <Row gap={6}>
        <Icon name={icon} size={14} color={level === 'ok' ? colors.textMuted : levelColor[level]} />
        <T v="label">{label.toUpperCase()}</T>
      </Row>
      <T v="metricSmall">{main}</T>
      <T v="caption" style={level !== 'ok' ? { color: levelColor[level] } : undefined}>
        {sub}
      </T>
    </Card>
  );
}

function Counts({ o }: { o: Overview }) {
  const c = o.counts;
  const backupLevel: Level = c.last_backup_age_seconds === null ? 'unknown' : c.last_backup_age_seconds > 36 * 3600 ? 'warning' : 'ok';
  return (
    <View style={hs.countsGrid}>
      <CountTile icon="server" label={t.overview.services} main={`${c.services.active}`} sub={c.services.failed ? `${c.services.failed} ${t.overview.failed}` : `${c.services.total} ${t.overview.total}`} level={c.services.failed ? 'warning' : 'ok'} onPress={() => router.push({ pathname: '/system', params: { seg: 'services' } })} />
      <CountTile icon="box" label={t.overview.containers} main={`${c.containers.running}/${c.containers.total}`} sub={c.containers.stopped ? `${c.containers.stopped} ${t.overview.stopped}` : t.overview.running} level={c.containers.stopped ? 'warning' : 'ok'} onPress={() => router.push({ pathname: '/system', params: { seg: 'containers' } })} />
      <CountTile icon="globe" label={t.overview.sites} main={`${c.sites.up}/${c.sites.total}`} sub={c.sites.down ? `${c.sites.down} ${t.overview.down}` : t.overview.up} level={c.sites.down ? 'critical' : 'ok'} onPress={() => router.push({ pathname: '/system', params: { seg: 'sites' } })} />
      <CountTile icon="archive" label={t.overview.backup} main={c.last_backup_age_seconds === null ? '–' : duration(c.last_backup_age_seconds, 1)} sub={backupLevel === 'warning' ? t.overview.tooOld : t.overview.agoShort} level={backupLevel} onPress={() => router.push('/backups')} />
    </View>
  );
}

function Metrics({ o, sparks }: { o: Overview; sparks: Record<string, number[]> }) {
  const s = o.system;
  const tempLevel = levelFromPercent(s.temperature_c, 70, 80);
  const thr = s.throttling;
  return (
    <>
      <SectionTitle>{t.overview.live}</SectionTitle>
      <View style={hs.grid}>
        <View style={hs.row}>
          <Tile icon="cpu" label={t.overview.cpu} value={pct(s.cpu.percent)} sub={`${s.cpu.cores} kernen${s.cpu.freq_mhz ? ` · ${s.cpu.freq_mhz} MHz` : ''}`} level={levelFromPercent(s.cpu.percent, 80, 95)} onPress={() => router.push('/metric/cpu')}>
            <View style={{ marginTop: 6 }}>
              <CoreBars values={s.cpu.per_core} height={24} />
            </View>
          </Tile>
          <Tile icon="database" label={t.overview.ram} value={pct(s.memory.percent)} sub={`${bytes(s.memory.used)} / ${bytes(s.memory.total, 0)}`} spark={sparks.ram} level={levelFromPercent(s.memory.percent, 85, 95)} onPress={() => router.push('/metric/ram')} />
        </View>
        <View style={hs.row}>
          <Tile
            icon="thermometer"
            label={t.overview.temp}
            value={s.temperature_c === null ? '–' : `${num(s.temperature_c)} °C`}
            sub={thr.active ? t.overview.throttleNow : thr.past.length ? t.overview.throttlePast : t.overview.throttleOk}
            spark={sparks.temp}
            level={thr.active ? 'warning' : tempLevel}
            onPress={() => router.push('/metric/temp')}
          />
          <Tile icon="wind" label={t.overview.fan} value={s.fan_rpm === null ? '–' : `${num(s.fan_rpm, 0)}`} sub="rpm" spark={sparks.fan} onPress={() => router.push('/metric/fan')} />
        </View>
        <View style={hs.row}>
          <Tile icon="trending-up" label={t.overview.load} value={num(s.load[0] ?? null, 2)} sub={`${num(s.load[1] ?? null, 2)} · ${num(s.load[2] ?? null, 2)}`} spark={sparks.load1} level={(s.load[0] ?? 0) > s.cpu.cores * 1.5 ? 'warning' : 'ok'} onPress={() => router.push('/metric/load1')} />
          <Tile icon="clock" label={t.overview.uptime} value={duration(s.uptime_seconds)} sub={t.overview.sinceBoot} />
        </View>
        <View style={hs.row}>
          <Tile icon="download" label={t.overview.network} value={rate(s.network.rx_bps)} sub={`${t.overview.out} ${rate(s.network.tx_bps)}`} spark={sparks['net.rx']} onPress={() => router.push('/metric/net.rx')} />
          <Tile icon="hard-drive" label={t.overview.diskIo} value={rate(s.disk_io.write_bps)} sub={`${t.overview.read} ${rate(s.disk_io.read_bps)}`} spark={sparks['disk.write']} onPress={() => router.push('/metric/disk.write')} />
        </View>
      </View>
    </>
  );
}

function Disks({ o }: { o: Overview }) {
  const smartByDev = (dev: string) => o.smart.find((d) => dev.startsWith(d.device));
  return (
    <>
      <SectionTitle right={<T v="caption" onPress={() => router.push('/disks')} style={{ color: colors.purple }} accessibilityRole="link">{t.common.details}</T>}>{t.disk.title}</SectionTitle>
      <Card onPress={() => router.push('/disks')} accessibilityLabel={t.disk.title}>
        <View style={{ gap: space.lg }}>
          {o.mounts.map((m) => {
            const sm = smartByDev(m.device);
            const lvl = levelFromPercent(m.percent, 80, 90);
            return (
              <View key={m.mountpoint} style={{ gap: 6 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Row gap={6} style={{ flex: 1 }}>
                    <T v="mono" numberOfLines={1} style={{ flexShrink: 1 }}>
                      {m.mountpoint}
                    </T>
                    <T v="monoSmall">{m.device.replace('/dev/', '')}</T>
                  </Row>
                  {sm ? <StatusPill compact level={smartLevel(sm.status)} label={`SMART ${smartLabel(sm.status)}`} /> : null}
                </Row>
                <ProgressBar value={m.percent} level={lvl} />
                <Row style={{ justifyContent: 'space-between' }}>
                  <T v="monoSmall">
                    {bytes(m.used)} / {bytes(m.total, 0)}
                  </T>
                  <T v="monoSmall" style={lvl !== 'ok' ? { color: levelColor[lvl] } : undefined}>
                    {pct(m.percent)}
                  </T>
                </Row>
              </View>
            );
          })}
          {o.smart
            .filter((d) => !o.mounts.some((m) => m.device.startsWith(d.device)))
            .map((d) => (
              <Row key={d.device} style={{ justifyContent: 'space-between' }}>
                <T v="mono">{d.device}</T>
                <StatusPill compact level={smartLevel(d.status)} label={`SMART ${smartLabel(d.status)}`} />
              </Row>
            ))}
        </View>
      </Card>
    </>
  );
}

function DeviceCard({ o }: { o: Overview }) {
  const device = useDevice();
  const conn = useStore(connectionStore);
  return (
    <>
      <SectionTitle>{t.overview.device}</SectionTitle>
      <Card onPress={() => router.push('/device')} accessibilityLabel={t.more.device}>
        <Row gap={space.md}>
          <View style={hs.devIcon}>
            <Icon name="cpu" size={20} color={colors.purple} />
          </View>
          <View style={{ flex: 1 }}>
            <T v="h3" numberOfLines={1}>{device.data ? `${device.data.model.replace(/ Rev [\d.]+$/, '')} · ${device.data.hostname}` : serverName(conn)}</T>
            <T v="monoSmall">
              {`${t.common.cores(o.system.cpu.cores)} · ${bytes(o.system.memory.total, 0)} RAM · swap ${pct(o.system.swap.percent)}`}
            </T>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textMuted} />
        </Row>
      </Card>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <View style={{ gap: space.md }}>
      <Skeleton height={150} radius={16} />
      <View style={hs.countsGrid}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={84} radius={16} style={{ width: '48%' }} />
        ))}
      </View>
      <View style={hs.row}>
        <Skeleton height={148} radius={16} style={{ flex: 1 }} />
        <Skeleton height={148} radius={16} style={{ flex: 1 }} />
      </View>
      <View style={hs.row}>
        <Skeleton height={148} radius={16} style={{ flex: 1 }} />
        <Skeleton height={148} radius={16} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const hs = themed(() => StyleSheet.create({
  hero: { padding: space.lg, gap: space.md },
  reasons: { gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: space.md },
  countsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.md, justifyContent: 'space-between' },
  count: { width: '48%', flexGrow: 1, padding: space.md, gap: 4 },
  grid: { gap: space.md },
  row: { flexDirection: 'row', gap: space.md },
  devIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' },
}));
