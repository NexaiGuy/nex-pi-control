// Thema's: wisselen werkt ter plaatse, stylesheets volgen, contrast blijft AA, en schermen renderen in het lichte thema.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import fixtures from './fixtures/mock-api.json';
import { connectionStore, DEFAULT_CONNECTION } from '@/state/settings';
import { applyTheme, colors, getTheme, levelColor, resolveTheme, series, themed, type } from '@/theme/tokens';

const FX = fixtures as Record<string, unknown>;

function respond(body: unknown, status = 200) {
  return Promise.resolve({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
}

function history(metric: string) {
  const now = Math.floor(Date.now() / 1000);
  const points = Array.from({ length: 30 }, (_, i) => [now - (30 - i) * 120, 20 + (i % 7), 15, 30]);
  return { metric, label: metric === 'cpu' ? 'CPU totaal' : metric, unit: '%', group: 'cpu', range: '1h', step: 120, points, summary: { current: 25, min: 15, avg: 22, max: 30 } };
}

beforeAll(() => {
  connectionStore.set({ ...DEFAULT_CONNECTION, name: 'homelab-pi', apiUrl: 'https://pi.example.com', agentToken: 'a'.repeat(48) });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string) => {
    const u = new URL(url);
    if (u.pathname === '/v1/stats/history') {
      const metrics = (u.searchParams.get('metric') ?? 'cpu').split(',');
      return respond(metrics.length === 1 ? history(metrics[0]!) : { range: u.searchParams.get('range'), series: metrics.map(history) });
    }
    if (u.pathname in FX) return respond(FX[u.pathname]);
    return respond({ code: 'not_found', message: 'nf' }, 404);
  });
});

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

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

afterAll(() => {
  applyTheme('dark');
});

describe('thema-keuze', () => {
  test('systeem volgt de gsm, vaste keuze wint', () => {
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', null)).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
  });

  test('applyTheme werkt kleuren, tekststijlen, niveaus en grafiekkleuren ter plaatse bij', () => {
    applyTheme('dark');
    const st = themed(() => StyleSheet.create({ root: { backgroundColor: colors.bg } }));
    expect(st.root.backgroundColor).toBe('#0B0B12');

    expect(applyTheme('light')).toBe(true);
    expect(applyTheme('light')).toBe(false);
    expect(getTheme()).toBe('light');
    expect(colors.bg).toBe('#F6F5FB');
    expect(type.body.color).toBe(colors.text);
    expect(levelColor.ok).toBe(colors.mint);
    expect(series[0]).toBe('#6D28D9');
    expect(st.root.backgroundColor).toBe('#F6F5FB');

    applyTheme('dark');
    expect(st.root.backgroundColor).toBe('#0B0B12');
    expect(series[1]).toBe('#34F5C5');
  });

  test('licht thema haalt WCAG AA voor tekst en statuskleuren', () => {
    applyTheme('light');
    for (const k of ['text', 'textMuted', 'purple', 'mint', 'amber', 'red', 'cyan', 'magenta'] as const) {
      expect(contrast(colors[k], colors.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(colors[k], colors.surface)).toBeGreaterThanOrEqual(4.5);
    }
    for (const c of series.slice(0, 4)) expect(contrast(c, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.bannerTitle, colors.redBanner)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.onAccent, colors.purple)).toBeGreaterThanOrEqual(4.5);
    applyTheme('dark');
  });
});

describe('schermen in het lichte thema', () => {
  beforeAll(() => {
    applyTheme('light');
  });

  test('Overzicht rendert met lichte achtergrond', async () => {
    await renderScreen(require('@/app/(tabs)/index').default);
    expect(await screen.findByText('Kritiek')).toBeTruthy();
    expect(colors.bg).toBe('#F6F5FB');
  });

  test('Instellingen toont de themakeuze', async () => {
    await renderScreen(require('@/app/settings').default);
    expect(await screen.findByText('WEERGAVE')).toBeTruthy();
    expect(screen.getByLabelText('Thema Licht')).toBeTruthy();
    expect(screen.getByLabelText('Thema Systeem')).toBeTruthy();
  });

  test('Statistieken rendert', async () => {
    await renderScreen(require('@/app/(tabs)/stats').default);
    expect(await screen.findAllByText(/CPU/)).not.toHaveLength(0);
  });
});
