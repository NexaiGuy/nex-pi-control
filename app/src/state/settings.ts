// Verbinding (geheimen) en voorkeuren. Alles in SecureStore (Android Keystore), nooit in logs.
import * as SecureStore from 'expo-secure-store';

import type { ThemePref } from '@/theme/tokens';

import { createStore } from './store';

export interface Connection {
  /** Weergavenaam van de server (uit de QR-code of zelf ingesteld). */
  name: string;
  /** Demo-modus: voorbeeldgegevens, geen netwerk. */
  demo: boolean;
  apiUrl: string;
  shellUrl: string;
  cfId: string;
  cfSecret: string;
  agentToken: string;
  shellToken: string;
}

export interface Thresholds {
  tempC: number;
  diskPct: number;
  backupHours: number;
}

export interface NotifyPrefs {
  disk: boolean;
  service: boolean;
  site: boolean;
  temp: boolean;
  backup: boolean;
  /** Beschikbare beveiligingsupdates en agent-updates. */
  updates: boolean;
}

export interface Prefs {
  onboarded: boolean;
  biometric: boolean;
  autoLockMinutes: number;
  thresholds: Thresholds;
  notify: NotifyPrefs;
  snippets: string[];
  /** Thema: volgt het systeem, of altijd donker of licht. */
  theme: ThemePref;
}

export const DEFAULT_CONNECTION: Connection = {
  name: '',
  demo: false,
  apiUrl: '',
  shellUrl: '',
  cfId: '',
  cfSecret: '',
  agentToken: '',
  shellToken: '',
};

export const DEMO_CONNECTION: Connection = {
  name: 'homelab-pi',
  demo: true,
  apiUrl: 'https://demo.invalid',
  shellUrl: 'https://demo.invalid/shell',
  cfId: '',
  cfSecret: '',
  agentToken: 'demo',
  shellToken: 'demo',
};

export const DEFAULT_PREFS: Prefs = {
  onboarded: false,
  biometric: true,
  autoLockMinutes: 2,
  thresholds: { tempC: 70, diskPct: 85, backupHours: 36 },
  notify: { disk: true, service: true, site: true, temp: true, backup: true, updates: true },
  snippets: [
    'docker ps --format "table {{.Names}}\\t{{.Status}}"',
    'systemctl --failed',
    'df -h',
    'journalctl -p err -n 50 --no-pager',
    'sudo smartctl -H -A /dev/sda',
    'free -h',
  ],
  theme: 'system',
};

const KEY_CONN = 'hal.connection.v1'; // oude opslag (één server), wordt bij de eerste start gemigreerd
const KEY_SERVERS = 'hal.servers.v1'; // index: welke servers, welke is actief
const KEY_SERVER = (id: string) => `hal.server.${id}`; // per server apart: SecureStore houdt waarden klein
const KEY_PREFS = 'hal.prefs.v1';
const SECURE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** Een opgeslagen server (Pi). Meerdere servers kunnen naast elkaar bestaan, één is actief. */
export interface Server extends Connection {
  id: string;
}

export interface ServersState {
  servers: Server[];
  activeId: string | null;
}

export const MAX_SERVERS = 10;

/** De actieve verbinding. Alle schermen en de API-client lezen enkel deze. */
export const connectionStore = createStore<Connection>(DEFAULT_CONNECTION);
export const serversStore = createStore<ServersState>({ servers: [], activeId: null });
export const prefsStore = createStore<Prefs>(DEFAULT_PREFS);
export const hydratedStore = createStore<boolean>(false);

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function strip(s: Server): Connection {
  const { id: _id, ...c } = s;
  return c;
}

function applyActive(state: ServersState): void {
  serversStore.set(state);
  const active = state.servers.find((s) => s.id === state.activeId);
  connectionStore.set(active ? strip(active) : DEFAULT_CONNECTION);
}

async function persistIndex(state: ServersState): Promise<void> {
  await SecureStore.setItemAsync(KEY_SERVERS, JSON.stringify({ ids: state.servers.map((s) => s.id), activeId: state.activeId }), SECURE_OPTS);
}

