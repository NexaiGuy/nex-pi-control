// De 13 Odyssey-widgets van Nex Pi Control. Elke widget leest enkel echte velden van de agent;
// ontbreekt een veld, dan blijft dat vak weg. Layouts volgen het designsysteem "Nex Pi Control Widgets".
import { FlexWidget, ListWidget, OverlapWidget, SvgWidget } from 'react-native-android-widget';

import type { AgentEvent, Backup, Container, HealthReason, Mount, Site } from '@/api/types';

import type { FleetEntry } from '../data';
import * as F from './format';
import {
  AlarmBand, Bar, BarRow, Diamond, Gap, Grow, Header, KV, Label, Num, Rule, Slab, Space, StatusWord, Txt, alarmText, ctap, eyeColor,
  timeText, valueColor, type Ctx,
} from './parts';
import { band, cores, eye, ring, spark } from './svg';

export type WidgetKind =
  | 'pulse' | 'glance' | 'vitals' | 'strip' | 'overview' | 'command' | 'board'
  | 'sites' | 'containers' | 'backups' | 'disks' | 'network' | 'fleet' | 'cover';

/** Referentiegrootte per widget in dp (een Pixel met 96 x 100 dp celafstand). */
export const REF: Record<WidgetKind, [number, number]> = {
  pulse: [88, 92], glance: [184, 92], vitals: [184, 192], strip: [376, 92], overview: [376, 192], command: [376, 292], board: [376, 392],
  sites: [376, 192], containers: [376, 192], backups: [376, 192], disks: [376, 192], network: [376, 192], fleet: [376, 192],
  // Flex Window van de Galaxy Z Flip: Samsung vraagt minstens 352 x 339 dp.
  cover: [352, 339],
};

// --- gedeeld ------------------------------------------------------------------------------------

function Shell({ c, children, pad = 14, gap = 8 }: { c: Ctx; children: any; pad?: number; gap?: number }) {
  const gradient = c.pal.bgTop !== c.pal.bgBottom ? { backgroundGradient: { from: c.pal.bgTop, to: c.pal.bgBottom, orientation: 'TOP_BOTTOM' as const } } : { backgroundColor: c.pal.bgBottom };
  return (
    <FlexWidget
      {...ctap(c, '/')}
      style={{ width: 'match_parent', height: 'match_parent', flexDirection: 'column', flexGap: gap, padding: pad, borderRadius: 24, borderWidth: 1, borderColor: c.pal.hairline, ...gradient }}
    >
      {children}
    </FlexWidget>
  );
}

const inner = (c: Ctx, pad = 14) => Math.max(40, Math.round(c.w - pad * 2 - 2));
const root = (c: Ctx): Mount | undefined => c.o?.mounts.find((m) => m.mountpoint === '/') ?? c.o?.mounts[0];
const shortDev = (d: string) => d.replace(/^\/dev\//, '');
const sparkPal = (c: Ctx) => ({ line: c.pal.line, s1: c.pal.s1, s2: c.pal.s2, s3: c.pal.s3, s4: c.pal.s4 });

function SpectralBand({ c, w }: { c: Ctx; w: number }) {
  return <SvgWidget svg={band(w, sparkPal(c))} style={{ width: w, height: 2 }} />;
}

function Spark({ c, w, h, pts }: { c: Ctx; w: number; h: number; pts: number[] | undefined }) {
  return <SvgWidget svg={spark(Math.round(w), h, pts ?? [], sparkPal(c), c.off)} style={{ width: Math.round(w), height: h }} />;
}

/** Vier hoofdgetallen; eenheden staan in de labels. Grote letters: procenten zonder decimaal, temperatuur houdt er één. */
function MetricsRow({ c, size, gap = 10 }: { c: Ctx; size: number; gap?: number }) {
  const sys = c.o?.system;
  const r = root(c);
  const col = (label: string, v: string, weight: number, route: string) => (
    <FlexWidget key={label} {...ctap(c, route)} style={{ flex: weight, flexDirection: 'column', flexGap: 3 }}>
      <Label c={c} text={label} />
      <Txt text={v} size={size} color={valueColor(c)} mono />
    </FlexWidget>
  );
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: gap }}>
      {[
        col(`${c.s.cpu} %`, F.pct(sys?.cpu.percent, c.big), 1, '/metric/cpu'),
        col(`${c.s.ram} %`, F.pct(sys?.memory.percent, c.big), 1, '/metric/ram'),
        col(`${c.s.temp} °C`, F.temp(sys?.temperature_c), 1.2, '/metric/temp'),
        col(`${c.s.disk} %`, F.pct(r?.percent, c.big), 1.15, '/disks'),
      ]}
    </FlexWidget>
  );
}

function Tile({ c, label, v, sub, lv, route }: { c: Ctx; label: string; v: string; sub?: string; lv: string; route: string }) {
  return (
    <Slab c={c} route={route}>
      <Label c={c} text={label} size={8.5} spacing={0.1} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 5 }}>
        <Diamond c={c} lv={lv} size={6} />
        <Num c={c} v={v} u={sub} size={13} />
      </FlexWidget>
    </Slab>
  );
}

function CountTiles({ c }: { c: Ctx }) {
  const k = c.o?.counts;
  const showTotal = !c.big;
  const backupLv = k?.backups?.failed ? 'critical' : k?.backups?.old ? 'warning' : 'ok';
  const age = k?.last_backup_age_seconds;
  const ageText = F.age(age);
  const [ageV, ageU] = ageText.includes(' ') ? ageText.split(' ') : [ageText, ''];
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 6 }}>
      <Tile c={c} label={c.s.services} v={F.int(k?.services.active)} sub={showTotal && k ? `/${k.services.total}` : undefined} lv={k?.services.failed ? 'critical' : 'ok'} route="/system?seg=services" />
      <Tile c={c} label={c.s.containers} v={F.int(k?.containers.running)} sub={showTotal && k ? `/${k.containers.total}` : undefined} lv={k?.containers.stopped ? 'warning' : 'ok'} route="/system?seg=containers" />
      <Tile c={c} label={c.s.sites} v={F.int(k?.sites.up)} sub={showTotal && k ? `/${k.sites.total}` : undefined} lv={k?.sites.down || k?.sites.warning ? 'warning' : 'ok'} route="/system?seg=sites" />
      <Tile c={c} label={c.s.backup} v={ageV ?? F.NONE} sub={ageU || undefined} lv={age === null || age === undefined ? 'offline' : backupLv} route="/backups" />
    </FlexWidget>
  );
}

