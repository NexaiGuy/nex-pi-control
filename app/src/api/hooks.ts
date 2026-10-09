// Data-hooks bovenop TanStack Query: polling enkel als het scherm zichtbaar is, offline cache als fallback.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';

import { cacheGet, cacheSet } from './cache';
import { ApiError, api } from './client';
import type {
  ActionResult, AgentUpdateState, AuditEntry, Backup, Command, CommandResult, ContainerRestartResult, ContainersResponse, DeviceInfo, Disks,
  EventsResponse, GpioState, Info, LabelKind, LabelResult, LabelsInfo, LogLine, MetricMeta, Overview, Ports, Process, RangeKey, Series,
  SensorsResponse, Service, ShellState, SitesResponse, UpdatesState, WolDevice,
} from './types';
import { createStore } from '@/state/store';

export interface LinkState {
  lastOkAt: number | null;
  error: ApiError | null;
}
export const linkStore = createStore<LinkState>({ lastOkAt: null, error: null });

function track<T>(p: Promise<T>): Promise<T> {
  return p.then(
    (v) => {
      linkStore.set({ lastOkAt: Date.now(), error: null });
      return v;
    },
    (e: unknown) => {
      if (e instanceof ApiError) linkStore.set((s) => ({ ...s, error: e }));
      throw e;
    },
  );
}

export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}

type Opts<T> = Omit<UseQueryOptions<T, ApiError>, 'queryKey' | 'queryFn'>;

function useCached<T>(key: readonly unknown[], fn: () => Promise<T>, intervalMs: number | false, opts: Opts<T> = {}) {
  const focused = useScreenFocused();
  const cacheKey = JSON.stringify(key);
  const cached = cacheGet<T>(cacheKey);
  return useQuery<T, ApiError>({
    queryKey: key,
    queryFn: () =>
      track(fn()).then((d) => {
        cacheSet(cacheKey, d);
        return d;
      }),
    refetchInterval: focused && intervalMs ? intervalMs : false,
    initialData: cached?.data,
    initialDataUpdatedAt: cached?.at,
    staleTime: 2000,
    retry: (count, err) => count < 2 && (err.kind === 'offline' || err.kind === 'timeout' || err.kind === 'server'),
    placeholderData: keepPreviousData,
    ...opts,
  });
}

export const qk = {
  info: ['info'] as const,
  overview: ['overview'] as const,
  device: ['device'] as const,
  disks: ['disks'] as const,
  metrics: ['stats', 'metrics'] as const,
  history: (m: string[], r: RangeKey) => ['stats', 'history', m.join(','), r] as const,
  services: (f: string) => ['services', f] as const,
  serviceLogs: (n: string) => ['services', 'logs', n] as const,
  containers: ['containers'] as const,
  containerLogs: (id: string) => ['containers', 'logs', id] as const,
  sites: ['sites'] as const,
  processes: (s: string) => ['processes', s] as const,
  backups: ['backups'] as const,
  ports: ['ports'] as const,
  gpio: ['gpio'] as const,
  sensors: ['sensors'] as const,
  commands: ['commands'] as const,
  wol: ['wol'] as const,
  audit: ['audit'] as const,
  shell: ['shell'] as const,
  events: ['events'] as const,
  updates: ['updates'] as const,
  agentUpdate: ['agent-update'] as const,
  labels: ['labels'] as const,
};

export const useInfo = () => useCached<Info>(qk.info, () => api.get('/v1/info'), 60000);
export const useOverview = () => useCached<Overview>(qk.overview, () => api.get('/v1/overview'), 5000);
export const useDevice = () => useCached<DeviceInfo>(qk.device, () => api.get('/v1/device'), false);
export const useDisks = () => useCached<Disks>(qk.disks, () => api.get('/v1/disks'), 30000);
export const useMetrics = () => useCached<MetricMeta[]>(qk.metrics, () => api.get('/v1/stats/metrics'), false, { staleTime: 300000 });

export function useHistory(metrics: string[], range: RangeKey, enabled = true) {
  const interval = range === '1h' ? 10000 : range === '6h' ? 30000 : 60000;
  return useCached<Series[]>(
    qk.history(metrics, range),
    async () => {
      if (metrics.length === 1) return [await api.get<Series>('/v1/stats/history', { metric: metrics[0], range })];
      const r = await api.get<{ series: Series[] }>('/v1/stats/history', { metric: metrics.join(','), range });
      return r.series;
    },
    interval,
    { enabled: enabled && metrics.length > 0 },
  );
}

export const useServices = (filter: string) => useCached<Service[]>(qk.services(filter), () => api.get('/v1/services', { filter }), 30000);
export const useServiceLogs = (name: string, live: boolean) =>
  useCached<LogLine[]>(qk.serviceLogs(name), () => api.get(`/v1/services/${encodeURIComponent(name)}/logs`, { lines: 50 }), live ? 3000 : false);
export const useContainers = () => useCached<ContainersResponse>(qk.containers, () => api.get('/v1/containers'), 30000);
export const useContainerLogs = (id: string) =>
  useCached<{ lines: string[] }>(qk.containerLogs(id), () => api.get(`/v1/containers/${encodeURIComponent(id)}/logs`, { lines: 100 }), false);