async function persistServer(s: Server): Promise<void> {
  await SecureStore.setItemAsync(KEY_SERVER(s.id), JSON.stringify(strip(s)), SECURE_OPTS);
}

export async function hydrate(): Promise<void> {
  try {
    const [idx, oldConn, p] = await Promise.all([
      SecureStore.getItemAsync(KEY_SERVERS, SECURE_OPTS),
      SecureStore.getItemAsync(KEY_CONN, SECURE_OPTS),
      SecureStore.getItemAsync(KEY_PREFS, SECURE_OPTS),
    ]);
    if (idx) {
      const parsed = JSON.parse(idx) as { ids?: string[]; activeId?: string | null };
      const ids = (parsed.ids ?? []).filter((x) => typeof x === 'string').slice(0, MAX_SERVERS);
      const raw = await Promise.all(ids.map((id) => SecureStore.getItemAsync(KEY_SERVER(id), SECURE_OPTS)));
      const servers: Server[] = [];
      raw.forEach((r, i) => {
        if (!r) return;
        try {
          servers.push({ ...DEFAULT_CONNECTION, ...(JSON.parse(r) as Partial<Connection>), id: ids[i]! });
        } catch {
          // één beschadigde server mag de rest niet tegenhouden
        }
      });
      const activeId = servers.some((s) => s.id === parsed.activeId) ? (parsed.activeId as string) : (servers[0]?.id ?? null);
      applyActive({ servers, activeId });
    } else if (oldConn) {
      // Migratie van versie 1.0/1.1: één verbinding wordt de eerste server.
      const conn = { ...DEFAULT_CONNECTION, ...(JSON.parse(oldConn) as Partial<Connection>) };
      if (isConfigured(conn)) {
        const server: Server = { ...conn, id: newId() };
        const state = { servers: [server], activeId: server.id };
        await persistServer(server);
        await persistIndex(state);
        applyActive(state);
      }
      await SecureStore.deleteItemAsync(KEY_CONN, SECURE_OPTS);
    }
    if (p) {
      const parsed = JSON.parse(p) as Partial<Prefs>;
      prefsStore.set({
        ...DEFAULT_PREFS,
        ...parsed,
        thresholds: { ...DEFAULT_PREFS.thresholds, ...(parsed.thresholds ?? {}) },
        notify: { ...DEFAULT_PREFS.notify, ...(parsed.notify ?? {}) },
      });
    }
  } catch {
    // Beschadigde opslag: val terug op de standaardwaarden, de gebruiker doet dan opnieuw onboarding.
  } finally {
    hydratedStore.set(true);
  }
}

/** Bewaart de actieve server (of maakt de eerste aan als er nog geen is). */
export async function saveConnection(next: Connection): Promise<void> {
  const st = serversStore.get();
  const active = st.servers.find((s) => s.id === st.activeId);
  if (!active) {
    await addServer(next);
    return;
  }
  const updated: Server = { ...next, id: active.id };
  const state = { ...st, servers: st.servers.map((s) => (s.id === active.id ? updated : s)) };
  await persistServer(updated);
  applyActive(state);
}

/** Voegt een server toe en maakt hem actief. Een demo-server bestaat hooguit één keer. */
export async function addServer(conn: Connection): Promise<Server> {
  const st = serversStore.get();
  if (st.servers.length >= MAX_SERVERS) throw new Error('max_servers');
  const existingDemo = conn.demo ? st.servers.find((s) => s.demo) : undefined;
  if (existingDemo) {
    await switchServer(existingDemo.id);
    return existingDemo;
  }
  const server: Server = { ...conn, id: newId() };
  const state = { servers: [...st.servers, server], activeId: server.id };
  await persistServer(server);
  await persistIndex(state);
  applyActive(state);
  return server;
}

export async function switchServer(id: string): Promise<void> {
  const st = serversStore.get();
  if (!st.servers.some((s) => s.id === id) || st.activeId === id) return;
  const state = { ...st, activeId: id };
  await persistIndex(state);
  applyActive(state);
}

