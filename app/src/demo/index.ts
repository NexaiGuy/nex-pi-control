// Ingebouwde demo: voorbeeldgegevens zonder server of netwerk. Voor nieuwe gebruikers en voor de Play Store-review.
// Data komt uit de mock-agent (agent/scripts/export_demo.py), tijdstempels worden naar "nu" verschoven.
import { lang } from '@/i18n';

import en from './demo-en.json';
import nl from './demo-nl.json';

type Json = Record<string, unknown>;
const FX: Json = (lang === 'nl' ? nl : en) as Json;
const BASE_TS = ((FX['/v1/overview'] as { ts: number }).ts ?? 0) as number;
const TIME_KEYS = /(^ts$|_at$|^boot_time$|^created$)/;

function shift<T>(v: T, offset: number): T {
  if (Array.isArray(v)) return v.map((x) => shift(x, offset)) as T;
  if (v && typeof v === 'object') {
    const out: Json = {};
    for (const [k, val] of Object.entries(v as Json)) {
      out[k] = typeof val === 'number' && TIME_KEYS.test(k) && val > 1e9 ? val + offset : shift(val, offset);
    }
    return out as T;
  }
  return v;
}

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function wave(t: number, period: number, lo: number, hi: number, seed = 0): number {
  const base = (Math.sin((2 * Math.PI * t) / period + seed) + 1) / 2;
  const wobble = ((Math.sin((2 * Math.PI * t) / (period / 7.3) + seed * 3) + 1) / 2) * 0.25;
  return lo + (hi - lo) * Math.min(1, base * 0.8 + wobble);
}

function metricValue(metric: string, t: number): number | null {
  const table: Record<string, [number, number, number, number]> = {
    cpu: [3600, 6, 38, 1], ram: [86400, 52, 68, 4], swap: [86400, 2, 9, 5], temp: [3600, 46, 61, 1], fan: [3600, 1800, 3900, 1],
    load1: [3600, 0.4, 2.1, 1], load5: [3600, 0.4, 2.1, 2], load15: [3600, 0.4, 2.1, 3], 'net.rx': [900, 40000, 2400000, 6],
    'net.tx': [900, 60000, 3800000, 7], 'disk.read': [600, 0, 4000000, 8], 'disk.write': [600, 50000, 9000000, 9],
  };
  const row = table[metric];
  if (row) return Math.round(wave(t, row[0], row[1], row[2], row[3]) * 100) / 100;
  if (metric.startsWith('cpu.core')) {
    const i = Number(metric.slice(8)) || 0;
    return Math.round(wave(t, 1800 + i * 300, 3, 45, i + 2) * 10) / 10;
  }
  if (metric === 'throttled') return 0;
  if (metric === 'containers.running') return 30;
  if (metric === 'services.failed') return 1;
  if (metric.startsWith('disk.usage:')) return metric.endsWith('/') ? 41.2 : 73.8;
  if (metric.endsWith('.latency')) return Math.round(wave(t, 1800, 45, 180, metric.length));
  if (metric.startsWith('sensor.')) return Math.round(wave(t, 86400, metric.includes('humidity') ? 38 : 19, metric.includes('humidity') ? 55 : 27, 2) * 10) / 10;
  return null;
}

const RANGES: Record<string, [number, number]> = { '1h': [3600, 10], '6h': [21600, 60], '24h': [86400, 240], '7d': [604800, 1800], '30d': [2592000, 7200] };

function series(metric: string, range: string) {
  const metas = FX['/v1/stats/metrics'] as { metric: string; label: string; unit: string; group: string; group_label?: string }[];
  const meta = metas.find((m) => m.metric === metric) ?? { metric, label: metric, unit: '', group: 'other' };
  const [secs, bucket] = RANGES[range] ?? RANGES['1h']!;
  const end = now();
  const start = end - secs - ((end - secs) % bucket);
  const points: [number, number, number, number][] = [];
  for (let ts = start; ts < end; ts += bucket) {
    const v = metricValue(metric, ts);
    if (v === null) continue;
    const spread = bucket > 10 ? Math.abs(v) * 0.08 : 0;
    points.push([ts, v, v - spread, v + spread]);
  }
  const vals = points.map((p) => p[1]);
  return {
    ...meta,
    range,
    bucket_seconds: bucket,
    points,
    summary: vals.length
      ? { min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length, current: metricValue(metric, end) }
      : { min: null, max: null, avg: null, current: null },
  };
}