/** Gezondheidsredenen. Wat de rode band al zegt, wordt niet herhaald. Overschot: "+N meer". */
function Reasons({ c, max }: { c: Ctx; max: number }) {
  if (!c.problem) {
    return (
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
        <Diamond c={c} lv={c.off ? 'offline' : 'ok'} size={6} />
        <Grow>
          <Txt text={c.s.noIssues} size={10.5} color={c.pal.muted} fill />
        </Grow>
      </FlexWidget>
    );
  }
  const all: HealthReason[] = (c.o?.health.reasons ?? []).filter(
    (r) => !(c.alarm && r.level === 'critical' && (r.target?.includes(c.alarm) || r.code.startsWith('disk'))),
  );
  const shown = all.slice(0, Math.max(1, max));
  const more = all.length - shown.length;
  if (!shown.length) return <Gap size={0} />;
  return (
    <FlexWidget {...ctap(c, '/events')} style={{ width: 'match_parent', flexDirection: 'column', flexGap: 3 }}>
      {shown.map((r, i) => (
        <FlexWidget key={`${r.code}${i}`} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          <Diamond c={c} lv={r.level} size={6} />
          <Grow>
            <Txt text={r.text} size={10.5} color={c.pal.ink} fill />
          </Grow>
          {more > 0 && i === shown.length - 1 ? <Txt text={c.s.more(more)} size={9} color={c.pal.muted} mono /> : <Gap size={0} />}
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

function MountRows({ c, w, max = 3, h = 3 }: { c: Ctx; w: number; max?: number; h?: number }) {
  const mounts = c.o?.mounts ?? [];
  const smartOf = (m: Mount) => c.o?.smart.find((d) => m.device.startsWith(d.device) || d.device.startsWith(m.device.replace(/\d+$/, '')));
  const rows = mounts.slice(0, max).map((m) => {
    const failing = Boolean(c.alarm && m.device.includes(c.alarm));
    const sm = smartOf(m);
    const lv = failing || sm?.status === 'failing' ? 'critical' : sm?.status === 'warning' ? 'warning' : sm ? 'ok' : 'offline';
    return (
      <FlexWidget key={m.mountpoint} style={{ width: 'match_parent', flexDirection: 'column', flexGap: 3 }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          <Diamond c={c} lv={lv} size={6} />
          <Grow>
            <Txt text={m.mountpoint} size={9.5} color={valueColor(c)} mono fill />
          </Grow>
          <Txt text={`${F.pct(m.percent)} %`} size={9.5} color={c.pal.muted} mono />
        </FlexWidget>
        <Bar c={c} w={w} pct={m.percent} lv={failing ? 'critical' : 'ok'} h={h} />
      </FlexWidget>
    );
  });
  if (mounts.length > max) rows.push(<Txt key="more" text={c.s.more(mounts.length - max)} size={9} color={c.pal.muted} mono />);
  return (
    <FlexWidget {...ctap(c, '/disks')} style={{ width: 'match_parent', flexDirection: 'column', flexGap: 6 }}>
      {rows}
    </FlexWidget>
  );
}

function CoresRow({ c, withCpu }: { c: Ctx; withCpu: boolean }) {
  const cpu = c.o?.system.cpu;
  const per = cpu?.per_core ?? [];
  const freq = cpu?.freq_mhz ? `${cpu.freq_mhz} MHz` : '';
  const bars = per.length ? (
    <SvgWidget svg={cores(52, withCpu ? 24 : 18, per, String(c.off ? c.pal.muted : c.pal.purple), c.pal.line)} style={{ width: 52, height: withCpu ? 24 : 18 }} />
  ) : (
    <Gap size={0} />
  );
  return (
    <FlexWidget {...ctap(c, '/metric/cpu')} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'flex-end', flexGap: 10 }}>
      <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 3 }}>
        <Label c={c} text={withCpu ? (freq ? `${c.s.cpu} · ${freq}` : c.s.cpu) : c.s.cores} size={8.5} />
        {withCpu ? <Num c={c} v={F.pct(cpu?.percent)} u="%" size={18} /> : <Txt text={freq || F.NONE} size={10} color={valueColor(c)} mono />}
      </FlexWidget>
      <FlexWidget style={{ flexDirection: 'column', alignItems: 'flex-end', flexGap: 2 }}>
        {bars}
        {!c.big && per.length && per.length <= 8 ? <Txt text={per.map((v) => F.int(v)).join(' ')} size={8.5} color={c.pal.muted} mono /> : <Gap size={0} />}
      </FlexWidget>
    </FlexWidget>
  );
}

function NetLines({ c, w, sh }: { c: Ctx; w: number; sh: number }) {
  const net = c.o?.system.network;
  const line = (label: string, bps: number | undefined, pts: number[] | undefined, route: string) => {
    const r = F.rate(bps);
    return (
      <FlexWidget key={label} {...ctap(c, route)} style={{ width: 'match_parent', flexDirection: 'column', flexGap: 2 }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'flex-end', flexGap: 6 }}>
          <Label c={c} text={label} size={8.5} />
          <Space />
          <Num c={c} v={r.v} u={r.u} size={12} />
        </FlexWidget>
        <Spark c={c} w={w} h={sh} pts={pts} />
      </FlexWidget>
    );
  };
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', flexGap: 5 }}>
      {[line(c.s.in, net?.rx_bps, c.snap.extras.rx24, '/metric/net.rx'), line(c.s.out, net?.tx_bps, c.snap.extras.tx24, '/metric/net.tx')]}
    </FlexWidget>
  );
}

// --- de widgets ---------------------------------------------------------------------------------

function Pulse(c: Ctx) {
  const t = c.o?.system.temperature_c;
  const foot = c.alarm ? (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 4 }}>
      <Diamond c={c} lv="critical" size={6} />
      <Label c={c} text={c.s.disk} size={8.5} color={c.pal.ink} />
    </FlexWidget>
  ) : (
    <Txt text={c.off ? c.s.offline.toLowerCase() : F.clock(c.snap.updatedAt)} size={9} color={c.pal.muted} mono />
  );
  const es = c.big ? 28 : 32;
  return (
    <Shell c={c} pad={c.big ? 7 : 10} gap={0}>
      <FlexWidget style={{ width: 'match_parent', height: 'match_parent', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGap: 5 }}>
        <SvgWidget svg={eye(es, eyeColor(c, c.alarm ? 'critical' : c.lv), c.pal.lens, c.pal.line, c.off)} style={{ width: es, height: es }} />
        <Num c={c} v={F.temp(t)} u="°C" size={15} />
        {foot}
      </FlexWidget>
    </Shell>
  );
}

