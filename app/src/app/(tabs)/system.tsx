import { router, useLocalSearchParams } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api, errorMessage } from '@/api/client';
import { useContainers, useProcesses, useServices, useShellState, useSites } from '@/api/hooks';
import type { Labeled, Process } from '@/api/types';
import { ListGroup, ListRow } from '@/components/ListRow';
import { Screen } from '@/components/layout';
import { ConfirmSheet, EmptyState, ErrorState, HoldButton, SearchField, Sheet, SkeletonList, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Chip, Divider, Dot, Icon, KeyValue, Row, SectionTitle, Segmented, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { bytes, dateTime, duration, pct } from '@/lib/format';
import { colors, space, themed } from '@/theme/tokens';
import { collapsedByDefault, reasonLabel, sectionize, type Section } from '@/lib/groups';
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


const PAGE = 60;

/** Inklapbare secties per categorie. Bewust uit en systeemdiensten staan standaard dicht; bij zoeken staat alles open. */
function Sections<T extends Labeled>({
  sections, rowKey, renderRow, forceOpen, right,
}: { sections: Section<T>[]; rowKey: (x: T) => string; renderRow: (x: T) => ReactNode; forceOpen: boolean; right?: (sec: Section<T>) => string }) {
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [full, setFull] = useState<Record<string, boolean>>({});
  // Eén gewone sectie (oudere agent, of alles in één categorie): geen kop, gewoon de lijst.
  const bare = sections.length === 1 && !sections[0]?.parked;
  return (
    <View style={{ gap: space.md }}>
      {sections.map((sec) => {
        const open = bare || forceOpen || (toggled[sec.key] ?? !collapsedByDefault(sec));
        // Honderden rijen tegelijk maken het scrollen stroef: per sectie eerst 60, de rest op vraag.
        const rows = !open ? [] : forceOpen || full[sec.key] ? sec.items : sec.items.slice(0, PAGE);
        return (
          <View key={sec.key} style={{ gap: space.xs }}>
            {bare ? null : (
              <Pressable
                onPress={() => setToggled((m) => ({ ...m, [sec.key]: !open }))}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${sec.title}, ${sec.items.length}`}
                hitSlop={6}
              >
                <SectionTitle
                  right={
                    <Row gap={space.xs}>
                      <T v="monoSmall">{right && !sec.parked ? right(sec) : t.labels.sectionCount(sec.items.length)}</T>
                      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                    </Row>
                  }
                >
                  {sec.title}
                </SectionTitle>
              </Pressable>
            )}
            {rows.length ? (
              <ListGroup>
                {rows.map((x, i) => (
                  <View key={rowKey(x)}>
                    {i ? <Divider /> : null}
                    {renderRow(x)}
                  </View>
                ))}
              </ListGroup>
            ) : null}
            {open && !forceOpen && !full[sec.key] && sec.items.length > PAGE ? (
              <Button label={t.labels.showAll(sec.items.length)} kind="ghost" onPress={() => setFull((m) => ({ ...m, [sec.key]: true }))} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function parkedSub(x: Labeled): string {
  const why = reasonLabel(x.parked_reason);
  return why ? `${t.labels.parked} · ${why}` : t.labels.parked;
}

type SvcFilter = 'all' | 'custom' | 'failed' | 'active' | 'parked';

function Services() {
  const [filter, setFilter] = useState<SvcFilter>('all');
  const [q, setQ] = useState('');
  const svc = useServices('all');
  const list = useMemo(() => {
    const all = svc.data ?? [];
    return all.filter((s) => {
      if (filter === 'custom' && !s.custom) return false;
      if (filter === 'failed' && (s.active !== 'failed' || s.parked)) return false;
      if (filter === 'active' && s.active !== 'active') return false;
      if (filter === 'parked' && !s.parked) return false;
      return !q || s.name.toLowerCase().includes(q.toLowerCase()) || s.description.toLowerCase().includes(q.toLowerCase());
    });
  }, [svc.data, filter, q]);
  const counts = useMemo(() => {
    const all = svc.data ?? [];
    return {
      all: all.length, custom: all.filter((s) => s.custom).length, failed: all.filter((s) => s.active === 'failed' && !s.parked).length,
      active: all.filter((s) => s.active === 'active').length, parked: all.filter((s) => s.parked).length,
    };
  }, [svc.data]);
  // Oudere agent zonder categorieën: één lijst zoals vroeger.
  const sections = useMemo(() => sectionize(list, () => ({ group: '', order: 1000 })), [list]);
  const filters: SvcFilter[] = counts.parked ? ['all', 'custom', 'failed', 'active', 'parked'] : ['all', 'custom', 'failed', 'active'];

  return (
    <View style={{ gap: space.md }}>
      <SearchField value={q} onChange={setQ} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Row gap={space.sm}>
          {filters.map((f) => (
            <Chip key={f} label={t.system.filters[f]} active={filter === f} onPress={() => setFilter(f)} count={counts[f]} />
          ))}
        </Row>
      </ScrollView>
      {!svc.data && svc.isLoading ? <SkeletonList /> : null}
      {!svc.data && svc.error ? <ErrorState error={svc.error} onRetry={() => void svc.refetch()} /> : null}
      {svc.data && !list.length ? <EmptyState icon="server" title={t.system.noServices} /> : null}
      {list.length ? (
        <Sections
          sections={sections}
          forceOpen={!!q || filter === 'failed' || filter === 'parked'}
          rowKey={(s) => s.name}
          renderRow={(s) => {
            const st = serviceLevel(s);
            return (
              <ListRow
                left={<Dot level={st.level} />}
                title={s.name.replace(/\.service$/, '')}
                subtitle={s.parked ? parkedSub(s) : `${st.label} · ${s.uptime_seconds !== null ? duration(s.uptime_seconds) : '–'} · ${bytes(s.memory_bytes)}`}
                right={s.active === 'failed' && !s.parked ? <StatusPill compact level="critical" label={t.system.states.failed} /> : null}
                onPress={() => router.push({ pathname: '/service/[name]', params: { name: s.name } })}
                a11y={`${s.name}, ${st.label}`}
              />
            );
          }}
        />
      ) : null}
    </View>
  );
}


function Containers() {
  const c = useContainers();
  const [q, setQ] = useState('');
  const sections = useMemo(() => {
    const list = (c.data?.containers ?? []).filter(
      (x) => !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.image.toLowerCase().includes(q.toLowerCase()) || x.project.toLowerCase().includes(q.toLowerCase()),
    );
    // Oudere agent: per compose-project, zoals vroeger.
    return sectionize(list, (x) => ({ group: x.project, order: x.project === 'los' ? 1500 : 1000 }));
  }, [c.data, q]);
  return (
    <View style={{ gap: space.md }}>
      <SearchField value={q} onChange={setQ} />
      {c.data?.error ? <StatusPill level="warning" label={c.data.error} /> : null}
      {!c.data && c.isLoading ? <SkeletonList /> : null}
      {!c.data && c.error ? <ErrorState error={c.error} onRetry={() => void c.refetch()} /> : null}
      {c.data && !c.data.containers.length && !c.data.error ? <EmptyState icon="box" title={t.system.noContainers} /> : null}
      {c.data && c.data.containers.length && q && !sections.length ? <EmptyState icon="box" title={t.system.noMatch} /> : null}
      <Sections
        sections={sections}
        forceOpen={!!q}
        rowKey={(x) => x.id}
        right={(sec) => `${sec.items.filter((x) => x.state === 'running').length}/${sec.items.length}`}
        renderRow={(x) => {
          const st = containerLevel(x);
          // In een categorie (niet per project) staat het project in de ondertitel en de volledige naam als titel.
          const byProject = !x.group || x.group_source === 'auto';
          const usage = `${pct(x.cpu_percent ?? 0)} · ${bytes(x.memory_bytes ?? 0)}${x.restart_count ? ` · ${t.system.restartedShort(x.restart_count)}` : ''}`;
          return (
            <ListRow
              left={<Dot level={st.level} />}
              title={byProject && !x.parked ? x.service ?? x.name : x.name}
              subtitle={x.parked ? parkedSub(x) : byProject ? `${st.label} · ${usage}` : `${st.label} · ${x.project} · ${usage}`}
              onPress={() => router.push({ pathname: '/container/[id]', params: { id: x.id } })}
            />
          );
        }}
      />
    </View>
  );
}


function Sites() {
  const s = useSites();
  const [q, setQ] = useState('');
  const all = s.data?.sites;
  const disc = s.data?.discovery;
  const sections = useMemo(() => {
    const list = (all ?? []).filter((x) => !q || x.hostname.includes(q.toLowerCase()));
    // Oudere agent: per tunnel (bron uit hal-sites-discover), handmatige sites achteraan.
    return sectionize(list, (x) => {
      const manual = !x.source || x.source === 'sites.yml';
      return { group: manual ? t.system.sitesManual : x.source!, order: manual ? 1500 : 1000 };
    });
  }, [all, q]);
  const many = (all?.length ?? 0) > 8;
  return (
    <View style={{ gap: space.md }}>
      {!s.data && s.isLoading ? <SkeletonList /> : null}
      {!s.data && s.error ? <ErrorState error={s.error} onRetry={() => void s.refetch()} /> : null}
      {many ? <SearchField value={q} onChange={setQ} /> : null}
      {all ? (
        <T v="caption">
          {disc?.enabled && disc.sources.length ? t.system.sitesFound(all.length, disc.sources.length) : t.system.sitesCount(all.length)}
        </T>
      ) : null}
      <Sections
        sections={sections}
        forceOpen={!!q}
        rowKey={(x) => x.hostname}
        right={(sec) => `${sec.items.filter((x) => x.state === 'up' || x.state === 'protected').length}/${sec.items.length}`}
        renderRow={(x) => {
          const st = siteLevel(x);
          return (
            <ListRow
              left={<Dot level={st.level} />}
              title={x.hostname}
              subtitle={x.parked ? parkedSub(x) : `${st.label} · ${x.latency_ms ?? '–'} ms · TLS ${x.tls_days_left ?? '–'} d${x.local ? ` · :${x.local.split(':').pop()}` : ''}`}
              onPress={() => router.push({ pathname: '/site/[host]', params: { host: x.hostname } })}
            />
          );
        }}
      />
      {all && q && !sections.length ? <EmptyState icon="globe" title={t.system.noMatch} /> : null}
      {disc?.remote_tunnels.length ? <T v="caption">{t.system.remoteTunnels(disc.remote_tunnels.join(', '))}</T> : null}
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

const ps = themed(() => StyleSheet.create({
  table: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg },
  th: { paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.surface2 },
  cName: { flex: 1 },
  cNum: { width: 64, textAlign: 'right' },
}));
