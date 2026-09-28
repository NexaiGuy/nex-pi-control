import { useLocalSearchParams } from 'expo-router';

import { useContainerLogs, useContainers } from '@/api/hooks';
import { DetailScreen } from '@/components/layout';
import { ErrorState, LogView, SkeletonList } from '@/components/overlays';
import { Card, KeyValue, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { bytes, pct } from '@/lib/format';
import { containerLevel } from '@/lib/status';
import { space } from '@/theme/tokens';

export default function ContainerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cid = String(id ?? '');
  const c = useContainers();
  const logs = useContainerLogs(cid);
  const x = c.data?.containers.find((k) => k.id === cid);
  const st = x ? containerLevel(x) : null;
  return (
    <DetailScreen title={x?.name ?? cid} onRefresh={() => void Promise.all([c.refetch(), logs.refetch()])} refreshing={logs.isRefetching}>
      {x ? (
        <Card style={{ gap: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="mono">{x.id}</T>
            {st ? <StatusPill level={st.level} label={st.label} /> : null}
          </Row>
          <KeyValue k={t.system.image} v={x.image} />
          <KeyValue k={t.system.project} v={x.project} />
          <KeyValue k={t.system.status} v={x.status} />
          <KeyValue k={t.system.health} v={x.health ?? '–'} />
          <KeyValue k="CPU" v={pct(x.cpu_percent ?? 0)} />
          <KeyValue k={t.system.memory} v={bytes(x.memory_bytes ?? 0)} />
          <KeyValue k={t.system.restarts} v={String(x.restart_count ?? 0)} />
          <KeyValue k={t.system.restartPolicy} v={x.restart_policy ?? '–'} />
          <KeyValue
            k={t.system.ports}
            v={x.ports.length ? x.ports.map((p) => `${p.ip ?? ''}${p.public ? `:${p.public}→` : ''}${p.private}/${p.type}`).join('\n') : '–'}
          />
        </Card>
      ) : null}
      <SectionTitle>{t.system.logs}</SectionTitle>
      {!logs.data && logs.isLoading ? <SkeletonList rows={4} /> : null}
      {!logs.data && logs.error ? <ErrorState error={logs.error} onRetry={() => void logs.refetch()} /> : null}
      {logs.data ? <LogView lines={logs.data.lines.map((l) => ({ message: l }))} /> : null}
      <T v="caption" style={{ marginTop: space.md }}>
        {t.system.readOnlyV1}
      </T>
    </DetailScreen>
  );
}
