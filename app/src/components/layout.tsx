// Scherm-opbouw: header met live-indicator, schijfalarm-banner (in elke tab), pull-to-refresh.
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { linkStore, useOverview } from '@/api/hooks';
import { t } from '@/i18n';
import { clock } from '@/lib/format';
import { connectionStore, serverName } from '@/state/settings';
import { useStore } from '@/state/store';
import { colors, fonts, radius, space } from '@/theme/tokens';

import { Icon, IconButton, T } from './primitives';

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

export function AppHeader({ title, right }: { title?: string; right?: ReactNode }) {
  const conn = useStore(connectionStore);
  const server = serverName(conn);
  return (
    <View style={h.header}>
      <View style={{ flex: 1, gap: 4 }}>
        <Pressable style={h.server} accessibilityRole="button" accessibilityLabel={`${t.common.server}: ${server}`} onPress={() => router.push('/device')}>
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
        {right ?? <IconButton icon="settings" label={t.more.settings} onPress={() => router.push('/settings')} color={colors.textMuted} />}
        <LiveIndicator />
      </View>
    </View>
  );
}

/** Rode banner bovenaan elke tab zolang een schijf tekenen van falen toont. Niet weg te klikken. */
export function DiskBanner() {
  const { data } = useOverview();
  const alarms = data?.disk_alarms ?? [];
  if (!alarms.length) return null;
  const first = alarms[0]!;
  return (
    <Pressable
      onPress={() => router.push('/disks')}
      style={h.banner}
      accessibilityRole="alert"
      accessibilityLabel={`${t.disk.banner(first.device)} ${t.common.details}`}
    >
      <Icon name="alert-octagon" size={20} color={colors.red} />
      <View style={{ flex: 1, gap: 2 }}>
        <T v="h3" style={{ color: '#FFD9DB' }}>
          {t.disk.banner(first.device)}
        </T>
        <T v="caption" style={{ color: '#F4A6AA' }} numberOfLines={1}>
          {first.reasons[0]}
          {alarms.length > 1 ? ` · +${alarms.length - 1}` : ''}
        </T>
      </View>
      <View style={h.bannerBtn}>
        <T v="label" style={{ color: colors.red }}>
          {t.common.details}
        </T>
      </View>
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
  children, title, onRefresh, refreshing = false, scroll = true, right, padded = true, dataUpdatedAt,
}: {
  children: ReactNode; title?: string; onRefresh?: () => void; refreshing?: boolean; scroll?: boolean; right?: ReactNode; padded?: boolean; dataUpdatedAt?: number;
}) {
  const insets = useSafeAreaInsets();
  const header = (
    <>
      <AppHeader title={title} right={right} />
      <DiskBanner />
      <OfflineNotice at={dataUpdatedAt} />
    </>
  );
  if (!scroll) {
    return (
      <View style={[h.root, { paddingTop: insets.top }]}>
        <View style={{ paddingHorizontal: space.lg }}>{header}</View>
        <View style={{ flex: 1, paddingHorizontal: padded ? space.lg : 0 }}>{children}</View>
      </View>
    );
  }
  return (
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
  );
}

/** Stack-scherm (detail) met terugknop. */
export function DetailScreen({ title, children, onRefresh, refreshing = false, right, scroll = true }: { title: string; children: ReactNode; onRefresh?: () => void; refreshing?: boolean; right?: ReactNode; scroll?: boolean }) {
  const insets = useSafeAreaInsets();
  const head = (
    <>
      <View style={h.detailHead}>
        <IconButton icon="arrow-left" label={t.common.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <T v="h2" style={{ flex: 1 }} numberOfLines={1} accessibilityRole="header">
          {title}
        </T>
        {right}
      </View>
      <DiskBanner />
      <OfflineNotice />
    </>
  );
  if (!scroll) {
    return (
      <View style={[h.root, { paddingTop: insets.top }]}>
        <View style={{ paddingHorizontal: space.lg }}>{head}</View>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
    );
  }
  return (
    <ScrollView
      style={h.root}
      contentContainerStyle={{ paddingTop: insets.top, paddingHorizontal: space.lg, paddingBottom: insets.bottom + space.xxxl }}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.purple} colors={[colors.purple]} progressBackgroundColor={colors.surface2} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {head}
      {children}
    </ScrollView>
  );
}

const h = StyleSheet.create({
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
    flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.redBanner, borderColor: colors.red, borderWidth: 1.5,
    borderRadius: radius.lg, padding: space.lg, marginBottom: space.md,
  },
  bannerBtn: { borderWidth: 1, borderColor: colors.red, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, minHeight: 36, justifyContent: 'center' },
  offline: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.amberSoft, borderRadius: radius.md, padding: space.md, marginBottom: space.md,
  },
  detailHead: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingVertical: space.sm, marginLeft: -space.md },
});
