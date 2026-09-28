import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useHistory, useMetrics } from '@/api/hooks';
import type { MetricMeta, RangeKey, Series } from '@/api/types';
import { Screen } from '@/components/layout';
import { ErrorState, Skeleton } from '@/components/overlays';
import { Chip, Row, SectionTitle } from '@/components/primitives';
import { GROUP_ORDER, groupKey, planCharts } from '@/features/charts/plan';
import { StatsCard } from '@/features/charts/StatsCard';
import { t } from '@/i18n';
import { space } from '@/theme/tokens';

const RANGES: RangeKey[] = ['1h', '6h', '24h', '7d', '30d'];

function Group({ name, label, metas, range }: { name: string; label: string; metas: MetricMeta[]; range: RangeKey }) {
  const all = useMemo(() => metas.map((m) => m.metric).slice(0, 24), [metas]);
  const q = useHistory([...all, ...(name === 'thermal' ? ['throttled'] : [])], range);
  const byMetric = useMemo(() => {
    const m = new Map<string, Series>();
    for (const s of q.data ?? []) m.set(s.metric, s);
    return m;
  }, [q.data]);
  const markers = useMemo(() => (byMetric.get('throttled')?.points ?? []).filter((p) => (p[3] ?? 0) > 0).map((p) => p[0]), [byMetric]);
  const specs = useMemo(() => planCharts(name, metas, label), [name, metas, label]);
  return (
    <View>
      <SectionTitle>{label}</SectionTitle>
      <View style={{ gap: space.md }}>
        {!q.data && q.isLoading ? <Skeleton height={240} radius={16} /> : null}
        {!q.data && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.data
          ? specs.map((sp) => (
              <StatsCard
                key={sp.title + sp.metrics.join()}
                title={sp.title}
                unit={sp.unit}
                data={sp.metrics.map((m) => byMetric.get(m)).filter((s): s is Series => !!s)}
                markers={sp.metrics.includes('temp') ? markers : undefined}
              />
            ))
          : null}
      </View>
    </View>
  );
}

export default function StatsScreen() {
  const [range, setRange] = useState<RangeKey>('1h');
  const metrics = useMetrics();
  const groups = useMemo(() => {
    const g = new Map<string, MetricMeta[]>();
    for (const m of metrics.data ?? []) {
      const k = groupKey(m);
      const list = g.get(k) ?? [];
      list.push(m);
      g.set(k, list);
    }
    return [...g.entries()].sort((a, b) => (GROUP_ORDER.indexOf(a[0]) + 1 || 99) - (GROUP_ORDER.indexOf(b[0]) + 1 || 99));
  }, [metrics.data]);

  return (
    <Screen title={t.stats.title} onRefresh={() => void metrics.refetch()} refreshing={metrics.isRefetching}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        <Row gap={space.sm}>
          {RANGES.map((r) => (
            <Chip key={r} label={t.stats.ranges[r] ?? r} active={range === r} onPress={() => setRange(r)} />
          ))}
        </Row>
      </ScrollView>
      {!metrics.data && metrics.error ? <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} /> : null}
      {!metrics.data && metrics.isLoading ? <Skeleton height={260} radius={16} style={{ marginTop: space.lg }} /> : null}
      {groups.map(([name, metas]) => (
        <Group key={name} name={name} label={metas[0]?.group_label ?? metas[0]?.group ?? name} metas={metas} range={range} />
      ))}
    </Screen>
  );
}
