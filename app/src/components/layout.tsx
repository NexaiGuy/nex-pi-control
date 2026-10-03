// Scherm-opbouw: header met live-indicator, schijfalarm-banner (in elke tab), pull-to-refresh.
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { linkStore, useEvents, useInfo, useOverview, useScreenFocused } from '@/api/hooks';
import { supports } from '@/lib/agent';
import { t } from '@/i18n';
import { clock } from '@/lib/format';
import { connectionStore, serverName } from '@/state/settings';
import { useStore } from '@/state/store';
import { colors, fonts, isOdyssey, radius, space, themed } from '@/theme/tokens';

import { ServerSwitcher } from '@/features/servers/ServerSwitcher';

import { AxisRule, EyeCorridor, GlowRing, LineIcon, PresenceEye, ScreenFocus, useEyeState, useScreenInView, type LineIconName } from './odyssey';
import { PiCaseSpin } from './PiCaseSpin';
import { Icon, IconButton, NeonLine, T } from './primitives';

const PI_SIZE = 56;

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function PulseDot({ color }: { color: string }) {
  const s = useSharedValue(1);
  useEffect(() => {
    s.set(withRepeat(withTiming(2.2, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
  }, [s]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: s.get() }], opacity: 2.2 - s.get() > 0 ? (2.2 - s.get()) / 1.2 : 0 }));
  return (
    <View style={{ width: 10, height: 10, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: color }, ring]} />
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    </View>
  );
}

export function LiveIndicator() {
  const link = useStore(linkStore);
  const now = useNow();
  const offline = !!link.error && (link.error.kind === 'offline' || link.error.kind === 'timeout');
  if (!link.lastOkAt && !link.error) {
    return (
      <View style={h.live}>
        <View style={[h.dot, { backgroundColor: colors.textFaint }]} />
        <T v="caption">{t.live.connecting}</T>
      </View>
    );
  }
  if (offline || link.error) {
    return (
      <View style={h.live} accessibilityLabel={t.live.offline}>
        <Icon name="wifi-off" size={12} color={colors.textMuted} />
        <T v="caption">{link.error?.kind === 'offline' || link.error?.kind === 'timeout' ? t.live.offline : link.error?.message}</T>
      </View>
    );
  }
  const secs = Math.max(0, Math.round((now - (link.lastOkAt ?? now)) / 1000));
  return (
    <View style={h.live} accessibilityLabel={t.live.updated(`${secs} s`)}>
      <PulseDot color={colors.mint} />
      <T v="caption">{t.live.updated(`${secs} s`)}</T>
    </View>
  );
}

/** Kleine live-regel voor Odyssey: mono, gedempt, op de as. */
function LiveLine() {
  const link = useStore(linkStore);
  const now = useNow();
  const offline = !!link.error && (link.error.kind === 'offline' || link.error.kind === 'timeout');
  let text: string;
  if (!link.lastOkAt && !link.error) text = t.live.connecting;
  else if (link.error) text = offline ? t.live.offline : (link.error.message ?? t.live.offline);
  else text = t.live.updated(`${Math.max(0, Math.round((now - (link.lastOkAt ?? now)) / 1000))} s`);
  return (
    <T v="monoSmall" numberOfLines={1} style={{ color: link.error ? colors.amber : colors.textMuted, textAlign: 'center' }} accessibilityLiveRegion="polite">
      {text}
    </T>
  );
}

function OdyIconButton({ icon, label, onPress }: { icon: LineIconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={4} style={({ pressed }) => [h.odyBtn, pressed && { opacity: 0.6 }]}>
      <LineIcon name={icon} size={22} color={colors.textMuted} />
    </Pressable>
  );
}

/**
 * Meldingen-knop met teller (Overzicht). Rood zodra er een open kritieke melding is, anders amber.
 * Oudere agents zonder meldingen: lege plek (de header blijft symmetrisch).
 */
