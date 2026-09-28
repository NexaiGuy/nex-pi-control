import type { Overview } from '@/api/types';
import { diffAlerts, evaluateAlerts, levelFromPercent } from '@/lib/alerts';
import { DEFAULT_PREFS } from '@/state/settings';

function overview(p: Partial<Overview> = {}): Overview {
  return {
    ts: 1,
    health: { status: 'ok', title: 'Alles in orde', reasons: [] },
    disk_alarms: [],
    system: {
      ts: 1, cpu: { percent: 10, per_core: [10, 10, 10, 10], cores: 4, freq_mhz: 2400 }, load: [0.5, 0.5, 0.5],
      memory: { total: 8, used: 4, available: 4, percent: 50 }, swap: { total: 2, used: 0, percent: 0 }, temperature_c: 50,
      throttling: { available: true, now: [], past: [], raw: '0x0', active: false }, fan_rpm: 2000,
      network: { rx_bps: 0, tx_bps: 0 }, disk_io: { read_bps: 0, write_bps: 0 }, uptime_seconds: 100,
    },
    mounts: [{ device: '/dev/nvme0n1p2', mountpoint: '/', fstype: 'ext4', total: 100, used: 40, free: 60, percent: 40 }],
    smart: [],
    counts: { services: { active: 30, failed: 0, total: 30 }, containers: { running: 33, stopped: 0, total: 33 }, sites: { up: 9, down: 0, total: 9 }, last_backup_age_seconds: 3600 },
    ...p,
  };
}

const th = DEFAULT_PREFS.thresholds;

test('alles in orde geeft geen meldingen', () => {
  expect(evaluateAlerts(overview(), th)).toEqual([]);
});

test('falende schijf is kritiek en komt eerst', () => {
  const o = overview({ disk_alarms: [{ device: '/dev/sda', status: 'failing', message: 'Schijf /dev/sda toont tekenen van falen. Eerst back-up maken.', reasons: ['184 verplaatste sectoren'] }] });
  const a = evaluateAlerts(o, th);
  expect(a[0]).toMatchObject({ kind: 'disk', level: 'critical', key: 'disk:/dev/sda' });
});

test('drempels voor temperatuur, schijf en backup', () => {
  const o = overview({
    mounts: [{ device: '/dev/sda1', mountpoint: '/mnt/data', fstype: 'ext4', total: 100, used: 96, free: 4, percent: 96 }],
    counts: { ...overview().counts, last_backup_age_seconds: 40 * 3600 },
  });
  o.system.temperature_c = 82;
  const kinds = evaluateAlerts(o, th).map((a) => `${a.kind}:${a.level}`);
  expect(kinds).toEqual(expect.arrayContaining(['diskUsage:critical', 'temp:critical', 'backup:warning']));
});

test('diff: enkel nieuwe meldingen, respecteert voorkeuren', () => {
  const o = overview({ health: { status: 'warning', title: '2', reasons: [{ level: 'warning', code: 'services_failed', text: '1 dienst gefaald: x', target: null }, { level: 'warning', code: 'sites_down', text: '1 site: y', target: null }] } });
  const cur = evaluateAlerts(o, th);
  const first = diffAlerts([], cur, DEFAULT_PREFS.notify);
  expect(first.fired).toHaveLength(2);
  const again = diffAlerts(cur.map((a) => a.key), cur, DEFAULT_PREFS.notify);
  expect(again.fired).toHaveLength(0);
  const noSites = diffAlerts([], cur, { ...DEFAULT_PREFS.notify, site: false });
  expect(noSites.fired.map((a) => a.kind)).toEqual(['service']);
  expect(diffAlerts(['temp'], [], DEFAULT_PREFS.notify).resolved).toEqual(['temp']);
});

test('levelFromPercent', () => {
  expect(levelFromPercent(50, 80, 90)).toBe('ok');
  expect(levelFromPercent(85, 80, 90)).toBe('warning');
  expect(levelFromPercent(95, 80, 90)).toBe('critical');
  expect(levelFromPercent(null, 80, 90)).toBe('ok');
});
