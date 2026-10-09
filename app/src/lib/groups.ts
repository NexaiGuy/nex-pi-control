// Secties voor de lijsten in Systeem: per categorie (agent 1.3.0+), wat bewust uit staat apart onderaan.
// Pure functies: getest in __tests__/groups.test.ts.
import type { Labeled, ParkedReason } from '@/api/types';
import { t } from '@/i18n';

export const PARKED_KEY = '__parked';
/** Vanaf deze group_order: systeemdiensten. Die sectie is standaard dicht. */
export const ORDER_SYSTEM = 2000;

export interface Section<T> {
  key: string;
  title: string;
  items: T[];
  order: number;
  parked: boolean;
}

export interface Fallback {
  group: string;
  order: number;
}

/**
 * Groepeert per `group` (van de agent). Zonder `group` (oudere agent) beslist `fallback`.
 * Bewust uit gaat altijd in één laatste sectie, ongeacht de categorie.
 */
export function sectionize<T extends Labeled>(items: T[], fallback: (x: T) => Fallback): Section<T>[] {
  const map = new Map<string, Section<T>>();
  const parked: T[] = [];
  for (const x of items) {
    if (x.parked) {
      parked.push(x);
      continue;
    }
    const fb = x.group ? null : fallback(x);
    const title = x.group ?? fb!.group;
    const order = x.group ? x.group_order ?? 1000 : fb!.order;
    const sec = map.get(title) ?? { key: `g:${title}`, title, items: [], order, parked: false };
    sec.items.push(x);
    sec.order = Math.min(sec.order, order);
    map.set(title, sec);
  }
  const out = [...map.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  if (parked.length) out.push({ key: PARKED_KEY, title: t.labels.parkedSection, items: parked, order: Number.MAX_SAFE_INTEGER, parked: true });
  return out;
}

/** Secties die standaard dicht staan: bewust uit en de systeemdiensten. Bij zoeken staat alles open. */
export function collapsedByDefault(sec: Section<unknown>): boolean {
  return sec.parked || sec.order >= ORDER_SYSTEM;
}

export function reasonLabel(r: ParkedReason | null | undefined): string {
  switch (r) {
    case 'app':
      return t.labels.reasons.app;
    case 'config':
      return t.labels.reasons.config;
    case 'disabled':
      return t.labels.reasons.disabled;
    case 'stopped':
      return t.labels.reasons.stopped;
    case 'backend':
      return t.labels.reasons.backend;
    default:
      return '';
  }
}

/** Staat de schakelaar "Bewust uitgezet" aan? Nu bewust uit, of in de app zo ingesteld (ook als het nog draait). */
export function parkedSwitch(x: Labeled): boolean {
  if (x.parked_setting === true) return true;
  if (x.parked_setting === false) return false;
  return !!x.parked;
}
