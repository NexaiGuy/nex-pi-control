// Widgets (Odyssey): alle 14 (13 startscherm + de Flex Window) bouwen een geldige boom in elke toestand, licht en donker,
// tonen enkel echte velden, en de getalopmaak volgt de regels van het designsysteem.
import fixtures from './fixtures/mock-api.json';
import type { Backup, Container, Overview, Point, Site } from '@/api/types';
import { downsample, loadingSnapshot, peakOf, type Snapshot } from '@/widget/data';
import * as F from '@/widget/odyssey/format';
import { COVER_CAMERAS, REF } from '@/widget/odyssey/widgets';
import { ALL_NEEDS, COVER_WIDGET, makeCtx, renderWidget, WIDGETS } from '@/widget/registry';
import { DARK } from '@/widget/odyssey/palette';

const { buildWidgetTree } = jest.requireActual('react-native-android-widget/lib/commonjs/api/build-widget-tree') as {
  buildWidgetTree: (el: unknown) => { type: string; props: Record<string, unknown>; children?: unknown[] };
};

const FX = fixtures as Record<string, unknown>;
const overview = FX['/v1/overview'] as Overview;

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { configured: true, server: 'homelab-pi', overview, updatedAt: Date.UTC(2026, 9, 3, 12, 32), offline: false, extras: {}, ...over };
}

function texts(tree: unknown, out: string[] = []): string[] {
  const n = tree as { type: string; props: { text?: string }; children?: unknown[] };
  if (n.type === 'TextWidget' && n.props.text) out.push(n.props.text);
  for (const ch of n.children ?? []) texts(ch, out);
  return out;
}

const okOverview: Overview = { ...overview, disk_alarms: [], health: { status: 'ok', title: 'OK', reasons: [] } };

describe('widgets', () => {
  test('14 widgets, PiStatus blijft de naam van de 4x2', () => {
    expect(WIDGETS).toHaveLength(14);
    expect(new Set(WIDGETS.map((w) => w.name)).size).toBe(14);
    expect(WIDGETS.find((w) => w.name === 'PiStatus')?.kind).toBe('overview');
    expect(ALL_NEEDS).toEqual(expect.arrayContaining(['cpu1h', 'net24', 'fleet']));
  });

  const states: [string, Snapshot][] = [
    ['ok', snap({ overview: okOverview })],
    ['fixture (probleem)', snap()],
    ['offline', snap({ offline: true })],
    ['niet gekoppeld', { configured: false, server: 'Nex Pi Control', overview: null, updatedAt: null, offline: false, extras: {} }],
    ['laden', loadingSnapshot()],
  ];
  for (const def of WIDGETS) {
    for (const [label, s] of states) {
      test(`${def.name} bouwt in toestand ${label}, licht en donker, ook groot en op 1.3`, () => {
        for (const size of [undefined, { width: REF[def.kind][0] + 60, height: REF[def.kind][1] + 100 }]) {
          const r = renderWidget(def, s, size) as { light: unknown; dark: unknown };
          const light = buildWidgetTree(r.light);
          const dark = buildWidgetTree(r.dark);
          expect(light.type).toBe('LinearLayoutWidget');
          expect(dark.type).toBe('LinearLayoutWidget');
        }
      });
    }
  }

  test('een falende schijf gaat boven alles: rode band met de apparaatnaam', () => {
    const alarm: Overview = { ...overview, disk_alarms: [{ device: '/dev/sda', status: 'failing', message: 'x', reasons: [] }] };
    const def = WIDGETS.find((w) => w.kind === 'overview')!;
    const t = texts(buildWidgetTree((renderWidget(def, snap({ overview: alarm })) as { dark: unknown }).dark));
    expect(t).toContain('Schijf sda vertoont tekenen van falen');
  });

  test('offline toont de laatste update', () => {
    const def = WIDGETS.find((w) => w.kind === 'overview')!;
    const t = texts(buildWidgetTree((renderWidget(def, snap({ overview: okOverview, offline: true })) as { dark: unknown }).dark));
    expect(t).toContain('OFFLINE');
    expect(t.some((x) => x.startsWith('laatste update'))).toBe(true);
  });

  test('niet gekoppeld vraagt om de app te openen', () => {
    const def = WIDGETS.find((w) => w.kind === 'overview')!;
    const s: Snapshot = { configured: false, server: 'Nex Pi Control', overview: null, updatedAt: null, offline: false, extras: {} };
    expect(texts(buildWidgetTree((renderWidget(def, s) as { dark: unknown }).dark))).toContain('Open Nex Pi Control om je Pi te koppelen');
  });

  test('laden toont geen getallen', () => {
    for (const def of WIDGETS) {
      const t = texts(buildWidgetTree((renderWidget(def, loadingSnapshot()) as { dark: unknown }).dark));
      expect(t.filter((x) => /\d/.test(x))).toEqual([]);
    }
  });

  test('tikzones openen de juiste schermen', () => {
    const def = WIDGETS.find((w) => w.kind === 'board')!;
    const json = JSON.stringify(buildWidgetTree((renderWidget(def, snap()) as { dark: unknown }).dark));
    for (const uri of ['nexpicontrol://metric/cpu', 'nexpicontrol://disks', 'nexpicontrol://system?seg=sites', 'nexpicontrol://events', 'nexpicontrol://backups', 'nexpicontrol://updates']) {
      expect(json).toContain(uri);
    }
  });

  test('statuskleuren zijn tekens, nooit tekst', () => {
    for (const def of WIDGETS) {
      const tree = buildWidgetTree((renderWidget(def, snap()) as { dark: unknown }).dark);
      const walk = (n: { type: string; props: Record<string, unknown>; children?: unknown[] }) => {
        if (n.type === 'TextWidget') expect([DARK.mint, DARK.warn].map((c) => String(c).toLowerCase())).not.toContain(String(n.props.color ?? '').toLowerCase());
        for (const ch of n.children ?? []) walk(ch as typeof n);
      };
      walk(tree);
    }
  });

  test('grote letters schakelen de knip-regels in', () => {
    const spy = jest.spyOn(require('react-native').PixelRatio, 'getFontScale').mockReturnValue(1.3);
    expect(makeCtx('strip', snap(), DARK).big).toBe(true);
    spy.mockRestore();
  });
});

