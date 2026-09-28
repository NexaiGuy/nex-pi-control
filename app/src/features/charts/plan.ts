import type { MetricMeta } from '@/api/types';
import { t } from '@/i18n';

export interface ChartSpec {
  title: string;
  unit: string;
  metrics: string[];
}

export const GROUP_ORDER = ['cpu', 'memory', 'thermal', 'network', 'disks', 'docker', 'services', 'sites', 'sensors', 'other'];

// Oudere agents (vóór 1.1) stuurden de Nederlandse groepsnaam in plaats van een sleutel.
const LEGACY: Record<string, string> = {
  CPU: 'cpu', Geheugen: 'memory', Thermisch: 'thermal', Netwerk: 'network', Schijven: 'disks', Docker: 'docker',
  Diensten: 'services', Sites: 'sites', Sensoren: 'sensors', Overig: 'other',
};

export function groupKey(m: MetricMeta): string {
  return LEGACY[m.group] ?? m.group;
}

/** Bouwt de grafieken per groep: één grafiek per eenheid, kernen en schijfgebruik apart. */
export function planCharts(group: string, metas: MetricMeta[], groupLabel: string = group): ChartSpec[] {
  const ORDER = ['cpu', 'temp', 'fan', 'load1', 'load5', 'load15', 'ram', 'swap', 'net.rx', 'net.tx', 'disk.read', 'disk.write'];
  const rank = (m: string) => (m.startsWith('cpu.core') ? 0.5 : ORDER.indexOf(m) === -1 ? 99 : ORDER.indexOf(m));
  const sorted = [...metas].sort((a, b) => rank(a.metric) - rank(b.metric) || a.metric.localeCompare(b.metric, 'en', { numeric: true }));
  const buckets = new Map<string, MetricMeta[]>();
  for (const m of sorted) {
    if (m.metric === 'throttled') continue;
    const key = `${m.unit}|${m.metric.startsWith('cpu.core') ? 'core' : m.metric.startsWith('disk.usage:') ? 'usage' : m.metric.startsWith('load') ? 'load' : m.metric.startsWith('sensor.') ? m.metric.split('.')[1] : ''}`;
    const list = buckets.get(key) ?? [];
    list.push(m);
    buckets.set(key, list);
  }
  const specs: ChartSpec[] = [];
  for (const [key, list] of buckets) {
    const [unit, kind] = key.split('|') as [string, string];
    for (let i = 0; i < list.length; i += 8) {
      const chunk = list.slice(i, i + 8);
      let title = chunk.length === 1 ? chunk[0]!.label : groupLabel;
      if (kind === 'core') title = t.stats.perCore;
      else if (kind === 'usage') title = t.stats.usagePerMount;
      else if (kind === 'load') title = t.stats.load;
      else if (group === 'network') title = t.stats.netInOut;
      else if (group === 'disks' && unit === 'B/s') title = t.stats.diskReadWrite;
      else if (group === 'memory') title = t.stats.ramSwap;
      else if (group === 'sites') title = t.stats.siteLatency;
      else if (group === 'sensors') title = t.stats.sensor(kind);
      specs.push({ title, unit, metrics: chunk.map((c) => c.metric) });
    }
  }
  return specs;
}

