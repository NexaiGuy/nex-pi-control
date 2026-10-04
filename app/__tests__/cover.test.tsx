// Flex Window (cover-scherm van de Galaxy Z Flip): intro-klok van de widget, de widgettaak, herkenning van het
// cover-scherm, de config plugin en het volledige cover-scherm in de app (logo, draaiende behuizing, dashboard).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import fixtures from './fixtures/mock-api.json';
import type { Overview } from '@/api/types';
import { connectionStore, DEFAULT_CONNECTION } from '@/state/settings';

const FX = fixtures as Record<string, unknown>;

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  // doMock geldt voor elk volgend require, ook buiten isolateModules: na elke test weer de echte modules.
  jest.dontMock('@/lib/widgetLive');
  jest.dontMock('@/widget/data');
});

describe('intro-klok van de widget (src/widget/cover.ts)', () => {
  function load(until: number) {
    let mod: typeof import('@/widget/cover') | undefined;
    jest.isolateModules(() => {
      jest.doMock('@/lib/widgetLive', () => ({ widgetLive: { coverIntroUntil: () => until, setCoverCaption: jest.fn() } }));
      mod = require('@/widget/cover') as typeof import('@/widget/cover');
    });
    return mod!;
  }

  test('buiten het intro: meteen tekenen', async () => {
    const c = load(0);
    expect(c.introWaitMs()).toBe(0);
    const fn = jest.fn(async () => 'data');
    await expect(c.afterIntro(fn)).resolves.toBe('data');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('tijdens het intro: nu al ophalen, pas tekenen als het laadscherm lang genoeg liep', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    const c = load(1_000_000 + 2500);
    expect(c.introWaitMs()).toBe(2500);
    const fn = jest.fn(async () => 'data');
    let done = false;
    const p = c.afterIntro(fn).then((v) => {
      done = true;
      return v;
    });
    expect(fn).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(2400);
    expect(done).toBe(false);
    await jest.advanceTimersByTimeAsync(200);
    await expect(p).resolves.toBe('data');
  });

  test('nooit langer dan 6 s wachten, ook bij een rare klok', () => {
    jest.useFakeTimers({ now: 5_000 });
    const c = load(5_000 + 60_000);
    expect(c.introWaitMs()).toBe(c.MAX_INTRO_WAIT_MS);
  });
});

describe('widgettaak (src/widget/task.tsx)', () => {
  function setup(until: number, nativeOk = true) {
    const snapshot = { configured: true, server: 'homelab-pi', overview: FX['/v1/overview'] as Overview, updatedAt: 1, offline: false, extras: {} };
    const native = {
      coverIntroUntil: () => until,
      setCoverCaption: jest.fn(),
      playCoverIntro: jest.fn(() => true),
      renderCover: jest.fn((_json: string) => nativeOk),
    };
    let handler: typeof import('@/widget/task').widgetTaskHandler | undefined;
    jest.isolateModules(() => {
      jest.doMock('@/lib/widgetLive', () => ({ widgetLive: native }));
      jest.doMock('@/widget/data', () => ({
        ...jest.requireActual('@/widget/data'),
        ensureHydrated: jest.fn(async () => undefined),
        loadSnapshot: jest.fn(async () => snapshot),
      }));
      handler = (require('@/widget/task') as typeof import('@/widget/task')).widgetTaskHandler;
    });
    return { handler: handler!, native };
  }

  const props = (name: string, renderWidget: jest.Mock, action = 'WIDGET_UPDATE') =>
    ({ widgetAction: action, widgetInfo: { widgetName: name, widgetId: 1, width: 0, height: 0 }, renderWidget, clickAction: undefined }) as never;

  test('PiCover wacht het intro af en tekent dan in de native layout, niet als afbeelding', async () => {
    jest.useFakeTimers({ now: 2_000_000 });
    const { handler, native } = setup(2_000_000 + 1800);
    const rw = jest.fn();
    const p = handler(props('PiCover', rw));
    await jest.advanceTimersByTimeAsync(1700);
    expect(native.renderCover).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(200);
    await p;
    expect(native.renderCover).toHaveBeenCalledTimes(1);
    expect(rw).not.toHaveBeenCalled();
    const model = JSON.parse(native.renderCover.mock.calls[0]![0]) as { server: string; metrics: unknown[] };
    expect(model.server).toBe('homelab-pi');
    expect(model.metrics).toHaveLength(4);
    expect(native.setCoverCaption).toHaveBeenCalledWith('homelab-pi');
  });

  test('net geplaatst: meteen het intro, daarna de cijfers', async () => {
    const { handler, native } = setup(0);
    const rw = jest.fn();
    await handler(props('PiCover', rw, 'WIDGET_ADDED'));
    expect(native.playCoverIntro).toHaveBeenCalledTimes(1);
    expect(native.renderCover).toHaveBeenCalledTimes(1);
  });

  test('zonder native kant valt PiCover terug op de gewone weergave', async () => {
    const { handler } = setup(0, false);
    const rw = jest.fn();
    await handler(props('PiCover', rw));
    expect(rw).toHaveBeenCalledTimes(1);
  });

  test('andere widgets tekenen meteen als afbeelding, ook tijdens een intro op het cover-scherm', async () => {
    const { handler, native } = setup(Date.now() + 4000);
    const rw = jest.fn();
    await handler(props('PiBoard', rw));
    expect(rw).toHaveBeenCalledTimes(1);
    expect(native.renderCover).not.toHaveBeenCalled();
    expect(native.setCoverCaption).not.toHaveBeenCalled();
  });
});

describe('cijfers voor de native layout (src/widget/coverModel.ts)', () => {
  const { buildCoverModel } = require('@/widget/coverModel') as typeof import('@/widget/coverModel');
  const overview = FX['/v1/overview'] as Overview;
  const base = { configured: true, server: 'homelab-pi', overview, updatedAt: Date.UTC(2026, 9, 4, 12, 32), offline: false };

  test('alle vakken gevuld: 4 hoofdgetallen, 5 + 2 + 2 rijen, 4 tellers, lijnen van 24 uur', () => {
    const m = buildCoverModel({ ...base, extras: { rx24: [1.234, 2, 3], tx24: [4, 5.55, 6], events: [], updates: { count: 3, held_count: 1 } as never, agentVersion: '1.2.6' } });
    expect(m.metrics.map((r) => r.label)).toEqual(['CPU %', 'RAM %', 'TEMP °C', 'SCHIJF %']);
    expect(m.left.map((r) => r.label)).toEqual(['LOAD', 'FAN', 'UPTIME', 'SWAP', 'UPDATES']);
    expect(m.left[4]!.value).toBe('3 · 1 vastgehouden');
    expect(m.net.map((r) => r.label)).toEqual(['IN', 'UIT']);
    expect(m.net[0]!.spark).toEqual([1.2, 2, 3]);
    expect(m.right.map((r) => r.label)).toEqual(['I/O', 'OPEN MELDINGEN']);
    expect(m.right[1]!.value).toBe('0');
    expect(m.counts.map((r) => r.label)).toEqual(['DIENSTEN', 'CONTAINERS', 'SITES', 'BACKUP']);
    expect(m.foot).toContain('agent 1.2.6');
  });

  test('scenario "disk": de rode band met de apparaatnaam vervangt de kop', () => {
    const m = buildCoverModel({ ...base, extras: {} });
    expect(m.alarm).toBe('Schijf sda vertoont tekenen van falen');
    expect(m.level).toBe('critical');
  });

  test('offline: gedempt, met het tijdstip van de laatste update', () => {
    const m = buildCoverModel({ ...base, offline: true, extras: {} });
    expect(m.dim).toBe(true);
    expect(m.time.startsWith('laatste update')).toBe(true);
  });

  test('niet gekoppeld: vraagt om de app te openen', () => {
    const m = buildCoverModel({ configured: false, server: 'Nex Pi Control', overview: null, updatedAt: null, offline: false, extras: {} });
    expect(m.status).toBe('Koppel je Pi');
    expect(m.foot).toBe('Open Nex Pi Control om je Pi te koppelen');
  });

  test('bevat nooit adressen of sleutels, enkel opgemaakte waarden', () => {
    const json = JSON.stringify(buildCoverModel({ ...base, extras: {} }));
    expect(json).not.toMatch(/https?:\/\/|token|secret|client/i);
  });
});

describe('cover-scherm herkennen', () => {
  test('klein en bijna vierkant zoals de Flex Window, geen gesplitst scherm of gewone gsm', () => {
    const { looksLikeCover } = require('@/features/cover/coverWindow') as typeof import('@/features/cover/coverWindow');
    expect(looksLikeCover(360, 374)).toBe(true);
    expect(looksLikeCover(374, 360)).toBe(true);
    expect(looksLikeCover(412, 915)).toBe(false);
    expect(looksLikeCover(411, 500)).toBe(false);
    expect(looksLikeCover(200, 200)).toBe(false);
    expect(looksLikeCover(0, 0)).toBe(false);
  });

  test('de native kant (scherm 1) gaat voor', () => {
    let mod: typeof import('@/features/cover/coverWindow') | undefined;
    jest.isolateModules(() => {
      jest.doMock('@/lib/widgetLive', () => ({ widgetLive: { isOnCoverDisplay: () => true } }));
      mod = require('@/features/cover/coverWindow') as typeof import('@/features/cover/coverWindow');
    });
    expect(mod!.isCoverWindow(412, 915)).toBe(true);
  });
});

describe('config plugin (plugins/withFlexWindow.js)', () => {
  const plugin = require('../plugins/withFlexWindow') as ((c: Record<string, unknown>) => Record<string, any>) & { providerXml: (w: Record<string, string>) => string };

  test('widget-XML: keyguard en minstens 352 x 339 dp, zoals Samsung vraagt', () => {
    const xml = plugin.providerXml({ name: 'PiCover', minWidth: '352dp', minHeight: '339dp' });
    expect(xml).toContain('android:widgetCategory="keyguard"');
    expect(xml).toContain('android:minWidth="352dp"');
    expect(xml).toContain('android:minHeight="339dp"');
    expect(xml).toContain('@drawable/picover_preview');
    expect(xml).toContain('@string/widget_picover_description');
  });

  test('eigen ontvanger: native eerste beeld, daarna de gewone widgetbibliotheek', () => {
    const java = (plugin as unknown as { providerJava: (pkg: string, name: string) => string }).providerJava('be.nexai.picontrol', 'PiCover');
    expect(java).toContain('package be.nexai.picontrol.widget;');
    expect(java).toContain('public class PiCover extends RNWidgetProvider');
    expect(java).toContain('CoverScreen.INSTANCE.paintIfEmpty(context);');
    expect(java.indexOf('paintIfEmpty')).toBeLessThan(java.indexOf('super.onUpdate'));
  });

  async function runManifest(receivers: unknown[]) {
    const cfg = plugin({ name: 'x', slug: 'x', android: { package: 'be.nexai.picontrol' } });
    const manifest = { manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' }, receiver: receivers }] } };
    const out = await cfg.mods.android.manifest({
      ...cfg,
      modResults: manifest,
      modRequest: { platform: 'android', modName: 'manifest', projectRoot: '/tmp', platformProjectRoot: '/tmp/android', introspect: false, nextMod: async (c: unknown) => c },
    });
    return (out.modResults ?? manifest).manifest.application[0].receiver as { $: Record<string, string>; 'meta-data': { $: Record<string, string> }[] }[];
  }

  test('maakt de ontvanger met beide meta-data als de widgetbibliotheek nog niet liep', async () => {
    const rs = await runManifest([]);
    const r = rs.find((x) => x.$['android:name'] === '.widget.PiCover')!;
    expect(r.$['android:exported']).toBe('false');
    expect(r['meta-data'].map((m) => [m.$['android:name'], m.$['android:resource']])).toEqual([
      ['android.appwidget.provider', '@xml/flexwindow_picover'],
      ['com.samsung.android.appwidget.provider', '@xml/samsung_meta_info_picover'],
    ]);
  });

  test('past de ontvanger van react-native-android-widget aan als die er al is', async () => {
    const existing = { $: { 'android:name': '.widget.PiCover', 'android:exported': 'false', 'android:label': 'Flex Window' }, 'meta-data': { $: { 'android:name': 'android.appwidget.provider', 'android:resource': '@xml/widgetprovider_picover' } } };
    const rs = await runManifest([existing]);
    expect(rs).toHaveLength(1);
    expect(rs[0]!['meta-data'][0]!.$['android:resource']).toBe('@xml/flexwindow_picover');
    expect(rs[0]!['meta-data'][1]!.$['android:name']).toBe('com.samsung.android.appwidget.provider');
  });
});

describe('volledig cover-scherm in de app (/cover)', () => {
  function respond(body: unknown, status = 200) {
    return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  }

  beforeAll(() => {
    connectionStore.set({ ...DEFAULT_CONNECTION, name: 'homelab-pi', apiUrl: 'https://pi.example.com', shellUrl: 'https://pi.example.com:8443', agentToken: 'a'.repeat(48), shellToken: 's'.repeat(48) });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string) => {
      const p = new URL(url).pathname;
      if (p === '/v1/stats/history') return respond({ range: '1h', series: [] });
      if (p in FX) return respond(FX[p]);
      return respond({ code: 'not_found', message: 'nf' }, 404);
    });
  });

  test('logo 3 s, dan de draaiende behuizing met de servernaam, dan alle parameters', async () => {
    jest.useFakeTimers();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const Cover = (require('@/app/cover') as { default: () => React.JSX.Element }).default;
    await render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 374 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <QueryClientProvider client={qc}>
          <Cover />
        </QueryClientProvider>
      </SafeAreaProvider>,
    );
    expect(screen.getByLabelText('Nex AI')).toBeTruthy();
    expect(screen.queryByText('Verbinden')).toBeNull();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(screen.queryByLabelText('Nex AI')).toBeNull();
    expect(screen.getByText('Verbinden')).toBeTruthy();
    expect(screen.getByText('homelab-pi')).toBeTruthy();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1800);
    });
    expect(await screen.findByText('Volledige app openen')).toBeTruthy();
    for (const label of ['CPU', 'RAM', 'Load', 'Uptime', 'Swap', 'Updates', 'Open meldingen', 'Diensten', 'Containers', 'Sites', 'Schijven']) {
      expect(screen.getAllByText(label, { exact: false }).length).toBeGreaterThan(0);
    }
    // Scenario "disk": de schijfbanner staat ook op het cover-scherm.
    expect(screen.getAllByText(/Schijf \/dev\/sda toont tekenen van falen/).length).toBeGreaterThan(0);
    qc.clear();
  });
});
