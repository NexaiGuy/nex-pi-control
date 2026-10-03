import * as Haptics from 'expo-haptics';
import { Tabs, type BottomTabBarProps } from 'expo-router/tabs';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { checkNow } from '@/background/alerts';
import { useOverview } from '@/api/hooks';
import { LineIcon, Marker, type LineIconName } from '@/components/odyssey';
import { Icon, NeonLine, type IconName } from '@/components/primitives';
import { t } from '@/i18n';
import { useKeyboardVisible } from '@/lib/useKeyboard';
import { refreshWidget } from '@/widget/refresh';
import { colors, fonts, isOdyssey, space, themed } from '@/theme/tokens';

const ICONS: Record<string, IconName> = {
  index: 'activity',
  stats: 'bar-chart-2',
  system: 'layers',
  terminal: 'terminal',
  more: 'grid',
};

// Odyssey: dunne lijniconen van 1 px. Het dashboard is een ring met een kern, een echo van het oog.
const LINE: Record<string, LineIconName> = {
  index: 'dash',
  stats: 'signal',
  system: 'containers',
  terminal: 'terminal',
  more: 'grid',
};

function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { data } = useOverview();
  const alarm = (data?.disk_alarms.length ?? 0) > 0 || data?.health.status === 'critical';
  const warn = data?.health.status === 'warning';
  const kb = useKeyboardVisible();
  if (kb) return null;
  const ody = isOdyssey();
  return (
    <View style={[tb.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const opts = descriptors[route.key]?.options;
        const label = (opts?.title as string) ?? route.name;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            void Haptics.selectionAsync();
            navigation.navigate(route.name, route.params);
          }
        };
        const color = focused ? colors.text : ody ? colors.textMuted : colors.textFaint;
        if (ody) {
          return (
            <Pressable key={route.key} onPress={onPress} style={tb.item} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label}>
              {focused ? <NeonLine height={1} style={tb.neon} /> : null}
              <View style={tb.iconWrap}>
                <LineIcon name={LINE[route.name] ?? 'dash'} size={22} color={color} />
                {route.name === 'index' && (alarm || warn) ? (
                  <View style={tb.badge} accessibilityLabel={alarm ? 'Kritiek' : 'Aandachtspunten'}>
                    <Marker level={alarm ? 'critical' : 'warning'} size={6} />
                  </View>
                ) : null}
              </View>
              <Text style={[tb.label, { color }]} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        }
        return (
          <Pressable key={route.key} onPress={onPress} style={tb.item} accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label}>
            {focused ? <NeonLine height={3} style={tb.neon} /> : null}
            <View style={[tb.iconWrap, focused && tb.iconActive]}>
              <Icon name={ICONS[route.name] ?? 'circle'} size={20} color={focused ? colors.purple : color} />
              {route.name === 'index' && (alarm || warn) ? (
                <View style={[tb.badge, { backgroundColor: alarm ? colors.red : colors.amber }]} accessibilityLabel={alarm ? 'Kritiek' : 'Aandachtspunten'} />
              ) : null}
            </View>
            <Text style={[tb.label, { color }]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  const { data } = useOverview();
  useEffect(() => {
    if (data) {
      void checkNow(data).catch(() => undefined);
      refreshWidget(data);
    }
  }, [data?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Tabs tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}>
      <Tabs.Screen name="index" options={{ title: t.tabs.overview }} />
      <Tabs.Screen name="stats" options={{ title: t.tabs.stats }} />
      <Tabs.Screen name="system" options={{ title: t.tabs.system }} />
      <Tabs.Screen name="terminal" options={{ title: t.tabs.terminal }} />
      <Tabs.Screen name="more" options={{ title: t.tabs.more }} />
    </Tabs>
  );
}

const tb = themed(() => (isOdyssey() ? odysseyTabStyles() : classicTabStyles()));

function odysseyTabStyles() {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row', backgroundColor: colors.tabBar, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, paddingTop: space.sm,
      position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 10,
    },
    item: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 56, gap: 4 },
    neon: { position: 'absolute', top: -space.sm, width: 24, alignSelf: 'center' },
    iconWrap: { width: 44, height: 26, alignItems: 'center', justifyContent: 'center' },
    iconActive: {},
    label: { fontFamily: fonts.body, fontSize: 9.5, letterSpacing: 0.4, textTransform: 'uppercase' },
    badge: { position: 'absolute', top: 0, right: 6 },
  });
}

function classicTabStyles() {
  return StyleSheet.create({
  bar: {
    flexDirection: 'row', backgroundColor: colors.tabBar, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: space.sm,
    position: 'absolute', left: 0, right: 0, bottom: 0,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 56, gap: 3 },
  neon: { position: 'absolute', top: -space.sm - 1, left: '26%', right: '26%', alignSelf: 'auto' },
  iconWrap: { width: 52, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  iconActive: { backgroundColor: colors.purpleSoft },
  label: { fontFamily: fonts.bodyMedium, fontSize: 11 },
  badge: { position: 'absolute', top: 2, right: 12, width: 9, height: 9, borderRadius: 5, borderWidth: 2, borderColor: colors.bg },
  });
}
