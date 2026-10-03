// Versie 1.2: meerdere servers, meldingen van de Pi, updates, containers herstarten, widget.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import type { ComponentType } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import fixtures from './fixtures/mock-api.json';
import type { AgentEvent, Overview } from '@/api/types';
import { eventEnabled, newEvents } from '@/background/alerts';
import {
  DEFAULT_CONNECTION, DEFAULT_PREFS, addServer, connectionStore, hydrate, hydratedStore, prefsStore, removeServer, serversStore, switchServer, wipeAll,
} from '@/state/settings';

const FX = fixtures as Record<string, unknown>;
const PI_A = { ...DEFAULT_CONNECTION, name: 'garage', apiUrl: 'https://a.example.com', agentToken: 'a'.repeat(48) };
const PI_B = { ...DEFAULT_CONNECTION, name: 'zolder', apiUrl: 'https://b.example.com', agentToken: 'b'.repeat(48) };

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
}

async function renderScreen(Comp: ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 24, left: 0, right: 0, bottom: 24 } }}>
      <QueryClientProvider client={qc}>
        <Comp />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

function fetchFromFixture() {
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string) => {
    const u = new URL(url);
    if (u.pathname in FX) return respond(FX[u.pathname]);
    return respond({ code: 'not_found', message: 'nf' }, 404);
  });
}

describe('meerdere servers', () => {
  beforeEach(async () => {
    await wipeAll();
  });

  test('toevoegen, wisselen en verwijderen', async () => {
    const a = await addServer(PI_A);
    expect(serversStore.get().activeId).toBe(a.id);
    expect(connectionStore.get().name).toBe('garage');
    const b = await addServer(PI_B);
    expect(serversStore.get().servers).toHaveLength(2);
    expect(connectionStore.get().name).toBe('zolder');
    await switchServer(a.id);
    expect(connectionStore.get().apiUrl).toBe('https://a.example.com');
    await removeServer(a.id);
    expect(serversStore.get().activeId).toBe(b.id);
    expect(connectionStore.get().name).toBe('zolder');
    await removeServer(b.id);
    expect(serversStore.get().servers).toHaveLength(0);
    expect(connectionStore.get()).toEqual(DEFAULT_CONNECTION);
  });

  test('elke server apart opgeslagen, en terug ingelezen na herstart', async () => {
    const a = await addServer(PI_A);
    await addServer(PI_B);
    await switchServer(a.id);
    // Simuleer een herstart van de app.
    serversStore.set({ servers: [], activeId: null });
    hydratedStore.set(false);
    await hydrate();
    expect(serversStore.get().servers.map((s) => s.name)).toEqual(['garage', 'zolder']);
    expect(connectionStore.get().name).toBe('garage');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(`hal.server.${a.id}`, expect.any(String), expect.anything());
  });

  test('migratie van de oude opslag met één verbinding', async () => {
    await SecureStore.setItemAsync('hal.connection.v1', JSON.stringify(PI_A));
    serversStore.set({ servers: [], activeId: null });
    hydratedStore.set(false);
    await hydrate();
    expect(serversStore.get().servers).toHaveLength(1);
    expect(connectionStore.get().name).toBe('garage');
    expect(await SecureStore.getItemAsync('hal.connection.v1')).toBeNull();
  });

  test('demo bestaat maar één keer', async () => {
    const d1 = await addServer({ ...DEFAULT_CONNECTION, demo: true, name: 'homelab-pi', apiUrl: 'https://demo.invalid', agentToken: 'demo' });
    await addServer(PI_A);
    const d2 = await addServer({ ...DEFAULT_CONNECTION, demo: true, name: 'homelab-pi', apiUrl: 'https://demo.invalid', agentToken: 'demo' });
    expect(d2.id).toBe(d1.id);
    expect(serversStore.get().servers).toHaveLength(2);
    expect(serversStore.get().activeId).toBe(d1.id);
  });
});

