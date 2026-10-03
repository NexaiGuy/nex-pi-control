// Bouwstenen van de Odyssey-widgets: tekst, getallen, ruit, kop, rode band, tegels, balken.
// Geen hooks en geen fragments: react-native-android-widget bouwt een vaste boom.
import { FlexWidget, SvgWidget, TextWidget, type ColorProp } from 'react-native-android-widget';

import type { Overview } from '@/api/types';

import type { Snapshot } from '../data';
import type { Copy } from './copy';
import { clock } from './format';
import type { Pal } from './palette';
import { bar, diamond } from './svg';

export const SANS = 'SpaceGrotesk_300Light';
export const MONO = 'JetBrainsMono_300Light';

export type Level = 'ok' | 'warning' | 'critical' | 'offline';

export interface Ctx {
  pal: Pal;
  s: Copy;
  /** Lettergrootte van het systeem (1.0 standaard). */
  fs: number;
  /** Grote letters: de knip-regels gelden. */
  big: boolean;
  /** Werkelijke grootte in dp. */
  w: number;
  h: number;
  snap: Snapshot;
  o: Overview | null;
  lv: Level;
  off: boolean;
  problem: boolean;
  /** Apparaatnaam van een falende schijf (sda), of null. Gaat boven alles. */
  alarm: string | null;
}

// --- tikzones -----------------------------------------------------------------------------------

export function tap(route: string): { clickAction: string; clickActionData?: Record<string, unknown> } {
  if (route === '/') return { clickAction: 'OPEN_APP' };
  return { clickAction: 'OPEN_URI', clickActionData: { uri: `nexpicontrol://${route.replace(/^\//, '')}` } };
}

// --- kleuren ------------------------------------------------------------------------------------

export function lvColor(c: Ctx, lv: string): ColorProp {
  if (lv === 'critical' || lv === 'down' || lv === 'failed' || lv === 'failing') return c.pal.crit;
  if (lv === 'warning' || lv === 'old' || lv === 'protected' || lv === 'unhealthy') return c.pal.warn;
  if (lv === 'offline' || lv === 'unknown') return c.pal.muted;
  return c.pal.mint;
}

export function eyeColor(c: Ctx, lv: Level): string {
  return lv === 'critical' ? c.pal.eyeCrit : lv === 'warning' ? c.pal.eyeWarn : lv === 'offline' ? c.pal.eyeOff : c.pal.eyeOk;
}

/** Waarden worden ink-muted als de Pi offline is (laatst bekende toestand). */
export const valueColor = (c: Ctx): ColorProp => (c.off ? c.pal.muted : c.pal.ink);

// --- tekst --------------------------------------------------------------------------------------

interface TextProps {
  text: string;
  size: number;
  color: ColorProp;
  mono?: boolean;
  spacing?: number;
  align?: 'left' | 'center' | 'right';
  lines?: number;
  fill?: boolean;
}

export function Txt({ text, size, color, mono, spacing, align, lines = 1, fill }: TextProps) {
  return (
    <TextWidget
      text={text}
      maxLines={lines}
      truncate="END"
      style={{
        fontFamily: mono ? MONO : SANS,
        fontSize: size,
        color,
        ...(spacing ? { letterSpacing: spacing } : {}),
        ...(align ? { textAlign: align } : {}),
        ...(fill ? { width: 'match_parent' as const } : {}),
      }}
    />
  );
}

export function Label({ c, text, size = 9, color, spacing = 0.14, fill }: { c: Ctx; text: string; size?: number; color?: ColorProp; spacing?: number; fill?: boolean }) {
  return <Txt text={text.toUpperCase()} size={size} color={color ?? c.pal.muted} spacing={spacing} fill={fill} />;
}

/** Neemt de resterende breedte in en kort zijn tekst af met een beletselteken. */
export function Grow({ children, weight = 1, align = 'flex-start' }: { children: any; weight?: number; align?: 'flex-start' | 'center' | 'flex-end' }) {
  return <FlexWidget style={{ flex: weight, flexDirection: 'row', alignItems: 'center', justifyContent: align }}>{children}</FlexWidget>;
}

export function Space() {
  return <FlexWidget style={{ flex: 1 }} />;
}

export function Gap({ size }: { size: number }) {
  return <FlexWidget style={{ width: size, height: size }} />;
}

/** Getal in JetBrains Mono, eenheid erachter in klein ink-muted. */
export function Num({ c, v, u, size, color }: { c: Ctx; v: string; u?: string; size: number; color?: ColorProp }) {
  const us = Math.max(9, Math.round(size * 0.42));
  const parts = [<Txt key="v" text={v} size={size} color={color ?? valueColor(c)} mono />];
  if (u) {
    parts.push(
      <FlexWidget key="u" style={{ paddingBottom: Math.round(size * 0.12) }}>
        <Txt text={` ${u}`} size={us} color={c.pal.muted} mono />
      </FlexWidget>,
    );
  }
  return <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end' }}>{parts}</FlexWidget>;
}

// --- tekens -------------------------------------------------------------------------------------

export function Diamond({ c, lv, size = 7, color }: { c: Ctx; lv: string; size?: number; color?: ColorProp }) {
  const off = c.off || lv === 'offline';
  return <SvgWidget svg={diamond(size, String(color ?? (off ? c.pal.muted : lvColor(c, lv))), off && !color)} style={{ width: size, height: size }} />;
}

