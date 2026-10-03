// Gegevens voor de widget: vers van de actieve Pi, of de laatst bekende toestand als die niet bereikbaar is.
import { cacheGet } from '@/api/cache';
import { api } from '@/api/client';
import type { Overview } from '@/api/types';
import { t } from '@/i18n';
import { connectionStore, hydrate, hydratedStore, isConfigured, prefsStore, serverName } from '@/state/settings';

import type { WidgetData } from './StatusWidget';

export function toWidgetData(o: Overview | null, server: string, updatedAt: number | null, offline: boolean): WidgetData {
  if (!o) {
    return { server, status: 'unknown', title: offline ? t.live.offline : t.live.connecting, temp: null, cpu: null, disk: null, updatedAt, offline };
  }
  const level = o.health.status === 'critical' ? 'critical' : o.health.status === 'warning' ? 'warning' : 'ok';
  const root = o.mounts.find((m) => m.mountpoint === '/') ?? o.mounts[0];
  return {
    server,
    status: level,
    title: level === 'ok' ? t.overview.allGood : o.health.title,
    temp: o.system.temperature_c,
    cpu: o.system.cpu.percent,
    disk: root ? root.percent : null,
    updatedAt,
    offline,
  };
}

export async function loadWidgetData(): Promise<WidgetData> {
  if (!hydratedStore.get()) await hydrate();
  const conn = connectionStore.get();
  const name = conn.apiUrl || conn.demo ? serverName(conn) : 'Nex Pi Control';
  const design = prefsStore.get().design;
  if (!isConfigured(conn)) return { ...toWidgetData(null, name, null, true), design };
  try {
    const o = await api.get<Overview>('/v1/overview', undefined, { timeoutMs: 12000 });
    return { ...toWidgetData(o, name, Date.now(), false), design };
  } catch {
    const cached = cacheGet<Overview>(JSON.stringify(['overview']));
    return { ...toWidgetData(cached?.data ?? null, name, cached?.at ?? null, true), design };
  }
}
