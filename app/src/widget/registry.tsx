// Alle startschermwidgets van Nex Pi Control: Android-naam, soort, welke gegevens nodig zijn, en de weergave.
// De naam PiStatus blijft voor de 4x2 Overview, zodat widgets die al op een startscherm staan blijven werken.
import { PixelRatio } from 'react-native';
import type { WidgetInfo, WidgetRepresentation } from 'react-native-android-widget';

import type { Need, Snapshot } from './data';
import { copy } from './odyssey/copy';
import { DARK, LIGHT, type Pal } from './odyssey/palette';
import type { Ctx, Level } from './odyssey/parts';
import { REF, renderKind, type WidgetKind } from './odyssey/widgets';

export interface WidgetDef {
  name: string;
  kind: WidgetKind;
  needs: readonly Need[];
}

export const WIDGETS: readonly WidgetDef[] = [
  { name: 'PiPulse', kind: 'pulse', needs: [] },
  { name: 'PiGlance', kind: 'glance', needs: [] },
  { name: 'PiVitals', kind: 'vitals', needs: [] },
  { name: 'PiStrip', kind: 'strip', needs: [] },
  { name: 'PiStatus', kind: 'overview', needs: ['cpu1h'] },
  { name: 'PiCommand', kind: 'command', needs: ['net24'] },
  { name: 'PiBoard', kind: 'board', needs: ['cpu1h', 'net24', 'sites', 'events', 'updates', 'device', 'info'] },
  { name: 'PiSites', kind: 'sites', needs: ['sites'] },
  { name: 'PiContainers', kind: 'containers', needs: ['containers'] },
  { name: 'PiBackups', kind: 'backups', needs: ['backups'] },
  { name: 'PiDisks', kind: 'disks', needs: [] },
  { name: 'PiNetwork', kind: 'network', needs: ['net24'] },
  { name: 'PiFleet', kind: 'fleet', needs: ['fleet'] },
];

export const widgetByName = (name: string): WidgetDef | undefined => WIDGETS.find((w) => w.name === name);

function fontScale(): number {
  try {
    const f = PixelRatio.getFontScale();
    return Number.isFinite(f) && f > 0 ? f : 1;
  } catch {
    return 1;
  }
}

function level(snap: Snapshot, alarm: string | null): Level {
  if (snap.offline || !snap.overview) return 'offline';
  if (alarm) return 'critical';
  return snap.overview.health.status;
}

export function makeCtx(kind: WidgetKind, snap: Snapshot, pal: Pal, size?: { width: number; height: number }): Ctx {
  const [rw, rh] = REF[kind];
  const w = size && size.width > 40 ? size.width : rw;
  const h = size && size.height > 40 ? size.height : rh;
  const fs = fontScale();
  const o = snap.overview;
  const dev = o?.disk_alarms?.[0]?.device;
  // Een falende schijf gaat boven alles, ook als de Pi intussen offline is (laatst bekende toestand).
  const alarm = dev ? dev.replace(/^\/dev\//, '') : null;
  const lv = level(snap, alarm);
  return { pal, s: copy, fs, big: fs > 1.15, w, h, snap, o, lv, off: lv === 'offline', problem: lv === 'warning' || lv === 'critical', alarm };
}

/**
 * Het thema volgt de keuze in de app (Instellingen > Weergave): Systeem laat Android kiezen tussen licht en donker,
 * Licht of Donker zet elke widget vast in dat thema, ook als de gsm zelf anders staat. De widgets zijn altijd Odyssey.
 */
export function renderWidget(def: WidgetDef, snap: Snapshot, info?: Pick<WidgetInfo, 'width' | 'height'>): WidgetRepresentation {
  const theme = snap.theme ?? 'system';
  if (theme === 'light') return renderKind(def.kind, makeCtx(def.kind, snap, LIGHT, info));
  if (theme === 'dark') return renderKind(def.kind, makeCtx(def.kind, snap, DARK, info));
  return {
    light: renderKind(def.kind, makeCtx(def.kind, snap, LIGHT, info)),
    dark: renderKind(def.kind, makeCtx(def.kind, snap, DARK, info)),
  };
}

/** Alle gegevens die minstens één widget nodig heeft. */
export const ALL_NEEDS: readonly Need[] = [...new Set(WIDGETS.flatMap((w) => w.needs))];
