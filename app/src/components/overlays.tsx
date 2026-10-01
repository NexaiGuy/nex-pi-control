// Bottom sheet, bevestiging (met 2 s vasthouden voor gevaarlijke acties), toasts, skeletons en foutstaten.
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withRepeat, withSpring, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { ApiError } from '@/api/client';
import { locale, t } from '@/i18n';
import { createStore, useStore } from '@/state/store';
import { colors, fonts, radius, space, themed, touch } from '@/theme/tokens';

import { Button, Icon, T, type IconName } from './primitives';

// ---------- Sheet ----------------------------------------------------------------------

export function Sheet({ visible, onClose, title, children, scroll = true }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode; scroll?: boolean }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const y = useSharedValue(height);
  const [mounted, setMounted] = useState(visible);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  if (visible && !mounted) setMounted(true);

  useEffect(() => {
    if (visible) {
      y.set(height);
      y.set(withSpring(0, { damping: 22, stiffness: 220, mass: 0.9 }));
    } else {
      y.set(
        withTiming(height, { duration: 200, easing: Easing.in(Easing.cubic) }, (done) => {
          if (done) runOnJS(setMounted)(false);
        }),
      );
    }
  }, [visible, height, y]);

  // PanResponder-callbacks lopen enkel bij aanraking, nooit tijdens de render; closeRef lezen is daar veilig.
  /* eslint-disable react-hooks/refs */
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => g.dy > 8 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_e, g) => {
          y.set(Math.max(0, g.dy));
        },
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 120 || g.vy > 1.2) closeRef.current();
          else y.set(withSpring(0, { damping: 22, stiffness: 220 }));
        },
      }),
    [y],
  );
  /* eslint-enable react-hooks/refs */

  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const backdrop = useAnimatedStyle(() => ({ opacity: 1 - Math.min(1, y.get() / 400) }));

  if (!mounted) return null;
  const Body = scroll ? ScrollView : View;
  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} animationType="none">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={t.common.close} />
      </Animated.View>
      <Animated.View style={[ov.sheet, { maxHeight: height * 0.9, paddingBottom: insets.bottom + space.lg }, style]} accessibilityViewIsModal>
        <View {...pan.panHandlers} style={ov.handleZone}>
          <View style={ov.handle} />
          {title ? (
            <T v="h2" style={{ marginTop: space.sm }} accessibilityRole="header">
              {title}
            </T>
          ) : null}
        </View>
        <Body {...(scroll ? { contentContainerStyle: { paddingHorizontal: space.lg, paddingBottom: space.lg }, keyboardShouldPersistTaps: 'handled' as const } : { style: { paddingHorizontal: space.lg } })}>
          {children}
        </Body>
      </Animated.View>
    </Modal>
  );
}

// ---------- Hold-to-confirm --------------------------------------------------------------

const ACircle = Animated.createAnimatedComponent(Circle);