describe('meldingen van de Pi', () => {
  const ev = (id: number, kind: string, extra: Partial<AgentEvent> = {}): AgentEvent => ({
    id, ts: 1, level: 'warning', kind, key: `${kind}:x`, resolved: false, title: `t${id}`, body: '', ...extra,
  });

  test('enkel nieuwe, open problemen volgens de voorkeuren', () => {
    const prefs = { ...DEFAULT_PREFS.notify, site: false };
    const out = newEvents([ev(3, 'service'), ev(4, 'site'), ev(5, 'disk', { level: 'critical' }), ev(6, 'service', { resolved: true, level: 'ok' }), ev(2, 'disk')], 2, prefs);
    expect(out.map((e) => e.id)).toEqual([3, 5]);
  });

  test('container valt onder diensten, updates onder updates', () => {
    expect(eventEnabled({ kind: 'container' }, { ...DEFAULT_PREFS.notify, service: false })).toBe(false);
    expect(eventEnabled({ kind: 'updates' }, { ...DEFAULT_PREFS.notify, updates: false })).toBe(false);
  });

  test('checkNow: eerst een basislijn, daarna een melding per nieuw probleem, voor elke server', async () => {
    let checkNow!: typeof import('@/background/alerts').checkNow;
    let settings!: typeof import('@/state/settings');
    let sched!: jest.Mock;
    jest.isolateModules(() => {
      settings = require('@/state/settings');
      const alerts = require('@/background/alerts');
      checkNow = alerts.checkNow;
      // Opslag in het geheugen, zodat de basislijn tussen twee controles bewaard blijft.
      let saved = {};
      alerts.alertStateIO.load = () => JSON.parse(JSON.stringify(saved));
      alerts.alertStateIO.save = (v: object) => {
        saved = v;
      };
      sched = require('expo-notifications').scheduleNotificationAsync;
    });
    await settings.wipeAll();
    await settings.addServer(PI_A);
    await settings.addServer(PI_B);
    await settings.savePrefs({ onboarded: true });
    let lastId = 7;
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string) => {
      const u = new URL(url);
      if (u.pathname === '/v1/overview') return respond(FX['/v1/overview']);
      if (u.pathname === '/v1/events') {
        const since = Number(u.searchParams.get('since'));
        const events = lastId > since ? [{ id: lastId, ts: 1, level: 'critical', kind: 'site', key: 'site:x.example.com', resolved: false, title: 'x.example.com is onbereikbaar', body: 'HTTP 502' }] : [];
        return respond({ last_id: lastId, open: 1, events });
      }
      if (u.pathname === '/v1/agent/update') return respond({ update_available: false, latest: '1.2.0' });
      return respond({ code: 'not_found', message: 'nf' }, 404);
    });
    sched.mockClear();
    const siteCalls = () => sched.mock.calls.filter((c) => String(c[0].content.title).includes('onbereikbaar'));
    await checkNow();
    expect(siteCalls()).toHaveLength(0);
    lastId = 9;
    await checkNow();
    expect(siteCalls().map((c) => c[0].content.title).sort()).toEqual(['garage: x.example.com is onbereikbaar', 'zolder: x.example.com is onbereikbaar']);
    expect(siteCalls()[0][0].content.data.url).toBe('/site/x.example.com');
    // Geen dubbele melding bij de volgende controle.
    await checkNow();
    expect(siteCalls()).toHaveLength(2);
    // Eén melding per probleem per server: een nieuwe vervangt de oude in de balk.
    expect(new Set(siteCalls().map((c) => c[0].identifier)).size).toBe(2);
    expect(siteCalls()[0][0].identifier).toMatch(/\|site:x\.example\.com$/);
  });

  test('flapperen: opgelost haalt de melding weg, terugkomen binnen 6 uur geeft geen nieuwe', () => {
    const { resolvedKeys, throttle, RENOTIFY_MS } = require('@/background/alerts') as typeof import('@/background/alerts');
    const down = (id: number) => ev(id, 'site', { key: 'site:news.example.com', level: 'critical' });
    const up = (id: number) => ev(id, 'site', { key: 'site:news.example.com', level: 'ok', resolved: true });
    expect(resolvedKeys([down(3), up(4)], 2)).toEqual(['site:news.example.com']);
    expect(resolvedKeys([up(4), down(5)], 2)).toEqual([]); // weer open: melding laten staan
    const first = throttle([down(5)], {}, 1000);
    expect(first.show).toHaveLength(1);
    expect(throttle([down(7)], first.notifiedAt, 1000 + 20 * 60_000).show).toHaveLength(0);
    expect(throttle([down(9)], first.notifiedAt, 1000 + RENOTIFY_MS + 1).show).toHaveLength(1);
    // Twee keer dezelfde sleutel in één controle: één melding.
    expect(throttle([down(10), down(11)], {}, 5).show).toHaveLength(1);
  });

  test('veel nieuwe problemen tegelijk: één samenvatting', async () => {
    let checkNow!: typeof import('@/background/alerts').checkNow;
    let settings!: typeof import('@/state/settings');
    let sched!: jest.Mock;
    jest.isolateModules(() => {
      settings = require('@/state/settings');
      const alerts = require('@/background/alerts');
      checkNow = alerts.checkNow;
      let saved = {};
      alerts.alertStateIO.load = () => JSON.parse(JSON.stringify(saved));
      alerts.alertStateIO.save = (v: object) => {
        saved = v;
      };
      sched = require('expo-notifications').scheduleNotificationAsync;
    });
    await settings.wipeAll();
    await settings.addServer(PI_A);
    await settings.savePrefs({ onboarded: true });
    let lastId = 1;
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string) => {
      const u = new URL(url);
      if (u.pathname === '/v1/overview') return respond(FX['/v1/overview']);
      if (u.pathname === '/v1/events') {
        const events = lastId > 1 ? [2, 3, 4, 5, 6].map((i) => ({ id: i, ts: 1, level: 'critical', kind: 'site', key: `site:s${i}.example.com`, resolved: false, title: `s${i}.example.com is onbereikbaar`, body: 'HTTP 502' })) : [];
        return respond({ last_id: lastId, open: events.length, events });
      }
      if (u.pathname === '/v1/agent/update') return respond({ update_available: false, latest: '1.2.0' });
      return respond({ code: 'not_found', message: 'nf' }, 404);
    });
    await checkNow();
    sched.mockClear();
    lastId = 6;
    await checkNow();
    const calls = sched.mock.calls.filter((c) => String(c[0].content.title).includes('nieuwe problemen'));
    expect(calls).toHaveLength(1);
    expect(calls[0][0].content.title).toBe('garage: 5 nieuwe problemen');
    expect(calls[0][0].content.data.url).toBe('/events');
    expect(sched.mock.calls.filter((c) => String(c[0].content.title).includes('onbereikbaar'))).toHaveLength(0);
  });
});