export function AlertsButton() {
  const info = useInfo();
  const has = supports(info.data, 'events');
  const ev = useEvents(has);
  if (!has) return <View style={h.odyBtn} />;
  const open = ev.data?.open ?? 0;
  const critical = (ev.data?.events ?? []).some((e) => !e.resolved && e.level === 'critical');
  const tint = critical ? colors.red : colors.amber;
  const ody = isOdyssey();
  return (
    <Pressable
      onPress={() => router.push('/events')}
      accessibilityRole="button"
      accessibilityLabel={open ? `${t.events.title}: ${t.events.open(open)}` : t.events.title}
      hitSlop={4}
      style={({ pressed }) => [h.odyBtn, pressed && { opacity: 0.6 }]}
    >
      {ody ? <LineIcon name="events" size={22} color={open ? tint : colors.textMuted} /> : <Icon name="bell" size={20} color={open ? tint : colors.textMuted} />}
      {open ? (
        <View style={[h.alertBadge, { backgroundColor: tint }]}>
          <T v="monoSmall" style={{ color: colors.onInk, fontSize: 9, lineHeight: 12 }}>
            {open > 9 ? '9+' : String(open)}
          </T>
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * Odyssey-header: symmetrisch rond de centrale as. Links opnieuw laden, rechts Instellingen, in het midden de
 * servernaam (de serverwissel) met de schermtitel en de live-regel eronder.
 */
function OdysseyHeader({ title, right, onRefresh, alerts }: { title?: string; right?: ReactNode; onRefresh?: () => void; alerts?: boolean }) {
  const conn = useStore(connectionStore);
  const server = serverName(conn);
  const [switcher, setSwitcher] = useState(false);
  return (
    <View style={h.odyHeader}>
      <ServerSwitcher visible={switcher} onClose={() => setSwitcher(false)} />
      <View style={h.odySide}>
        {onRefresh ? <OdyIconButton icon="sync" label={t.common.retry} onPress={onRefresh} /> : <View style={h.odyBtn} />}
        {alerts ? <View style={h.odyBtn} /> : null}
      </View>
      <View style={h.odyCenter}>
        <Pressable style={h.odySwitch} accessibilityRole="button" accessibilityLabel={`${t.common.server}: ${server}`} onPress={() => setSwitcher(true)}>
          <T v="h1" numberOfLines={1} style={{ flexShrink: 1 }}>
            {server}
          </T>
          <LineIcon name="chevron" size={14} color={colors.textMuted} />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {title ? (
            <T v="label" accessibilityRole="header" numberOfLines={1}>
              {title}
            </T>
          ) : null}
          {conn.demo ? (
            <>
              <T v="label">·</T>
              <T v="label" style={{ color: colors.mint }}>
                {t.demo.badge.toUpperCase()}
              </T>
            </>
          ) : null}
        </View>
        <LiveLine />
      </View>
      <View style={h.odySide}>
        {alerts ? <AlertsButton /> : null}
        {right ?? <OdyIconButton icon="gear" label={t.more.settings} onPress={() => router.push('/settings')} />}
      </View>
    </View>
  );
}

/** Het oog op de centrale as, met de gang van perspectieflijnen. Enkel op het dashboard. */
function DashboardEye({ pi }: { pi?: boolean }) {
  const state = useEyeState();
  return (
    <View>
      <EyeCorridor height={88}>
        <PresenceEye state={state} size={44} />
      </EyeCorridor>
      {/* Rechtsboven, gecentreerd onder het tandwiel (dat staat 22 px voorbij de rand, de header heeft -space.sm marge). */}
      {pi ? (
        <View style={h.piSpot} pointerEvents="none">
          <PiCaseSpin size={PI_SIZE} />
        </View>
      ) : null}
    </View>
  );
}

export function AppHeader({ title, right, onRefresh, alerts, pi }: { title?: string; right?: ReactNode; onRefresh?: () => void; alerts?: boolean; pi?: boolean }) {
  if (isOdyssey()) return <OdysseyHeader title={title} right={right} onRefresh={onRefresh} alerts={alerts} />;
  return <ClassicHeader title={title} right={right} alerts={alerts} pi={pi} />;
}

function ClassicHeader({ title, right, alerts, pi }: { title?: string; right?: ReactNode; alerts?: boolean; pi?: boolean }) {
  const conn = useStore(connectionStore);
  const server = serverName(conn);
  const [switcher, setSwitcher] = useState(false);
  return (
    <View style={h.header}>
      <ServerSwitcher visible={switcher} onClose={() => setSwitcher(false)} />
      <View style={{ flex: 1, gap: 4 }}>
        <Pressable style={h.server} accessibilityRole="button" accessibilityLabel={`${t.common.server}: ${server}`} onPress={() => setSwitcher(true)}>
          <View style={h.serverIcon}>
            <Icon name="cpu" size={12} color={colors.purple} />
          </View>
          <T v="label" style={{ color: colors.text, fontFamily: fonts.monoMedium, letterSpacing: 0.4 }}>
            {server}
          </T>
          {conn.demo ? (
            <View style={h.demoChip}>
              <T v="monoSmall" style={{ color: colors.mint }}>
                {t.demo.badge.toUpperCase()}
              </T>
            </View>
          ) : null}
          <Icon name="chevron-down" size={14} color={colors.textMuted} />
        </Pressable>
        {title ? (
          <T v="h1" accessibilityRole="header">
            {title}
          </T>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {alerts ? <AlertsButton /> : null}
          {right ?? <IconButton icon="settings" label={t.more.settings} onPress={() => router.push('/settings')} color={colors.textMuted} />}
        </View>
        {pi ? <PiCaseSpin size={48} /> : null}
        <LiveIndicator />
      </View>
    </View>
  );
}

/** Rode banner bovenaan elke tab zolang een schijf tekenen van falen toont. Niet weg te klikken. */
export function DiskBanner() {
  const { data } = useOverview();
  const [box, setBox] = useState({ w: 0, h: 0 });
  const reducedMotion = useReducedMotion();
  const inView = useScreenInView();
  const alarms = data?.disk_alarms ?? [];
  if (!alarms.length) return null;
  const first = alarms[0]!;
  return (
    <Pressable
      onPress={() => router.push('/disks')}
      onLayout={isOdyssey() ? (e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }) : undefined}
      style={h.banner}
      accessibilityRole="alert"
      accessibilityLabel={`${t.disk.banner(first.device)} ${t.common.details}`}
    >
      <Icon name="alert-octagon" size={20} color={colors.red} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="h3" style={{ color: colors.bannerTitle }}>
          {t.disk.banner(first.device)}
        </T>
        <T v="caption" style={{ color: colors.bannerText }} numberOfLines={isOdyssey() ? 2 : 1}>
          {first.reasons[0]}
          {alarms.length > 1 ? ` · +${alarms.length - 1}` : ''}
        </T>
      </View>
      {isOdyssey() ? (
        // Odyssey: geen brede knop die de tekst wegduwt, enkel een dunne pijl. De hele banner is tikbaar.
        <View style={{ transform: [{ rotate: '-90deg' }] }}>
          <LineIcon name="chevron" size={20} color={colors.red} />
        </View>
      ) : (
        <View style={h.bannerBtn}>
          <T v="label" style={{ color: colors.red }}>
            {t.common.details}
          </T>
        </View>
      )}
      {isOdyssey() && box.w > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: -1, top: -1 }}>
          <GlowRing severity="critical" radius={radius.lg} w={box.w} h={box.h} reduced={reducedMotion || !inView} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function OfflineNotice({ at }: { at?: number }) {
  const link = useStore(linkStore);
  const conn = useStore(connectionStore);
  if (!link.error || !(link.error.kind === 'offline' || link.error.kind === 'timeout')) return null;
  return (
    <View style={h.offline} accessibilityRole="alert">
      <Icon name="cloud-off" size={16} color={colors.amber} />
      <T v="caption" style={{ color: colors.amber, flex: 1 }}>
        {t.live.offlineLong(serverName(conn), at ? clock(at / 1000) : '–')}
      </T>
    </View>
  );
}

export function Screen({
  children, title, onRefresh, refreshing = false, scroll = true, right, padded = true, dataUpdatedAt, eye = false, alerts = false, pi = false,
}: {
  children: ReactNode; title?: string; onRefresh?: () => void; refreshing?: boolean; scroll?: boolean; right?: ReactNode; padded?: boolean; dataUpdatedAt?: number;
  /** Meldingen-knop met teller in de header (Overzicht). */
  alerts?: boolean;
  /** De draaiende Pi-behuizing rechtsboven onder het tandwiel (Overzicht). */
  pi?: boolean;
  /** Odyssey: toon het oog met de perspectieflijnen onder de header (dashboard). */
  eye?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const ody = isOdyssey();
  const focused = useScreenFocused();
  const header = (
    <>
      <AppHeader title={title} right={right} onRefresh={onRefresh} alerts={alerts} pi={pi} />
      {ody ? <AxisRule style={{ marginBottom: eye ? 0 : space.md }} /> : <NeonLine style={{ marginBottom: space.md, opacity: 0.9 }} />}
      {ody && eye ? <DashboardEye pi={pi} /> : null}
      <DiskBanner />
      <OfflineNotice at={dataUpdatedAt} />
    </>
  );
  if (!scroll) {
    return (
      <ScreenFocus focused={focused}>
      <View style={[h.root, { paddingTop: insets.top }]}>
        <View style={{ paddingHorizontal: space.lg }}>{header}</View>
        <View style={{ flex: 1, paddingHorizontal: padded ? space.lg : 0 }}>{children}</View>
      </View>
      </ScreenFocus>
    );
  }
  return (
    <ScreenFocus focused={focused}>
    <ScrollView
      style={h.root}
      contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: padded ? space.lg : 0, paddingBottom: insets.bottom + 110 }}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple} colors={[colors.purple]} progressBackgroundColor={colors.surface2} /> : undefined
      }
      keyboardShouldPersistTaps="handled"
    >
      {header}
      {children}
    </ScrollView>
    </ScreenFocus>
  );
}

/** Stack-scherm (detail) met terugknop. */
export function DetailScreen({
  title, children, onRefresh, refreshing = false, right, scroll = true, diskBanner = true,
}: {
  title: string; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; right?: ReactNode; scroll?: boolean;
  /** Uit op het Schijven-scherm zelf: daar staat de veiligheidsmelding al, twee keer hetzelfde is ruis. */
  diskBanner?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const focused = useScreenFocused();
  const head = (
    <>
      {isOdyssey() ? (
        <View style={h.odyDetail}>
          <OdyIconButton icon="back" label={t.common.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <T v="h1" style={{ flex: 1, textAlign: 'center' }} numberOfLines={1} accessibilityRole="header">
            {title}
          </T>
          {right ?? <View style={h.odyBtn} />}
        </View>
      ) : (
        <View style={h.detailHead}>
          <IconButton icon="arrow-left" label={t.common.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          <T v="h2" style={{ flex: 1 }} numberOfLines={1} accessibilityRole="header">
            {title}
          </T>
          {right}
        </View>
      )}
      {isOdyssey() ? <AxisRule style={{ marginBottom: space.md }} /> : <NeonLine style={{ marginBottom: space.md, opacity: 0.9 }} />}
      {diskBanner ? <DiskBanner /> : null}
      <OfflineNotice />
    </>
  );
  if (!scroll) {
    return (
      <ScreenFocus focused={focused}>
      <View style={[h.root, { paddingTop: insets.top }]}>
        <View style={{ paddingHorizontal: space.lg }}>{head}</View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
      </ScreenFocus>
    );
  }
  return (
    <ScreenFocus focused={focused}>
    <ScrollView
      style={h.root}
      contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxxl }}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple} colors={[colors.purple]} progressBackgroundColor={colors.surface2} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {head}
      {children}
    </ScrollView>
    </ScreenFocus>
  );
}

const h = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingTop: space.md, paddingBottom: space.md, gap: space.md },
  server: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, minHeight: 32,
  },
  demoChip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1, borderColor: colors.mint, marginLeft: 2 },
  serverIcon: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' },
  live: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.redBanner,
    borderColor: isOdyssey() ? colors.line : colors.red, borderWidth: isOdyssey() ? 1 : 1.5,
    borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
  },
  bannerBtn: { borderWidth: 1, borderColor: colors.red, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  offline: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.md,
  },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.sm, marginLeft: -space.md },
  odyHeader: { flexDirection: 'row', alignItems: 'center', paddingTop: space.md, paddingBottom: space.md, marginHorizontal: -space.sm },
  odyCenter: { flex: 1, alignItems: 'center', gap: 3 },
  odySwitch: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: space.sm, maxWidth: '100%' },
  odyBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  odySide: { flexDirection: 'row', alignItems: 'center' },
  piSpot: { position: 'absolute', top: 0, right: -space.sm + 22 - PI_SIZE / 2 },
  alertBadge: { position: 'absolute', top: 6, right: 4, minWidth: 15, height: 15, borderRadius: 8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  odyDetail: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm, marginHorizontal: -space.sm },
}));
