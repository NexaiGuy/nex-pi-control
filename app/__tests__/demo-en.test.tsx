// Engelstalige gsm in demo-modus: geen netwerk, alles in het Engels, geen persoonlijke gegevens.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { connectionStore, DEMO_CONNECTION } from '@/state/settings';

jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en', languageTag: 'en-US' }] }));

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

const g = globalThis as unknown as { fetch: jest.Mock };

beforeAll(() => {
  connectionStore.set(DEMO_CONNECTION);
  g.fetch = jest.fn(() => Promise.reject(new Error('network used in demo mode')));
});

afterAll(() => {
  expect(g.fetch).not.toHaveBeenCalled();
});

test('overview in English with demo badge and server name', async () => {
  await renderScreen(require('@/app/(tabs)/index').default);
  expect((await screen.findAllByText('homelab-pi')).length).toBeGreaterThan(0);
  expect(await screen.findByText('DEMO')).toBeTruthy();
  expect(screen.getAllByText(/^temperature$/i).length).toBeGreaterThan(0);
  expect(true).toBeTruthy();
  expect(screen.queryByText(/HAL-9000|nex-ai\.be/)).toBeNull();
});

test('statistics groups use English labels', async () => {
  await renderScreen(require('@/app/(tabs)/stats').default);
  expect((await screen.findAllByText(/^memory$/i))[0]).toBeTruthy();
  expect((await screen.findAllByText(/^cpu per core$/i))[0]).toBeTruthy();
});

test('system shows the Custom filter', async () => {
  await renderScreen(require('@/app/(tabs)/system').default);
  expect(await screen.findByText('Custom')).toBeTruthy();
  expect(await screen.findByText('zigbee2mqtt')).toBeTruthy();
});

test('about screen carries the Nex AI pitch', async () => {
  await renderScreen(require('@/app/about').default);
  expect(await screen.findByText('MADE BY NEX AI')).toBeTruthy();
  expect(screen.getByText('Book a call')).toBeTruthy();
  expect(screen.getByText('Privacy policy')).toBeTruthy();
});

test('settings offers to leave the demo', async () => {
  await renderScreen(require('@/app/settings').default);
  expect(await screen.findByText('Leave demo and connect your own server')).toBeTruthy();
});

test('demo terminal answers commands', () => {
  const { DemoTerminal } = require('@/demo') as typeof import('@/demo');
  const out: string[] = [];
  jest.useFakeTimers();
  const term = new DemoTerminal((s) => out.push(s));
  term.input('whoami\r');
  jest.runAllTimers();
  jest.useRealTimers();
  expect(out.join('')).toContain('\r\npi\r\n');
});