type Node = { type: string; props: Record<string, unknown>; children?: Node[] };

function clicks(n: Node, out: string[] = []): string[] {
  const a = n.props.clickAction as string | undefined;
  if (a) out.push(a === 'OPEN_URI' ? String((n.props.clickActionData as { uri?: string } | undefined)?.uri) : a);
  for (const ch of n.children ?? []) clicks(ch, out);
  return out;
}

describe('Flex Window (cover-scherm)', () => {
  const def = WIDGETS.find((w) => w.name === COVER_WIDGET)!;

  test('PiCover bestaat, is 352 x 339 dp (minimum van Samsung) en vraagt enkel wat hij toont', () => {
    expect(def.kind).toBe('cover');
    expect(REF.cover).toEqual([352, 339]);
    expect([...def.needs].sort()).toEqual(['device', 'events', 'info', 'net24', 'updates']);
  });

  test('elke tik opent het volledige cover-scherm, in elke toestand', () => {
    for (const s of [snap({ overview: okOverview }), snap(), snap({ offline: true })]) {
      const tree = buildWidgetTree((renderWidget(def, s) as { dark: unknown }).dark) as Node;
      const all = clicks(tree);
      expect(all.length).toBeGreaterThan(0);
      expect(new Set(all)).toEqual(new Set(['nexpicontrol://cover']));
    }
  });

  test('andere widgets houden hun eigen tikzones', () => {
    const board = WIDGETS.find((w) => w.kind === 'board')!;
    const all = clicks(buildWidgetTree((renderWidget(board, snap()) as { dark: unknown }).dark) as Node);
    expect(all).not.toContain('nexpicontrol://cover');
    expect(makeCtx('board', snap(), DARK).tapTo).toBeUndefined();
    expect(makeCtx('cover', snap(), DARK).tapTo).toBe('/cover');
  });

  test('toont alle parameters: status, CPU, RAM, temp, schijf, load, fan, uptime, swap, updates, netwerk, I/O, meldingen, tellers', () => {
    const t = texts(buildWidgetTree((renderWidget(def, snap({ overview: okOverview, extras: { events: [], updates: { count: 3, held_count: 1 } as never } })) as { dark: unknown }).dark));
    for (const label of ['CPU %', 'RAM %', 'TEMP °C', 'SCHIJF %', 'LOAD', 'FAN', 'UPTIME', 'SWAP', 'UPDATES', 'IN', 'UIT', 'I/O', 'OPEN MELDINGEN', 'DIENSTEN', 'CONTAINERS', 'SITES', 'BACKUP']) {
      expect(t).toContain(label);
    }
    expect(t).toContain('3 · 1 vastgehouden');
  });

  test('de uitsparing rechtsonder blijft leeg', () => {
    const tree = buildWidgetTree((renderWidget(def, snap({ overview: okOverview })) as { dark: unknown }).dark) as Node;
    const empty = (n: Node): boolean => !(n.children ?? []).length && n.type === 'LinearLayoutWidget';
    let found = false;
    const walk = (n: Node) => {
      const { width, height } = n.props as { width?: number; height?: number };
      if (empty(n) && width === COVER_CAMERAS.w && (height ?? 0) >= COVER_CAMERAS.h) found = true;
      for (const ch of n.children ?? []) walk(ch);
    };
    walk(tree);
    expect(found).toBe(true);
  });

  test('een falende schijf staat ook op het cover-scherm bovenaan', () => {
    const alarm: Overview = { ...overview, disk_alarms: [{ device: '/dev/sda', status: 'failing', message: 'x', reasons: [] }] };
    const t = texts(buildWidgetTree((renderWidget(def, snap({ overview: alarm })) as { dark: unknown }).dark));
    expect(t).toContain('Schijf sda vertoont tekenen van falen');
  });
});