function liveOverview() {
  const o = shift(FX['/v1/overview'], now() - BASE_TS) as Json & { system: Json & { cpu: Json } };
  const t = now();
  const perCore = [0, 1, 2, 3].map((i) => metricValue(`cpu.core${i}`, t) ?? 0);
  o.system = {
    ...o.system,
    cpu: { ...o.system.cpu, percent: Math.round((perCore.reduce((a, b) => a + b, 0) / 4) * 10) / 10, per_core: perCore },
    temperature_c: metricValue('temp', t),
    fan_rpm: Math.round(metricValue('fan', t) ?? 0),
    load: [metricValue('load1', t), metricValue('load5', t), metricValue('load15', t)],
    network: { rx_bps: metricValue('net.rx', t), tx_bps: metricValue('net.tx', t) },
    disk_io: { read_bps: metricValue('disk.read', t), write_bps: metricValue('disk.write', t) },
    uptime_seconds: (o.system.uptime_seconds as number) + (t - BASE_TS),
  };
  return o;
}

// Demo-bestanden voor de bestandsbeheerder
const HOME = '/home/pi';
const DEMO_FILES: Record<string, string> = {
  [`${HOME}/docker-compose.yml`]: `services:\n  homeassistant:\n    image: ghcr.io/home-assistant/home-assistant:stable\n    network_mode: host\n    restart: unless-stopped\n    volumes:\n      - ./ha:/config\n`,
  [`${HOME}/notes.md`]: '# Homelab\n\n- Pi 5, 8 GB\n- NVMe 500 GB + data SSD 1 TB\n- Backups every night at 03:00\n',
  [`${HOME}/backup.sh`]: '#!/usr/bin/env bash\nset -euo pipefail\nrsync -a --delete /srv/ /mnt/data/backup/\necho "OK backup done"\n',
};

function listing(path: string) {
  const t = now();
  const entries =
    path === HOME
      ? [
          { name: 'ha', path: `${HOME}/ha`, type: 'dir', size: null, modified: t - 3600, mode: 'drwxr-xr-x', hidden: false },
          { name: 'scripts', path: `${HOME}/scripts`, type: 'dir', size: null, modified: t - 86400, mode: 'drwxr-xr-x', hidden: false },
          ...Object.entries(DEMO_FILES).map(([p, c], i) => ({ name: p.split('/').pop(), path: p, type: 'file', size: c.length, modified: t - 7200 * (i + 1), mode: '-rw-r--r--', hidden: false })),
          { name: '.bashrc', path: `${HOME}/.bashrc`, type: 'file', size: 3771, modified: t - 864000, mode: '-rw-r--r--', hidden: true },
        ]
      : [];
  return { path, root: HOME, writable: true, parent: path === HOME ? null : HOME, entries };
}

function action(message: string, extra: Json = {}) {
  return new Promise((resolve) => setTimeout(() => resolve({ ok: true, message, ...extra }), 700));
}

/** Beheermodus in de demo: enkel in het geheugen, zodat de terminal ook zonder server te proberen is. */
let shellSince: number | null = null;

