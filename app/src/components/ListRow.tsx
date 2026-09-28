import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Icon, T } from './primitives';

export function ListRow({ left, title, subtitle, right, onPress, a11y, mono = true }: { left?: ReactNode; title: string; subtitle?: string; right?: ReactNode; onPress?: () => void; a11y?: string; mono?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={a11y ?? `${title} ${subtitle ?? ''}`}
      style={({ pressed }) => [lr.row, pressed && { backgroundColor: colors.surface2 }]}
      android_ripple={{ color: colors.purpleSoft }}
    >
      {left}
      <View style={{ flex: 1, gap: 2 }}>
        <T v={mono ? 'mono' : 'h3'} numberOfLines={1} style={mono ? { fontSize: 14 } : undefined}>
          {title}
        </T>
        {subtitle ? (
          <T v="caption" numberOfLines={1}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {right}
      {onPress ? <Icon name="chevron-right" size={16} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

export function ListGroup({ children }: { children: ReactNode }) {
  return <View style={lr.group}>{children}</View>;
}

const lr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.lg, paddingVertical: space.sm },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
});