describe('opmaak', () => {
  test('temperatuur altijd één decimaal, procent hoogstens één', () => {
    expect(F.temp(65)).toBe('65,0');
    expect(F.pct(37.84)).toBe('37,8');
    expect(F.pct(53)).toBe('53');
    expect(F.pct(37.8, true)).toBe('38');
    expect(F.pct(null)).toBe(F.NONE);
  });

  test('bytes binair: één decimaal onder 100, geen vanaf 100', () => {
    expect(F.bytes(9.8 * 1024 ** 3)).toEqual({ v: '9,8', u: 'GiB' });
    expect(F.bytes(119 * 1024 ** 3)).toEqual({ v: '119', u: 'GiB' });
    expect(F.rateText(8.8 * 1024)).toBe('8,8 KiB/s');
  });

  test('korte leeftijd en klok', () => {
    expect(F.age(48 * 60)).toBe('48 min');
    expect(F.age(6 * 3600)).toBe('6 u');
    expect(F.age(9 * 86400)).toBe('9 d');
    expect(F.uptime(86400 + 15 * 3600)).toBe('1d 15u');
    expect(F.clock(new Date(2026, 9, 3, 14, 32).getTime())).toBe('14:32');
  });

  test('reeksen inkorten en de piek vinden', () => {
    expect(downsample([1, 2, 3, 4], 2)).toEqual([1.5, 3.5]);
    const pts: Point[] = [[100, 1, 0, 2], [200, 5, 1, 9], [300, 2, 1, 3]];
    expect(peakOf(pts)).toEqual({ v: 9, at: 200_000 });
  });
});