function Glance(c: Ctx) {
  const sys = c.o?.system;
  const compact = c.big || Boolean(c.alarm);
  const body = compact ? (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'flex-end', flexGap: 12 }}>
      <FlexWidget {...ctap(c, '/metric/temp')} style={{ flex: 1 }}>
        <Num c={c} v={F.temp(sys?.temperature_c)} u="°C" size={22} />
      </FlexWidget>
      <FlexWidget {...ctap(c, '/metric/cpu')}>
        <Num c={c} v={F.pct(sys?.cpu.percent, true)} u="%" size={22} />
      </FlexWidget>
    </FlexWidget>
  ) : (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'flex-end', flexGap: 12 }}>
      <FlexWidget {...ctap(c, '/metric/temp')} style={{ flex: 1, flexDirection: 'column', flexGap: 3 }}>
        <Label c={c} text={c.s.temp} />
        <Num c={c} v={F.temp(sys?.temperature_c)} u="°C" size={22} />
      </FlexWidget>
      <FlexWidget {...ctap(c, '/metric/cpu')} style={{ flex: 1, flexDirection: 'column', flexGap: 3 }}>
        <Label c={c} text={c.s.cpu} />
        <Num c={c} v={F.pct(sys?.cpu.percent)} u="%" size={22} />
      </FlexWidget>
    </FlexWidget>
  );
  return (
    <Shell c={c} pad={12} gap={6}>
      <Header c={c} short noTitle wordSize={9.5} />
      <Space />
      {body}
    </Shell>
  );
}

function Vitals(c: Ctx) {
  const sys = c.o?.system;
  const r = root(c);
  const rs = c.big || c.h < 180 ? 46 : 52;
  const col = String(c.off ? c.pal.muted : c.pal.purple);
  const cell = (label: string, v: string, pct: number, route: string) => (
    <FlexWidget key={label} {...ctap(c, route)} style={{ flex: 1, flexDirection: 'column', alignItems: 'center', flexGap: 4 }}>
      <OverlapWidget style={{ width: rs, height: rs }}>
        <SvgWidget svg={ring(rs, pct, col, c.pal.line, 3)} style={{ width: rs, height: rs }} />
        <FlexWidget style={{ width: rs, height: rs, alignItems: 'center', justifyContent: 'center' }}>
          <Txt text={v} size={12} color={valueColor(c)} mono />
        </FlexWidget>
      </OverlapWidget>
      <Label c={c} text={label} size={8.5} />
    </FlexWidget>
  );
  const t = sys?.temperature_c ?? 0;
  return (
    <Shell c={c} pad={12} gap={6}>
      <Header c={c} short noServer noTitle wordSize={9.5} />
      <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'column', justifyContent: 'space-around' }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row' }}>
          {[cell(`${c.s.cpu} %`, F.pct(sys?.cpu.percent), sys?.cpu.percent ?? 0, '/metric/cpu'), cell(`${c.s.ram} %`, F.pct(sys?.memory.percent), sys?.memory.percent ?? 0, '/metric/ram')]}
        </FlexWidget>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row' }}>
          {[cell(`${c.s.temp} °C`, F.temp(sys?.temperature_c), (t / 85) * 100, '/metric/temp'), cell(`${c.s.disk} ${r?.mountpoint ?? '/'}`, F.pct(r?.percent), r?.percent ?? 0, '/disks')]}
        </FlexWidget>
      </FlexWidget>
    </Shell>
  );
}

function Strip(c: Ctx) {
  const sys = c.o?.system;
  const r = root(c);
  const left = c.alarm ? (
    <FlexWidget {...ctap(c, '/disks')} style={{ flexDirection: 'column', justifyContent: 'center', flexGap: 3, backgroundColor: c.pal.crit, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 5 }}>
        <Diamond c={c} lv="critical" size={6} color={c.pal.onCrit} />
        <Label c={c} text={c.s.disk} color={c.pal.onCrit} />
      </FlexWidget>
      <Txt text={c.alarm} size={10} color={c.pal.onCrit} mono />
      <Txt text={F.clock(c.snap.updatedAt)} size={10} color={c.pal.onCrit} mono />
    </FlexWidget>
  ) : (
    <FlexWidget {...ctap(c, '/')} style={{ flexDirection: 'column', flexGap: 5 }}>
      <StatusWord c={c} size={9.5} compact />
      <Txt text={timeText(c, true)} size={10} color={c.pal.muted} mono />
    </FlexWidget>
  );
  const col = (label: string, v: string, weight: number, route: string) => (
    <FlexWidget key={label} {...ctap(c, route)} style={{ flex: weight, flexDirection: 'column', flexGap: 4 }}>
      <Label c={c} text={label} />
      <Txt text={v} size={22} color={valueColor(c)} mono />
    </FlexWidget>
  );
  return (
    <Shell c={c} pad={12}>
      <FlexWidget style={{ width: 'match_parent', height: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 8 }}>
        {left}
        <FlexWidget style={{ width: 1, height: 'match_parent', backgroundColor: c.pal.hairline }} />
        {[
          col(`${c.s.cpu} %`, F.pct(sys?.cpu.percent, c.big), 1, '/metric/cpu'),
          col(`${c.s.ram} %`, F.pct(sys?.memory.percent, c.big), 1, '/metric/ram'),
          col(`${c.s.temp} °C`, F.temp(sys?.temperature_c), 1.3, '/metric/temp'),
          col(`${c.s.disk} %`, F.pct(r?.percent, c.big), 1.15, '/disks'),
        ]}
      </FlexWidget>
    </Shell>
  );
}

function Overview(c: Ctx) {
  const w = inner(c);
  const showSpark = !c.big && c.h >= 170;
  return (
    <Shell c={c} gap={9}>
      <Header c={c} />
      <SpectralBand c={c} w={w} />
      <MetricsRow c={c} size={26} />
      {showSpark ? (
        <FlexWidget {...ctap(c, '/metric/cpu')} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 10 }}>
          <FlexWidget style={{ width: 56 }}>
            <Label c={c} text={`${c.s.cpu} · 1H`} size={8.5} />
          </FlexWidget>
          <Spark c={c} w={w - 66} h={20} pts={c.snap.extras.cpu1h} />
        </FlexWidget>
      ) : (
        <Space />
      )}
      <CountTiles c={c} />
    </Shell>
  );
}

