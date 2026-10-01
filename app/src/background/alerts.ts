// Meldingen zonder pushserver.
//
// Sinds agent 1.2.0 houdt de Pi zelf bij wat er misgaat en weer goed komt (/v1/events). De app haalt die gebeurtenissen
// op, voor elke toegevoegde server: live terwijl de app open is (hooguit om de 30 s) en ongeveer elk kwartier in de
// achtergrond (Android beslist het exacte moment). Zo mis je ook een probleem dat tussendoor weer opgelost raakte.
// Drempels die je zelf instelt (temperatuur, schijf %, backup-leeftijd) controleert de app zelf op het overzicht.
// Oudere agents zonder /v1/events: de app valt terug op de controle van het overzicht, zoals in versie 1.0.
import * as BackgroundTask from 'expo-background-task';
import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { ApiError, api } from '@/api/client';
import type { AgentEvent, AgentUpdateState, EventsResponse, Overview } from '@/api/types';
import { t } from '@/i18n';
import { diffAlerts, evaluateAlerts, type Alert } from '@/lib/alerts';
import {
  hydrate, hydratedStore, isConfigured, prefsStore, serverName, serversStore, type Connection, type NotifyPrefs, type Server,
} from '@/state/settings';

export const TASK = 'nex-pi-control-alerts';
const CHANNEL = 'hal-alerts';
const FOREGROUND_MIN_MS = 30_000;
const AGENT_CHECK_MS = 24 * 3600_000;

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export interface ServerAlertState {
  /** Hoogste gebeurtenis-id die we al gezien hebben; null = nog geen basislijn. */
  lastEventId: number | null;
  /** Actieve drempelmeldingen (temperatuur, schijf %, backup) van de vorige keer. */
  keys: string[];
  /** Laatste keer dat we naar een agent-update vroegen, en voor welke versie we al een melding gaven. */
  agentCheckedAt?: number;
  agentNotified?: string | null;
}

type StateFile = Record<string, ServerAlertState>;

function stateFile(): File {
  return new File(Paths.document, 'hal-alert-state-v2.json');
}

function loadState(): StateFile {
  try {
    const f = stateFile();
    return f.exists ? (JSON.parse(f.textSync()) as StateFile) : {};
  } catch {
    return {};
  }
}

function saveState(s: StateFile): void {
  try {
    stateFile().write(JSON.stringify(s));
  } catch {
    // best effort
  }
}

/** Opslag van de meldingstoestand. Los aanpasbaar voor tests. */
export const alertStateIO = { load: loadState, save: saveState };

const lastForeground: Record<string, number> = {};

function titleFor(a: Alert, server: string): string {
  switch (a.kind) {
    case 'disk':
    case 'diskUsage':
      return t.notify.diskTitle(server);
    case 'service':
      return t.notify.serviceTitle(server);
    case 'site':
      return t.notify.siteTitle;
    case 'temp':
      return t.notify.tempTitle(server);
    case 'backup':
      return t.notify.backupTitle;
  }
}

/** Welke voorkeur hoort bij een soort gebeurtenis van de agent? */
export function eventEnabled(e: Pick<AgentEvent, 'kind'>, prefs: NotifyPrefs): boolean {
  switch (e.kind) {
    case 'disk':
      return prefs.disk;
    case 'service':
    case 'container':
      return prefs.service;
    case 'site':
      return prefs.site;
    case 'updates':
      return prefs.updates;
    default:
      return true;
  }
}

/** Nieuwe, nog niet gemelde problemen. Opgeloste gebeurtenissen komen in de lijst in de app, niet als melding. */
export function newEvents(events: AgentEvent[], lastId: number, prefs: NotifyPrefs): AgentEvent[] {
  return events
    .filter((e) => e.id > lastId && !e.resolved && e.level !== 'ok' && eventEnabled(e, prefs))
    .sort((a, b) => a.id - b.id)
    .slice(-5);
}

function eventUrl(e: AgentEvent): string {
  const target = e.key.slice(e.key.indexOf(':') + 1);
  switch (e.kind) {
    case 'disk':
      return '/disks';
    case 'service':
      return `/service/${encodeURIComponent(target)}`;
    case 'container':
      return `/container/${encodeURIComponent(target)}`;
    case 'site':
      return `/site/${encodeURIComponent(target)}`;
    case 'updates':
      return '/updates';
    default:
      return '/events';
  }
}

async function notify(title: string, body: string, data: Record<string, string>, critical: boolean): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data,
      priority: critical ? Notifications.AndroidNotificationPriority.MAX : Notifications.AndroidNotificationPriority.HIGH,
    },
    trigger: { channelId: CHANNEL },
  });
}

