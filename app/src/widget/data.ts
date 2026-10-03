// Gegevens voor de widgets: vers van de actieve Pi, of de laatst bekende toestand als die niet bereikbaar is.
// Elke widget vraagt enkel op wat hij toont (needs). Toont nooit geheimen.
import { cacheGet, cacheSet } from '@/api/cache';
import { api, request } from '@/api/client';
import type {
  AgentEvent, Backup, Container, ContainersResponse, DeviceInfo, EventsResponse, Info, Overview, Point, Series, Site, SitesResponse, UpdatesState,
} from '@/api/types';
import { connectionStore, hydrate, hydratedStore, isConfigured, prefsStore, serverName, serversStore, type Server } from '@/state/settings';
import type { ThemePref } from '@/theme/tokens';

export type Need = 'cpu1h' | 'net24' | 'sites' | 'containers' | 'backups' | 'events' | 'updates' | 'device' | 'info' | 'fleet';

export interface Peak {
  v: number;
  /** ms */
  at: number;
}

export interface FleetEntry {
  id: string;
  name: string;
  active: boolean;
  overview: Overview | null;
  offline: boolean;
  updatedAt: number | null;
}

export interface Extras {
  cpu1h?: number[];
  rx24?: number[];
  tx24?: number[];
  rxPeak?: Peak | null;
  txPeak?: Peak | null;
  sites?: Site[];
  containers?: Container[];
  backups?: Backup[];
  events?: AgentEvent[];
  updates?: UpdatesState;
  device?: DeviceInfo;
  agentVersion?: string;
  fleet?: FleetEntry[];
}

export interface Snapshot {
  /** false: nog geen Pi gekoppeld. */
  configured: boolean;
  /** true: eerste weergave, er is nog niets geladen. */
  loading?: boolean;
  server: string;
  overview: Overview | null;
  /** ms */
  updatedAt: number | null;
  offline: boolean;
  extras: Extras;
  /** Thema uit de app: 'system' volgt Android, 'dark' of 'light' zet de widget vast in dat thema. */
  theme?: ThemePref;
}

/** Het thema dat de gebruiker in de app koos (Instellingen > Weergave). */
export function widgetTheme(): ThemePref {
  const t = prefsStore.get().theme;
  return t === 'dark' || t === 'light' ? t : 'system';
}

/** Zorgt dat voorkeuren en verbinding geladen zijn (de widgettaak start zonder de app). */
export async function ensureHydrated(): Promise<void> {
  if (!hydratedStore.get()) await hydrate();
}

/** Een laatste toestand uit de cache telt als offline zodra ze ouder is dan twee verversingen (2 x 30 min) plus marge. */
const STALE_MS = 65 * 60 * 1000;

// Dezelfde cachesleutels als de app (JSON van de query-key), zodat widget en app elkaars laatste toestand delen.
const K = {
  overview: ['overview'],
  cpu1h: ['stats', 'history', 'cpu', '1h'],
  net24: ['stats', 'history', 'net.rx,net.tx', '24h'],
  sites: ['sites'],
  containers: ['containers'],
  backups: ['backups'],
  events: ['events'],
  updates: ['updates'],
  device: ['device'],
  info: ['info'],
} as const;
const key = (k: readonly string[]) => JSON.stringify(k);
const SERVER_KEY = 'widget.server';
const TIMEOUT = 9000;

async function get<T>(k: readonly string[], path: string, query: Record<string, string> | undefined, cacheOnly: boolean): Promise<T | undefined> {
  const ck = key(k);
  if (!cacheOnly) {
    try {
      const d = await api.get<T>(path, query, { timeoutMs: TIMEOUT });
      cacheSet(ck, d);
      return d;
    } catch {
      // val terug op de cache
    }
  }
  return cacheGet<T>(ck)?.data;
}

const value = (p: Point) => p[1];
const nums = (pts: Point[]) => pts.map(value).filter((v): v is number => v !== null && Number.isFinite(v));