function Command(c: Ctx) {
  const sys = c.o?.system;
  const colW = Math.round((inner(c) - 16) * 0.5);
  const right = inner(c) - colW - 16;
  const tight = c.big || c.h < 270;
  return (
    <Shell c={c} gap={9}>
      <Header c={c} />
      {c.problem ? <Reasons c={c} max={tight ? 1 : 2} /> : <SpectralBand c={c} w={inner(c)} />}
      {c.problem ? <Gap size={0} /> : <Reasons c={c} max={1} />}
      <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'row', flexGap: 16 }}>
        <FlexWidget style={{ width: colW, flexDirection: 'column', flexGap: 7 }}>
          <CoresRow c={c} withCpu />
          <BarRow c={c} label={c.s.ram} value={`${F.bytesText(sys?.memory.used)} / ${F.bytesText(sys?.memory.total)}`} pct={sys?.memory.percent ?? 0} w={colW} route="/metric/ram" />
          <BarRow c={c} label={c.s.swap} value={`${F.pct(sys?.swap.percent)} %`} pct={sys?.swap.percent ?? 0} w={colW} lv={swapLevel(c)} route="/metric/swap" />
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 10 }}>
            <FlexWidget {...ctap(c, '/metric/temp')} style={{ flex: 1, flexDirection: 'column', flexGap: 2 }}>
              <Label c={c} text={c.s.temp} size={8.5} />
              <Num c={c} v={F.temp(sys?.temperature_c)} u="°C" size={15} />
            </FlexWidget>
            <FlexWidget {...ctap(c, '/metric/fan')} style={{ flex: 1, flexDirection: 'column', flexGap: 2 }}>
              <Label c={c} text={c.s.fan} size={8.5} />
              <Num c={c} v={F.int(sys?.fan_rpm)} u={sys?.fan_rpm === null ? undefined : 'rpm'} size={15} />
            </FlexWidget>
          </FlexWidget>
        </FlexWidget>
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 9 }}>
          <NetLines c={c} w={right} sh={14} />
          <MountRows c={c} w={right} max={2} />
        </FlexWidget>
      </FlexWidget>
      <CountTiles c={c} />
    </Shell>
  );
}

function swapLevel(c: Ctx): string {
  const named = c.o?.health.reasons.find((r) => /swap/i.test(r.code) || /swap/i.test(r.target ?? ''));
  return named ? named.level : 'ok';
}

/** Zoals in de app: "protected" (achter Cloudflare Access, 401/403) is in orde. */
function siteLevel(s: Site): string {
  return s.state === 'down' ? 'critical' : s.state === 'warning' ? 'warning' : 'ok';
}
const SITE_RANK: Record<Site['state'], number> = { down: 0, warning: 1, protected: 2, up: 2 };
/** Problemen eerst, daarna de traagste. */
function worstSites(list: Site[] | undefined): Site[] {
  return [...(list ?? [])].sort((a, b) => SITE_RANK[a.state] - SITE_RANK[b.state] || (b.latency_ms ?? 0) - (a.latency_ms ?? 0));
}
/** Volledige lijst: problemen eerst, daarna alfabetisch. */
function allSites(list: Site[] | undefined): Site[] {
  return [...(list ?? [])].sort((a, b) => SITE_RANK[a.state] - SITE_RANK[b.state] || a.hostname.localeCompare(b.hostname));
}

function openEvents(list: AgentEvent[] | undefined): AgentEvent[] {
  return [...(list ?? [])].filter((e) => !e.resolved).sort((a, b) => b.ts - a.ts);
}

function ListBlock({ c, title, route, children }: { c: Ctx; title: string; route: string; children: any }) {
  return (
    <FlexWidget {...ctap(c, route)} style={{ flex: 1, flexDirection: 'column', flexGap: 3 }}>
      <Label c={c} text={title} size={8.5} />
      {children}
    </FlexWidget>
  );
}

function SiteLines({ c, n }: { c: Ctx; n: number }) {
  const list = worstSites(c.snap.extras.sites).slice(0, n);
  if (!list.length) return <Txt text={c.s.noSites} size={10} color={c.pal.muted} />;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', flexGap: 2 }}>
      {list.map((s) => (
        <FlexWidget key={s.hostname} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          <Diamond c={c} lv={siteLevel(s)} size={6} />
          <Grow>
            <Txt text={s.hostname} size={9.5} color={valueColor(c)} mono fill />
          </Grow>
          <Txt text={s.latency_ms !== null && s.latency_ms !== undefined && s.state !== 'down' ? `${F.int(s.latency_ms)} ms` : String(s.status_code ?? F.NONE)} size={9.5} color={c.pal.muted} mono />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

function EventLines({ c, n }: { c: Ctx; n: number }) {
  const ev = openEvents(c.snap.extras.events).slice(0, n);
  if (!ev.length) return <Txt text={c.s.noIssues} size={10} color={c.pal.muted} />;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', flexGap: 2 }}>
      {ev.map((e) => (
        <FlexWidget key={String(e.id)} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          <Diamond c={c} lv={e.level === 'info' ? 'ok' : e.level} size={6} />
          <Grow>
            <Txt text={e.title} size={10} color={valueColor(c)} fill />
          </Grow>
          <Txt text={F.clock(e.ts < 1e12 ? e.ts * 1000 : e.ts)} size={9} color={c.pal.muted} mono />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

function Board(c: Ctx) {
  const sys = c.o?.system;
  const big5 = c.h >= 460;
  const colW = 160;
  const right = inner(c) - colW - 16;
  const x = c.snap.extras;
  const up = x.updates;
  const io = sys ? `${c.s.read} ${F.rateText(sys.disk_io.read_bps)} · ${c.s.write} ${F.rateText(sys.disk_io.write_bps)}` : F.NONE;
  const rows = big5 ? (c.big ? 2 : 3) : 2;
  const showLists = big5 || !c.big;
  const reasonsMax = c.big || (!big5 && c.alarm) ? 1 : 2;
  const device = [x.device?.model, x.device?.os, x.agentVersion ? `${c.s.agent} ${x.agentVersion}` : undefined].filter(Boolean).join(' · ');
  return (
    <Shell c={c} gap={big5 ? 11 : 7}>
      <Header c={c} />
      {c.problem ? <Reasons c={c} max={reasonsMax} /> : <SpectralBand c={c} w={inner(c)} />}
      <MetricsRow c={c} size={big5 ? 30 : 24} />
      {big5 && !c.big ? (
        <FlexWidget {...ctap(c, '/metric/cpu')} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 10 }}>
          <FlexWidget style={{ width: 56 }}>
            <Label c={c} text={`${c.s.cpu} · 1H`} size={8.5} />
          </FlexWidget>
          <Spark c={c} w={inner(c) - 66} h={22} pts={x.cpu1h} />
        </FlexWidget>
      ) : (
        <Gap size={0} />
      )}
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 16 }}>
        <FlexWidget style={{ width: colW, flexDirection: 'column', flexGap: 6 }}>
          <CoresRow c={c} withCpu={false} />
          <BarRow c={c} label={c.s.ram} value={`${F.bytesText(sys?.memory.used)} / ${F.bytesText(sys?.memory.total)}`} pct={sys?.memory.percent ?? 0} w={colW} route="/metric/ram" />
          <BarRow c={c} label={c.s.swap} value={`${F.pct(sys?.swap.percent)} %`} pct={sys?.swap.percent ?? 0} w={colW} lv={swapLevel(c)} route="/metric/swap" />
          <KV c={c} label={c.s.load} value={(sys?.load ?? []).slice(0, 3).map((v) => F.load(v)).join(' · ') || F.NONE} route="/metric/load1" />
          <KV c={c} label={c.s.fan} value={sys?.fan_rpm === null || sys?.fan_rpm === undefined ? F.NONE : `${F.int(sys.fan_rpm)} rpm`} route="/metric/fan" />
          <KV c={c} label={c.s.uptime} value={F.uptime(sys?.uptime_seconds)} />
        </FlexWidget>
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 6 }}>
          <NetLines c={c} w={right} sh={big5 ? 14 : 10} />
          <KV c={c} label={c.s.io} value={io} route="/metric/disk.write" />
          <MountRows c={c} w={right} max={2} />
          <KV c={c} label={c.s.updates} value={up ? `${up.count} · ${up.held_count ?? 0} ${c.s.held}` : F.NONE} route="/updates" />
        </FlexWidget>
      </FlexWidget>
      <CountTiles c={c} />
      {showLists ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 16 }}>
          <ListBlock c={c} title={`${c.s.sites} · ${c.s.latency}`} route="/system?seg=sites">
            <SiteLines c={c} n={rows} />
          </ListBlock>
          <ListBlock c={c} title={c.s.events} route="/events">
            <EventLines c={c} n={rows} />
          </ListBlock>
        </FlexWidget>
      ) : (
        <Gap size={0} />
      )}
      <Space />
      {device ? <Txt text={device} size={9} color={c.pal.muted} mono /> : <Gap size={0} />}
    </Shell>
  );
}

