// Het dashboard van het cover-scherm (Flex Window, ongeveer 360 x 374 dp): alle parameters van de Pi, compact en live.
// Zelfde gegevens als het Overzicht, met de grafieken van het laatste uur. Rechtsonder heeft het cover-scherm een
// uitsparing: onderaan is er ruimte om alles erboven te scrollen.
import { router } from 'expo-router';
import { useMemo, type ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useEvents, useHistory, useUpdates } from '@/api/hooks';
import type { Overview, SmartStatus } from '@/api/types';
import { DiskBanner, OfflineNotice } from '@/components/layout';
import { Marker } from '@/components/odyssey';
import { Button, Card, ProgressBar, T } from '@/components/primitives';
import { CoreBars, Sparkline } from '@/features/charts/Charts';
import { t } from '@/i18n';
import { levelFromPercent } from '@/lib/alerts';
import { bytes, clock, duration, num, pct, rate } from '@/lib/format';
import { colors, type Level, levelColor, space, themed } from '@/theme/tokens';

const PAD = 12;
const GAP = 8;
/** Ruimte onderaan om de laatste kaart boven de uitsparing rechtsonder te kunnen scrollen. */
const CAMERA_ROOM = 96;
const HISTORY = ['cpu', 'ram', 'temp', 'net.rx', 'net.tx'];

function statusWord(o: Overview): string {
  return o.health.status === 'ok' ? t.overview.allGood : o.health.title;
}

function smartLevel(s: SmartStatus): Level {
  return s === 'failing' ? 'critical' : s === 'warning' ? 'warning' : s === 'ok' ? 'ok' : 'unknown';
}

