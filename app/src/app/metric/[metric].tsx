import { File, Paths } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { errorMessage, request } from '@/api/client';
import { useHistory, useProcesses } from '@/api/hooks';
import type { RangeKey } from '@/api/types';
import { DetailScreen } from '@/components/layout';
import { ErrorState, Skeleton, toast } from '@/components/overlays';
import { Button, Card, Chip, Row, SectionTitle, T } from '@/components/primitives';
import { LineChart } from '@/features/charts/Charts';
import { shortLabel } from '@/features/charts/StatsCard';
import { t } from '@/i18n';
import { bytes, pct, unitValue } from '@/lib/format';
import { colors, series as palette, space } from '@/theme/tokens';

const RANGES: RangeKey[] = ['1h', '6h', '24h', '7d', '30d'];

export default function MetricDetail() {
  const { metric } = useLocalSearchParams<{ metric: string }>();
  const metrics = useMemo(() => String(metric ?? 'cpu').split(',').filter(Boolean).slice(0, 8), [metric]);
  const [range, setRange] = useState<RangeKey>('1h');
  const q = useHistory(metrics, range);
  const showProcs = metrics[0] === 'cpu' || metrics[0] === 'ram';
  const procs = useProcesses(metrics[0] === 'ram' ? 'mem' : 'cpu');
  const data = q.data ?? [];
  const first = data[0];
  const unit = first?.unit ?? '';
  const title = data.length === 1 ? first?.label ?? metric : data.map((d) => shortLabel(d.label)).join(', ');

  const exportCsv = async () => {
    try {
      const csv = await request<string>('/v1/stats/export', { query: { metric: metrics[0], range }, raw: true });
      const f = new File(Paths.cache, `hal-${metrics[0]!.replace(/[^a-z0-9.]/gi, '_')}-${range}.csv`);
      f.write(csv);
      await Sharing.shareAsync(f.uri, { mimeType: 'text/csv', dialogTitle: t.stats.export });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <DetailScreen title={title ?? ''} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Row gap={space.sm}>
          {RANGES.map((r) => (
            <Chip key={r} label={t.stats.ranges[r] ?? r} active={range === r} onPress={() => setRange(r)} />
          ))}
        </Row>
      </ScrollView>
      <Card style={{ marginTop: space.lg, gap: space.lg }}>
        {first && data.length === 1 ? (
          <Row style={{ justifyContent: 'space-between' }}>
            {(['current', 'min', 'avg', 'max'] as const).map((k) => (
              <View key={k}>
                <T v="label">{k === 'current' ? t.stats.now.toUpperCase() : t.stats[k].toUpperCase()}</T>
                <T v="metricSmall" style={{ color: k === 'current' ? colors.text : colors.textMuted }}>
                  {unitValue(first.summary[k], unit)}
                </T>
              </View>
            ))}
          </Row>
        ) : null}
        {!q.data && q.isLoading ? <Skeleton height={320} /> : null}
        {!q.data && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
        {data.length ? (
          <LineChart series={data.map((s, i) => ({ label: shortLabel(s.label), color: palette[i % palette.length]!, points: s.points }))} unit={unit} height={320} showBand={data.length === 1} />
        ) : null}
        {data.length > 1 ? (
          <View style={{ gap: 6 }}>
            {data.map((s, i) => (
              <Row key={s.metric} style={{ justifyContent: 'space-between' }}>
                <Row gap={6}>
                  <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: palette[i % palette.length] }} />
                  <T v="body">{shortLabel(s.label)}</T>
                </Row>
                <T v="mono">
                  {`${unitValue(s.summary.current, unit)} · ${t.stats.max} ${unitValue(s.summary.max, unit)}`}
                </T>
              </Row>
            ))}
          </View>
        ) : null}
      </Card>
      <Button label={t.stats.export} icon="download" kind="secondary" onPress={exportCsv} style={{ marginTop: space.lg }} />
      {showProcs ? (
        <>
          <SectionTitle>{t.stats.topProcesses}</SectionTitle>
          <Card style={{ gap: space.sm }}>
            {(procs.data ?? []).slice(0, 5).map((p) => (
              <Row key={p.pid} style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <T v="mono" numberOfLines={1}>
                    {p.name}
                  </T>
                  <T v="monoSmall">
                    PID {p.pid} · {p.user}
                  </T>
                </View>
                <T v="mono">{metrics[0] === 'ram' ? bytes(p.memory_bytes) : pct(p.cpu_percent)}</T>
              </Row>
            ))}
          </Card>
        </>
      ) : null}
    </DetailScreen>
  );
}