// --- Flex Window (cover-scherm) -------------------------------------------------------------------

/**
 * Vrije zone rechtsonder: daar heeft het cover-scherm van de Flip 5 een uitsparing (zie de widgetbewerker van
 * Samsung: ongeveer de halve breedte, een tiende van de hoogte). In dp, ruim genomen.
 */
export const COVER_CAMERAS = { w: 150, h: 40 } as const;

/**
 * Alles in één blik op het cover-scherm, na het intro (logo en draaiende behuizing, native: modules/widget-live).
 * Elke tik opent het volledige cover-scherm van de app (tapTo, zie registry).
 * Op het cover-scherm zelf tekent de native layout nex_cover_data.xml (src/widget/coverModel.ts): Samsung toont daar
 * geen vooraf getekende widgetafbeelding. Deze versie is de reserve als de native kant ontbreekt.
 */
function Cover(c: Ctx) {
  const sys = c.o?.system;
  const x = c.snap.extras;
  const pad = 14;
  const w = inner(c, pad);
  const colGap = 14;
  const colW = Math.round((w - colGap) / 2);
  const tight = c.big || c.problem || Boolean(c.alarm) || c.h < 330;
  const up = x.updates;
  const open = openEvents(x.events).length;
  const io = sys ? `${c.s.read} ${F.rateText(sys.disk_io.read_bps)} · ${c.s.write} ${F.rateText(sys.disk_io.write_bps)}` : F.NONE;
  const fan = sys?.fan_rpm === null || sys?.fan_rpm === undefined ? F.NONE : `${F.int(sys.fan_rpm)} rpm`;
  const k = c.o?.counts;
  const backupLv = k?.backups?.failed ? 'critical' : k?.backups?.old ? 'warning' : 'ok';
  const age = k?.last_backup_age_seconds;
  const ageText = F.age(age);
  const [ageV, ageU] = ageText.includes(' ') ? ageText.split(' ') : [ageText, ''];
  const total = !c.big;
  return (
    <Shell c={c} pad={pad} gap={tight ? 6 : 8}>
      <Header c={c} />
      {c.problem ? <Reasons c={c} max={c.big ? 1 : 2} /> : <SpectralBand c={c} w={w} />}
      <MetricsRow c={c} size={tight ? 22 : 26} />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: colGap }}>
        <FlexWidget style={{ width: colW, flexDirection: 'column', flexGap: tight ? 4 : 5 }}>
          <KV c={c} label={c.s.load} value={(sys?.load ?? []).slice(0, 3).map((v) => F.load(v)).join(' · ') || F.NONE} route="/cover" />
          <KV c={c} label={c.s.fan} value={fan} route="/cover" />
          <KV c={c} label={c.s.uptime} value={F.uptime(sys?.uptime_seconds)} route="/cover" />
          <KV c={c} label={c.s.swap} value={`${F.pct(sys?.swap.percent)} %`} route="/cover" />
          <KV c={c} label={c.s.updates} value={up ? `${up.count} · ${up.held_count ?? 0} ${c.s.held}` : F.NONE} route="/cover" />
        </FlexWidget>
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: tight ? 4 : 5 }}>
          <NetLines c={c} w={w - colW - colGap} sh={tight ? 6 : 9} />
          <KV c={c} label={c.s.io} value={io} route="/cover" />
          <KV c={c} label={c.s.events} value={x.events ? F.int(open) : F.NONE} route="/cover" />
        </FlexWidget>
      </FlexWidget>
      <Space />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'flex-end', flexGap: 8 }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 6 }}>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 6 }}>
            <Tile c={c} label={c.s.services} v={F.int(k?.services.active)} sub={total && k ? `/${k.services.total}` : undefined} lv={k?.services.failed ? 'critical' : 'ok'} route="/cover" />
            <Tile c={c} label={c.s.containers} v={F.int(k?.containers.running)} sub={total && k ? `/${k.containers.total}` : undefined} lv={k?.containers.stopped ? 'warning' : 'ok'} route="/cover" />
          </FlexWidget>
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 6 }}>
            <Tile c={c} label={c.s.sites} v={F.int(k?.sites.up)} sub={total && k ? `/${k.sites.total}` : undefined} lv={k?.sites.down || k?.sites.warning ? 'warning' : 'ok'} route="/cover" />
            <Tile c={c} label={c.s.backup} v={ageV ?? F.NONE} sub={ageU || undefined} lv={age === null || age === undefined ? 'offline' : backupLv} route="/cover" />
          </FlexWidget>
        </FlexWidget>
        <FlexWidget style={{ width: COVER_CAMERAS.w, height: COVER_CAMERAS.h }} />
      </FlexWidget>
    </Shell>
  );
}

// --- specialisten -------------------------------------------------------------------------------

