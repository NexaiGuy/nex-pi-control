// Grafieken met react-native-svg: sparkline, interactieve lijngrafiek met crosshair, en een status-ring.
import { locale, t } from '@/i18n';
import { useId, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import type { Point } from '@/api/types';
import { unitValue } from '@/lib/format';
import { colors, fonts, themed } from '@/theme/tokens';

type XY = { x: number; y: number };

function linePath(pts: XY[]): string {
  if (!pts.length) return '';
  // Monotone cubic smoothing: rustiger dan rechte lijnen, geen overshoot.
  let d = `M${pts[0]!.x.toFixed(1)},${pts[0]!.y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const mx = (p0.x + p1.x) / 2;
    d += ` C${mx.toFixed(1)},${p0.y.toFixed(1)} ${mx.toFixed(1)},${p1.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }
  return d;
}

export function Sparkline({ values, width = 120, height = 32, color = colors.purple, fill = true }: { values: number[]; width?: number; height?: number; color?: string; fill?: boolean }) {
  const d = useMemo(() => {
    if (values.length < 2) return { line: '', area: '' };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = values.map((v, i) => ({ x: (i / (values.length - 1)) * width, y: height - 2 - ((v - min) / span) * (height - 4) }));
    const line = linePath(pts);
    return { line, area: `${line} L${width},${height} L0,${height} Z` };
  }, [values, width, height]);
  const id = `sg${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.35} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {fill && d.area ? <Path d={d.area} fill={`url(#${id})`} /> : null}
      {d.line ? <Path d={d.line} stroke={color} strokeWidth={1.8} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
    </Svg>
  );
}

export function CoreBars({ values, height = 28 }: { values: number[]; height?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 4, height }} accessibilityLabel={t.stats.perCoreA11y(values.map((v) => Math.round(v)).join(', '))}>
      {values.map((v, i) => (
        <View key={i} style={{ flex: 1, height, backgroundColor: colors.surface3, borderRadius: 3, justifyContent: 'flex-end', overflow: 'hidden' }}>
          <View style={{ height: `${Math.max(4, Math.min(100, v))}%`, backgroundColor: v > 85 ? colors.amber : colors.purple, borderRadius: 3 }} />
        </View>
      ))}
    </View>
  );
}

export interface ChartSeries {
  label: string;
  color: string;
  points: Point[];
}

interface LineChartProps {
  series: ChartSeries[];
  unit: string;
  height?: number;
  showBand?: boolean;
  markers?: number[]; // tijdstippen (s) voor verticale markers, bv. throttling
  yMin?: number;
  yMax?: number;
}

const PAD = { l: 44, r: 10, t: 12, b: 24 };

