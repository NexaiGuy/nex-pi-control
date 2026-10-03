// Audit 3 oktober 2026: de tegels op Overzicht moeten tonen wat de agent echt meldt.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import fixtures from './fixtures/mock-api.json';
import { connectionStore, DEFAULT_CONNECTION } from '@/state/settings';

const FX = fixtures as unknown as Record<string, Record<string, unknown>>;

function respond(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
}

function overviewWith(counts: Record<string, unknown>) {
  const base = FX['/v1/overview'] as Record<string, unknown>;
  return { ...base, disk_alarms: [], health: { status: 'warning', title: '1 aandachtspunt', reasons: [] }, counts: { ...(base.counts as object), ...counts } };
}

function serve(ov: unknown) {
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string) => {
    const p = new URL(url).pathname;
    if (p === '/v1/overview') return respond(ov);
    if (p === '/v1/stats/history') return respond({ range: '1h', series: [] });
    return respond(FX[p] ?? {});
  });
}

async function renderOverview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const Comp = require('@/app/(tabs)/index').default;
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 24, left: 0, right: 0, bottom: 24 } }}>
      <QueryClientProvider client={qc}><Comp /></QueryClientProvider>
    </SafeAreaProvider>,
  );
}

jest.setTimeout(40000);

beforeAll(() => {
  connectionStore.set({ ...DEFAULT_CONNECTION, name: 'hal', apiUrl: 'https://pi.example.com', agentToken: 'a'.repeat(48) });
});

test('sites met een foutcode zijn niet stil groen', async () => {
  serve(overviewWith({ sites: { up: 52, down: 0, warning: 3, total: 55 } }));
  await renderOverview();
  expect(await screen.findByText('52/55')).toBeTruthy();
  expect(screen.getByText('3 met foutcode')).toBeTruthy();
});

test('oudere agent zonder warning-telling: het verschil telt als foutcode', async () => {
  serve(overviewWith({ sites: { up: 52, down: 0, total: 55 } }));
  await renderOverview();
  expect(await screen.findByText('3 met foutcode')).toBeTruthy();
});

test('een mislukte back-up kleurt de back-uptegel, ook als een andere net gelukt is', async () => {
  serve(overviewWith({ last_backup_age_seconds: 7 * 3600, backups: { failed: 1, old: 0, total: 14 } }));
  await renderOverview();
  expect(await screen.findByText('1 gefaald')).toBeTruthy();
});
