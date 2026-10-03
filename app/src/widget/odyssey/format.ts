// Getallen voor de widgets: binaire eenheden, temperatuur altijd met één decimaal, procenten met hoogstens één.
// Decimaalteken volgt de taal van de gsm, net als de rest van de app.
import { locale } from '@/i18n';

import { copy } from './copy';

/** Ontbrekende waarde: een rustig puntje, nooit een gok. */
export const NONE = '·';

const fmt = (min: number, max: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: false });
const f0 = fmt(0, 0);
const f1 = fmt(1, 1);
const f01 = fmt(0, 1);
const f2 = fmt(2, 2);

const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

export function temp(v: number | null | undefined): string {
  return ok(v) ? f1.format(v) : NONE;
}

/** Procent zonder teken. compact: zonder decimaal (grote letters in smalle rijen). */
export function pct(v: number | null | undefined, compact = false): string {
  return ok(v) ? (compact ? f0 : f01).format(v) : NONE;
}

export function int(v: number | null | undefined): string {
  return ok(v) ? f0.format(v) : NONE;
}

export function load(v: number | null | undefined): string {
  return ok(v) ? f2.format(v) : NONE;
}

const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

/** Bytes in waarde en eenheid apart: één decimaal onder 100, geen vanaf 100. */
export function bytes(v: number | null | undefined): { v: string; u: string } {
  if (!ok(v)) return { v: NONE, u: '' };
  let n = Math.abs(v);
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i += 1;
  }
  return { v: (i === 0 || n >= 100 ? f0 : f01).format(n), u: UNITS[i]! };
}

export function bytesText(v: number | null | undefined): string {
  const b = bytes(v);
  return b.u ? `${b.v} ${b.u}` : b.v;
}

export function rate(bps: number | null | undefined): { v: string; u: string } {
  const b = bytes(bps);
  return { v: b.v, u: b.u ? `${b.u}/s` : '' };
}

export function rateText(bps: number | null | undefined): string {
  const r = rate(bps);
  return r.u ? `${r.v} ${r.u}` : r.v;
}

/** Korte leeftijd: 48 min, 6 h, 9 d. */
export function age(seconds: number | null | undefined): string {
  if (!ok(seconds)) return NONE;
  const s = Math.max(0, seconds);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} ${copy.min}`;
  if (s < 86400) return `${Math.round(s / 3600)} ${copy.hour}`;
  return `${Math.round(s / 86400)} ${copy.day}`;
}

/** Uptime in de twee grootste eenheden: 1d 15h. */
export function uptime(seconds: number | null | undefined): string {
  if (!ok(seconds)) return NONE;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}${copy.day} ${h}${copy.hour}`;
  if (h) return `${h}${copy.hour} ${m}m`;
  return `${m}m`;
}

/** 24-uursklok: 14:32. Neemt milliseconden. */
export function clock(ms: number | null | undefined): string {
  if (!ok(ms)) return NONE;
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