function SpecHeader({ c, title, right, route, lv }: { c: Ctx; title: string; right: string; route: string; lv: string }) {
  if (c.alarm) return <AlarmBand c={c} text={alarmText(c, 'long')} />;
  return (
    <FlexWidget {...ctap(c, route)} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
      <Diamond c={c} lv={c.off ? 'offline' : lv} />
      <Label c={c} text={title} size={10} color={c.pal.ink} />
      <Grow>
        <Txt text={`· ${c.snap.server}`} size={10} color={c.pal.muted} mono fill />
      </Grow>
      <Txt text={right ? `${right} · ${timeText(c, true)}` : timeText(c, true)} size={10} color={c.pal.muted} mono />
    </FlexWidget>
  );
}

function Stat({ c, label, v, lv }: { c: Ctx; label: string; v: string; lv?: string }) {
  return (
    <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 2 }}>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 5 }}>
        {lv ? <Diamond c={c} lv={lv} size={6} /> : <Gap size={0} />}
        <Label c={c} text={label} size={8.5} />
      </FlexWidget>
      <Txt text={v} size={18} color={valueColor(c)} mono />
    </FlexWidget>
  );
}

interface Row {
  key: string;
  lv: string;
  name: string;
  cols: { text: string; w: number; ink?: boolean }[];
  hi?: boolean;
  /** Tikken op de rij opent dit scherm. */
  route?: string;
}

function RowLine({ c, r }: { c: Ctx; r: Row }) {
  return (
    <FlexWidget
      {...(r.route ? ctap(c, r.route) : {})}
      style={{
        width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 8, paddingHorizontal: 4, paddingVertical: 5, borderRadius: 4,
        ...(r.hi ? { backgroundColor: c.pal.surface, borderWidth: 1, borderColor: c.pal.hairline } : {}),
      }}
    >
      <Diamond c={c} lv={r.lv} size={6} />
      <Grow>
        <Txt text={r.name} size={10} color={valueColor(c)} mono fill />
      </Grow>
      {r.cols.map((col, i) => (
        <FlexWidget key={String(i)} style={{ width: Math.round(col.w * c.fs), flexDirection: 'row', justifyContent: 'flex-end' }}>
          <Txt text={col.text} size={10} color={col.ink ? valueColor(c) : c.pal.muted} mono align="right" />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
}

/** Alle rijen, scrollbaar binnen de widget: niets valt weg, hoe lang de lijst ook is. */
function ScrollList({ children }: { children: any[] }) {
  return (
    <FlexWidget style={{ width: 'match_parent', flex: 1 }}>
      <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>{children}</ListWidget>
    </FlexWidget>
  );
}

function RowList({ c, rows, empty }: { c: Ctx; rows: Row[]; empty: string }) {
  if (!rows.length) return <Empty c={c} text={empty} />;
  return <ScrollList>{rows.map((r) => <RowLine key={r.key} c={c} r={r} />)}</ScrollList>;
}

function Empty({ c, text }: { c: Ctx; text: string }) {
  return <Txt text={text} size={10.5} color={c.pal.muted} />;
}

function Sites(c: Ctx) {
  const k = c.o?.counts.sites;
  const list = c.snap.extras.sites;
  const down = k?.down ?? list?.filter((s) => s.state === 'down').length ?? 0;
  const warning = k?.warning ?? list?.filter((s) => s.state === 'warning').length ?? 0;
  const rows: Row[] = allSites(list).map((s) => ({
      key: s.hostname,
      lv: siteLevel(s),
      name: s.hostname,
      route: `/site/${encodeURIComponent(s.hostname)}`,
      cols: [
        { text: s.status_code ? String(s.status_code) : F.NONE, w: 28, ink: s.state === 'down' || s.state === 'warning' },
        { text: s.latency_ms !== null && s.latency_ms !== undefined ? `${F.int(s.latency_ms)} ms` : 'n/a', w: 48 },
        { text: s.tls_days_left !== undefined ? `TLS ${s.tls_days_left} ${c.s.day}` : '', w: 58 },
      ],
  }));
  return (
    <Shell c={c}>
      <SpecHeader c={c} title={c.s.sites} right={k ? `${k.up} / ${k.total}` : ''} route="/system?seg=sites" lv={down ? 'critical' : warning ? 'warning' : 'ok'} />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 10 }}>
        <Stat c={c} label={c.s.up} v={F.int(k?.up)} lv="ok" />
        <Stat c={c} label={c.s.warningShort} v={F.int(warning)} lv="warning" />
        <Stat c={c} label={c.s.down} v={F.int(down)} lv="critical" />
      </FlexWidget>
      <Rule c={c} />
      <RowList c={c} rows={rows} empty={c.s.noSites} />
    </Shell>
  );
}

function containerLevel(x: Container): string {
  if (x.health === 'unhealthy' || x.state === 'restarting' || x.oom_killed) return 'warning';
  if (x.state !== 'running') return 'warning';
  return 'ok';
}

function Containers(c: Ctx) {
  const k = c.o?.counts.containers;
  const list = c.snap.extras.containers ?? [];
  const unhealthy = list.filter((x) => x.health === 'unhealthy').length;
  const sorted = [...list].sort((a, b) => {
    const r = (x: Container) => (containerLevel(x) === 'ok' ? 1 : 0);
    return r(a) - r(b) || (b.cpu_percent ?? 0) - (a.cpu_percent ?? 0);
  });
  const rows: Row[] = sorted.map((x) => ({
    key: x.id,
    lv: containerLevel(x),
    route: `/container/${encodeURIComponent(x.id)}`,
    hi: containerLevel(x) !== 'ok',
    name: x.name,
    cols: [
      { text: x.cpu_percent !== undefined ? `${F.pct(x.cpu_percent)} %` : F.NONE, w: 46, ink: true },
      { text: F.bytesText(x.memory_bytes), w: 56 },
      { text: `${x.restart_count ?? 0}×`, w: 22, ink: (x.restart_count ?? 0) > 2 },
    ],
  }));
  return (
    <Shell c={c}>
      <SpecHeader c={c} title={c.s.containers} right={k ? `${k.running} / ${k.total}` : ''} route="/system?seg=containers" lv={k?.stopped || unhealthy ? 'warning' : 'ok'} />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 10 }}>
        <Stat c={c} label={c.s.running} v={F.int(k?.running)} lv="ok" />
        <Stat c={c} label={c.s.stopped} v={F.int(k?.stopped)} lv="warning" />
        <Stat c={c} label={c.s.unhealthy} v={F.int(unhealthy)} lv="critical" />
      </FlexWidget>
      <Rule c={c} />
      <RowList c={c} rows={rows} empty={c.s.noContainers} />
    </Shell>
  );
}

