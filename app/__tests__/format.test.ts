import { bytes, duration, mmss, rate, unitValue } from '@/lib/format';
import { planCharts } from '@/features/charts/plan';

test('bytes en rate', () => {
  expect(bytes(0)).toBe('0 B');
  expect(bytes(1536)).toMatch(/^1,5 KB$/);
  expect(bytes(8 * 1024 ** 3, 0)).toBe('8 GB');
  expect(rate(2 * 1024 ** 2)).toBe('2 MB/s');
  expect(bytes(null)).toBe('–');
});

test('duur', () => {
  expect(duration(59)).toBe('59s');
  expect(duration(3 * 86400 + 4 * 3600 + 5 * 60)).toBe('3d 4u');
  expect(duration(3 * 86400 + 4 * 3600 + 5 * 60, 3)).toBe('3d 4u 5m');
  expect(mmss(872)).toBe('14:32');
});

test('eenheden', () => {
  expect(unitValue(51.25, '°C')).toBe('51,3 °C');
  expect(unitValue(120, 'ms')).toBe('120 ms');
  expect(unitValue(null, '%')).toBe('–');
});

test('grafiekplanning groepeert per eenheid', () => {
  const metas = [
    { metric: 'cpu', label: 'CPU totaal', unit: '%', group: 'cpu' },
    { metric: 'cpu.core0', label: 'CPU kern 0', unit: '%', group: 'cpu' },
    { metric: 'cpu.core1', label: 'CPU kern 1', unit: '%', group: 'cpu' },
    { metric: 'load1', label: 'Load 1 min', unit: '', group: 'cpu' },
    { metric: 'load5', label: 'Load 5 min', unit: '', group: 'cpu' },
  ];
  const plan = planCharts('cpu', metas, 'CPU');
  expect(plan.map((p) => p.title)).toEqual(['CPU totaal', 'CPU per kern', 'Load (1, 5, 15 min)']);
  expect(plan[1]!.metrics).toEqual(['cpu.core0', 'cpu.core1']);
  expect(planCharts('thermal', [{ metric: 'throttled', label: 'x', unit: '', group: 'thermal' }])).toEqual([]);
});