export function CoverDashboard({ o, server, updatedAt, refreshing, onRefresh }: {
  o: Overview; server: string; updatedAt: number; refreshing: boolean; onRefresh: () => void;
}) {
  const { width } = useWindowDimensions();
  const cardW = Math.floor((width - PAD * 2 - GAP) / 2);
  const hist = useHistory(HISTORY, '1h');
  const events = useEvents();
  const updates = useUpdates(false);
  const sparks = useMemo(() => {
    const m: Record<string, number[]> = {};
    for (const s of hist.data ?? []) m[s.metric] = s.points.map((p) => p[1] ?? 0).slice(-60);
    return m;
  }, [hist.data]);

  const s = o.system;
  const level = o.health.status;
  const root = o.mounts.find((m) => m.mountpoint === '/') ?? o.mounts[0];
  const thr = s.throttling;
  const openEvents = events.data ? events.data.events.filter((e) => !e.resolved).length : null;
  const c = o.counts;
  const siteErr = c.sites.warning ?? Math.max(0, c.sites.total - c.sites.up - c.sites.down);
  const age = c.last_backup_age_seconds;
  const backupLevel: Level = age === null ? 'unknown' : c.backups?.failed || c.backups?.old || age > 36 * 3600 ? 'warning' : 'ok';

  return (
    <Animated.View entering={FadeIn.duration(300)} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={cs.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple} colors={[colors.purple]} />}
      >
        <View style={cs.header} accessibilityRole="header">
          <Marker level={level} />
          <T v="label" style={{ color: level === 'ok' ? colors.textMuted : levelColor[level] }} numberOfLines={1}>
            {statusWord(o)}
          </T>
          <T v="monoSmall" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
            {server}
          </T>
          <T v="monoSmall">{clock(updatedAt / 1000)}</T>
        </View>

        <DiskBanner />
        <OfflineNotice at={updatedAt} />

        {o.health.reasons.length ? (
          <Card style={cs.card} severity={level}>
            {o.health.reasons.slice(0, 3).map((r, i) => (
              <View key={`${r.code}${i}`} style={cs.line}>
                <Marker level={r.level} />
                <T v="caption" style={{ flex: 1, color: colors.text }} numberOfLines={2}>
                  {r.text}
                </T>
              </View>
            ))}
          </Card>
        ) : null}

        <View style={cs.grid}>
          <Metric w={cardW} label={t.overview.cpu} value={num(s.cpu.percent, 0)} unit="%" level={levelFromPercent(s.cpu.percent, 80, 95)} spark={sparks.cpu} onPress={() => router.push('/metric/cpu')}>
            <CoreBars values={s.cpu.per_core} height={14} />
          </Metric>
          <Metric w={cardW} label={t.overview.ram} value={num(s.memory.percent, 0)} unit="%" sub={`${bytes(s.memory.used)} / ${bytes(s.memory.total, 0)}`} level={levelFromPercent(s.memory.percent, 85, 95)} spark={sparks.ram} onPress={() => router.push('/metric/ram')} />
          <Metric
            w={cardW}
            label={t.overview.temp}
            value={s.temperature_c === null ? '–' : num(s.temperature_c)}
            unit="°C"
            sub={!thr.available ? t.overview.throttleUnknown : thr.active ? t.overview.throttleNow : thr.past.length ? t.overview.throttlePast : t.overview.throttleOk}
            level={thr.active ? 'warning' : levelFromPercent(s.temperature_c, 70, 80)}
            spark={sparks.temp}
            onPress={() => router.push('/metric/temp')}
          />
          <Metric w={cardW} label={`${t.cover.disks} ${root?.mountpoint ?? '/'}`} value={num(root?.percent ?? null, 0)} unit="%" sub={root ? `${bytes(root.used)} / ${bytes(root.total, 0)}` : undefined} level={levelFromPercent(root?.percent ?? null, 80, 90)} onPress={() => router.push('/disks')}>
            <ProgressBar value={root?.percent ?? 0} level={levelFromPercent(root?.percent ?? null, 80, 90)} height={4} />
          </Metric>
        </View>

        <Card style={cs.card}>
          <KV k={t.overview.load} v={s.load.slice(0, 3).map((v) => num(v, 2)).join(' · ') || '–'} />
          <KV k={t.overview.fan} v={s.fan_rpm === null ? '–' : `${num(s.fan_rpm, 0)} rpm`} />
          <KV k={t.overview.uptime} v={duration(s.uptime_seconds)} />
          <KV k={t.cover.swap} v={pct(s.swap.percent)} />
          <KV k={t.overview.network} v={`↓ ${rate(s.network.rx_bps)}  ↑ ${rate(s.network.tx_bps)}`} />
          <KV k={t.cover.io} v={`${t.overview.read} ${rate(s.disk_io.read_bps)} · ${t.cover.write} ${rate(s.disk_io.write_bps)}`} />
          <KV k={t.cover.updates} v={updates.data ? `${updates.data.count} · ${updates.data.held_count ?? 0} ${t.cover.held}` : '–'} onPress={() => router.push('/updates')} />
          <KV k={t.cover.events} v={openEvents === null ? '–' : String(openEvents)} level={openEvents ? 'warning' : undefined} onPress={() => router.push('/events')} />
        </Card>

        <View style={cs.grid}>
          <Count w={cardW} label={t.overview.services} main={`${c.services.active}/${c.services.total}`} level={c.services.failed ? 'warning' : 'ok'} onPress={() => router.push({ pathname: '/system', params: { seg: 'services' } })} />
          <Count w={cardW} label={t.overview.containers} main={`${c.containers.running}/${c.containers.total}`} level={c.containers.stopped ? 'warning' : 'ok'} onPress={() => router.push({ pathname: '/system', params: { seg: 'containers' } })} />
          <Count w={cardW} label={t.overview.sites} main={`${c.sites.up}/${c.sites.total}`} level={c.sites.down ? 'critical' : siteErr ? 'warning' : 'ok'} onPress={() => router.push({ pathname: '/system', params: { seg: 'sites' } })} />
          <Count w={cardW} label={t.overview.backup} main={age === null ? '–' : duration(age, 1)} level={backupLevel} onPress={() => router.push('/backups')} />
        </View>

        {(sparks['net.rx']?.length ?? 0) > 1 || (sparks['net.tx']?.length ?? 0) > 1 ? (
          <Card style={cs.card}>
            <T v="label">{t.cover.network}</T>
            <Sparkline values={sparks['net.rx'] ?? []} width={width - PAD * 2 - 24} height={28} color={colors.purple} />
            <Sparkline values={sparks['net.tx'] ?? []} width={width - PAD * 2 - 24} height={20} color={colors.mint} fill={false} />
          </Card>
        ) : null}

        <Card style={cs.card} onPress={() => router.push('/disks')} accessibilityLabel={t.cover.disks}>
          <T v="label">{t.cover.disks}</T>
          {o.mounts.map((m) => {
            const sm = o.smart.find((d) => m.device.startsWith(d.device));
            const lvl = levelFromPercent(m.percent, 80, 90);
            return (
              <View key={m.mountpoint} style={{ gap: 4 }}>
                <View style={cs.line}>
                  {sm ? <Marker level={smartLevel(sm.status)} /> : null}
                  <T v="mono" numberOfLines={1} style={{ flex: 1 }}>
                    {m.mountpoint}
                  </T>
                  <T v="monoSmall" style={lvl !== 'ok' ? { color: levelColor[lvl] } : undefined}>
                    {pct(m.percent)}
                  </T>
                </View>
                <ProgressBar value={m.percent} level={lvl} height={4} />
              </View>
            );
          })}
        </Card>

        <Button kind="ghost" label={t.cover.openApp} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <T v="caption" style={{ textAlign: 'center' }}>
          {t.cover.updated(clock(updatedAt / 1000))}
        </T>
        <View style={{ height: CAMERA_ROOM }} />
      </ScrollView>
    </Animated.View>
  );
}