export function LineChart({ series, unit, height = 200, showBand = true, markers = [], yMin, yMax }: LineChartProps) {
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const widthRef = useRef(0);

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.points);
    if (!all.length || width === 0) return null;
    const xs = all.map((p) => p[0]);
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const vals = all.flatMap((p) => [p[1], showBand ? p[2] : null, showBand ? p[3] : null]).filter((v): v is number => v !== null);
    let lo = yMin ?? Math.min(...vals);
    let hi = yMax ?? Math.max(...vals);
    if (unit === '%' && yMax === undefined) hi = Math.max(hi, Math.min(100, hi * 1.1));
    if (hi === lo) {
      hi += 1;
      lo = Math.max(0, lo - 1);
    }
    const pad = (hi - lo) * 0.08;
    lo = yMin ?? Math.max(unit === '%' || unit === 'B/s' || unit === 'rpm' ? 0 : -Infinity, lo - pad);
    hi = yMax ?? hi + pad;
    const w = width - PAD.l - PAD.r;
    const h = height - PAD.t - PAD.b;
    const sx = (t: number) => PAD.l + ((t - x0) / Math.max(1, x1 - x0)) * w;
    const sy = (v: number) => PAD.t + h - ((v - lo) / (hi - lo)) * h;
    const lines = series.map((s) => {
      const pts = s.points.filter((p) => p[1] !== null).map((p) => ({ x: sx(p[0]), y: sy(p[1] as number) }));
      const line = linePath(pts);
      const area = pts.length ? `${line} L${pts[pts.length - 1]!.x},${PAD.t + h} L${pts[0]!.x},${PAD.t + h} Z` : '';
      let band = '';
      if (showBand && series.length === 1) {
        const up = s.points.filter((p) => p[3] !== null).map((p) => ({ x: sx(p[0]), y: sy(p[3] as number) }));
        const down = s.points.filter((p) => p[2] !== null).map((p) => ({ x: sx(p[0]), y: sy(p[2] as number) })).reverse();
        if (up.length > 1) band = `M${up.map((p) => `${p.x},${p.y}`).join(' L')} L${down.map((p) => `${p.x},${p.y}`).join(' L')} Z`;
      }
      return { line, area, band, color: s.color };
    });
    const ticks = [0, 0.5, 1].map((f) => ({ v: lo + (hi - lo) * f, y: sy(lo + (hi - lo) * f) }));
    const span = x1 - x0;
    const tfmt = (ts: number) => {
      const d = new Date(ts * 1000);
      return span > 2 * 86400
        ? d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
        : d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    };
    const xt = [x0, x0 + span / 2, x1].map((ts) => ({ x: sx(ts), label: tfmt(ts) }));
    return { lines, ticks, xt, sx, sy, x0, x1, w, h };
  }, [series, width, height, showBand, unit, yMin, yMax]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy),
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: (e) => setHover(e.nativeEvent.locationX),
        onPanResponderMove: (e) => setHover(e.nativeEvent.locationX),
        onPanResponderRelease: () => setHover(null),
        onPanResponderTerminate: () => setHover(null),
      }),
    [],
  );

  const onLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setWidth(e.nativeEvent.layout.width);
  };

  let tooltip: { x: number; ts: number; rows: { label: string; color: string; v: number | null }[] } | null = null;
  if (geo && hover !== null) {
    const tsAt = geo.x0 + ((Math.min(Math.max(hover, PAD.l), PAD.l + geo.w) - PAD.l) / geo.w) * (geo.x1 - geo.x0);
    const rows = series.map((s) => {
      let best: Point | undefined;
      for (const p of s.points) if (!best || Math.abs(p[0] - tsAt) < Math.abs(best[0] - tsAt)) best = p;
      return { label: s.label, color: s.color, v: best ? best[1] : null, ts: best ? best[0] : tsAt };
    });
    tooltip = { x: geo.sx(rows[0]?.ts ?? tsAt), ts: rows[0]?.ts ?? tsAt, rows };
  }

  return (
    <View onLayout={onLayout} style={{ height }} {...pan.panHandlers} accessible accessibilityLabel={t.stats.chartA11y(series.map((s) => s.label).join(', '))}>
      {geo ? (
        <Svg width={width} height={height}>
          <Defs>
            {geo.lines.map((l, i) => (
              <LinearGradient key={i} id={`lg${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={l.color} stopOpacity={series.length === 1 ? 0.28 : 0.1} />
                <Stop offset="1" stopColor={l.color} stopOpacity={0} />
              </LinearGradient>
            ))}
          </Defs>
          {geo.ticks.map((tk, i) => (
            <G key={i}>
              <Line x1={PAD.l} x2={width - PAD.r} y1={tk.y} y2={tk.y} stroke={colors.line} strokeDasharray="3 4" strokeWidth={1} />
              <SvgText x={PAD.l - 6} y={tk.y + 4} fill={colors.textFaint} fontSize={10} fontFamily={fonts.mono} textAnchor="end">
                {compact(tk.v, unit)}
              </SvgText>
            </G>
          ))}
          {geo.xt.map((x, i) => (
            <SvgText key={i} x={x.x} y={height - 6} fill={colors.textFaint} fontSize={10} fontFamily={fonts.mono} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
              {x.label}
            </SvgText>
          ))}
          {markers.map((m, i) =>
            m >= geo.x0 && m <= geo.x1 ? <Rect key={i} x={geo.sx(m) - 1} y={PAD.t} width={2} height={geo.h} fill={colors.amber} opacity={0.5} /> : null,
          )}
          {geo.lines.map((l, i) => (
            <G key={i}>
              {l.band ? <Path d={l.band} fill={l.color} opacity={0.1} /> : null}
              {l.area ? <Path d={l.area} fill={`url(#lg${i})`} /> : null}
              <Path d={l.line} stroke={l.color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
            </G>
          ))}
          {tooltip ? (
            <G>
              <Line x1={tooltip.x} x2={tooltip.x} y1={PAD.t} y2={PAD.t + geo.h} stroke={colors.textMuted} strokeWidth={1} />
              {tooltip.rows.map((r, i) => (r.v !== null ? <Circle key={i} cx={tooltip!.x} cy={geo.sy(r.v)} r={4} fill={colors.bg} stroke={r.color} strokeWidth={2} /> : null))}
            </G>
          ) : null}
        </Svg>
      ) : null}
      {tooltip ? (
        <View pointerEvents="none" style={[st.tip, { left: Math.min(Math.max(tooltip.x - 70, 0), Math.max(0, width - 150)) }]}>
          <Text style={st.tipTime}>{new Date(tooltip.ts * 1000).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</Text>
          {tooltip.rows.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.color }} />
              <Text style={st.tipVal} numberOfLines={1}>
                {series.length > 1 ? `${r.label} ` : ''}
                {unitValue(r.v, unit)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function compact(v: number, unit: string): string {
  if (unit === 'B/s') {
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(1)}G`;
    if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(1)}M`;
    if (v >= 1024) return `${(v / 1024).toFixed(0)}K`;
    return v.toFixed(0);
  }
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return Math.abs(v) < 10 ? v.toFixed(1) : v.toFixed(0);
}

export function HealthRing({ level, size = 88, progress = 1, children }: { level: 'ok' | 'warning' | 'critical'; size?: number; progress?: number; children?: React.ReactNode }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = level === 'ok' ? colors.mint : level === 'warning' ? colors.amber : colors.red;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surface3} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${c * progress} ${c}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

const st = themed(() => StyleSheet.create({
  tip: {
    position: 'absolute', top: 4, minWidth: 140, backgroundColor: colors.surface2, borderColor: colors.lineStrong, borderWidth: 1,
    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6, gap: 2,
  },
  tipTime: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted },
  tipVal: { fontFamily: fonts.monoMedium, fontSize: 12, color: colors.text },
}));
