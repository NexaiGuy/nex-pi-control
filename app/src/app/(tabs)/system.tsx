import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { api, errorMessage } from '@/api/client';
import { useContainers, useProcesses, useServices, useShellState, useSites } from '@/api/hooks';
import type { Container, Process } from '@/api/types';
import { ListGroup, ListRow } from '@/components/ListRow';
import { Screen } from '@/components/layout';
import { ConfirmSheet, EmptyState, ErrorState, HoldButton, SearchField, Sheet, SkeletonList, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Chip, Divider, Dot, KeyValue, Row, SectionTitle, Segmented, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { bytes, dateTime, duration, pct } from '@/lib/format';
import { colors, space } from '@/theme/tokens';
import { containerLevel, serviceLevel, siteLevel } from '@/lib/status';

type Seg = 'services' | 'containers' | 'sites' | 'processes';

export default function SystemScreen() {
  const params = useLocalSearchParams<{ seg?: Seg }>();
  const [seg, setSeg] = useState<Seg>(params.seg ?? 'services');
  const [paramSeg, setParamSeg] = useState(params.seg);
  if (params.seg !== paramSeg) {
    // Navigatie vanaf Overzicht met ?seg=: pas de gekozen tab aan tijdens de render (geen effect nodig).
    setParamSeg(params.seg);
    if (params.seg) setSeg(params.seg);
  }
  return (
    <Screen title={t.tabs.system}>
      <Segmented<Seg>
        items={[
          { key: 'services', label: t.system.segments.services },
          { key: 'containers', label: t.system.segments.containers },
          { key: 'sites', label: t.system.segments.sites },
          { key: 'processes', label: t.system.segments.processes },
        ]}
        value={seg}
        onChange={setSeg}
      />
      <View style={{ marginTop: space.lg }}>
        {seg === 'services' ? <Services /> : seg === 'containers' ? <Containers /> : seg === 'sites' ? <Sites /> : <Processes />}
      </View>
    </Screen>
  );
}


function Services() {
  const [filter, setFilter] = useState<'all' | 'custom' | 'failed' | 'active'>('all');
  const [q, setQ] = useState('');
  const svc = useServices('all');
  const list = useMemo(() => {
    const all = svc.data ?? [];
    return all.filter((s) => {
      if (filter === 'custom' && !s.custom) return false;
      if (filter === 'failed' && s.active !== 'failed') return false;
      if (filter === 'active' && s.active !== 'active') return false;
      return !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.description.toLowerCase().includes(q.toLowerCase());
    });
  }, [svc.data, filter, q]);
  const counts = useMemo(() => {
    const all = svc.data ?? [];
    return { all: all.length, custom: all.filter((s) => s.custom).length, failed: all.filter((s) => s.active === 'failed').length, active: all.filter((s) => s.active === 'active').length };
  }, [svc.data]);

  return (
    <View style={{ gap: space.md }}>
      <SearchField value={q} onChange={setQ} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Row gap={space.sm}>
          {(['all', 'custom', 'failed', 'active'] as const).map((f) => (
            <Chip key={f} label={t.system.filters[f]} active={filter === f} onPress={() => setFilter(f)} count={counts[f]} />
          ))}
        </Row>
      </ScrollView>
      {!svc.data && svc.isLoading ? <SkeletonList /> : null}
      {!svc.data && svc.error ? <ErrorState error={svc.error} onRetry={() => void svc.refetch()} /> : null}
      {svc.data && !list.length ? <EmptyState icon="server" title={t.system.noServices} /> : null}
      {list.length ? (
        <ListGroup>
          {list.map((s, i) => {
            const st = serviceLevel(s);
            return (
              <View key={s.name}>
                {i ? <Divider /> : null}
                <ListRow
                  left={<Dot level={st.level} />}
                  title={s.name.replace(/\.service$/, '')}
                  subtitle={`${st.label} · ${s.uptime_seconds !== null ? duration(s.uptime_seconds) : '–'} · ${bytes(s.memory_bytes)}`}
                  right={s.active === 'failed' ? <StatusPill compact level="critical" label={t.system.states.failed} /> : null}
                  onPress={() => router.push({ pathname: '/service/[name]', params: { name: s.name } })}
                  a11y={`${s.name}, ${st.label}`}
                />
              </View>
            );
          })}
        </ListGroup>
      ) : null}
    </View>
  );
}


function Containers() {
  const c = useContainers();
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const g = new Map<string, Container[]>();
    for (const x of c.data?.containers ?? []) {
      if (q && !x.name.toLowerCase().includes(q.toLowerCase()) && !x.image.toLowerCase().includes(q.toLowerCase())) continue;
      const l = g.get(x.project) ?? [];
      l.push(x);
      g.set(x.project, l);
    }
    return [...g.entries()];
  }, [c.data, q]);
  return (
    <View style={{ gap: space.md }}>
      <SearchField value={q} onChange={setQ} />
      {c.data?.error ? <StatusPill level="warning" label={c.data.error} /> : null}
      {!c.data && c.isLoading ? <SkeletonList /> : null}
      {!c.data && c.error ? <ErrorState error={c.error} onRetry={() => void c.refetch()} /> : null}
      {c.data && !c.data.containers.length && !c.data.error ? <EmptyState icon="box" title={t.system.noContainers} /> : null}
      {groups.map(([proj, list]) => (
        <View key={proj}>
          <SectionTitle right={<T v="monoSmall">{`${list.filter((x) => x.state === 'running').length}/${list.length}`}</T>}>{proj}</SectionTitle>
          <ListGroup>
            {list.map((x, i) => {
              const st = containerLevel(x);
              return (
                <View key={x.id}>
                  {i ? <Divider /> : null}
                  <ListRow
                    left={<Dot level={st.level} />}
                    title={x.service ?? x.name}
                    subtitle={`${st.label} · ${pct(x.cpu_percent ?? 0)} · ${bytes(x.memory_bytes ?? 0)}${x.restart_count ? ` · ${t.system.restartedShort(x.restart_count)}` : ''}`}
                    onPress={() => router.push({ pathname: '/container/[id]', params: { id: x.id } })}
                  />
                </View>
              );
            })}
          </ListGroup>
        </View>
      ))}
    </View>
  );
}