/** Brengt een lange reeks terug tot hooguit n punten (gemiddelde per emmer). */
export function downsample(v: number[], n: number): number[] {
  if (v.length <= n) return v;
  const out: number[] = [];
  const size = v.length / n;
  for (let i = 0; i < n; i++) {
    const part = v.slice(Math.floor(i * size), Math.max(Math.floor((i + 1) * size), Math.floor(i * size) + 1));
    out.push(part.reduce((a, b) => a + b, 0) / part.length);
  }
  return out;
}

export function peakOf(pts: Point[]): Peak | null {
  let best: Peak | null = null;
  for (const p of pts) {
    const v = p[3] ?? p[1];
    if (v === null || !Number.isFinite(v)) continue;
    if (!best || v > best.v) best = { v, at: p[0] < 1e12 ? p[0] * 1000 : p[0] };
  }
  return best;
}

const SEVERITY: Record<string, number> = { critical: 3, warning: 2, offline: 1, ok: 0 };

async function loadFleet(cacheOnly: boolean, current: Overview | null): Promise<FleetEntry[]> {
  const st = serversStore.get();
  const servers: Server[] = st.servers.length ? st.servers : [];
  const conn = connectionStore.get();
  const list = servers.length
    ? servers
    : [{ ...conn, id: 'active' } as Server];
  const entries = await Promise.all(
    list.map(async (s): Promise<FleetEntry> => {
      const ck = `widget.fleet.${s.id}`;
      const active = s.id === st.activeId || s.id === 'active';
      if (active && current) {
        cacheSet(ck, current);
        return { id: s.id, name: serverName(s), active, overview: current, offline: false, updatedAt: Date.now() };
      }
      if (!cacheOnly && isConfigured(s)) {
        try {
          const o = await request<Overview>('/v1/overview', { conn: s, timeoutMs: TIMEOUT });
          cacheSet(ck, o);
          return { id: s.id, name: serverName(s), active, overview: o, offline: false, updatedAt: Date.now() };
        } catch {
          // offline: laatste bekende toestand
        }
      }
      const c = cacheGet<Overview>(ck);
      return { id: s.id, name: serverName(s), active, overview: c?.data ?? null, offline: !cacheOnly || !c, updatedAt: c?.at ?? null };
    }),
  );
  const sev = (e: FleetEntry) =>
    e.offline || !e.overview ? SEVERITY.offline! : e.overview.disk_alarms.length ? 3 : (SEVERITY[e.overview.health.status] ?? 0);
  // De actieve Pi eerst, daarna de ergste.
  return entries.sort((a, b) => (a.active === b.active ? sev(b) - sev(a) : a.active ? -1 : 1));
}

async function loadExtras(needs: readonly Need[], cacheOnly: boolean, current: Overview | null): Promise<Extras> {
  const want = new Set(needs);
  const x: Extras = {};
  const jobs: Promise<void>[] = [];
  if (want.has('cpu1h')) {
    jobs.push(
      get<Series[]>(K.cpu1h, '/v1/stats/history', { metric: 'cpu', range: '1h' }, true).then(async (cached) => {
        let s = cached;
        if (!cacheOnly) {
          try {
            const one = await api.get<Series>('/v1/stats/history', { metric: 'cpu', range: '1h' }, { timeoutMs: TIMEOUT });
            s = [one];
            cacheSet(key(K.cpu1h), s);
          } catch {
            // cache
          }
        }
        if (s?.[0]) x.cpu1h = downsample(nums(s[0].points), 60);
      }),
    );
  }
  if (want.has('net24')) {
    jobs.push(
      (async () => {
        let s = cacheGet<Series[]>(key(K.net24))?.data;
        if (!cacheOnly) {
          try {
            const r = await api.get<{ series: Series[] }>('/v1/stats/history', { metric: 'net.rx,net.tx', range: '24h' }, { timeoutMs: TIMEOUT });
            s = r.series;
            cacheSet(key(K.net24), s);
          } catch {
            // cache
          }
        }
        const rx = s?.find((v) => v.metric === 'net.rx');
        const tx = s?.find((v) => v.metric === 'net.tx');
        if (rx) {
          x.rx24 = downsample(nums(rx.points), 48);
          x.rxPeak = peakOf(rx.points);
        }
        if (tx) {
          x.tx24 = downsample(nums(tx.points), 48);
          x.txPeak = peakOf(tx.points);
        }
      })(),
    );
  }
  if (want.has('sites')) jobs.push(get<SitesResponse>(K.sites, '/v1/sites', undefined, cacheOnly).then((r) => void (x.sites = r?.sites)));
  if (want.has('containers')) jobs.push(get<ContainersResponse>(K.containers, '/v1/containers', undefined, cacheOnly).then((r) => void (x.containers = r?.containers)));
  if (want.has('backups')) jobs.push(get<Backup[]>(K.backups, '/v1/backups', undefined, cacheOnly).then((r) => void (x.backups = r)));
  if (want.has('events')) jobs.push(get<EventsResponse>(K.events, '/v1/events', { limit: '20' }, cacheOnly).then((r) => void (x.events = r?.events)));
  if (want.has('updates')) jobs.push(get<UpdatesState>(K.updates, '/v1/updates', undefined, cacheOnly).then((r) => void (x.updates = r)));
  if (want.has('device')) jobs.push(get<DeviceInfo>(K.device, '/v1/device', undefined, cacheOnly).then((r) => void (x.device = r)));
  if (want.has('info')) jobs.push(get<Info>(K.info, '/v1/info', undefined, cacheOnly).then((r) => void (x.agentVersion = r?.version)));
  if (want.has('fleet')) jobs.push(loadFleet(cacheOnly, current).then((r) => void (x.fleet = r)));
  await Promise.all(jobs.map((j) => j.catch(() => undefined)));
  return x;
}

