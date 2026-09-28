import { View } from 'react-native';

import { useHistory, useSensors } from '@/api/hooks';
import { DetailScreen } from '@/components/layout';
import { EmptyState, ErrorState, SkeletonList } from '@/components/overlays';
import { Card, Icon, KeyValue, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { Sparkline } from '@/features/charts/Charts';
import { t } from '@/i18n';
import { ago, num } from '@/lib/format';
import { colors, space } from '@/theme/tokens';

const TYPE_LABEL = { ds18b20: 'DS18B20 · 1-wire', dht: `DHT11/22 · ${t.sensors.driver}`, bmp280: 'BMP280 · I2C' } as const;

function SensorCard({ id, name, type, values, error, ts }: { id: string; name: string; type: 'ds18b20' | 'dht' | 'bmp280'; values: Record<string, number | undefined> | null; error: string | null; ts: number | null }) {
  const h = useHistory([`sensor.${id}.temp`], '24h');
  const spark = (h.data?.[0]?.points ?? []).map((p) => p[1] ?? 0);
  return (
    <Card style={{ gap: space.sm }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View>
          <T v="h3">{name}</T>
          <T v="monoSmall">{TYPE_LABEL[type]}</T>
        </View>
        {error ? <StatusPill compact level="critical" label={t.sensors.error} /> : <StatusPill compact level="ok" label={t.common.ago(ago(ts))} />}
      </Row>
      <Row gap={space.xl}>
        {values?.temp !== undefined ? (
          <View>
            <T v="label">{t.sensors.temp}</T>
            <T v="metric">{num(values.temp)} °C</T>
          </View>
        ) : null}
        {values?.humidity !== undefined ? (
          <View>
            <T v="label">{t.sensors.humidity}</T>
            <T v="metric">{num(values.humidity)}%</T>
          </View>
        ) : null}
        {values?.pressure !== undefined ? (
          <View>
            <T v="label">{t.sensors.pressure}</T>
            <T v="metric">{num(values.pressure, 0)} hPa</T>
          </View>
        ) : null}
      </Row>
      {error ? (
        <T v="caption" style={{ color: colors.red }}>
          {error}
        </T>
      ) : null}
      {spark.length > 1 ? <Sparkline values={spark} width={320} height={44} color={colors.mint} /> : null}
    </Card>
  );
}

export default function SensorsScreen() {
  const q = useSensors();
  return (
    <DetailScreen title={t.sensors.title} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {!q.data && q.isLoading ? <SkeletonList rows={3} /> : null}
      {!q.data && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && !q.data.sensors.length ? <EmptyState icon="thermometer" title={t.sensors.none} body={t.sensors.noneBody} /> : null}
      <View style={{ gap: space.md }}>
        {q.data?.sensors.map((s) => (
          <SensorCard key={s.id} {...s} values={s.values as Record<string, number | undefined> | null} />
        ))}
      </View>
      {q.data ? (
        <>
          <SectionTitle>{t.sensors.discovered}</SectionTitle>
          <Card>
            <KeyValue k="1-wire (DS18B20)" v={q.data.discovered.ds18b20.join('\n') || t.common.none} />
            <KeyValue k="IIO (DHT)" v={q.data.discovered.iio.join('\n') || t.common.none} />
            <KeyValue k={t.sensors.buses} v={q.data.discovered.i2c_buses.join(', ') || t.common.none} />
          </Card>
          <Row style={{ marginTop: space.md }}>
            <Icon name="info" size={14} color={colors.textMuted} />
            <T v="caption" style={{ flex: 1 }}>
              {t.sensors.newHint}
            </T>
          </Row>
        </>
      ) : null}
    </DetailScreen>
  );
}
