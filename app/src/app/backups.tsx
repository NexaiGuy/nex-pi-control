import { View } from 'react-native';

import { useBackups } from '@/api/hooks';
import { ListGroup, ListRow } from '@/components/ListRow';
import { DetailScreen } from '@/components/layout';
import { EmptyState, ErrorState, SkeletonList } from '@/components/overlays';
import { Divider, Dot, StatusPill } from '@/components/primitives';
import { t } from '@/i18n';
import { bytes, duration } from '@/lib/format';
import { prefsStore } from '@/state/settings';
import { useStore } from '@/state/store';

export default function BackupsScreen() {
  const q = useBackups();
  const maxH = useStore(prefsStore, (p) => p.thresholds.backupHours);
  return (
    <DetailScreen title={t.backups.title} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {!q.data && q.isLoading ? <SkeletonList /> : null}
      {!q.data && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && !q.data.length ? <EmptyState icon="archive" title={t.backups.none} /> : null}
      {q.data?.length ? (
        <ListGroup>
          {q.data.map((b, i) => {
            const old = b.state === 'ok' && (b.age_seconds ?? 0) > maxH * 3600;
            return (
              <View key={b.path}>
                {i ? <Divider /> : null}
                <ListRow
                  left={<Dot level={b.state !== 'ok' ? 'unknown' : old ? 'warning' : 'ok'} />}
                  title={b.name}
                  subtitle={
                    b.state === 'ok'
                      ? `${t.backups.oldShort(duration(b.age_seconds ?? 0, 1))} · ${bytes(b.latest_size)} · ${b.files} ${t.backups.files} · ${bytes(b.total_size)} ${t.backups.total}`
                      : b.state === 'no_access'
                        ? t.backups.noAccess
                        : t.backups.empty
                  }
                  right={old ? <StatusPill compact level="warning" label={t.backups.tooOld} /> : null}
                />
              </View>
            );
          })}
        </ListGroup>
      ) : null}
    </DetailScreen>
  );
}