export interface LoadOptions {
  /** Een vers overzicht dat de app net ophaalde: geen netwerk nodig voor het overzicht. */
  overview?: Overview;
  /** Enkel de cache lezen (bijwerken vanuit de app, zonder extra verkeer). */
  cacheOnly?: boolean;
}

export async function loadSnapshot(needs: readonly Need[], opts: LoadOptions = {}): Promise<Snapshot> {
  await ensureHydrated();
  return { ...(await loadData(needs, opts)), theme: widgetTheme() };
}

async function loadData(needs: readonly Need[], opts: LoadOptions): Promise<Snapshot> {
  const conn = connectionStore.get();
  if (!isConfigured(conn)) {
    // Een vergrendelde gsm geeft de verbinding soms niet vrij aan de achtergrondtaak. Is er al een laatste
    // toestand, dan tonen we die als offline in plaats van te vragen om de Pi opnieuw te koppelen.
    const c = cacheGet<Overview>(key(K.overview));
    if (!c) return { configured: false, server: 'Nex Pi Control', overview: null, updatedAt: null, offline: false, extras: {} };
    const name = cacheGet<string>(SERVER_KEY)?.data ?? '';
    return { configured: true, server: name, overview: c.data, updatedAt: c.at, offline: true, extras: await loadExtras(needs, true, null) };
  }
  const server = serverName(conn);
  if (cacheGet<string>(SERVER_KEY)?.data !== server) cacheSet(SERVER_KEY, server);
  let overview: Overview | null = opts.overview ?? null;
  let updatedAt: number | null = opts.overview ? Date.now() : null;
  let offline = false;
  if (!overview) {
    if (!opts.cacheOnly) {
      try {
        overview = await api.get<Overview>('/v1/overview', undefined, { timeoutMs: 12000 });
        cacheSet(key(K.overview), overview);
        updatedAt = Date.now();
      } catch {
        offline = true;
      }
    }
    if (!overview) {
      const c = cacheGet<Overview>(key(K.overview));
      overview = c?.data ?? null;
      updatedAt = c?.at ?? null;
      // Netwerk mislukt: offline. Enkel de cache gelezen (vanuit de app): offline pas als die te oud is.
      offline = !opts.cacheOnly || !c || Date.now() - c.at > STALE_MS;
    }
  }
  const extras = await loadExtras(needs, Boolean(opts.cacheOnly) || offline, offline ? null : overview);
  return { configured: true, server, overview, updatedAt, offline, extras };
}

/** De eerste weergave terwijl de gegevens nog laden: haarlijnen, geen getallen. */
export function loadingSnapshot(): Snapshot {
  return { configured: true, loading: true, server: '', overview: null, updatedAt: null, offline: false, extras: {}, theme: widgetTheme() };
}
