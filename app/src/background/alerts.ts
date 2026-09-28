// Meldingen zonder pushserver: een achtergrondtaak (ongeveer elke 15 min, door Android bepaald) haalt het overzicht op
// en toont een lokale melding bij een nieuw probleem of een herstel. Ook in de voorgrond via checkNow().
import * as BackgroundTask from 'expo-background-task';
import { File, Paths } from 'expo-file-system';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';

import { api } from '@/api/client';
import type { Overview } from '@/api/types';
import { t } from '@/i18n';
import { diffAlerts, evaluateAlerts, type Alert } from '@/lib/alerts';
import { connectionStore, hydrate, hydratedStore, isConfigured, prefsStore, serverName } from '@/state/settings';

export const TASK = 'nex-pi-control-alerts';
const CHANNEL = 'hal-alerts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

function stateFile(): File {
  return new File(Paths.document, 'hal-alert-state.json');
}

function loadKeys(): string[] {
  try {
    const f = stateFile();
    return f.exists ? (JSON.parse(f.textSync()) as string[]) : [];
  } catch {
    return [];
  }
}

function saveKeys(keys: string[]): void {
  try {
    stateFile().write(JSON.stringify(keys));
  } catch {
    // best effort
  }
}

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

export async function checkNow(overview?: Overview): Promise<void> {
  if (!hydratedStore.get()) await hydrate();
  const conn = connectionStore.get();
  const prefs = prefsStore.get();
  if (!prefs.onboarded || !isConfigured(conn) || conn.demo) return;
  const o = overview ?? (await api.get<Overview>('/v1/overview', undefined, { timeoutMs: 20000 }));
  const current = evaluateAlerts(o, prefs.thresholds);
  const prev = loadKeys();
  const { fired } = diffAlerts(prev, current, prefs.notify);
  for (const a of fired) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: titleFor(a, serverName(conn)),
        body: a.text,
        data: { kind: a.kind, url: a.kind === 'disk' ? '/disks' : '/' },
        priority: a.level === 'critical' ? Notifications.AndroidNotificationPriority.MAX : Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: { channelId: CHANNEL },
    });
  }
  saveKeys(current.map((a) => a.key));
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
