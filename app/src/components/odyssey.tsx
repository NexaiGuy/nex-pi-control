// Odyssey-design: de bouwstenen die het klassieke design niet heeft.
// - OdysseyAmbient: één gedeelde klok voor de spectrale lichtstroom en de aberratie, plus scanlijnen over het scherm.
// - SlabDeco: de versiering van elke monoliet (kaart): lichtstroom langs de rand, rood/cyaan randje, klokwijze gloed.
// - GlowRing: de gloed die klokwijs rond een kaart met een probleem loopt (react-native-svg + Reanimated).
// - PresenceEye, EyeCorridor: het rode oog op de centrale as en de perspectieflijnen ernaartoe.
// - LineIcon, Marker, AxisRule: dunne iconen (1 px), ruitvormige statusmarkering, haarlijn met spectraal middenstuk.
// Alles stopt bij "beweging verminderen": dan blijven enkel statische haarlijnen over.
import { createContext, memo, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, cancelAnimation, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import { linkStore } from '@/api/hooks';
import { useStore } from '@/state/store';
import { colors, easing, getTheme, glow, type Level, motion, odysseyOpacity, roundedRectPerimeter } from '@/theme/tokens';

const AXIS = Easing.bezier(easing.axis[0], easing.axis[1], easing.axis[2], easing.axis[3]);

// ---------- Gedeelde klok -------------------------------------------------------------------------

interface Clock {
  /** 0..1, één doorloop van de lichtstroom van boven naar onder (dur-spectral). */
  stream: SharedValue<number>;
  /** 0..1, één drift van de aberratie (dur-aberration). */
  ab: SharedValue<number>;
  /** 0..1, zichtbaarheid van de stroom (dooft uit als de verbinding wegvalt). */
  on: SharedValue<number>;
}

const ClockCtx = createContext<Clock | null>(null);

/**
 * Zet de klok aan voor alle kaarten eronder en tekent de scanlijnen. Eén keer in de root-layout, enkel in Odyssey.
 */
export function OdysseyAmbient({ children }: { children: ReactNode }) {
  const stream = useSharedValue(0);
  const ab = useSharedValue(0);
  const on = useSharedValue(1);
  const reduced = useReducedMotion();
  const link = useStore(linkStore);
  const offline = !!link.error && (link.error.kind === 'offline' || link.error.kind === 'timeout');

  useEffect(() => {
    if (reduced) return undefined;
    stream.set(0);
    ab.set(0);
    stream.set(withRepeat(withTiming(1, { duration: motion.spectral, easing: Easing.linear }), -1, false));
    ab.set(withRepeat(withTiming(1, { duration: motion.aberration, easing: Easing.linear }), -1, false));
    return () => {
      cancelAnimation(stream);
      cancelAnimation(ab);
    };
  }, [reduced, stream, ab]);

  useEffect(() => {
    // Verbinding weg: de stroom dooft uit over 1,2 s en blijft uit. Terug: hij komt weer op.
    on.set(withTiming(offline ? 0 : 1, { duration: 1200, easing: AXIS }));
  }, [offline, on]);

  return (
    <ClockCtx.Provider value={reduced ? null : { stream, ab, on }}>
      <View style={{ flex: 1 }}>
        {children}
        <Scanlines />
      </View>
    </ClockCtx.Provider>
  );
}

/** Heel zwakke scanlijnen over het hele scherm (op-scanline). Vangt geen aanrakingen op. */
function Scanlines() {
  const id = `scan${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} x="0" y="0" width="4" height="3" patternUnits="userSpaceOnUse">
            <Rect x="0" y="0" width="4" height="1" fill={colors.scanline} />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} opacity={odysseyOpacity.scanline} />
      </Svg>
    </View>
  );
}

// ---------- Schermfocus ---------------------------------------------------------------------------

/**
 * Tabs en gestapelde schermen blijven gemount als je verder navigeert. Zonder dit zouden hun lichtstroom en gloed
 * onzichtbaar blijven doorlopen. Screen en DetailScreen zetten dit één keer per scherm; buiten een scherm: altijd aan.
 */
const ScreenFocusCtx = createContext(true);

export function ScreenFocus({ focused, children }: { focused: boolean; children: ReactNode }) {
  return <ScreenFocusCtx.Provider value={focused}>{children}</ScreenFocusCtx.Provider>;
}

/** Is het scherm waarin dit component staat nu in beeld? */
export function useScreenInView(): boolean {
  return useContext(ScreenFocusCtx);
}

// ---------- Kaartversiering -----------------------------------------------------------------------

const BAND = 180; // hoogte van de lichtband in px

type Severity = 'ok' | 'warning' | 'critical';

export function toSeverity(level?: Level | null): Severity {
  return level === 'warning' || level === 'critical' ? level : 'ok';
}

/**
 * Versiering van een monoliet. Leg hem als laatste kind in een kaart met een rand van 1 px.
 * Licht gehouden: per kaart één geanimeerde stijl (de band), een statisch rood/cyaan randje, en enkel bij een
 * probleem de gloed. Alles staat stil zodra het scherm niet in beeld is.
 */
function SlabDecoImpl({ radius, severity = 'ok', border = 1 }: { radius: number; severity?: Severity; border?: number }) {
  const clock = useContext(ClockCtx);
  const focused = useContext(ScreenFocusCtx);
  const reduced = useReducedMotion();
  const [size, setSize] = useState({ w: 0, h: 0 });
  const ref = useRef<View>(null);
  const pageY = useSharedValue(0);
  const { height: screenH } = useWindowDimensions();

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
    // Eén meting bij de layout volstaat: de band is sfeer, geen meetlat. Geen timers per kaart.
    ref.current?.measureInWindow((_x, y) => {
      if (Number.isFinite(y)) pageY.set(y);
    });
  };

  const offset = -border;
  const issue = severity !== 'ok';
  const live = !!clock && focused && size.w > 0;
  return (
    <View
      ref={ref}
      pointerEvents="none"
      onLayout={onLayout}
      style={{ position: 'absolute', left: offset, top: offset, right: offset, bottom: offset }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {clock ? <Fringe radius={radius} /> : null}
      {live ? <Stream clock={clock} radius={radius} w={size.w} h={size.h} pageY={pageY} screenH={screenH} /> : null}
      {issue && size.w > 0 ? <GlowRing severity={severity} radius={radius} w={size.w} h={size.h} reduced={reduced || !focused} /> : null}
    </View>
  );
}

/** Chromatische aberratie: een vast rood en cyaan randje van een halve pixel. Statisch, dus gratis. */
function FringeImpl({ radius }: { radius: number }) {
  const base = { position: 'absolute' as const, top: 0, bottom: 0, left: 0, right: 0, borderRadius: radius, borderWidth: StyleSheet.hairlineWidth };
  return (
    <>
      <View style={[base, { borderColor: colors.abRed, transform: [{ translateX: -0.5 }] }]} />
      <View style={[base, { borderColor: colors.abCyan, transform: [{ translateX: 0.5 }] }]} />
    </>
  );
}

function StreamImpl({ clock, radius, w, h, pageY, screenH }: { clock: Clock; radius: number; w: number; h: number; pageY: SharedValue<number>; screenH: number }) {
  const id = `sv${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const peak = getTheme() === 'light' ? odysseyOpacity.spectralLight : odysseyOpacity.spectral;
  const span = screenH + BAND * 2;

  // Eén worklet per kaart: de band schuift naar beneden en dooft uit als de verbinding wegvalt.
  const band = useAnimatedStyle(() => {
    const head = clock.stream.get() * span - BAND; // kop van de band in venstercoördinaten
    return { opacity: peak * clock.on.get(), transform: [{ translateY: head - pageY.get() - BAND }] };
  });

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, width: w, height: h, borderRadius: radius, overflow: 'hidden' }}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: w, height: BAND }, band]}>
        <Svg width={w} height={BAND}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.neonA} stopOpacity={0} />
              <Stop offset="0.2" stopColor={colors.neonA} />
              <Stop offset="0.45" stopColor={colors.neonB} />
              <Stop offset="0.7" stopColor={colors.neonC} />
              <Stop offset="0.88" stopColor={colors.neonD} />
              <Stop offset="1" stopColor={colors.neonD} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="1" height={BAND} fill={`url(#${id})`} />
          <Rect x={w - 1} y="0" width="1" height={BAND} fill={`url(#${id})`} />
        </Svg>
      </Animated.View>
    </View>
  );
}

