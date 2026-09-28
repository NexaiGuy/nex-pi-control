// Rooktest per scherm met echte agent-data (mock-agent, scenario "disk", Nederlands) via het gewone netwerkpad.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import fixtures from './fixtures/mock-api.json';
import { connectionStore, DEFAULT_CONNECTION } from '@/state/settings';

const FX = fixtures as Record<string, unknown>;

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
}

function series(metric: string) {
  const now = Math.floor(Date.now() / 1000);
  const points = Array.from({ length: 30 }, (_, i) => [now - (30 - i) * 120, 20 + (i % 7), 15, 30]);
  return { metric, label: metric === 'cpu' ? 'CPU totaal' : metric, unit: metric.startsWith('site') ? 'ms' : '%', group: 'cpu', range: '1h', step: 120, points, summary: { current: 25, min: 15, avg: 22, max: 30 } };
}

function handler(url: string) {
  const u = new URL(url);
  const p = u.pathname;
  if (p === '/v1/stats/history') {
    const metrics = (u.searchParams.get('metric') ?? 'cpu').split(',');
    return respond(metrics.length === 1 ? series(metrics[0]!) : { range: u.searchParams.get('range'), series: metrics.map(series) });
  }
  if (p === '/v1/processes') return respond(FX[`/v1/processes?sort=${u.searchParams.get('sort') ?? 'cpu'}`]);
  if (/^\/v1\/services\/.+\/logs$/.test(p)) return respond(FX['logs:service']);
  if (/^\/v1\/containers\/.+\/logs$/.test(p)) return respond(FX['logs:container']);
  if (p in FX) return respond(FX[p]);
  return respond({ code: 'not_found', message: 'nf' }, 404);
}

beforeAll(() => {
  connectionStore.set({ ...DEFAULT_CONNECTION, name: 'homelab-pi', apiUrl: 'https://pi.example.com', shellUrl: 'https://pi.example.com:8443', agentToken: 'a'.repeat(48), shellToken: 's'.repeat(48) });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string) => handler(url));
});

export async function renderScreen(Comp: ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 24, left: 0, right: 0, bottom: 24 } }}>
      <QueryClientProvider client={qc}>
        <Comp />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
}

const router = jest.requireMock('expo-router') as { useLocalSearchParams: jest.Mock };

describe('smoke test per scherm (mockdata van de echte agent, scenario "disk")', () => {
  test('Overzicht toont gezondheid, schijfbanner, servernaam en tegels', async () => {
    await renderScreen(require('@/app/(tabs)/index').default);
    expect(await screen.findAllByText(/Schijf \/dev\/sda toont tekenen van falen/)).not.toHaveLength(0);
    expect(await screen.findByText('Kritiek')).toBeTruthy();
    expect(screen.getAllByText('homelab-pi').length).toBeGreaterThan(0);
    expect(screen.getByText('CPU')).toBeTruthy();
    expect(screen.getByText('/mnt/data')).toBeTruthy();
  });

  test('Statistieken toont bereikkeuze en grafiekgroepen', async () => {
    await renderScreen(require('@/app/(tabs)/stats').default);
    expect(await screen.findByText('30d')).toBeTruthy();
    expect((await screen.findAllByText(/^geheugen$/i))[0]).toBeTruthy();
  });

  test('Systeem toont diensten, filter Eigen en gefaalde dienst', async () => {
    await renderScreen(require('@/app/(tabs)/system').default);
    expect(await screen.findByText('zigbee2mqtt')).toBeTruthy();
    expect(screen.getByText('Processen')).toBeTruthy();
  });

  test('Terminal toont beheermodus uit', async () => {
    await renderScreen(require('@/app/(tabs)/terminal').default);
    expect(await screen.findByText('Beheermodus staat uit')).toBeTruthy();
  });

  test('Meer toont alle tools en Over', async () => {
    await renderScreen(require('@/app/(tabs)/more').default);
    for (const label of ['Bestanden', 'GPIO', 'Sensoren', "Commando's", 'Power', 'Wake-on-LAN', 'Pinout', 'Audit log', 'Over']) {
      expect(await screen.findByText(label)).toBeTruthy();
    }
  });

  test('Schijven toont SMART-redenen en veiligheidsmelding', async () => {
    await renderScreen(require('@/app/disks').default);
    expect((await screen.findAllByText(/184 verplaatste sectoren/)).length).toBeGreaterThan(0);
    expect(await screen.findByText('Eerst alles veiligstellen naar gezonde opslag')).toBeTruthy();
  });

  test('Dienstdetail toont logs en herstartknop', async () => {
    router.useLocalSearchParams.mockReturnValue({ name: 'nginx.service' });
    await renderScreen(require('@/app/service/[name]').default);
    expect(await screen.findByText('Herstarten')).toBeTruthy();
    expect((await screen.findAllByText(/Worker heartbeat ok/)).length).toBeGreaterThan(0);
  });

  test('Containerdetail', async () => {
    const id = (FX['/v1/containers'] as { containers: { id: string }[] }).containers[0]!.id;
    router.useLocalSearchParams.mockReturnValue({ id });
    await renderScreen(require('@/app/container/[id]').default);
    expect(await screen.findByText(id)).toBeTruthy();
  });

  test('Sitedetail', async () => {
    router.useLocalSearchParams.mockReturnValue({ host: 'home.example.com' });
    await renderScreen(require('@/app/site/[host]').default);
    expect(await screen.findByText('https://home.example.com')).toBeTruthy();
  });

  test('Metriekdetail', async () => {
    router.useLocalSearchParams.mockReturnValue({ metric: 'cpu' });
    await renderScreen(require('@/app/metric/[metric]').default);
    expect(await screen.findByText('CSV exporteren')).toBeTruthy();
  });

  test.each([
    ['gpio', 'GPIO17'],
    ['sensors', 'Serverkast'],
    ['commands', 'Refresh package lists'],
    ['power', 'Uitschakelen'],
    ['wol', 'Desktop PC'],
    ['backups', 'home-assistant'],
    ['ports', '8080'],
    ['pinout', 'GPIO17'],
    ['audit', /restart-service/],
    ['device', 'Raspberry Pi 5 Model B Rev 1.0'],
    ['settings', 'Drempels voor meldingen'.toUpperCase()],
    ['files', 'Beheermodus starten'],
    ['about', 'Gemaakt door Nex AI'.toUpperCase()],
    ['onboarding', 'Welkom bij Nex Pi Control'],
  ])('scherm %s', async (name, text) => {
    await renderScreen(require(`@/app/${name}`).default);
    await waitFor(async () => expect((await screen.findAllByText(text as string | RegExp)).length).toBeGreaterThan(0));
  });
});
