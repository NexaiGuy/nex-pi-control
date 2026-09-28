import { lang, locale } from '@/i18n';

const HOUR = lang === 'nl' ? 'u' : 'h';

// Opmaak volgens de taal van de gsm: bytes, snelheden, duur, relatieve tijd.

const nf1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

export function num(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  return digits === 0 ? nf0.format(v) : new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v);
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '–' : `${nf1.format(v)}%`;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function bytes(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  let n = Math.abs(v);
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i += 1;
  }
  const f = i === 0 ? nf0.format(n) : new Intl.NumberFormat(locale, { maximumFractionDigits: n >= 100 ? 0 : digits }).format(n);
  return `${v < 0 ? '-' : ''}${f} ${UNITS[i]}`;
}

export function rate(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '–';
  return `${bytes(bps)}/s`;
}

export function duration(seconds: number | null | undefined, parts = 2): string {
  if (seconds === null || seconds === undefined || seconds < 0) return '–';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const out: string[] = [];
  if (d) out.push(`${d}d`);
  if (h) out.push(`${h}${HOUR}`);
  if (m && out.length < parts) out.push(`${m}m`);
  if (!out.length) out.push(`${sec}s`);
  return out.slice(0, parts).join(' ');
}

export function ago(tsSeconds: number | null | undefined, now: number = Date.now() / 1000): string {
  if (!tsSeconds) return '–';
  return duration(Math.max(0, now - tsSeconds), 1);
}

export function clock(tsSeconds: number | null | undefined): string {
  if (!tsSeconds) return '–';
  const d = new Date(tsSeconds * 1000);
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function dateTime(tsSeconds: number | null | undefined): string {
  if (!tsSeconds) return '–';
  const d = new Date(tsSeconds * 1000);
  return `${d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
}

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function unitValue(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined) return '–';
  switch (unit) {
    case 'B/s':
      return rate(v);
    case '%':
      return pct(v);
    case '°C':
      return `${nf1.format(v)} °C`;
    case 'rpm':
      return `${nf0.format(v)} rpm`;
    case 'ms':
      return `${nf0.format(v)} ms`;
    case 'hPa':
      return `${nf1.format(v)} hPa`;
    default:
      return num(v, 2);
  }
}
