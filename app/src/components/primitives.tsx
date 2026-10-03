// Basiscomponenten: tekst, iconen, kaarten, knoppen, pills, chips, segmented control, voortgangsbalk.
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { colors, fonts, getTheme, isOdyssey, type Level, levelColor, levelSoft, radius, space, themed, touch, type } from '@/theme/tokens';

import { Marker, SlabDeco, toSeverity } from './odyssey';

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

/**
 * Kaart. `glow` kleurt de rand (beide designs). `severity` is de status van de inhoud: in Odyssey loopt bij een
 * waarschuwing of kritiek een gloed klokwijs rond de kaart, en elke kaart krijgt de spectrale lichtstroom.
 */
export function Card({
  children, style, onPress, accessibilityLabel, glow, severity,
}: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; glow?: Level; severity?: Level }) {
  const ody = isOdyssey();
  const sev = toSeverity(severity);
  const flat = StyleSheet.flatten(style) as ViewStyle | undefined;
  const r = typeof flat?.borderRadius === 'number' ? flat.borderRadius : radius.lg;
  // In Odyssey neemt de gloed de rol van de gekleurde rand over; de rand zelf blijft een haarlijn.
  const border = glow && !(ody && sev !== 'ok') ? { borderColor: levelColor[glow] } : null;
  const deco = ody ? <SlabDeco radius={r} severity={sev} /> : null;
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
        {deco}
      </Pressable>
    );
  }
  return (
    <View style={[s.card, border, style]}>
      {children}
      {deco}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  if (isOdyssey()) {
    // Odyssey: het label staat op de centrale as, tussen twee haarlijnen.
    return (
      <View style={s.section}>
        <View style={s.axisLine} />
        <T v="label" style={s.sectionText} accessibilityRole="header">
          {typeof children === 'string' ? children.toUpperCase() : children}
        </T>
        <View style={s.axisLine} />
        {right}
      </View>
    );
  }
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

/**
 * Dunne neonlijn (paars, magenta, cyaan). Het cyberpunk-accent van het lichte thema: enkel onder de header
 * en boven de actieve tab. In het donkere thema tekent hij niets, daar blijft het ontwerp zoals het was.
 */
export function NeonLine({ height = 2, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  const id = `neon${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // Odyssey: altijd (beide thema's), dun en spectraal. Classic: enkel in het lichte thema.
  if (!isOdyssey() && getTheme() !== 'light') return null;
  return (
    <View style={[{ height, alignSelf: 'stretch', borderRadius: height }, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width="100%" height={height} preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            {isOdyssey()
              ? [
                  <Stop key="a" offset="0" stopColor={colors.neonA} />,
                  <Stop key="b" offset="0.35" stopColor={colors.neonB} />,
                  <Stop key="c" offset="0.65" stopColor={colors.neonC} />,
                  <Stop key="d" offset="1" stopColor={colors.neonD} />,
                ]
              : [
                  <Stop key="a" offset="0" stopColor={colors.neonA} />,
                  <Stop key="b" offset="0.5" stopColor={colors.neonB} />,
                  <Stop key="c" offset="1" stopColor={colors.neonC} />,
                ]}
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height={height} rx={height / 2} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
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
  if (isOdyssey()) {
    // Odyssey: een ruitje en het statuswoord. OK-woorden blijven gedempt; enkel de markering is mint.
    return (
      <View style={s.pill} accessibilityLabel={`Status: ${label}`}>
        <Marker level={level} />
        <Text style={[s.pillText, { color: level === 'ok' || level === 'unknown' ? colors.textMuted : levelColor[level] }]}>{label}</Text>
      </View>
    );
  }
  return (
    <View style={[s.pill, { backgroundColor: levelSoft[level] }, compact && s.pillCompact]} accessibilityLabel={`Status: ${label}`}>
      <Icon name={LEVEL_ICON[level]} size={compact ? 12 : 13} color={levelColor[level]} />
      <Text style={[s.pillText, { color: levelColor[level] }, compact && { fontSize: 11 }]}>{label}</Text>
    </View>
  );
}

export function Dot({ level, size = 8 }: { level: Level; size?: number }) {
  // Odyssey: een ruitje in plaats van een rond bolletje, hol voor onbekend.
  if (isOdyssey()) return <Marker level={level} size={Math.max(6, Math.round(size * 0.7))} />;
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: levelColor[level] }} />;
}

type BtnKind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  label, onPress, kind = 'primary', icon, loading, disabled, style, accessibilityHint, full,
}: {
  label: string; onPress?: () => void; kind?: BtnKind; icon?: IconName; loading?: boolean; disabled?: boolean;
  style?: StyleProp<ViewStyle>; accessibilityHint?: string; full?: boolean;
}) {
  const ody = isOdyssey();
  // Odyssey: primair is gevuld met inkt, de rest is een haarlijn. Destructief = rode tekst en rand, geen vulling.
  const bg = ody
    ? { primary: colors.text, secondary: 'transparent', ghost: 'transparent', danger: 'transparent' }[kind]
    : { primary: colors.purple, secondary: colors.surface2, ghost: 'transparent', danger: colors.red }[kind];
  const fg = ody
    ? { primary: colors.onInk, secondary: colors.text, ghost: colors.purple, danger: colors.red }[kind]
    : kind === 'primary' || kind === 'danger' ? '#FFFFFF' : kind === 'ghost' ? colors.purple : colors.text;
  const edge = ody
    ? kind === 'danger' ? { borderWidth: 1, borderColor: colors.red } : kind === 'ghost' ? null : { borderWidth: 1, borderColor: colors.lineStrong }
    : kind === 'secondary' ? { borderWidth: 1, borderColor: colors.line } : null;
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
        edge,
        full && { alignSelf: 'stretch' },
        (disabled || loading) && { opacity: 0.5 },
        pressed && s.pressed,
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Icon name={icon} size={ody ? 15 : 17} color={fg} /> : null}
      <Text style={[s.btnText, { color: fg }]} numberOfLines={ody ? 1 : undefined} adjustsFontSizeToFit={ody} minimumFontScale={0.85}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Rij knoppen. In Odyssey onder elkaar (volle breedte), zodat lange labels in hoofdletters nooit op twee regels breken. */
export function ButtonRow({ children }: { children: ReactNode }) {
  if (isOdyssey()) return <View style={{ gap: space.sm }}>{children}</View>;
  return <Row>{children}</Row>;
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
  if (isOdyssey()) {
    // Odyssey: een balk van 1 px. Gedempt als alles goed is, statuskleur anders.
    const fill = level === 'ok' ? colors.textMuted : levelColor[level];
    return (
      <View style={[s.track, { height: 1 }]} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(w) }}>
        <View style={{ width: `${w}%`, height: 1, backgroundColor: fill }} />
      </View>
    );
  }
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

export const s = themed(() => (isOdyssey() ? odysseyStyles() : classicStyles()));

function classicStyles() {
  return StyleSheet.create({
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
  axisLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.line },
  });
}

/** Odyssey: haarlijnen, kleine dunne letters in hoofdletters, geen vullingen behalve waar het moet. */
function odysseyStyles() {
  const base = classicStyles();
  return StyleSheet.create({
    ...base,
    card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg },
    pressed: { opacity: 0.8 },
    section: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xl, marginBottom: space.md },
    sectionText: { letterSpacing: 1.8, textAlign: 'center' },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2, alignSelf: 'flex-start' },
    pillCompact: {},
    pillText: { fontFamily: fonts.body, fontSize: 9.5, letterSpacing: 1.7, textTransform: 'uppercase' },
    btn: { minHeight: 44, borderRadius: radius.md, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
    btnText: { fontFamily: fonts.body, fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase' },
    chip: {
      minHeight: 32, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
      backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center',
    },
    chipActive: { backgroundColor: colors.purpleSoft, borderColor: colors.lineStrong },
    chipText: { fontFamily: fonts.body, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.textMuted },
    chipCount: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted },
    seg: { flexDirection: 'row', backgroundColor: 'transparent', borderRadius: radius.md, padding: 2, borderWidth: 1, borderColor: colors.lineStrong },
    segItem: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
    segItemActive: { backgroundColor: getTheme() === 'light' ? 'rgba(11,11,18,0.09)' : 'rgba(242,242,240,0.09)' },
    segText: { fontFamily: fonts.body, fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.textMuted },
    track: { backgroundColor: colors.line, overflow: 'hidden', width: '100%' },
  });
}