function backupLevel(b: Backup): string {
  if (b.state === 'failed') return 'critical';
  if (b.state === 'empty' || b.state === 'no_access') return 'warning';
  if (b.max_age_seconds && (b.age_seconds ?? 0) > b.max_age_seconds) return 'old';
  return 'ok';
}

function Backups(c: Ctx) {
  const k = c.o?.counts;
  const all = c.snap.extras.backups ?? [];
  const jobs = all.filter((b) => b.kind !== 'archive');
  const rank = (b: Backup) => (backupLevel(b) === 'ok' ? 1 : 0) + (b.kind === 'archive' ? 2 : 0);
  // Problemen eerst, dan de bewaakte taken van oud naar nieuw, eenmalige kopieën (archive) achteraan.
  const sorted = [...all].sort((a, b) => rank(a) - rank(b) || (b.age_seconds ?? 0) - (a.age_seconds ?? 0));
  const oldest = [...jobs].sort((a, b) => (b.age_seconds ?? 0) - (a.age_seconds ?? 0))[0]?.name;
  const failed = k?.backups?.failed ?? jobs.filter((b) => b.state === 'failed').length;
  const old = k?.backups?.old ?? jobs.filter((b) => backupLevel(b) === 'old').length;
  const rows: Row[] = sorted.map((b) => ({
    key: `${b.name}${b.path}`,
    lv: b.kind === 'archive' ? 'offline' : backupLevel(b),
    hi: b.name === oldest && jobs.length > 1,
    name: b.name,
    route: '/backups',
    cols: [
      { text: b.kind === 'archive' ? 'archive' : b.source === 'timer' ? 'timer' : 'dir', w: 62 },
      { text: F.age(b.age_seconds), w: 52, ink: b.name === oldest },
    ],
  }));
  return (
    <Shell c={c}>
      <SpecHeader c={c} title={c.s.backup} right={k?.last_backup_age_seconds !== null && k?.last_backup_age_seconds !== undefined ? `${F.age(k.last_backup_age_seconds)} ${c.s.ago}` : ''} route="/backups" lv={failed ? 'critical' : old ? 'warning' : 'ok'} />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 10 }}>
        <Stat c={c} label={c.s.jobs} v={F.int(k?.backups?.total ?? jobs.length)} />
        <Stat c={c} label={c.s.failedLabel} v={F.int(failed)} lv="critical" />
        <Stat c={c} label={c.s.oldLabel} v={F.int(old)} lv="warning" />
      </FlexWidget>
      <Rule c={c} />
      <RowList c={c} rows={rows} empty={c.s.noBackups} />
    </Shell>
  );
}

function Disks(c: Ctx) {
  const w = inner(c);
  const mounts = c.o?.mounts ?? [];
  const rows = mounts.map((m) => {
    const failing = Boolean(c.alarm && m.device.includes(c.alarm));
    return (
      <FlexWidget key={m.mountpoint} {...ctap(c, '/disks')} style={{ width: 'match_parent', flexDirection: 'column', flexGap: 4, paddingVertical: 4 }}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'flex-end', flexGap: 8 }}>
          <Grow>
            <Txt text={m.mountpoint} size={11} color={valueColor(c)} mono fill />
          </Grow>
          <Num c={c} v={F.pct(m.percent)} u="%" size={18} />
        </FlexWidget>
        <Bar c={c} w={w} pct={m.percent} lv={failing ? 'critical' : 'ok'} h={6} />
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 8 }}>
          <Grow>
            <Txt text={`${F.bytesText(m.used)} / ${F.bytesText(m.total)}`} size={9.5} color={c.pal.muted} mono fill />
          </Grow>
          <Txt text={`${F.bytesText(m.free)} ${c.s.free}`} size={9.5} color={c.pal.muted} mono />
        </FlexWidget>
      </FlexWidget>
    );
  });
  const smart = (c.o?.smart ?? []).slice(0, 4).map((d) => {
    const dev = shortDev(d.device);
    const lv = (c.alarm && dev === c.alarm) || d.status === 'failing' ? 'critical' : d.status === 'warning' ? 'warning' : d.status === 'unknown' ? 'offline' : 'ok';
    return (
      <FlexWidget key={d.device} style={{ flexDirection: 'row', alignItems: 'center', flexGap: 5 }}>
        <Diamond c={c} lv={lv} size={6} />
        <Txt text={`${dev} ${lv === 'critical' ? c.s.failing : d.status}`} size={10} color={valueColor(c)} mono />
      </FlexWidget>
    );
  });
  return (
    <Shell c={c}>
      <SpecHeader c={c} title={c.s.disks} right="" route="/disks" lv={(c.o?.smart ?? []).some((d) => d.status === 'warning') ? 'warning' : 'ok'} />
      {rows.length ? <ScrollList>{rows}</ScrollList> : <Space />}
      <Rule c={c} />
      <FlexWidget {...ctap(c, '/disks')} style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 12 }}>
        <Label c={c} text={c.s.smart} size={8.5} />
        {smart.length ? smart : <Txt text={F.NONE} size={10} color={c.pal.muted} mono />}
      </FlexWidget>
    </Shell>
  );
}

function Network(c: Ctx) {
  const net = c.o?.system.network;
  const x = c.snap.extras;
  const w = Math.round((inner(c) - 16) / 2);
  const col = (label: string, bps: number | undefined, pts: number[] | undefined, peak: { v: number; at: number } | null | undefined, route: string) => {
    const r = F.rate(bps);
    const pk = peak ? (c.big ? F.rateText(peak.v) : `${F.rateText(peak.v)} · ${F.clock(peak.at)}`) : F.NONE;
    return (
      <FlexWidget key={label} {...ctap(c, route)} style={{ width: w, flexDirection: 'column', justifyContent: 'flex-end', flexGap: 4 }}>
        <Label c={c} text={label} />
        <Num c={c} v={r.v} u={r.u} size={26} />
        <Spark c={c} w={w} h={Math.max(24, Math.min(44, c.h - 148))} pts={pts} />
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          <Label c={c} text={c.s.peak} size={8} />
          <Grow align="flex-end">
            <Txt text={pk} size={9.5} color={c.pal.muted} mono align="right" />
          </Grow>
        </FlexWidget>
      </FlexWidget>
    );
  };
  return (
    <Shell c={c} gap={10}>
      <SpecHeader c={c} title={c.s.network} right="" route="/metric/net.rx" lv={c.lv} />
      <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'row', alignItems: 'flex-end', flexGap: 16 }}>
        {[col(c.s.in, net?.rx_bps, x.rx24, x.rxPeak, '/metric/net.rx'), col(c.s.out, net?.tx_bps, x.tx24, x.txPeak, '/metric/net.tx')]}
      </FlexWidget>
    </Shell>
  );
}

