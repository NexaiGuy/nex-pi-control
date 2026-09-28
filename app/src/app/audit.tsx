import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useAudit } from '@/api/hooks';
import { ListGroup, ListRow } from '@/components/ListRow';
import { DetailScreen } from '@/components/layout';
import { EmptyState, ErrorState, SearchField, SkeletonList } from '@/components/overlays';
import { Chip, Divider, Dot, Row } from '@/components/primitives';
import { t } from '@/i18n';
import { dateTime } from '@/lib/format';
import { space } from '@/theme/tokens';

export default function AuditScreen() {
  const q = useAudit();
  const [src, setSrc] = useState<'all' | 'agent' | 'shell'>('all');
  const [search, setSearch] = useState('');
  const rows = useMemo(
    () =>
      (q.data ?? []).filter(
        (r) => (src === 'all' || r.source === src) && (!search || `${r.action} ${r.target ?? ''} ${r.detail} ${r.actor}`.toLowerCase().includes(search.toLowerCase())),
      ),
    [q.data, src, search],
  );
  return (
    <DetailScreen title={t.audit.title} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      <View style={{ gap: space.md }}>
        <SearchField value={search} onChange={setSearch} />
        <Row>
          <Chip label={t.common.all} active={src === 'all'} onPress={() => setSrc('all')} />
          <Chip label={t.audit.agent} active={src === 'agent'} onPress={() => setSrc('agent')} />
          <Chip label={t.audit.shell} active={src === 'shell'} onPress={() => setSrc('shell')} />
        </Row>
        {!q.data && q.isLoading ? <SkeletonList /> : null}
        {!q.data && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
        {q.data && !rows.length ? <EmptyState icon="list" title={t.audit.none} /> : null}
        {rows.length ? (
          <ListGroup>
            {rows.map((r, i) => (
              <View key={`${r.ts}-${i}`}>
                {i ? <Divider /> : null}
                <ListRow
                  left={<Dot level={r.result === 'ok' ? 'ok' : 'critical'} />}
                  title={`${r.action}${r.target ? ` · ${r.target}` : ''}`}
                  subtitle={`${dateTime(r.ts)} · ${r.actor} · ${r.ip}${r.detail ? ` · ${r.detail}` : ''}`}
                />
              </View>
            ))}
          </ListGroup>
        ) : null}
      </View>
    </DetailScreen>
  );
}