// ---------- Klokwijze gloed (3D, cyberpunk) ----------------------------------------------------------

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const PAD = 14; // ruimte voor bloei, schaduw en de buitenste cyaanlijn

type LayerSpec = {
  /** Kleur van deze laag. */
  color: string;
  /** Lengte van het streepje als deel van de omtrek. */
  share: number;
  opacity: number;
  width: number;
  /** Positief = naar binnen, negatief = naar buiten (px). Geeft de chromatische split en diepte. */
  inset?: number;
  /** Kop van deze laag loopt zoveel (deel van de omtrek) voor (+) of achter (-) op de hoofdkop. */
  lead?: number;
  dx?: number;
  dy?: number;
};

type LayerProps = LayerSpec & { progress: SharedValue<number>; w: number; h: number; r: number };

function GlowLayer({ progress, w, h, r, color, share, opacity, width, inset = 0, lead = 0, dx = 0, dy = 0 }: LayerProps) {
  const lw = w - 1 - inset * 2;
  const lh = h - 1 - inset * 2;
  const lr = Math.max(0, r - inset);
  const perimeter = roundedRectPerimeter(lw, lh, lr);
  const start = lw / 2 - lr; // het rect-pad start na de hoek linksboven; boven midden ligt hier
  const len = share * perimeter;
  const animatedProps = useAnimatedProps(() => ({
    // De kop staat op start + (progress + lead) * P; het streepje beslaat [kop - len, kop]. Positief = klokwijs.
    strokeDashoffset: -(start + (progress.get() + lead) * perimeter - len),
  }));
  if (lw <= 0 || lh <= 0) return null;
  return (
    <AnimatedRect
      x={PAD + 0.5 + inset + dx} y={PAD + 0.5 + inset + dy} width={lw} height={lh} rx={lr} ry={lr} fill="none"
      stroke={color} strokeOpacity={opacity} strokeWidth={width} strokeLinecap="round" strokeDasharray={[len, perimeter - len]}
      animatedProps={animatedProps}
    />
  );
}