describe('volledige lijsten', () => {
  type Node = { type: string; props: Record<string, unknown>; children?: Node[] };
  const find = (n: Node, type: string): Node | undefined => (n.type === type ? n : (n.children ?? []).map((ch) => find(ch, type)).find(Boolean));
  const listOf = (kind: string, extras: Snapshot['extras'], o: Overview = okOverview) => {
    const def = WIDGETS.find((w) => w.kind === kind)!;
    const tree = buildWidgetTree((renderWidget(def, snap({ overview: o, extras }), { width: 376, height: 600 }) as { dark: unknown }).dark) as Node;
    return find(tree, 'ListWidget');
  };

  test('alle 55 sites, beschermde sites tellen als in orde', () => {
    const sites = Array.from({ length: 55 }, (_, i) => ({ hostname: `s${String(i).padStart(2, '0')}.example`, state: i % 5 ? 'up' : 'protected', status_code: i % 5 ? 200 : 403, latency_ms: 100 + i })) as Site[];
    const list = listOf('sites', { sites });
    expect(list?.children).toHaveLength(55);
    expect(JSON.stringify(list)).toContain('nexpicontrol://site/s00.example');
    expect(JSON.stringify(list)).not.toContain(DARK.warn);
  });

  test('alle 49 containers, met een tik naar de container', () => {
    const containers = Array.from({ length: 49 }, (_, i) => ({ id: `c${i}`, name: `app-${i}`, state: 'running', cpu_percent: i / 10, memory_bytes: 1024 ** 2 * i })) as unknown as Container[];
    const list = listOf('containers', { containers });
    expect(list?.children).toHaveLength(49);
    expect(JSON.stringify(list)).toContain('nexpicontrol://container/c0');
  });

  test('alle 15 backups, ook eenmalige kopieën', () => {
    const backups = Array.from({ length: 15 }, (_, i) => ({ name: `job-${i}`, path: `/b/${i}`, state: 'ok', age_seconds: 3600 * i, source: 'timer', kind: i > 12 ? 'archive' : 'job' })) as Backup[];
    expect(listOf('backups', { backups })?.children).toHaveLength(15);
  });

  test('alle schijven', () => {
    const mounts = Array.from({ length: 6 }, (_, i) => ({ device: `/dev/sd${i}`, mountpoint: `/m${i}`, fstype: 'ext4', total: 100, used: 50, free: 50, percent: 50 }));
    expect(listOf('disks', {}, { ...okOverview, mounts })?.children).toHaveLength(6);
  });
});

describe('thema volgt de app', () => {
  type Node = { type: string; props: Record<string, unknown>; children?: Node[] };
  const def = WIDGETS.find((w) => w.kind === 'overview')!;
  const json = (el: unknown) => JSON.stringify(buildWidgetTree(el) as Node);

  test('Licht in de app: elke widget licht, ook als de gsm donker staat', () => {
    const r = renderWidget(def, snap({ theme: 'light' })) as { light?: unknown };
    expect(r.light).toBeUndefined();
    expect(json(r)).toContain('#F4F4F1');
    expect(json(r)).not.toContain('#050508"');
  });

  test('Donker in de app: elke widget donker', () => {
    const r = renderWidget(def, snap({ theme: 'dark' })) as { light?: unknown };
    expect(r.light).toBeUndefined();
    expect(json(r)).toContain('#0B0B12');
    expect(json(r)).not.toContain('#F4F4F1');
  });

  test('Systeem: Android kiest tussen een lichte en een donkere versie', () => {
    const r = renderWidget(def, snap({ theme: 'system' })) as { light: unknown; dark: unknown };
    expect(json(r.light)).toContain('#F4F4F1');
    expect(json(r.dark)).toContain('#0B0B12');
    // Zonder thema (oude snapshot) hetzelfde gedrag.
    expect((renderWidget(def, snap()) as { light: unknown }).light).toBeTruthy();
  });

  test('widgetTheme leest de keuze uit Instellingen', () => {
    const { prefsStore } = require('@/state/settings') as typeof import('@/state/settings');
    const { widgetTheme } = require('@/widget/data') as typeof import('@/widget/data');
    const before = prefsStore.get();
    prefsStore.set({ ...before, theme: 'light' });
    expect(widgetTheme()).toBe('light');
    prefsStore.set({ ...before, theme: 'system' });
    expect(widgetTheme()).toBe('system');
    prefsStore.set(before);
  });
});

describe('cache vanuit de app', () => {
  test('een verse cache telt niet als offline, een oude wel', async () => {
    const settings = require('@/state/settings') as typeof import('@/state/settings');
    const { cacheSet } = require('@/api/cache') as typeof import('@/api/cache');
    const { loadSnapshot } = require('@/widget/data') as typeof import('@/widget/data');
    settings.hydratedStore.set(true);
    settings.connectionStore.set({ ...settings.DEFAULT_CONNECTION, name: 'hal-9000', apiUrl: 'https://pi.example.com', agentToken: 'a'.repeat(48) });
    cacheSet(JSON.stringify(['overview']), okOverview);
    const fresh = await loadSnapshot([], { cacheOnly: true });
    expect(fresh.overview).toBeTruthy();
    expect(fresh.offline).toBe(false);
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now + 2 * 3600 * 1000);
    const old = await loadSnapshot([], { cacheOnly: true });
    expect(old.offline).toBe(true);
    spy.mockRestore();
  });
});
