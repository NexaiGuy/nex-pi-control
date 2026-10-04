// De cijfers voor de Flex Window-widget, als gewone tekst. De native kant (modules/widget-live, CoverScreen.renderData)
// zet ze in een echte Android-layout (nex_cover_data.xml): Samsungs cover-scherm toont geen vooraf getekende
// widgetafbeelding, een layout wel. Enkel opgemaakte waarden, niveaus en reeksen: nooit adressen of sleutels.
import type { HealthReason } from '@/api/types';

import type { Snapshot } from './data';
import * as F from './odyssey/format';
import { DARK } from './odyssey/palette';
import { alarmText, statusWord, timeText, type Level } from './odyssey/parts';
import { makeCtx } from './registry';

export interface CoverRow {
  label: string;
  value: string;
  level?: Level;
}

export interface CoverModel {
  v: 1;
  level: Level;
  status: string;
  server: string;
  time: string;
  /** Falende schijf: vervangt de kop. */
  alarm: string | null;
  reasons: { text: string; level: string }[];
  /** CPU, RAM, temperatuur, schijf. */
  metrics: CoverRow[];
  /** Load, fan, uptime, swap, updates. */
  left: CoverRow[];
  /** Netwerk in en uit, met de lijn van 24 uur. */
  net: (CoverRow & { spark: number[] })[];
  /** I/O en open meldingen. */
  right: CoverRow[];
  /** Diensten, containers, sites, back-up. */
  counts: CoverRow[];
  foot: string;
  /** Offline: waarden gedempt (laatst bekende toestand). */
  dim: boolean;
}

const round = (v: number[] | undefined) => (v ?? []).map((n) => Math.round(n * 10) / 10);

export function buildCoverModel(snap: Snapshot): CoverModel {
  const c = makeCtx('cover', snap, DARK);
  const s = c.s;
  const o = c.o;
  const sys = o?.system;
  const x = snap.extras;
  if (!snap.configured) {
    return {
      v: 1, level: 'offline', status: s.setupShort, server: '', time: '', alarm: null, reasons: [],
      metrics: [], left: [], net: [], right: [], counts: [], foot: s.setup, dim: true,
    };
  }
  const root = o?.mounts.find((m) => m.mountpoint === '/') ?? o?.mounts[0];
  const reasons: HealthReason[] = c.problem
    ? (o?.health.reasons ?? []).filter((r) => !(c.alarm && r.level === 'critical' && (r.target?.includes(c.alarm) || r.code.startsWith('disk'))))
    : [];
  const up = x.updates;
  const open = x.events ? x.events.filter((e) => !e.resolved).length : null;
  const k = o?.counts;
  const age = k?.last_backup_age_seconds;
  const backupLv: Level = age === null || age === undefined ? 'offline' : k?.backups?.failed ? 'critical' : k?.backups?.old ? 'warning' : 'ok';
  const rx = F.rate(sys?.network.rx_bps);
  const tx = F.rate(sys?.network.tx_bps);
  const device = [x.device?.model?.replace(/ Rev [\d.]+$/, ''), x.agentVersion ? `${s.agent} ${x.agentVersion}` : undefined].filter(Boolean).join(' · ');
  return {
    v: 1,
    level: c.lv,
    status: o || c.off ? statusWord(c, false) : F.NONE,
    server: snap.server,
    time: timeText(c, false),
    alarm: c.alarm ? alarmText(c, 'long') : null,
    reasons: reasons.slice(0, 2).map((r) => ({ text: r.text, level: r.level })),
    metrics: [
      { label: `${s.cpu} %`, value: F.pct(sys?.cpu.percent) },
      { label: `${s.ram} %`, value: F.pct(sys?.memory.percent) },
      { label: `${s.temp} °C`, value: F.temp(sys?.temperature_c) },
      { label: `${s.disk} %`, value: F.pct(root?.percent) },
    ],
    left: [
      { label: s.load, value: (sys?.load ?? []).slice(0, 3).map((v) => F.load(v)).join(' · ') || F.NONE },
      { label: s.fan, value: sys?.fan_rpm === null || sys?.fan_rpm === undefined ? F.NONE : `${F.int(sys.fan_rpm)} rpm` },
      { label: s.uptime, value: F.uptime(sys?.uptime_seconds) },
      { label: s.swap, value: `${F.pct(sys?.swap.percent)} %` },
      { label: s.updates, value: up ? `${up.count} · ${up.held_count ?? 0} ${s.held}` : F.NONE },
    ],
    net: [
      { label: s.in, value: `${rx.v} ${rx.u}`.trim(), spark: round(x.rx24) },
      { label: s.out, value: `${tx.v} ${tx.u}`.trim(), spark: round(x.tx24) },
    ],
    right: [
      { label: s.io, value: sys ? `${s.read} ${F.rateText(sys.disk_io.read_bps)} · ${s.write} ${F.rateText(sys.disk_io.write_bps)}` : F.NONE },
      { label: s.events, value: open === null ? F.NONE : F.int(open), level: open ? 'warning' : 'ok' },
    ],
    counts: [
      { label: s.services, value: k ? `${k.services.active}/${k.services.total}` : F.NONE, level: k?.services.failed ? 'critical' : k ? 'ok' : 'offline' },
      { label: s.containers, value: k ? `${k.containers.running}/${k.containers.total}` : F.NONE, level: k?.containers.stopped ? 'warning' : k ? 'ok' : 'offline' },
      { label: s.sites, value: k ? `${k.sites.up}/${k.sites.total}` : F.NONE, level: k?.sites.down ? 'critical' : k?.sites.warning ? 'warning' : k ? 'ok' : 'offline' },
      { label: s.backup, value: F.age(age), level: backupLv },
    ],
    foot: device || 'Nex Pi Control',
    dim: c.off,
  };
}