/**
 * De lagen van de gloed, van achter naar voor:
 * schaduw (diepte) > bloei in de statuskleur > violette staart > magenta binnenlijn (loopt achter) >
 * cyaan buitenlijn (loopt voor) > kern in de statuskleur > witte glanslijn > witheet kopje.
 * Zo leest de gloed als een 3D-lichtbuis met chromatische split, en blijft de status (amber of rood) herkenbaar.
 */
export function glowLayers(severity: 'warning' | 'critical', theme: 'dark' | 'light'): LayerSpec[] {
  const sev = severity === 'critical' ? colors.critGlow : colors.warnGlow;
  const light = theme === 'light';
  // Bloei als een benaderde gaussiaanse vervaging: één brede zwakke laag onder een smallere sterkere.
  // Bewust beperkt tot 10 lagen: elke laag is een SVG-prop die elke frame wordt bijgewerkt.
  const bloom: [number, number][] = severity === 'critical' ? [[14, 0.08], [6, 0.24]] : [[10, 0.07], [4, 0.2]];
  return [
    { color: '#000000', share: 0.22, opacity: light ? 0.18 : 0.6, width: 4, dx: 1.5, dy: 2 },
    ...bloom.map(([width, opacity]) => ({ color: sev, share: 0.21, opacity: light ? opacity * 0.8 : opacity, width })),
    { color: colors.neonA, share: 0.36, opacity: 0.5, width: 1.2, lead: -0.03 },
    { color: colors.neonB, share: 0.2, opacity: 0.8, width: 1, inset: 1.25, lead: -0.015 },
    { color: colors.neonC, share: 0.16, opacity: 0.9, width: 1, inset: -1.25, lead: 0.01 },
    { color: sev, share: 0.17, opacity: 0.45, width: 1.6 },
    { color: sev, share: 0.06, opacity: 1, width: 1.6 },
    { color: '#FFFFFF', share: 0.1, opacity: light ? 0.85 : 0.55, width: 0.8 },
    { color: light ? '#FFFFFF' : colors.eyeHot, share: 0.02, opacity: 1, width: 2.2 },
  ];
}