/** Antwoord van de demo op een API-pad, of undefined als het pad onbekend is. */
export async function demoRequest(target: 'api' | 'shell', path: string, method: string, query: Record<string, unknown> = {}, body?: unknown): Promise<unknown> {
  const offset = now() - BASE_TS;
  const nlang = lang === 'nl';
  if (target === 'shell') {
    if (path === '/v1/status') return { ok: true, user: 'pi', sessions: 0, idle_timeout_seconds: 900, idle_remaining_seconds: 900 - (shellSince ? Math.min(900, now() - shellSince) : 0) };
    if (path === '/v1/files/roots') return [{ path: HOME, label: 'Home', writable: true, exists: true }, { path: '/var/log', label: 'Logs', writable: false, exists: true }];
    if (path === '/v1/files/list') return listing(String(query.path ?? HOME));
    if (path === '/v1/files/read') {
      const p = String(query.path);
      return { path: p, binary: false, content: DEMO_FILES[p] ?? '', truncated: false, size: (DEMO_FILES[p] ?? '').length, modified: Date.now() * 1000, writable: true };
    }
    if (method !== 'GET') return action(nlang ? 'Demo: niets gewijzigd' : 'Demo: nothing changed', { path: query.path ?? (body as Json | undefined)?.path, size: 0, modified: Date.now() * 1000 });
    return undefined;
  }
  if (path === '/v1/overview') return liveOverview();
  if (path === '/v1/stats/history') {
    const metrics = String(query.metric ?? 'cpu').split(',');
    const range = String(query.range ?? '1h');
    return metrics.length === 1 ? series(metrics[0]!, range) : { range, series: metrics.map((m) => series(m, range)) };
  }
  if (path === '/v1/stats/export') {
    const s = series(String(query.metric), String(query.range ?? '24h'));
    return ['timestamp_utc,avg,min,max', ...s.points.map((p) => `${new Date(p[0] * 1000).toISOString()},${p[1]},${p[2]},${p[3]}`)].join('\n');
  }
  if (path === '/v1/processes') return shift(FX[`/v1/processes?sort=${String(query.sort ?? 'cpu')}`] ?? FX['/v1/processes?sort=cpu'], offset);
  if (path === '/v1/services') return FX['/v1/services'];
  if (/^\/v1\/services\/.+\/logs$/.test(path)) return shift(path.includes('zigbee') ? FX['logs:service-failed'] : FX['logs:service'], offset);
  if (/^\/v1\/containers\/.+\/logs$/.test(path)) return FX['logs:container'];
  if (path === '/v1/actions/restart-service') return action(nlang ? `${String((body as Json)?.name)} herstart (demo)` : `${String((body as Json)?.name)} restarted (demo)`);
  if (path === '/v1/actions/power') return action(nlang ? 'Demo: de server zou nu herstarten' : 'Demo: the server would restart now');
  if (/^\/v1\/commands\/.+\/run$/.test(path)) return action('', { output: ['Reading package lists...', '12 packages can be upgraded.', 'Done.'], reason: '' });
  if (/^\/v1\/wol\//.test(path)) return action('', { device: 'Desktop PC' });
  if (/^\/v1\/gpio\/\d+$/.test(path)) return action('', { pin: Number(path.split('/').pop()), value: (body as Json)?.action === 'on' ? 1 : 0 });
  if (path === '/v1/shell') return { ...(FX['/v1/shell'] as Json), active: shellSince !== null, state: shellSince !== null ? 'active' : 'inactive', active_seconds: shellSince !== null ? now() - shellSince : null };
  if (path === '/v1/shell/start') {
    shellSince = shellSince ?? now();
    return action(nlang ? 'Beheermodus gestart (demo)' : 'Admin mode started (demo)');
  }
  if (path === '/v1/shell/stop') {
    shellSince = null;
    return action(nlang ? 'Beheermodus gestopt (demo)' : 'Admin mode stopped (demo)');
  }
  if (path === '/v1/disks/acknowledge-crc') return action('Demo');
  const hit = FX[path];
  return hit === undefined ? undefined : shift(hit, offset);
}

// ---- Demo-terminal: een klein nagebootst shell-antwoord zonder server ------------------------

const PROMPT = '\x1b[38;2;52;245;197mpi@homelab-pi\x1b[0m:\x1b[38;2;139;92;246m~\x1b[0m$ ';

const OUTPUT: Record<string, string> = {
  help: 'Demo commands: uptime, df -h, free -h, docker ps, systemctl --failed, whoami, hostname, clear',
  uptime: ' 14:02:11 up 12 days,  3:12,  1 user,  load average: 0.84, 0.76, 0.71',
  'df -h': 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/nvme0n1p2  476G  197G  255G  44% /\n/dev/nvme0n1p1  512M   65M  447M  13% /boot/firmware\n/dev/sda1       931G  688G  196G  78% /mnt/data',
  'free -h': '               total        used        free      shared  buff/cache   available\nMem:           7.9Gi       5.2Gi       312Mi        84Mi       2.6Gi       2.7Gi\nSwap:          2.0Gi       164Mi       1.8Gi',
  'docker ps': 'CONTAINER ID   IMAGE                                   STATUS         NAMES\n01c0ffee0001   ghcr.io/home-assistant/home-assistant   Up 4 days      homeassistant-core-1\n02c0ffee0002   jellyfin/jellyfin                       Up 4 days      media-jellyfin-1\n03c0ffee0003   pihole/pihole                           Up 9 days      network-pihole-1',
  'systemctl --failed': '  UNIT                LOAD   ACTIVE SUB    DESCRIPTION\n● zigbee2mqtt.service loaded failed failed Zigbee2MQTT\n\n1 loaded units listed.',
  whoami: 'pi',
  hostname: 'homelab-pi',
};

export class DemoTerminal {
  private line = '';
  constructor(private readonly write: (text: string) => void) {
    setTimeout(() => this.write(`\x1b[38;2;138;138;163m${lang === 'nl' ? 'Nex Pi Control demoterminal. Typ help.' : 'Nex Pi Control demo terminal. Type help.'}\x1b[0m\r\n${PROMPT}`), 200);
  }

  input(data: string): void {
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const cmd = this.line.trim();
        this.line = '';
        if (cmd === 'clear') {
          this.write(`\x1b[2J\x1b[H${PROMPT}`);
          continue;
        }
        const miss = lang === 'nl' ? 'niet beschikbaar in de demo (probeer help)' : 'not available in the demo (try help)';
        const out = cmd ? (OUTPUT[cmd] ?? `${cmd.split(' ')[0]}: ${miss}`) : '';
        this.write(`\r\n${out ? `${out.replace(/\n/g, '\r\n')}\r\n` : ''}${PROMPT}`);
      } else if (ch === '\x7f') {
        if (this.line) {
          this.line = this.line.slice(0, -1);
          this.write('\b \b');
        }
      } else if (ch === '\x03') {
        this.line = '';
        this.write(`^C\r\n${PROMPT}`);
      } else if (ch >= ' ') {
        this.line += ch;
        this.write(ch);
      }
    }
  }
}