export const useSites = () => useCached<SitesResponse>(qk.sites, () => api.get('/v1/sites'), 30000);
export const useProcesses = (sort: string) => useCached<Process[]>(qk.processes(sort), () => api.get('/v1/processes', { sort, limit: 60 }), 5000);
export const useBackups = () => useCached<Backup[]>(qk.backups, () => api.get('/v1/backups'), 60000);
export const usePorts = () => useCached<Ports>(qk.ports, () => api.get('/v1/ports'), 60000);
export const useGpio = () => useCached<GpioState>(qk.gpio, () => api.get('/v1/gpio'), 5000);
export const useSensors = () => useCached<SensorsResponse>(qk.sensors, () => api.get('/v1/sensors'), 30000);
export const useCommands = () => useCached<Command[]>(qk.commands, () => api.get('/v1/commands'), false);
export const useWol = () => useCached<WolDevice[]>(qk.wol, () => api.get('/v1/wol'), false);
export const useAudit = () => useCached<AuditEntry[]>(qk.audit, () => api.get('/v1/audit', { limit: 200 }), 15000);
export const useEvents = (enabled = true) => useCached<EventsResponse>(qk.events, () => api.get('/v1/events', { limit: 100 }), 30000, { enabled });
/** Polt snel zolang er een update loopt, anders traag. */
export const useUpdates = (fast: boolean, enabled = true) => useCached<UpdatesState>(qk.updates, () => api.get('/v1/updates'), fast ? 2000 : 30000, { enabled });
export const useAgentUpdate = (fast: boolean, enabled = true) =>
  useCached<AgentUpdateState>(qk.agentUpdate, () => api.get('/v1/agent/update'), fast ? 2000 : 60000, {
    enabled,
    // Tijdens een agent-update valt de verbinding even weg: blijf rustig opnieuw proberen.
    retry: (count) => count < (fast ? 20 : 2),
    retryDelay: 2000,
  });
export const useLabels = (enabled = true) => useCached<LabelsInfo>(qk.labels, () => api.get('/v1/labels'), false, { enabled });
export const useShellState = (interval: number | false = 5000) => useCached<ShellState>(qk.shell, () => api.get('/v1/shell'), interval);

// Acties --------------------------------------------------------------------------

function useAction<V, R>(fn: (v: V) => Promise<R>, invalidate: readonly (readonly unknown[])[]) {
  const qc = useQueryClient();
  return useMutation<R, ApiError, V>({
    mutationFn: (v) => track(fn(v)),
    onSettled: () => {
      invalidate.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

export const useRestartService = () =>
  useAction((name: string) => api.post<ActionResult>('/v1/actions/restart-service', { name }, { timeoutMs: 100000 }), [['services'], qk.overview]);
export const useRunCommand = () => useAction((id: string) => api.post<CommandResult>(`/v1/commands/${encodeURIComponent(id)}/run`, {}, { timeoutMs: 920000 }), [qk.commands]);
export const useWake = () => useAction((id: string) => api.post<{ ok: boolean; device: string }>(`/v1/wol/${encodeURIComponent(id)}`), [qk.wol]);
export const usePower = () =>
  useAction((v: { action: 'reboot' | 'poweroff'; confirm: string }) => api.post<ActionResult>('/v1/actions/power', v), []);
export const useGpioAction = () =>
  useAction((v: { pin: number; action: 'on' | 'off' | 'pulse' | 'read' | 'release'; duration_ms?: number }) =>
    api.post<{ pin: number; value?: number }>(`/v1/gpio/${v.pin}`, { action: v.action, duration_ms: v.duration_ms ?? 500 }, { timeoutMs: 15000 }), [qk.gpio]);
export const useShellStart = () => useAction(() => api.post<ActionResult>('/v1/shell/start'), [qk.shell]);
export const useShellStop = () => useAction(() => api.post<ActionResult>('/v1/shell/stop'), [qk.shell]);
export const useAckCrc = () => useAction(() => api.post<ActionResult>('/v1/disks/acknowledge-crc'), [qk.disks, qk.overview]);
export const useRestartContainer = () =>
  useAction((ref: string) => api.post<ContainerRestartResult>(`/v1/containers/${encodeURIComponent(ref)}/restart`, {}, { timeoutMs: 130000 }), [qk.containers, qk.overview, qk.events]);
/** Bewust uit (parked: true/false/null = automatisch) en categorie (group: naam of null = automatisch). Weglaten = ongewijzigd. */
export const useSetLabel = () =>
  useAction(
    (v: { kind: LabelKind; name: string; parked?: boolean | null; group?: string | null }) => api.post<LabelResult>('/v1/labels', v),
    [['services'], qk.containers, qk.sites, qk.overview, qk.events, qk.labels],
  );
export const useCheckUpdates = () => useAction(() => api.post<ActionResult>('/v1/updates/check'), [qk.updates]);
export const useInstallUpdates = () => useAction(() => api.post<ActionResult>('/v1/updates/install'), [qk.updates]);
export const useStartAgentUpdate = () => useAction(() => api.post<ActionResult>('/v1/agent/update'), [qk.agentUpdate]);
export const useCheckAgentUpdate = () => {
  const qc = useQueryClient();
  return useMutation<AgentUpdateState, ApiError, void>({
    mutationFn: () => track(api.get<AgentUpdateState>('/v1/agent/update', { refresh: true })),
    onSuccess: (d) => qc.setQueryData(qk.agentUpdate, d),
  });
};
