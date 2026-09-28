// Verbinding (geheimen) en voorkeuren. Alles in SecureStore (Android Keystore), nooit in logs.
import * as SecureStore from 'expo-secure-store';

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
}

export interface Prefs {
  onboarded: boolean;
  biometric: boolean;
  autoLockMinutes: number;
  thresholds: Thresholds;
  notify: NotifyPrefs;
  snippets: string[];
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
  notify: { disk: true, service: true, site: true, temp: true, backup: true },
  snippets: [
    'docker ps --format "table {{.Names}}\\t{{.Status}}"',
    'systemctl --failed',
    'df -h',
    'journalctl -p err -n 50 --no-pager',
    'sudo smartctl -H -A /dev/sda',
    'free -h',
  ],
};

const KEY_CONN = 'hal.connection.v1';
const KEY_PREFS = 'hal.prefs.v1';
const SECURE_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const connectionStore = createStore<Connection>(DEFAULT_CONNECTION);
export const prefsStore = createStore<Prefs>(DEFAULT_PREFS);
export const hydratedStore = createStore<boolean>(false);

export async function hydrate(): Promise<void> {
  try {
    const [c, p] = await Promise.all([
      SecureStore.getItemAsync(KEY_CONN, SECURE_OPTS),
      SecureStore.getItemAsync(KEY_PREFS, SECURE_OPTS),
    ]);
    if (c) connectionStore.set({ ...DEFAULT_CONNECTION, ...(JSON.parse(c) as Partial<Connection>) });
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

export async function saveConnection(next: Connection): Promise<void> {
  connectionStore.set(next);
  await SecureStore.setItemAsync(KEY_CONN, JSON.stringify(next), SECURE_OPTS);
}

export async function savePrefs(update: Partial<Prefs> | ((p: Prefs) => Prefs)): Promise<void> {
  const next = typeof update === 'function' ? update(prefsStore.get()) : { ...prefsStore.get(), ...update };
  prefsStore.set(next);
  await SecureStore.setItemAsync(KEY_PREFS, JSON.stringify(next), SECURE_OPTS);
}

export async function wipeAll(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(KEY_CONN, SECURE_OPTS), SecureStore.deleteItemAsync(KEY_PREFS, SECURE_OPTS)]);
  connectionStore.set(DEFAULT_CONNECTION);
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