function fleetLevel(e: FleetEntry): string {
  if (e.offline || !e.overview) return 'offline';
  if (e.overview.disk_alarms.length) return 'critical';
  return e.overview.health.status;
}

function Fleet(c: Ctx) {
  const list = c.snap.extras.fleet ?? [];
  const shown = list.slice(0, 4);
  const worst = list.map(fleetLevel).reduce((a, b) => (rank(b) > rank(a) ? b : a), 'ok');
  const cell = (e: FleetEntry | undefined, i: number) => {
    if (!e) return <FlexWidget key={`e${i}`} style={{ flex: 1 }} />;
    const lv = fleetLevel(e);
    const off = lv === 'offline';
    const sys = e.overview?.system;
    const dim = off ? c.pal.muted : c.pal.ink;
    return (
      <Slab key={e.id} c={c} pad={[7, 9]} gap={4}>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          <Diamond c={c} lv={lv} size={6} />
          <Grow>
            <Txt text={e.name} size={10.5} color={dim} mono fill />
          </Grow>
          {off ? <Txt text={F.clock(e.updatedAt)} size={9} color={c.pal.muted} mono /> : <Gap size={0} />}
        </FlexWidget>
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 8 }}>
          <FlexWidget style={{ flex: 1 }}>
            <Num c={c} v={F.temp(sys?.temperature_c)} u="°C" size={14} color={dim} />
          </FlexWidget>
          <FlexWidget style={{ flex: 1 }}>
            <Num c={c} v={F.pct(sys?.cpu.percent)} u="%" size={14} color={dim} />
          </FlexWidget>
        </FlexWidget>
      </Slab>
    );
  };
  if (list.length > 4) {
    const rows: Row[] = list.map((e) => {
      const sys = e.overview?.system;
      const off = fleetLevel(e) === 'offline';
      return {
        key: e.id,
        lv: fleetLevel(e),
        name: e.name,
        cols: [
          { text: off ? F.clock(e.updatedAt) : '', w: 40 },
          { text: `${F.temp(sys?.temperature_c)} °C`, w: 58, ink: !off },
          { text: `${F.pct(sys?.cpu.percent)} %`, w: 48, ink: !off },
        ],
      };
    });
    return (
      <Shell c={c} gap={9}>
        <SpecHeader c={c} title={c.s.fleet} right={c.s.servers(list.length)} route="/" lv={worst} />
        <RowList c={c} rows={rows} empty={F.NONE} />
      </Shell>
    );
  }
  return (
    <Shell c={c} gap={9}>
      <SpecHeader c={c} title={c.s.fleet} right={c.s.servers(list.length)} route="/" lv={worst} />
      <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'column', flexGap: 6 }}>
        <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'row', flexGap: 6 }}>{[cell(shown[0], 0), cell(shown[1], 1)]}</FlexWidget>
        <FlexWidget style={{ width: 'match_parent', flex: 1, flexDirection: 'row', flexGap: 6 }}>{[cell(shown[2], 2), cell(shown[3], 3)]}</FlexWidget>
      </FlexWidget>
    </Shell>
  );
}

function rank(lv: string): number {
  return lv === 'critical' ? 3 : lv === 'warning' ? 2 : lv === 'offline' ? 1 : 0;
}

// --- toestanden zonder gegevens -----------------------------------------------------------------

function Setup(c: Ctx, kind: WidgetKind) {
  const small = REF[kind][0] < 150;
  const short = small || REF[kind][1] < 100;
  const es = small ? 28 : 24;
  return (
    <Shell c={c} pad={small ? 10 : 14}>
      <FlexWidget style={{ width: 'match_parent', height: 'match_parent', flexDirection: 'column', alignItems: small ? 'center' : 'flex-start', justifyContent: 'center', flexGap: 8 }}>
        <SvgWidget svg={eye(es, c.pal.eyeIdle, c.pal.lens, c.pal.line, true)} style={{ width: es, height: es }} />
        <Txt text={short ? c.s.setupShort : c.s.setup} size={small ? 9.5 : 12} color={c.pal.ink} lines={2} align={small ? 'center' : 'left'} />
      </FlexWidget>
    </Shell>
  );
}

function Skel({ c, w, h }: { c: Ctx; w: number; h: number }) {
  return <FlexWidget style={{ width: Math.max(4, Math.round(w)), height: h, backgroundColor: c.pal.hairline, borderRadius: 2 }} />;
}

function Loading(c: Ctx, kind: WidgetKind) {
  const [rw, rh] = REF[kind];
  const w = inner(c);
  if (rw < 150) {
    return (
      <Shell c={c} pad={10}>
        <FlexWidget style={{ width: 'match_parent', height: 'match_parent', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexGap: 8 }}>
          <FlexWidget style={{ width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: c.pal.hairline }} />
          <Skel c={c} w={40} h={8} />
        </FlexWidget>
      </Shell>
    );
  }
  const cols = (n: number, hh: number) => (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 10 }}>
      {Array.from({ length: n }, (_, i) => (
        <FlexWidget key={String(i)} style={{ flex: 1, flexDirection: 'column', flexGap: 6 }}>
          <Skel c={c} w={((w - 10 * (n - 1)) / n) * 0.6} h={6} />
          <Skel c={c} w={((w - 10 * (n - 1)) / n) * 0.85} h={hh} />
        </FlexWidget>
      ))}
    </FlexWidget>
  );
  return (
    <Shell c={c} gap={12}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 8 }}>
        <Skel c={c} w={64} h={8} />
        <Space />
        <Skel c={c} w={48} h={8} />
      </FlexWidget>
      {rh > 120 ? cols(4, 20) : cols(2, 18)}
      {rh > 160 ? <Skel c={c} w={w} h={1} /> : <Gap size={0} />}
      {rh > 160 ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 6 }}>
          {[0, 1, 2, 3].map((i) => (
            <FlexWidget key={String(i)} style={{ flex: 1, height: 30, borderRadius: 10, borderWidth: 1, borderColor: c.pal.hairline }} />
          ))}
        </FlexWidget>
      ) : (
        <Gap size={0} />
      )}
    </Shell>
  );
}

const RENDER: Record<WidgetKind, (c: Ctx) => any> = {
  pulse: Pulse, glance: Glance, vitals: Vitals, strip: Strip, overview: Overview, command: Command, board: Board,
  sites: Sites, containers: Containers, backups: Backups, disks: Disks, network: Network, fleet: Fleet, cover: Cover,
};

export function renderKind(kind: WidgetKind, c: Ctx) {
  if (!c.snap.configured) return Setup(c, kind);
  if (c.snap.loading || (!c.o && !c.off)) return Loading(c, kind);
  return RENDER[kind](c);
}
