// Bewust uit en categorieën (agent 1.3.0+): pure functies en de schermen met echte mockdata (scenario "disk", Nederlands).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import fixtures from './fixtures/mock-api.json';
import type { Container, Overview, Service, Site } from '@/api/types';
import { collapsedByDefault, PARKED_KEY, parkedSwitch, reasonLabel, sectionize } from '@/lib/groups';
import { containerLevel, serviceLevel, siteLevel } from '@/lib/status';
import { connectionStore, DEFAULT_CONNECTION } from '@/state/settings';

const FX = fixtures as Record<string, unknown>;

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
}

const LABELS = { groups: [{ name: 'Klanten', source: 'config' }], auto_parked: true, editable: true };
const posts: unknown[] = [];

function handler(url: string, init?: { method?: string; body?: string }) {
  const p = new URL(url).pathname;
  if (p === '/v1/labels') {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(init.body ?? '{}'));
      return respond({ ok: true });
    }
    return respond(LABELS);
  }
  if (/^\/v1\/services\/.+\/logs$/.test(p)) return respond(FX['logs:service']);
  if (/^\/v1\/containers\/.+\/logs$/.test(p)) return respond(FX['logs:container']);
  if (p === '/v1/stats/history') return respond({ metric: 'x', label: 'x', unit: 'ms', group: 'site', range: '24h', step: 60, points: [], summary: { current: null, min: null, avg: null, max: null } });
  if (p in FX) return respond(FX[p]);
  return respond({ code: 'not_found', message: 'nf' }, 404);
}

beforeAll(() => {
  connectionStore.set({ ...DEFAULT_CONNECTION, name: 'homelab-pi', apiUrl: 'https://pi.example.com', shellUrl: 'https://pi.example.com:8443', agentToken: 'a'.repeat(48), shellToken: 's'.repeat(48) });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string, init?: { method?: string; body?: string }) => handler(url, init));
});

async function renderScreen(Comp: ComponentType) {
  // Mutaties ook zonder gc-timer: anders houdt React Query jest nog 5 minuten wakker na een aanpassing.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  return await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 24, left: 0, right: 0, bottom: 24 } }}>
      <QueryClientProvider client={qc}>
        <Comp />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}
const services = FX['/v1/services'] as Service[];
const containers = (FX['/v1/containers'] as { containers: Container[] }).containers;
const sites = (FX['/v1/sites'] as { sites: Site[] }).sites;

describe('sectionize', () => {
  test('per categorie in de volgorde van de agent, bewust uit in één laatste sectie', () => {
    const secs = sectionize(services, () => ({ group: '-', order: 0 }));
    const titles = secs.map((s) => s.title);
    expect(titles).toEqual(['Eigen diensten', 'Systeem', 'Bewust uit']);
    const parked = secs[secs.length - 1]!;
    expect(parked.key).toBe(PARKED_KEY);
    expect(parked.items.map((s) => s.name)).toEqual(['minecraft.service']);
    expect(collapsedByDefault(parked)).toBe(true);
    expect(collapsedByDefault(secs[1]!)).toBe(true); // systeemdiensten dicht
    expect(collapsedByDefault(secs[0]!)).toBe(false);
  });

  test('oudere agent zonder group: de fallback beslist', () => {
    const old = containers.map(({ group: _g, group_source: _s, group_order: _o, parked: _p, ...rest }) => rest as Container);
    const secs = sectionize(old, (x) => ({ group: x.project, order: 1000 }));
    expect(secs.some((s) => s.parked)).toBe(false);
    expect(secs.map((s) => s.title)).toContain('old-blog');
  });

  test('containers per compose-project, gestopt project apart als bewust uit', () => {
    const secs = sectionize(containers, () => ({ group: '-', order: 0 }));
    const parked = secs.find((s) => s.parked)!;
    expect(parked.items.map((c) => c.name).sort()).toEqual(['old-blog-ghost-1', 'old-blog-mysql-1']);
    // De gecrashte zigbee2mqtt (exitcode 1) is geen bewust uit: blijft een probleem.
    expect(parked.items.some((c) => c.name === 'automation-zigbee2mqtt-1')).toBe(false);
  });

  test('sites per domein, met een backend die uit staat', () => {
    const blog = sites.find((s) => s.hostname === 'blog.example.com')!;
    expect(blog.parked).toBe(true);
    expect(reasonLabel(blog.parked_reason)).toBe('de backend staat uit');
    expect(siteLevel(blog)).toEqual({ level: 'unknown', label: 'Bewust uit' });
    const n8n = sites.find((s) => s.hostname === 'n8n.example.com')!;
    expect(siteLevel(n8n).level).toBe('critical');
  });
});

describe('status en schakelaar', () => {
  test('bewust uit is grijs, een gestopte container met oude healthcheck is niet ongezond', () => {
    expect(serviceLevel({ ...services[0]!, active: 'failed', parked: true }).level).toBe('unknown');
    const stopped = { ...containers[0]!, state: 'exited', exit_code: 0, health: 'unhealthy', parked: false };
    expect(containerLevel(stopped).level).toBe('unknown');
  });

  test('parkedSwitch volgt de app-instelling, anders de toestand', () => {
    expect(parkedSwitch({ parked: true })).toBe(true);
    expect(parkedSwitch({ parked: true, parked_setting: false })).toBe(false);
    expect(parkedSwitch({ parked: false, parked_setting: true })).toBe(true);
    expect(parkedSwitch({})).toBe(false);
  });

  test('overzicht: bewust uit telt niet mee', () => {
    const o = FX['/v1/overview'] as Overview;
    expect(o.counts.containers.parked).toBe(2);
    expect(o.counts.sites.parked).toBe(1);
    expect(o.health.reasons.some((r) => r.text.includes('blog.example.com'))).toBe(false);
  });
});

describe('schermen', () => {
  const router = jest.requireMock('expo-router') as { useLocalSearchParams: jest.Mock };

  test('Systeem: chip Bewust uit en een dichte sectie onderaan', async () => {
    router.useLocalSearchParams.mockReturnValue({});
    await renderScreen(require('@/app/(tabs)/system').default);
    expect(await screen.findByText('home-assistant')).toBeTruthy();
    expect(screen.getByText('BEWUST UIT')).toBeTruthy(); // sectiekop
    expect(screen.queryByText('minecraft')).toBeNull(); // dicht
    fireEvent.press(screen.getByLabelText('Bewust uit, 1'));
    expect(await screen.findByText('minecraft')).toBeTruthy();
    expect(screen.getByText('Bewust uit · uitgeschakeld (disabled)')).toBeTruthy();
  });

  test('Sitedetail: categorie en schakelaar, aanpassen stuurt een POST', async () => {
    posts.length = 0;
    router.useLocalSearchParams.mockReturnValue({ host: 'blog.example.com' });
    await renderScreen(require('@/app/site/[host]').default);
    expect(await screen.findByText('example.com (automatisch)')).toBeTruthy();
    expect(screen.getByText(/Herkend als bewust uit: de backend staat uit/)).toBeTruthy();
    fireEvent(screen.getByLabelText('Bewust uitgezet'), 'valueChange', false);
    await waitFor(() => expect(posts).toEqual([{ kind: 'site', name: 'blog.example.com', parked: false }]));
    fireEvent.press(screen.getByLabelText('Categorie: example.com (automatisch)'));
    fireEvent.press(await screen.findByText('Klanten'));
    await waitFor(() => expect(posts[1]).toEqual({ kind: 'site', name: 'blog.example.com', group: 'Klanten' }));
  });
});