export function Bar({ c, w, pct, lv = 'ok', h = 4 }: { c: Ctx; w: number; pct: number; lv?: string; h?: number }) {
  const col = c.off ? c.pal.muted : lv === 'warning' ? c.pal.warn : lv === 'critical' ? c.pal.crit : c.pal.purple;
  return <SvgWidget svg={bar(Math.max(8, Math.round(w)), pct, String(col), c.pal.line, h)} style={{ width: Math.max(8, Math.round(w)), height: h }} />;
}

// --- kop ----------------------------------------------------------------------------------------

export function statusWord(c: Ctx, compact: boolean): string {
  if (c.lv === 'warning') return compact ? c.s.warningShort : c.s.warning;
  return c.s[c.lv];
}

export function StatusWord({ c, size = 10, compact = false }: { c: Ctx; size?: number; compact?: boolean }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
      <Diamond c={c} lv={c.lv} />
      <Label c={c} text={statusWord(c, compact)} size={size} color={c.pal.ink} />
    </FlexWidget>
  );
}

export function timeText(c: Ctx, short: boolean): string {
  const t = clock(c.snap.updatedAt);
  return c.off && !short ? `${c.s.lastUpdate} ${t}` : t;
}

/** De rode band van een falende schijf: vervangt de kop op elke widget. */
export function AlarmBand({ c, text, size = 11 }: { c: Ctx; text: string; size?: number }) {
  return (
    <FlexWidget
      {...tap('/disks')}
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 8, backgroundColor: c.pal.crit, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 5 }}
    >
      <Diamond c={c} lv="critical" color={c.pal.onCrit} />
      <Grow>
        <Txt text={text} size={size} color={c.pal.onCrit} fill />
      </Grow>
      <Txt text={clock(c.snap.updatedAt)} size={10} color={c.pal.onCrit} mono />
    </FlexWidget>
  );
}

export function alarmText(c: Ctx, width: 'long' | 'short' | 'tiny'): string {
  const d = c.alarm ?? 'sda';
  return width === 'long' ? c.s.alarmLong(d) : width === 'short' ? c.s.alarmShort(d) : c.s.alarmTiny(d);
}

/** Standaardkop: ruit en statuswoord, gezondheidstitel, servernaam, tijd. */
export function Header({ c, short = false, noServer = false, noTitle = false, wordSize = 10 }: { c: Ctx; short?: boolean; noServer?: boolean; noTitle?: boolean; wordSize?: number }) {
  if (c.alarm) return <AlarmBand c={c} text={alarmText(c, short ? (c.big ? 'tiny' : 'short') : 'long')} />;
  const title = c.problem && !noTitle && c.o ? c.o.health.title : '';
  const kids = [<StatusWord key="w" c={c} size={wordSize} compact={short} />];
  if (title) {
    kids.push(
      <Grow key="t">
        <Txt text={`· ${title}`} size={10} color={c.pal.muted} mono fill />
      </Grow>,
    );
  }
  if (!noServer) {
    kids.push(
      <Grow key="s" align="flex-end">
        <Txt text={c.snap.server} size={10} color={c.pal.muted} mono align="right" />
      </Grow>,
    );
  } else if (!title) {
    kids.push(<Space key="sp" />);
  }
  kids.push(<Txt key="time" text={timeText(c, short)} size={10} color={c.pal.muted} mono />);
  return (
    <FlexWidget {...tap('/')} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 8 }}>
      {kids}
    </FlexWidget>
  );
}

// --- rijen --------------------------------------------------------------------------------------

/** Label links, waarde rechts. */
export function KV({ c, label, value, size = 9.5, route }: { c: Ctx; label: string; value: string; size?: number; route?: string }) {
  return (
    <FlexWidget {...(route ? tap(route) : {})} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
      <Label c={c} text={label} size={8.5} />
      <Grow align="flex-end">
        <Txt text={value} size={size} color={valueColor(c)} mono align="right" />
      </Grow>
    </FlexWidget>
  );
}

export function BarRow({ c, label, value, pct, w, lv = 'ok', route }: { c: Ctx; label: string; value: string; pct: number; w: number; lv?: string; route?: string }) {
  return (
    <FlexWidget {...(route ? tap(route) : {})} style={{ width: 'match_parent', flexDirection: 'column', flexGap: 3 }}>
      <KV c={c} label={label} value={value} />
      <Bar c={c} w={w} pct={pct} lv={lv} />
    </FlexWidget>
  );
}

export function Slab({ c, children, route, pad = [6, 8], weight = 1, gap = 3 }: { c: Ctx; children: any; route?: string; pad?: [number, number]; weight?: number; gap?: number }) {
  return (
    <FlexWidget
      {...(route ? tap(route) : {})}
      style={{ flex: weight, flexDirection: 'column', flexGap: gap, backgroundColor: c.pal.surface, borderWidth: 1, borderColor: c.pal.hairline, borderRadius: 10, paddingVertical: pad[0], paddingHorizontal: pad[1] }}
    >
      {children}
    </FlexWidget>
  );
}

export function Rule({ c }: { c: Ctx }) {
  return <FlexWidget style={{ width: 'match_parent', height: 1, backgroundColor: c.pal.hairline }} />;
}