/**
 * Een heldere kop (ongeveer 20 % van de omtrek, met zachte staart) die klokwijs rond de volledige rand loopt,
 * vanaf boven midden. Waarschuwing: amber, 4 s per toer. Kritiek: rood, 2,2 s per toer, met bredere bloei.
 * Met "beweging verminderen" wordt de rand statisch amber of rood.
 */
function GlowRingImpl({ severity, radius, w, h, reduced }: { severity: 'warning' | 'critical'; radius: number; w: number; h: number; reduced: boolean }) {
  const progress = useSharedValue(0);
  const spec = severity === 'critical' ? glow.critical : glow.warning;
  const animate = !reduced && w > 0;

  useEffect(() => {
    cancelAnimation(progress);
    progress.set(0);
    if (animate) progress.set(withRepeat(withTiming(1, { duration: spec.periodMs, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(progress);
  }, [animate, spec.periodMs, progress]);

  const r = Math.max(0, radius - 0.5);
  const staticStroke = reduced ? (severity === 'critical' ? colors.red : colors.amber) : colors.line;
  const layers = glowLayers(severity, getTheme());

  return (
    <Svg pointerEvents="none" width={w + PAD * 2} height={h + PAD * 2} style={{ position: 'absolute', left: -PAD, top: -PAD }}>
      <Rect x={PAD + 0.5} y={PAD + 0.5} width={w - 1} height={h - 1} rx={r} ry={r} fill="none" stroke={staticStroke} strokeWidth={1} />
      {animate ? layers.map((l, i) => <GlowLayer key={i} progress={progress} w={w} h={h} r={r} {...l} />) : null}
    </Svg>
  );
}

// ---------- Het oog -------------------------------------------------------------------------------

export type EyeState = 'on' | 'wait' | 'drop' | 'off';

/** Toestand van het oog uit de verbinding: aanwezig, verbinden, net weggevallen of offline. */
export function useEyeState(): EyeState {
  const link = useStore(linkStore);
  const [wasOn, setWasOn] = useState(false);
  const offline = !!link.error && (link.error.kind === 'offline' || link.error.kind === 'timeout');
  const base: EyeState = offline ? 'off' : !link.lastOkAt ? 'wait' : 'on';
  // Bijhouden of de agent er net nog was: dan is offline een "drop" (één flikkering), anders gewoon "off".
  if (base === 'on' && !wasOn) setWasOn(true);
  if (base === 'wait' && wasOn) setWasOn(false);
  return base === 'off' && wasOn ? 'drop' : base;
}

/**
 * Het observerende oog: een rode lens, een radiale gradiënt en verder niets. Ademt traag zolang de agent er is,
 * flikkert één keer als de verbinding wegvalt en rust daarna gedimd.
 */
export function PresenceEye({ state, size = 44, label }: { state: EyeState; size?: number; label?: string }) {
  const id = `eye${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const op = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(scale);
    cancelAnimation(op);
    if (state === 'on') {
      if (reduced) {
        scale.set(1);
        op.set(1);
      } else {
        scale.set(0.9);
        op.set(0.72);
        const half = motion.eyeBreath / 2;
        scale.set(withRepeat(withTiming(1, { duration: half, easing: AXIS }), -1, true));
        op.set(withRepeat(withTiming(1, { duration: half, easing: AXIS }), -1, true));
      }
    } else if (state === 'wait') {
      scale.set(1);
      op.set(0.5);
    } else if (state === 'drop' && !reduced) {
      scale.set(1);
      const step = motion.eyeFlicker / 6;
      op.set(
        withSequence(
          withTiming(1, { duration: step }), withTiming(0.15, { duration: step }), withTiming(0.85, { duration: step }),
          withTiming(0.1, { duration: step }), withTiming(0.55, { duration: step }), withTiming(odysseyOpacity.eyeOffline, { duration: step }),
        ),
      );
    } else {
      scale.set(1);
      op.set(odysseyOpacity.eyeOffline);
    }
  }, [state, reduced, scale, op]);

  const style = useAnimatedStyle(() => ({ opacity: op.get(), transform: [{ scale: scale.get() }] }));
  const r = size / 2;
  return (
    <Animated.View
      style={[{ width: size, height: size }, style]}
      accessibilityRole="image"
      accessibilityLabel={label ?? `Agent ${state === 'on' ? 'aanwezig' : state === 'wait' ? 'verbinden' : 'offline'}`}
    >
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.eyeHot} />
            <Stop offset="0.2" stopColor={colors.eye} />
            <Stop offset="0.4" stopColor={colors.eye} stopOpacity={0.45} />
            <Stop offset="0.66" stopColor={colors.eye} stopOpacity={0.12} />
            <Stop offset="1" stopColor={colors.eye} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={r} cy={r} r={r} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * De gang: een paar haarlijnen die in één punt samenkomen, het oog. Zo leest het dashboard als één-punts-perspectief.
 */
export function EyeCorridor({ height = 96, children }: { height?: number; children?: ReactNode }) {
  const [w, setW] = useState(0);
  const cx = w / 2;
  const cy = height / 2;
  const from: [number, number][] = [
    [0, 0], [0, height], [w, 0], [w, height], [w * 0.22, height], [w * 0.78, height], [w * 0.22, 0], [w * 0.78, 0],
  ];
  return (
    <View style={{ height, alignItems: 'center', justifyContent: 'center' }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg pointerEvents="none" width={w} height={height} style={StyleSheet.absoluteFill}>
          {from.map(([x, y], i) => (
            <Line key={i} x1={x} y1={y} x2={cx} y2={cy} stroke={colors.lineStrong} strokeWidth={0.5} strokeOpacity={0.7} />
          ))}
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

// ---------- Iconen, markering, aslijn ---------------------------------------------------------------

function gearPath(): string {
  const cx = 12, cy = 12, rO = 9, rI = 7, teeth = 8;
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    const w = (Math.PI * 2) / teeth;
    const pts: [number, number][] = [[rI, a0 - w * 0.5], [rI, a0 - w * 0.22], [rO, a0 - w * 0.16], [rO, a0 + w * 0.16], [rI, a0 + w * 0.22]];
    pts.forEach(([rad, ang], j) => {
      d += `${i === 0 && j === 0 ? 'M' : 'L'}${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)} `;
    });
  }
  return `${d}Z`;
}

type Shape = { c: [number, number, number] } | { r: [number, number, number, number, number] } | { p: string };

const LINE_ICONS = {
  dash: [{ c: [12, 12, 8.5] }, { c: [12, 12, 2.2] }],
  containers: [{ r: [4.5, 4.5, 15, 4.2, 0.6] }, { r: [4.5, 9.9, 15, 4.2, 0.6] }, { r: [4.5, 15.3, 15, 4.2, 0.6] }],
  events: [{ p: 'M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.3 1.6H5.2z' }, { p: 'M10.2 20.3h3.6' }],
  updates: [{ c: [12, 12, 8.5] }, { p: 'M12 16.2V7.8M8.6 11.2L12 7.8l3.4 3.4' }],
  terminal: [{ r: [3.5, 5, 17, 14, 0.8] }, { p: 'M7.2 10l2.8 2-2.8 2M12.4 14.6h4.2' }],
  gear: [{ p: gearPath() }, { c: [12, 12, 2.8] }],
  chevron: [{ p: 'M8 10l4 4 4-4' }],
  back: [{ p: 'M14.5 6l-6 6 6 6' }],
  sync: [{ p: 'M18.6 13.6A6.8 6.8 0 1 1 16.9 7' }, { p: 'M17.2 3.8v3.6h-3.6' }],
  server: [{ r: [4.5, 5, 15, 6, 0.6] }, { r: [4.5, 13, 15, 6, 0.6] }, { p: 'M7.5 8h.01M7.5 16h.01' }],
  signal: [{ p: 'M5 18v-2M9 18v-5M13 18v-8M17 18V7' }],
  grid: [{ r: [4.5, 4.5, 6.2, 6.2, 0.6] }, { r: [13.3, 4.5, 6.2, 6.2, 0.6] }, { r: [4.5, 13.3, 6.2, 6.2, 0.6] }, { r: [13.3, 13.3, 6.2, 6.2, 0.6] }],
  log: [{ p: 'M6 6h12M6 10h12M6 14h8M6 18h5' }],
} satisfies Record<string, Shape[]>;

export type LineIconName = keyof typeof LINE_ICONS;

/** Dunne lijniconen op een raster van 24, 1 px lijn, ronde uiteinden, geen vullingen. */
export function LineIcon({ name, size = 22, color = colors.text }: { name: LineIconName; size?: number; color?: string }) {
  const shapes: Shape[] = LINE_ICONS[name];
  const common = { fill: 'none', stroke: color, strokeWidth: 1, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, vectorEffect: 'non-scaling-stroke' as const };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {shapes.map((s, i) =>
        'c' in s ? <Circle key={i} cx={s.c[0]} cy={s.c[1]} r={s.c[2]} {...common} />
          : 'r' in s ? <Rect key={i} x={s.r[0]} y={s.r[1]} width={s.r[2]} height={s.r[3]} rx={s.r[4]} {...common} />
            : <Path key={i} d={s.p} {...common} />,
      )}
    </Svg>
  );
}

/** Ruitje van 5 px: de statusmarkering van Odyssey. Hol voor offline of onbekend. */
export function Marker({ level, size = 5 }: { level: Level | 'offline'; size?: number }) {
  const hollow = level === 'offline' || level === 'unknown';
  const color = level === 'offline' ? colors.textMuted : level === 'ok' ? colors.mint : level === 'warning' ? colors.amber : level === 'critical' ? colors.red : level === 'info' ? colors.purple : colors.textMuted;
  return (
    <View
      style={{
        width: size, height: size, transform: [{ rotate: '45deg' }],
        backgroundColor: hollow ? 'transparent' : color, borderWidth: hollow ? 1 : 0, borderColor: color,
      }}
    />
  );
}

/** Haarlijn over de volle breedte met een kort spectraal stuk op de as. Onder de header, in plaats van de neonlijn. */
export function AxisRule({ style }: { style?: StyleProp<ViewStyle> }) {
  const id = `ax${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <View style={[{ height: 1, alignSelf: 'stretch', justifyContent: 'center', alignItems: 'center' }, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={{ position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.line }} />
      <Svg width={24} height={1}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.neonA} />
            <Stop offset="0.35" stopColor={colors.neonB} />
            <Stop offset="0.65" stopColor={colors.neonC} />
            <Stop offset="1" stopColor={colors.neonD} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="24" height="1" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

// Gememoïseerd: de kaarten herrenderen bij elke verversing (om de 5 s); de versiering hoeft dat niet.
export const SlabDeco = memo(SlabDecoImpl);
export const GlowRing = memo(GlowRingImpl);
const Stream = memo(StreamImpl);
const Fringe = memo(FringeImpl);
