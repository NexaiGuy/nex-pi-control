import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Sparkline } from '@/features/charts/Charts';
import { colors, type Level, levelColor, radius, space, themed } from '@/theme/tokens';

import { Card, Icon, T, type IconName } from './primitives';

export function Tile({
  icon, label, value, sub, spark, level = 'ok', onPress, children, a11y,
}: {
  icon: IconName; label: string; value: string; sub?: string; spark?: number[]; level?: Level; onPress?: () => void; children?: ReactNode; a11y?: string;
}) {
  const accent = level === 'ok' ? colors.purple : levelColor[level];
  return (
    <Card onPress={onPress} style={tl.tile} glow={level === 'ok' ? undefined : level} accessibilityLabel={a11y ?? `${label} ${value} ${sub ?? ''}`}>
      <View style={tl.top}>
        <View style={[tl.icon, { backgroundColor: level === 'ok' ? colors.purpleSoft : `${accent}26` }]}>
          <Icon name={icon} size={14} color={accent} />
        </View>
        <T v="label" numberOfLines={1} style={{ flex: 1 }}>
          {label.toUpperCase()}
        </T>
      </View>
      <T v="metric" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      {sub ? (
        <T v="caption" numberOfLines={1} style={level !== 'ok' ? { color: accent } : undefined}>
          {sub}
        </T>
      ) : null}
      {children}
      {spark && spark.length > 1 ? (
        <View style={tl.spark}>
          <Sparkline values={spark} width={140} height={30} color={accent} />
        </View>
      ) : null}
    </Card>
  );
}

const tl = themed(() => StyleSheet.create({
  tile: { flex: 1, minHeight: 148, padding: space.md, gap: 4, borderRadius: radius.lg, overflow: 'hidden' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: 4 },
  icon: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  spark: { marginTop: 'auto', marginHorizontal: -space.md, marginBottom: -space.md, opacity: 0.95 },
}));
