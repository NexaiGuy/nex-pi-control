import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { Series } from '@/api/types';
import { Card, Icon, Row, T } from '@/components/primitives';
import { t } from '@/i18n';
import { num, unitValue } from '@/lib/format';
import { colors, series as palette, space, themed } from '@/theme/tokens';

import { LineChart } from './Charts';

export function StatsCard({ title, data, unit, markers, height = 180 }: { title: string; data: Series[]; unit: string; markers?: number[]; height?: number }) {
  const multi = data.length > 1;
  const first = data[0];
  const empty = data.every((s) => s.points.length === 0);
  return (
    <Card style={{ gap: space.md }} accessibilityLabel={title}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T v="h3" style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </T>
        {first ? (
          <Icon name="maximize-2" size={16} color={colors.textMuted} />
        ) : null}
      </Row>
      {!multi && first ? (
        <View style={cs.summary}>
          {(['current', 'min', 'avg', 'max'] as const).map((k) => (
            <View key={k} style={{ flex: 1 }}>
              <T v="label">{k === 'current' ? t.stats.now.toUpperCase() : t.stats[k].toUpperCase()}</T>
              <T v="metricSmall" numberOfLines={1} adjustsFontSizeToFit style={k === 'current' ? { color: colors.text } : { color: colors.textMuted }}>
                {unit === 'rpm' ? num(first.summary[k], 0) : unitValue(first.summary[k], unit)}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      {empty ? (
        <T v="bodyMuted" style={{ textAlign: 'center', paddingVertical: space.xl }}>
          {t.stats.noData}
        </T>
      ) : (
        <View
          onTouchEnd={undefined}
          accessible={false}
        >
          <LineChart
            series={data.map((s, i) => ({ label: shortLabel(s.label), color: palette[i % palette.length]!, points: s.points }))}
            unit={unit}
            height={height}
            showBand={!multi}
            markers={markers}
          />
        </View>
      )}
      {multi ? (
        <View style={cs.legend}>
          {data.map((s, i) => (
            <Row key={s.metric} gap={6}>
              <View style={[cs.sw, { backgroundColor: palette[i % palette.length] }]} />
              <T v="caption" numberOfLines={1}>
                {shortLabel(s.label)} <T v="monoSmall">{unitValue(s.summary.current, unit)}</T>
              </T>
            </Row>
          ))}
        </View>
      ) : null}
      {first ? (
        <T v="caption" style={{ color: colors.purple }} onPress={() => router.push({ pathname: '/metric/[metric]', params: { metric: data.map((d) => d.metric).join(',') } })} accessibilityRole="link">
          {t.stats.fullscreen}
        </T>
      ) : null}
    </Card>
  );
}

export function shortLabel(l: string): string {
  return l.replace(/^(Schijfgebruik|Disk usage|Latency) /, '').replace(/^CPU (kern|core) /, (_m, w: string) => `${w[0]!.toUpperCase()}${w.slice(1)} `);
}

const cs = themed(() => StyleSheet.create({
  summary: { flexDirection: 'row', gap: space.sm },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: 6 },
  sw: { width: 10, height: 10, borderRadius: 3 },
}));
