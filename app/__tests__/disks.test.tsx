// Schijven: elke fysieke schijf zichtbaar (ook USB-SSD's zonder SMART), "OK" nooit zonder gegevens, en de 3D-gloed.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { glowLayers } from '@/components/odyssey';
import { connectionStore, DEFAULT_CONNECTION } from '@/state/settings';
import { applyTheme, colors } from '@/theme/tokens';

const USB_REASON = 'De USB-adapter van deze schijf geeft geen SMART-gegevens door. Gezondheid onbekend.';
const part = (device: string, mp: string | null, extra = {}) => ({ device, size_bytes: 100e9, fstype: 'ext4', label: '', mountpoints: mp ? [mp] : [], ...extra });
const DISKS = {
  mounts: [
    { device: '/dev/sda2', mountpoint: '/', fstype: 'ext4', total: 234e9, used: 142e9, free: 92e9, percent: 63.2 },
    { device: 'nas:/data', mountpoint: '/mnt/nas', fstype: 'nfs4', total: 1e12, used: 1e11, free: 9e11, percent: 10 },
  ],
  smart: [],
  disk_alarms: [],
  disks: [
    { device: '/dev/sda', model: 'TS256GESD310C', transport: 'usb', status: 'unknown', smart_supported: false, attributes: {}, reasons: [USB_REASON],
      capacity_bytes: 256060514304, partitions: [part('/dev/sda1', '/boot/firmware'), part('/dev/sda2', '/', { used: 142e9, total: 234e9, percent: 63.2 })] },
    { device: '/dev/sdb', model: 'TS256GESD310C', transport: 'usb', status: 'unknown', smart_supported: false, attributes: {}, reasons: [USB_REASON],
      capacity_bytes: 256060514304, removable: true, partitions: [part('/dev/sdb1', null, { fstype: 'exfat' })] },
    { device: '/dev/sdc', model: 'Flash Disk', transport: 'usb', status: 'unknown', smart_supported: null, attributes: {}, reasons: ['Nog niet gemeten'], partitions: [] },
  ],
};

beforeAll(() => {
  connectionStore.set({ ...DEFAULT_CONNECTION, name: 'hal-9000', apiUrl: 'https://pi.example.com', agentToken: 'a'.repeat(48) });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest.fn((url: string) => {
    const path = new URL(url).pathname;
    const body = path === '/v1/disks' ? DISKS : path === '/v1/overview' ? { disk_alarms: [] } : {};
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
  });
});

test('alle schijven staan erin, zonder valse OK, met partities en andere mounts', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const Disks = require('@/app/disks').default;
  await render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 412, height: 915 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <QueryClientProvider client={qc}>
        <Disks />
      </QueryClientProvider>
    </SafeAreaProvider>,
  );
  expect(await screen.findByText('/dev/sdc')).toBeTruthy();
  expect(screen.getByText('/dev/sda')).toBeTruthy();
  expect(screen.getByText('/dev/sdb')).toBeTruthy();
  expect(screen.queryByText('OK')).toBeNull();
  expect(screen.getAllByText('Onbekend').length).toBe(3);
  expect(screen.getAllByText(USB_REASON).length).toBe(2);
  expect(screen.getByText('/boot/firmware')).toBeTruthy();
  expect(screen.getByText(/niet gemount/)).toBeTruthy();
  expect(screen.getByText('/mnt/nas')).toBeTruthy(); // hoort bij geen schijf: onder "Andere mounts"
  expect(screen.queryByText('/mnt/nas') && screen.getAllByText('/').length).toBe(1); // / staat enkel bij sda
});

test('de gloed is meerkleurig en 3D, met de statuskleur in kern en bloei', () => {
  applyTheme('dark', 'odyssey');
  for (const sev of ['warning', 'critical'] as const) {
    const layers = glowLayers(sev, 'dark');
    const tones = new Set(layers.map((l) => l.color));
    expect(tones.has(colors.neonA) && tones.has(colors.neonB) && tones.has(colors.neonC)).toBe(true);
    expect(tones.has(sev === 'critical' ? colors.critGlow : colors.warnGlow)).toBe(true);
    expect(layers.some((l) => (l.inset ?? 0) > 0) && layers.some((l) => (l.inset ?? 0) < 0)).toBe(true); // chromatische split
    expect(layers.some((l) => l.dx && l.dy)).toBe(true); // schaduw voor diepte
  }
});
