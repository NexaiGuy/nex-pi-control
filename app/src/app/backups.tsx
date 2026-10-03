import { View } from 'react-native';

import { useBackups } from '@/api/hooks';
import { ListGroup, ListRow } from '@/components/ListRow';
import { DetailScreen } from '@/components/layout';
import { EmptyState, ErrorState, SkeletonList } from '@/components/overlays';
import { Divider, Dot, StatusPill, T } from '@/components/primitives';
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
            const archive = b.kind === 'archive';
            const timer = b.source === 'timer';
            const failed = b.state === 'failed';
            const limit = b.max_age_seconds ?? maxH * 3600;
            const old = !archive && b.state === 'ok' && (b.age_seconds ?? 0) > limit;
            return (
              <View key={b.path}>
                {i ? <Divider /> : null}
                <ListRow
                  left={<Dot level={failed ? 'critical' : b.state !== 'ok' || archive ? 'unknown' : old ? 'warning' : 'ok'} />}
                  title={b.name}
                  subtitle={
                    timer
                      ? [t.backups.timer, b.age_seconds !== undefined ? t.backups.lastRun(duration(b.age_seconds, 1)) : t.backups.noRun, b.result && b.result !== 'success' ? b.result : null, b.description || null]
                          .filter(Boolean)
                          .join(' · ')
                      : b.state === 'ok'
                      ? `${t.backups.oldShort(duration(b.age_seconds ?? 0, 1))} · ${bytes(b.latest_size)} · ${b.files} ${t.backups.files} · ${bytes(b.total_size)} ${t.backups.total}`
                      : b.state === 'no_access'
                        ? t.backups.noAccess
                        : t.backups.empty
                  }
                  right={failed ? <StatusPill compact level="critical" label={t.backups.failed} /> : old ? <StatusPill compact level="warning" label={t.backups.tooOld} /> : archive ? <StatusPill compact level="unknown" label={t.backups.archive} /> : null}
                />
              </View>
            );
          })}
        </ListGroup>
      ) : null}
      {q.data?.some((b) => b.kind === 'archive') ? (
        <T v="caption" style={{ marginTop: 12 }}>
          {t.backups.archiveNote}
        </T>
      ) : null}
    </DetailScreen>
  );
}