export function HoldButton({ label, onConfirm, danger = true, holdMs = 2000, disabled }: { label: string; onConfirm: () => void; danger?: boolean; holdMs?: number; disabled?: boolean }) {
  const p = useSharedValue(0);
  const fired = useRef(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const R = 14;
  const C = 2 * Math.PI * R;
  const ring = useAnimatedProps(() => ({ strokeDashoffset: C * (1 - p.get()) }));
  const fill = useAnimatedStyle(() => ({ width: `${p.get() * 100}%` }));

  const done = () => {
    if (fired.current) return;
    fired.current = true;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirm();
  };
  const start = () => {
    if (disabled) return;
    fired.current = false;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    tick.current = setInterval(() => void Haptics.selectionAsync(), 400);
    p.set(
      withTiming(1, { duration: holdMs, easing: Easing.linear }, (finished) => {
        if (finished) runOnJS(done)();
      }),
    );
  };
  const stop = () => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    if (!fired.current) {
      cancelAnimation(p);
      p.set(withTiming(0, { duration: 180 }));
    }
  };
  useEffect(() => () => {
    if (tick.current) clearInterval(tick.current);
  }, []);

  const color = danger ? colors.red : colors.purple;
  return (
    <Pressable
      onPressIn={start}
      onPressOut={stop}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${t.common.holdToConfirm}`}
      accessibilityHint={t.common.holdToConfirm}
      style={[ov.hold, { borderColor: color, opacity: disabled ? 0.5 : 1 }]}
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: danger ? colors.redSoft : colors.purpleSoft }, fill]} />
      <Svg width={34} height={34}>
        <Circle cx={17} cy={17} r={R} stroke={colors.surface3} strokeWidth={3} fill="none" />
        <ACircle cx={17} cy={17} r={R} stroke={color} strokeWidth={3} fill="none" strokeDasharray={`${C} ${C}`} animatedProps={ring} strokeLinecap="round" transform="rotate(-90 17 17)" />
      </Svg>
      <View>
        <Text style={[ov.holdText, { color }]}>{label}</Text>
        <Text style={ov.holdHint}>{t.common.holdToConfirm}</Text>
      </View>
    </Pressable>
  );
}

// ---------- Bevestiging -----------------------------------------------------------------

export interface ConfirmSpec {
  title: string;
  effect: string;
  confirmLabel: string;
  dangerous?: boolean;
  icon?: IconName;
  onConfirm: () => void;
}

export function ConfirmSheet({ spec, onClose }: { spec: ConfirmSpec | null; onClose: () => void }) {
  return (
    <Sheet visible={!!spec} onClose={onClose} title={spec?.title}>
      {spec ? (
        <View style={{ gap: space.lg, paddingTop: space.sm }}>
          <View style={[ov.effect, spec.dangerous && { borderColor: colors.red, backgroundColor: colors.redSoft }]}>
            <Icon name={spec.icon ?? (spec.dangerous ? 'alert-octagon' : 'info')} size={18} color={spec.dangerous ? colors.red : colors.purple} />
            <T style={{ flex: 1 }}>{spec.effect}</T>
          </View>
          {spec.dangerous ? (
            <HoldButton
              label={spec.confirmLabel}
              onConfirm={() => {
                onClose();
                spec.onConfirm();
              }}
            />
          ) : (
            <Button
              label={spec.confirmLabel}
              icon={spec.icon}
              onPress={() => {
                onClose();
                spec.onConfirm();
              }}
            />
          )}
          <Button label={t.common.cancel} kind="secondary" onPress={onClose} />
        </View>
      ) : null}
    </Sheet>
  );
}

export function PromptSheet({ visible, title, initial = '', placeholder, confirmLabel, onSubmit, onClose }: { visible: boolean; title: string; initial?: string; placeholder?: string; confirmLabel: string; onSubmit: (v: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(initial);
  const [seen, setSeen] = useState({ initial, visible });
  if (seen.initial !== initial || seen.visible !== visible) {
    setSeen({ initial, visible });
    setValue(initial);
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <View style={{ gap: space.md, paddingTop: space.sm }}>
        <TextInput
          value={value}
          onChangeText={setValue}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          style={ov.input}
          accessibilityLabel={title}
        />
        <Button label={confirmLabel} disabled={!value.trim()} onPress={() => onSubmit(value.trim())} />
      </View>
    </Sheet>
  );
}

// ---------- Toasts ------------------------------------------------------------------------

type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string };
const toastStore = createStore<Toast[]>([]);
let toastId = 0;

export const toast = {
  show(kind: Toast['kind'], text: string, ms = 3200) {
    const id = ++toastId;
    toastStore.set((l) => [...l.slice(-2), { id, kind, text }]);
    void Haptics.notificationAsync(kind === 'error' ? Haptics.NotificationFeedbackType.Error : Haptics.NotificationFeedbackType.Success);
    setTimeout(() => toastStore.set((l) => l.filter((x) => x.id !== id)), ms);
  },
  success: (text: string) => toast.show('success', text),
  error: (text: string) => toast.show('error', text, 5000),
  info: (text: string) => toast.show('info', text),
};

export function ToastHost() {
  const items = useStore(toastStore);
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" style={[ov.toastWrap, { bottom: insets.bottom + 84 }]}>
      {items.map((it) => (
        <ToastItem key={it.id} item={it} />
      ))}
    </View>
  );
}

function ToastItem({ item }: { item: Toast }) {
  const y = useSharedValue(30);
  const o = useSharedValue(0);
  useEffect(() => {
    y.set(withSpring(0, { damping: 18 }));
    o.set(withTiming(1, { duration: 160 }));
  }, [o, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }], opacity: o.get() }));
  const color = item.kind === 'success' ? colors.mint : item.kind === 'error' ? colors.red : colors.purple;
  const icon: IconName = item.kind === 'success' ? 'check-circle' : item.kind === 'error' ? 'x-octagon' : 'info';
  return (
    <Animated.View style={[ov.toast, { borderColor: color }, style]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Icon name={icon} size={18} color={color} />
      <Text style={ov.toastText}>{item.text}</Text>
    </Animated.View>
  );
}

// ---------- Skeletons en staten ----------------------------------------------------------------

export function Skeleton({ height = 16, width = '100%', radius: r = 8, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: object }) {
  const o = useSharedValue(0.4);
  useEffect(() => {
    o.set(withRepeat(withTiming(0.9, { duration: 800, easing: Easing.inOut(Easing.quad) }), -1, true));
  }, [o]);
  const a = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[{ height, width, borderRadius: r, backgroundColor: colors.surface3 }, a, style]} accessibilityLabel={t.common.loading} />;
}

export function SkeletonList({ rows = 6 }: { rows?: number }) {
  return (
    <View style={{ gap: space.md }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={ov.skelRow}>
          <Skeleton height={10} width={10} radius={5} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton height={14} width="60%" />
            <Skeleton height={10} width="35%" />
          </View>
          <Skeleton height={14} width={48} />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({ icon = 'inbox', title, body }: { icon?: IconName; title: string; body?: string }) {
  return (
    <View style={ov.empty}>
      <View style={ov.emptyIcon}>
        <Icon name={icon} size={24} color={colors.textMuted} />
      </View>
      <T v="h3" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {body ? (
        <T v="bodyMuted" style={{ textAlign: 'center' }}>
          {body}
        </T>
      ) : null}
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const icon: IconName =
    e?.kind === 'offline' || e?.kind === 'timeout' ? 'wifi-off' : e?.kind === 'unauthorized' || e?.kind === 'access_denied' || e?.kind === 'forbidden' ? 'lock' : 'alert-triangle';
  return (
    <View style={ov.empty} accessibilityRole="alert">
      <View style={[ov.emptyIcon, { backgroundColor: colors.redSoft }]}>
        <Icon name={icon} size={24} color={colors.red} />
      </View>
      <T v="h3" style={{ textAlign: 'center' }}>
        {e?.message ?? t.errors.generic}
      </T>
      {onRetry ? <Button label={t.common.retry} icon="refresh-cw" kind="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

// ---------- Zoekveld en logviewer ---------------------------------------------------------------

export function SearchField({ value, onChange, placeholder = t.common.search }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <View style={ov.search}>
      <Icon name="search" size={16} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={ov.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={placeholder}
      />
      {value ? (
        <Pressable onPress={() => onChange('')} accessibilityLabel={t.common.clear} hitSlop={10}>
          <Icon name="x" size={16} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const LEVEL_COLORS: Record<string, string> = themed(() => ({
  emerg: colors.red, alert: colors.red, crit: colors.red, err: colors.red, warning: colors.amber, notice: colors.blue, info: colors.textMuted, debug: colors.textFaint,
}));

export function LogView({ lines }: { lines: { ts?: number; level?: string; message: string }[] }) {
  return (
    <View style={ov.log}>
      {lines.map((l, i) => (
        <Text key={i} style={ov.logLine} selectable>
          {l.ts ? <Text style={{ color: colors.textFaint }}>{new Date(l.ts * 1000).toLocaleTimeString(locale)} </Text> : null}
          {l.level ? <Text style={{ color: LEVEL_COLORS[l.level] ?? colors.textMuted }}>{l.level.toUpperCase().padEnd(7)} </Text> : null}
          <Text style={{ color: l.level && ['err', 'crit', 'alert', 'emerg'].includes(l.level) ? colors.red : colors.text }}>{l.message}</Text>
        </Text>
      ))}
    </View>
  );
}

const ov = themed(() => StyleSheet.create({
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl, borderWidth: 1, borderColor: colors.line,
  },
  handleZone: { alignItems: 'center', paddingTop: space.sm, paddingBottom: space.md, paddingHorizontal: space.lg },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong },
  effect: { flexDirection: 'row', gap: space.md, padding: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface2 },
  hold: {
    minHeight: 60, borderRadius: radius.md, borderWidth: 1.5, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, overflow: 'hidden',
  },
  holdText: { fontFamily: fonts.headingMedium, fontSize: 16 },
  holdHint: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted },
  input: {
    minHeight: touch, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface2,
    paddingHorizontal: space.md, color: colors.text, fontFamily: fonts.mono, fontSize: 14,
  },
  toastWrap: { position: 'absolute', left: space.lg, right: space.lg, gap: space.sm },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface2, borderWidth: 1, borderRadius: radius.md,
    paddingHorizontal: space.lg, paddingVertical: space.md,
  },
  toastText: { color: colors.text, fontFamily: fonts.bodyMedium, fontSize: 14, flex: 1 },
  skelRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxxl, paddingHorizontal: space.xl },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: space.md,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 15, paddingVertical: 0 },
  log: { backgroundColor: colors.codeBg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space.md, gap: 2 },
  logLine: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 16 },
}));