function asConn(s: Server): Connection {
  const { id: _id, ...c } = s;
  return c;
}

async function checkServer(server: Server, prev: ServerAlertState, overview: Overview | undefined, background: boolean): Promise<ServerAlertState> {
  const prefs = prefsStore.get();
  const conn = asConn(server);
  const name = serverName(conn);
  const o = overview ?? (await api.get<Overview>('/v1/overview', undefined, { timeoutMs: 20000, conn }));
  const next: ServerAlertState = { ...prev };

  // 1. Gebeurtenissen van de Pi zelf.
  let hasEvents = false;
  try {
    const res = await api.get<EventsResponse>('/v1/events', { since: prev.lastEventId ?? 0, limit: 50 }, { timeoutMs: 20000, conn });
    hasEvents = true;
    if (prev.lastEventId === null || prev.lastEventId === undefined) {
      // Eerste keer: enkel een basislijn, geen stortvloed aan oude meldingen.
      next.lastEventId = res.last_id;
    } else {
      for (const e of newEvents(res.events, prev.lastEventId, prefs.notify)) {
        await notify(t.notify.eventTitle(name, e.title), e.body, { serverId: server.id, url: eventUrl(e) }, e.level === 'critical');
      }
      next.lastEventId = Math.max(prev.lastEventId, res.last_id);
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.kind === 'not_found')) throw e;
  }

  // 2. Drempels die je zelf instelt. Met gebeurtenissen van de agent dekken die al schijf, diensten en sites.
  const all = evaluateAlerts(o, prefs.thresholds);
  const current = hasEvents ? all.filter((a) => a.kind === 'temp' || a.kind === 'diskUsage' || a.kind === 'backup') : all;
  const { fired } = diffAlerts(prev.keys ?? [], current, prefs.notify);
  for (const a of fired) {
    await notify(titleFor(a, name), a.text, { serverId: server.id, url: a.kind === 'disk' ? '/disks' : '/' }, a.level === 'critical');
  }
  next.keys = current.map((a) => a.key);

  // 3. Agent-update: hooguit één keer per dag vragen, één melding per nieuwe versie. Enkel in de achtergrond.
  if (background && hasEvents && prefs.notify.updates && Date.now() - (prev.agentCheckedAt ?? 0) > AGENT_CHECK_MS) {
    next.agentCheckedAt = Date.now();
    try {
      const u = await api.get<AgentUpdateState>('/v1/agent/update', undefined, { timeoutMs: 20000, conn });
      if (u.update_available && u.latest && u.latest !== prev.agentNotified) {
        await notify(t.notify.agentUpdateTitle(name), t.notify.agentUpdateBody(u.latest), { serverId: server.id, url: '/updates' }, false);
        next.agentNotified = u.latest;
      }
    } catch {
      // geen probleem: morgen opnieuw
    }
  }
  return next;
}

/**
 * Controleert alle servers. Met `overview` (vanuit de app, voor de actieve server) gebeurt dit hooguit om de 30 s
 * per server; zonder (achtergrondtaak) altijd.
 */
export async function checkNow(overview?: Overview): Promise<void> {
  if (!hydratedStore.get()) await hydrate();
  const prefs = prefsStore.get();
  if (!prefs.onboarded) return;
  const { servers, activeId } = serversStore.get();
  const background = overview === undefined;
  const state = alertStateIO.load();
  let changed = false;
  for (const s of servers) {
    if (s.demo || !isConfigured(s)) continue;
    if (!background) {
      const last = lastForeground[s.id] ?? 0;
      if (Date.now() - last < FOREGROUND_MIN_MS) continue;
      lastForeground[s.id] = Date.now();
    }
    try {
      state[s.id] = await checkServer(s, state[s.id] ?? { lastEventId: null, keys: [] }, s.id === activeId ? overview : undefined, background);
      changed = true;
    } catch {
      // Eén onbereikbare Pi mag de andere niet tegenhouden.
    }
  }
  // Opruimen: state van verwijderde servers.
  for (const id of Object.keys(state)) {
    if (!servers.some((s) => s.id === id)) {
      delete state[id];
      changed = true;
    }
  }
  if (changed) alertStateIO.save(state);
}

TaskManager.defineTask(TASK, async () => {
  try {
    await checkNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundAlerts(): Promise<void> {
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: t.notify.channel,
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#8B5CF6',
      vibrationPattern: [0, 200, 120, 200],
    });
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) await Notifications.requestPermissionsAsync();
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Available && !(await TaskManager.isTaskRegisteredAsync(TASK))) {
      await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
    }
  } catch {
    // Meldingen zijn optioneel; de app werkt ook zonder.
  }
}
