// Basiscomponenten: tekst, iconen, kaarten, knoppen, pills, chips, segmented control, voortgangsbalk.
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';

import { colors, fonts, levelColor, levelSoft, radius, space, touch, type, type Level } from '@/theme/tokens';

export type IconName = ComponentProps<typeof Feather>['name'];

export function Icon({ name, size = 18, color = colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Feather name={name} size={size} color={color} />;
}

type Variant = keyof typeof type;

export function T({ v = 'body', style, children, ...rest }: TextProps & { v?: Variant; style?: StyleProp<TextStyle>; children?: ReactNode }) {
  return (
    <Text {...rest} style={[type[v], style]}>
      {children}
    </Text>
  );
}

export function Card({ children, style, onPress, accessibilityLabel, glow }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; glow?: Level }) {
  const border = glow ? { borderColor: levelColor[glow] } : null;
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [s.card, border, pressed && s.pressed, style]}
        android_ripple={{ color: colors.purpleSoft }}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={[s.card, border, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={s.section}>
      <T v="label" style={s.sectionText}>
        {typeof children === 'string' ? children.toUpperCase() : children}
      </T>
      {right}
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Divider() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.line, marginVertical: space.sm }} />;
}

const LEVEL_ICON: Record<Level, IconName> = {
  ok: 'check-circle',
  warning: 'alert-triangle',
  critical: 'alert-octagon',
  unknown: 'help-circle',
  info: 'info',
};

/** Status altijd met kleur én icoon én tekst. */
export function StatusPill({ level, label, compact }: { level: Level; label: string; compact?: boolean }) {
  return (
    <View style={[s.pill, { backgroundColor: levelSoft[level] }, compact && s.pillCompact]} accessibilityLabel={`Status: ${label}`}>
      <Icon name={LEVEL_ICON[level]} size={compact ? 12 : 13} color={levelColor[level]} />
      <Text style={[s.pillText, { color: levelColor[level] }, compact && { fontSize: 11 }]}>{label}</Text>
    </View>
  );
}

export function Dot({ level, size = 8 }: { level: Level; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: levelColor[level] }} />;
}

type BtnKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label, onPress, kind = 'primary', icon, loading, disabled, style, accessibilityHint, full,
}: {
  label: string; onPress?: () => void; kind?: BtnKind; icon?: IconName; loading?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; accessibilityHint?: string; full?: boolean;
}) {
  const bg = { primary: colors.purple, secondary: colors.surface2, ghost: 'transparent', danger: colors.red }[kind];
  const fg = kind === 'primary' || kind === 'danger' ? '#FFFFFF' : kind === 'ghost' ? colors.purple : colors.text;
  return (
    <Pressable
      onPress={() => {
        if (disabled || loading) return;
        void Haptics.selectionAsync();
        onPress?.();
      }}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg },
        kind === 'secondary' && { borderWidth: 1, borderColor: colors.line },
        full && { alignSelf: 'stretch' },
        (disabled || loading) && { opacity: 0.5 },
        pressed && s.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={17} color={fg} /> : null}
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color = colors.text, size = 20 }: { icon: IconName; onPress: () => void; label: string; color?: string; size?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

export function Chip({ label, active, onPress, count }: { label: string; active?: boolean; onPress: () => void; count?: number }) {
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      accessibilityLabel={label}
      style={[s.chip, active && s.chipActive]}
    >
      <Text style={[s.chipText, active && { color: colors.text }]}>{label}</Text>
      {count !== undefined && <Text style={[s.chipCount, active && { color: colors.purple }]}>{count}</Text>}
    </Pressable>
  );
}

export function Segmented<K extends string>({ items, value, onChange }: { items: { key: K; label: string }[]; value: K; onChange: (k: K) => void }) {
  return (
    <View style={s.seg} accessibilityRole="tablist">
      {items.map((it) => {
        const active = it.key === value;
        return (
          <Pressable
            key={it.key}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(it.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[s.segItem, active && s.segItemActive]}
          >
            <Text style={[s.segText, active && { color: colors.text }]} numberOfLines={1}>
              {it.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, level = 'ok', height = 6 }: { value: number; level?: Level; height?: number }) {
  const w = Math.max(0, Math.min(100, value));
  return (
    <View style={[s.track, { height, borderRadius: height / 2 }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(w) }}>
      <View style={{ width: `${w}%`, height, borderRadius: height / 2, backgroundColor: level === 'ok' ? colors.purple : levelColor[level] }} />
    </View>
  );
}

export function KeyValue({ k, v, mono = true }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <View style={s.kv}>
      <T v="bodyMuted">{k}</T>
      {typeof v === 'string' || typeof v === 'number' ? (
        <T v={mono ? 'mono' : 'body'} style={{ flexShrink: 1, textAlign: 'right' }} selectable>
          {v}
        </T>
      ) : (
        v
      )}
    </View>
  );
}

export const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.lg,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.xl, marginBottom: space.sm },
  sectionText: { letterSpacing: 1.2 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill, alignSelf: 'flex-start' },
  pillCompact: { paddingHorizontal: 7, paddingVertical: 2 },
  pillText: { fontFamily: fonts.bodyMedium, fontSize: 12 },
  btn: { minHeight: touch, borderRadius: radius.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  btnText: { fontFamily: fonts.headingMedium, fontSize: 15 },
  iconBtn: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  chip: {
    minHeight: 36, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.purpleSoft, borderColor: colors.purple },
  chipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textMuted },
  chipCount: { fontFamily: fonts.mono, fontSize: 11, color: colors.textFaint },
  seg: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.md, padding: 4, borderWidth: 1, borderColor: colors.line },
  segItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segItemActive: { backgroundColor: colors.surface3 },
  segText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.textMuted },
  track: { backgroundColor: colors.surface3, overflow: 'hidden', width: '100%' },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, minHeight: 36 },
});
