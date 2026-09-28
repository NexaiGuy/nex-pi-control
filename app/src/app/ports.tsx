import { View } from 'react-native';

import { usePorts } from '@/api/hooks';
import { ListGroup, ListRow } from '@/components/ListRow';
import { DetailScreen } from '@/components/layout';
import { ErrorState, SkeletonList } from '@/components/overlays';
import { Card, Divider, Dot, SectionTitle, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';

export default function PortsScreen() {
  const q = usePorts();
  return (
    <DetailScreen title={t.ports.title} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {!q.data && q.isLoading ? <SkeletonList /> : null}
      {!q.data && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data?.error ? <StatusPill level="warning" label={q.data.error} /> : null}
      {q.data?.registry.length ? (
        <>
          <SectionTitle>{t.ports.registry}</SectionTitle>
          <ListGroup>
            {q.data.registry.map((p, i) => (
              <View key={`${p.port}-${i}`}>
                {i ? <Divider /> : null}
                <ListRow left={<Dot level={p.listening ? 'ok' : 'unknown'} />} title={`${p.port}`} subtitle={`${p.service} · ${p.address} · ${p.listening ? t.ports.listening : t.ports.notListening}`} />
              </View>
            ))}
          </ListGroup>
        </>
      ) : null}
      {q.data?.unregistered_listening.length ? (
        <>
          <SectionTitle>{t.ports.unregistered}</SectionTitle>
          <Card>
            <T v="mono">{q.data.unregistered_listening.join(', ')}</T>
          </Card>
        </>
      ) : null}
    </DetailScreen>
  );
}