function Metric({ w, label, value, unit, sub, level = 'ok', spark, onPress, children }: {
  w: number; label: string; value: string; unit: string; sub?: string; level?: Level; spark?: number[]; onPress?: () => void; children?: ReactNode;
}) {
  const accent = level === 'ok' ? colors.purple : levelColor[level];
  return (
    <Card style={[cs.metric, { width: w }]} severity={level} onPress={onPress} accessibilityLabel={`${label} ${value} ${unit}`}>
      <T v="label" numberOfLines={1}>
        {label}
      </T>
      <View style={cs.value}>
        <T v="metric" numberOfLines={1} adjustsFontSizeToFit style={level !== 'ok' ? { color: accent } : undefined}>
          {value}
        </T>
        <T v="monoSmall">{unit}</T>
      </View>
      {sub ? (
        <T v="caption" numberOfLines={1}>
          {sub}
        </T>
      ) : null}
      {children}
      {spark && spark.length > 1 ? <Sparkline values={spark} width={w - 20} height={22} color={accent} /> : null}
    </Card>
  );
}

function Count({ w, label, main, level, onPress }: { w: number; label: string; main: string; level: Level; onPress: () => void }) {
  return (
    <Card style={[cs.count, { width: w }]} severity={level} onPress={onPress} accessibilityLabel={`${label}: ${main}`}>
      <View style={cs.line}>
        <Marker level={level} />
        <T v="label" numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </T>
      </View>
      <T v="metricSmall">{main}</T>
    </Card>
  );
}

function KV({ k, v, level, onPress }: { k: string; v: string; level?: Level; onPress?: () => void }) {
  return (
    <View style={cs.kv}>
      <T v="caption" numberOfLines={1} onPress={onPress}>
        {k}
      </T>
      <T v="mono" numberOfLines={1} style={[{ flexShrink: 1, textAlign: 'right' }, level ? { color: levelColor[level] } : null]} onPress={onPress}>
        {v}
      </T>
    </View>
  );
}

const cs = themed(() => StyleSheet.create({
  content: { padding: PAD, gap: GAP },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 28 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  card: { padding: 10, gap: 6 },
  metric: { padding: 10, gap: 2 },
  count: { padding: 10, gap: 4 },
  value: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.sm, minHeight: 20 },
}));