export async function renameServer(id: string, name: string): Promise<void> {
  const st = serversStore.get();
  const target = st.servers.find((s) => s.id === id);
  if (!target) return;
  const updated = { ...target, name: name.trim().slice(0, 40) };
  await persistServer(updated);
  applyActive({ ...st, servers: st.servers.map((s) => (s.id === id ? updated : s)) });
}

/** Verwijdert een server. Was hij actief, dan wordt de eerste overblijvende server actief (of geen). */
export async function removeServer(id: string): Promise<void> {
  const st = serversStore.get();
  const servers = st.servers.filter((s) => s.id !== id);
  const activeId = st.activeId === id ? (servers[0]?.id ?? null) : st.activeId;
  const state = { servers, activeId };
  await SecureStore.deleteItemAsync(KEY_SERVER(id), SECURE_OPTS);
  await persistIndex(state);
  applyActive(state);
}

export async function savePrefs(update: Partial<Prefs> | ((p: Prefs) => Prefs)): Promise<void> {
  const next = typeof update === 'function' ? update(prefsStore.get()) : { ...prefsStore.get(), ...update };
  prefsStore.set(next);
  await SecureStore.setItemAsync(KEY_PREFS, JSON.stringify(next), SECURE_OPTS);
}

export async function wipeAll(): Promise<void> {
  const ids = serversStore.get().servers.map((s) => s.id);
  await Promise.all([
    SecureStore.deleteItemAsync(KEY_CONN, SECURE_OPTS),
    SecureStore.deleteItemAsync(KEY_SERVERS, SECURE_OPTS),
    SecureStore.deleteItemAsync(KEY_PREFS, SECURE_OPTS),
    ...ids.map((id) => SecureStore.deleteItemAsync(KEY_SERVER(id), SECURE_OPTS)),
  ]);
  applyActive({ servers: [], activeId: null });
  prefsStore.set(DEFAULT_PREFS);
}

export function isConfigured(c: Connection): boolean {
  return c.demo || Boolean(c.apiUrl && c.agentToken && validateUrl(c.apiUrl) === null);
}

export function serverName(c: Connection): string {
  if (c.name) return c.name;
  try {
    return new URL(c.apiUrl).hostname.split('.')[0] || 'server';
  } catch {
    return 'server';
  }
}

// --- URL-beleid ----------------------------------------------------------------

/** Privé-adres in je thuisnetwerk (RFC 1918), of een .local-naam (mDNS). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h.endsWith('.local') || h === 'localhost' || h === '10.0.2.2') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/** Onversleutelde verbinding naar het thuisnetwerk (toegelaten, maar met waarschuwing). */
export function isLanHttp(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'http:' && isPrivateHost(u.hostname);
  } catch {
    return false;
  }
}

/** Altijd https, behalve http naar een privé-adres in je thuisnetwerk. Nooit http naar het internet. */
export function validateUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return 'invalid';
  }
  if (u.protocol === 'https:') return null;
  if (u.protocol === 'http:' && isPrivateHost(u.hostname)) return null;
  return 'insecure';
}

export function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

// --- QR-import ------------------------------------------------------------------

export interface QrPayload {
  v: 1;
  name?: string;
  api: string;
  shell?: string;
  cfId: string;
  cfSecret: string;
  agentToken: string;
  shellToken?: string;
}

export function parseQr(raw: string): Connection | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<QrPayload>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  if (d.v !== 1 || !str(d.api) || !str(d.agentToken)) return null;
  if (Boolean(str(d.cfId)) !== Boolean(str(d.cfSecret))) return null;
  if (validateUrl(str(d.api)) !== null) return null;
  if (str(d.shell) && validateUrl(str(d.shell)) !== null) return null;
  if (str(d.agentToken).length < 32) return null;
  return {
    name: str(d.name).slice(0, 40),
    demo: false,
    apiUrl: normalizeBase(str(d.api)),
    shellUrl: normalizeBase(str(d.shell)),
    cfId: str(d.cfId),
    cfSecret: str(d.cfSecret),
    agentToken: str(d.agentToken),
    shellToken: str(d.shellToken),
  };
}