function Sites() {
  const s = useSites();
  return (
    <View style={{ gap: space.md }}>
      {!s.data && s.isLoading ? <SkeletonList /> : null}
      {!s.data && s.error ? <ErrorState error={s.error} onRetry={() => void s.refetch()} /> : null}
      {s.data ? (
        <ListGroup>
          {s.data.sites.map((x, i) => {
            const st = siteLevel(x);
            return (
              <View key={x.hostname}>
                {i ? <Divider /> : null}
                <ListRow
                  left={<Dot level={st.level} />}
                  title={x.hostname}
                  subtitle={`${st.label} · ${x.latency_ms ?? '–'} ms · TLS ${x.tls_days_left ?? '–'} d${x.local ? ` · :${x.local.split(':').pop()}` : ''}`}
                  onPress={() => router.push({ pathname: '/site/[host]', params: { host: x.hostname } })}
                />
              </View>
            );
          })}
        </ListGroup>
      ) : null}
    </View>
  );
}

function Processes() {
  const [sort, setSort] = useState<'cpu' | 'mem' | 'pid' | 'name'>('cpu');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Process | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const p = useProcesses(sort);
  const shell = useShellState(false);
  const list = useMemo(() => (p.data ?? []).filter((x) => !q || x.name.toLowerCase().includes(q.toLowerCase()) || String(x.pid) === q || x.command.toLowerCase().includes(q.toLowerCase())), [p.data, q]);

  const kill = async (proc: Process, sig: 'TERM' | 'KILL') => {
    try {
      await api.shellSend('POST', `/v1/processes/${proc.pid}/signal`, { signal: sig });
      toast.success(t.system.signalSent(proc.name, proc.pid, sig));
      void p.refetch();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <SearchField value={q} onChange={setQ} />
      <Row gap={space.sm}>
        {(['cpu', 'mem', 'pid', 'name'] as const).map((k) => (
          <Chip key={k} label={{ cpu: t.system.sortCpu, mem: t.system.sortMem, pid: t.system.sortPid, name: t.system.sortName }[k]} active={sort === k} onPress={() => setSort(k)} />
        ))}
      </Row>
      {!p.data && p.isLoading ? <SkeletonList /> : null}
      {!p.data && p.error ? <ErrorState error={p.error} onRetry={() => void p.refetch()} /> : null}
      {list.length ? (
        <View style={ps.table}>
          <View style={[ps.tr, ps.th]}>
            <T v="label" style={ps.cName}>
              {t.system.process.toUpperCase()}
            </T>
            <T v="label" style={ps.cNum}>
              CPU
            </T>
            <T v="label" style={ps.cNum}>
              RAM
            </T>
          </View>
          {list.map((x) => (
            <View key={x.pid}>
              <ListRow
                title={x.name}
                subtitle={`${x.pid} · ${x.user}`}
                right={
                  <Row gap={0}>
                    <T v="mono" style={[ps.cNum, x.cpu_percent > 50 ? { color: colors.amber } : null]}>
                      {pct(x.cpu_percent)}
                    </T>
                    <T v="mono" style={ps.cNum}>
                      {bytes(x.memory_bytes, 0)}
                    </T>
                  </Row>
                }
                onPress={() => setSel(x)}
              />
            </View>
          ))}
        </View>
      ) : null}
      <Sheet visible={!!sel} onClose={() => setSel(null)} title={sel?.name}>
        {sel ? (
          <View style={{ gap: space.sm }}>
            <KeyValue k="PID" v={String(sel.pid)} />
            <KeyValue k={t.system.user} v={sel.user} />
            <KeyValue k="Status" v={sel.status} />
            <KeyValue k="CPU" v={pct(sel.cpu_percent)} />
            <KeyValue k="RAM" v={`${bytes(sel.memory_bytes)} (${pct(sel.memory_percent)})`} />
            <KeyValue k="Threads" v={String(sel.threads)} />
            <KeyValue k={t.system.started} v={dateTime(sel.started_at)} />
            <T v="label" style={{ marginTop: space.sm }}>
              {t.system.command.toUpperCase()}
            </T>
            <T v="mono" selectable style={{ backgroundColor: colors.surface2, padding: space.md, borderRadius: 8 }}>
              {sel.command || sel.name}
            </T>
            {shell.data?.active ? (
              <View style={{ gap: space.md, marginTop: space.md }}>
                <Button
                  label={t.system.killTerm}
                  kind="secondary"
                  icon="x-circle"
                  onPress={() => {
                    const target = sel;
                    setSel(null);
                    setConfirm({ title: t.system.kill, effect: t.system.killEffect(target.name, target.pid), confirmLabel: t.system.sendTerm, icon: 'x-circle', onConfirm: () => void kill(target, 'TERM') });
                  }}
                />
                <HoldButton label={t.system.killForce} onConfirm={() => { const target = sel; setSel(null); void kill(target, 'KILL'); }} />
              </View>
            ) : (
              <T v="caption" style={{ marginTop: space.md }}>
                {t.system.killNeedsShell}
              </T>
            )}
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </View>
  );
}

const ps = StyleSheet.create({
  table: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg },
  th: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface2 },
  cName: { flex: 1 },
  cNum: { width: 64, textAlign: 'right' },
});