describe('schermen 1.2', () => {
  beforeAll(async () => {
    await wipeAll();
    await addServer({ ...PI_A, name: 'homelab-pi' });
    prefsStore.set({ ...DEFAULT_PREFS, onboarded: true });
    fetchFromFixture();
  });

  test('Updates toont pakketten, beveiligingsupdates en de agent-update', async () => {
    await renderScreen(require('@/app/updates').default);
    expect(await screen.findByText('openssl')).toBeTruthy();
    expect(screen.getByText('5 update(s) klaar')).toBeTruthy();
    expect(screen.getByText('2 beveiliging')).toBeTruthy();
    expect(await screen.findByText(/^Bijwerken naar /)).toBeTruthy();
  });

  test('Updates: een achtergehouden pakket telt niet als klaar en wordt uitgelegd', async () => {
    const upd = FX['/v1/updates'] as Record<string, unknown>;
    const held = {
      ...upd, count: 0, held_count: 1, security_count: 0, full_upgrade_removes: ['oud-pakket'],
      packages: [{ name: 'rpd-common', from: '1.31', to: '1.32', security: false, held: true, reason: 'removal' }],
    };
    const prev = (globalThis as unknown as { fetch: jest.Mock }).fetch;
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string) =>
      new URL(url).pathname === '/v1/updates' ? respond(held) : prev(url));
    (require('@/api/cache') as typeof import('@/api/cache')).cacheClear(); // geen offline-kopie van de vorige test
    await renderScreen(require('@/app/updates').default);
    expect(await screen.findByText('rpd-common')).toBeTruthy();
    expect(screen.getByText('Alles is up-to-date')).toBeTruthy();
    expect(screen.getByText(/1 achtergehouden/)).toBeTruthy();
    expect(screen.getByText(/oud-pakket te verwijderen/)).toBeTruthy();
    (globalThis as unknown as { fetch: jest.Mock }).fetch = prev;
  });

  test('Overzicht: meldingen-knop met teller', async () => {
    const { AlertsButton } = require('@/components/layout') as typeof import('@/components/layout');
    await renderScreen(AlertsButton);
    expect(await screen.findByLabelText('Meldingen: 5 open')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  test('Meldingen toont de gebeurtenissen van de Pi', async () => {
    await renderScreen(require('@/app/events').default);
    expect(await screen.findByText('n8n.example.com is onbereikbaar')).toBeTruthy();
  });

  test('Container: herstartknop voor een container die mag', async () => {
    const router = jest.requireMock('expo-router') as { useLocalSearchParams: jest.Mock };
    router.useLocalSearchParams.mockReturnValue({ id: 'automation-zigbee2mqtt-1' });
    await renderScreen(require('@/app/container/[id]').default);
    expect(await screen.findByText('Container herstarten')).toBeTruthy();
  });

  test('Instellingen toont de servers', async () => {
    await renderScreen(require('@/app/settings').default);
    expect(await screen.findByText('SERVERS')).toBeTruthy();
    expect(screen.getAllByText('homelab-pi').length).toBeGreaterThan(0);
  });
});


describe('demo', () => {
  test('container herstarten, updates en agent-update in de demo', async () => {
    const { demoRequest } = require('@/demo') as typeof import('@/demo');
    const before = (await demoRequest('api', '/v1/containers', 'GET')) as { containers: { name: string; state: string }[] };
    const broken = before.containers.find((c) => c.state !== 'running')!;
    await demoRequest('api', `/v1/containers/${broken.name}/restart`, 'POST');
    const after = (await demoRequest('api', '/v1/containers', 'GET')) as { containers: { name: string; state: string }[] };
    expect(after.containers.find((c) => c.name === broken.name)!.state).toBe('running');
    const upd = (await demoRequest('api', '/v1/updates', 'GET')) as { count: number; upgrade: { running: boolean } };
    expect(upd.count).toBeGreaterThan(0);
    await demoRequest('api', '/v1/updates/install', 'POST');
    expect(((await demoRequest('api', '/v1/updates', 'GET')) as { upgrade: { running: boolean } }).upgrade.running).toBe(true);
    const ag = (await demoRequest('api', '/v1/agent/update', 'GET')) as { update_available: boolean };
    expect(ag.update_available).toBe(true);
  });
});
