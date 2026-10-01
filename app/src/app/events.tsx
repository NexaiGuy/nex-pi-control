// Meldingen van de Pi zelf: wat er misging en wat weer goed kwam. De agent houdt dit bij, ook als de gsm uit staat.
import { router, type Href } from 'expo-router';

import { useEvents, useInfo } from '@/api/hooks';
import type { AgentEvent } from '@/api/types';
import { DetailScreen } from '@/components/layout';
import { EmptyState, ErrorState, SkeletonList } from '@/components/overlays';
import { ListGroup, ListRow } from '@/components/ListRow';
import { Card, Dot, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { supports } from '@/lib/agent';
import { ago } from '@/lib/format';
import type { Level } from '@/theme/tokens';

/** Waar brengt een tik op de melding je naartoe? */
export function eventHref(e: Pick<AgentEvent, 'kind' | 'key'>): Href {
  const target = e.key.slice(e.key.indexOf(':') + 1);
  switch (e.kind) {
    case 'disk':
      return '/disks';
    case 'service':
      return { pathname: '/service/[name]', params: { name: target } };
    case 'container':
      return { pathname: '/container/[id]', params: { id: target } };
    case 'site':
      return { pathname: '/site/[host]', params: { host: target } };
    case 'updates':
      return '/updates';
    default:
      return '/';
  }
}

function levelOf(e: AgentEvent): Level {
  if (e.resolved || e.level === 'ok') return 'ok';
  if (e.level === 'critical') return 'critical';
  if (e.level === 'warning') return 'warning';
  return 'info';
}

export default function EventsScreen() {
  const info = useInfo();
  const ev = useEvents(supports(info.data, 'events'));
  const old = info.data && !supports(info.data, 'events');
  return (
    <DetailScreen title={t.events.title} onRefresh={() => void ev.refetch()} refreshing={ev.isRefetching} right={ev.data?.open ? <StatusPill compact level="warning" label={t.events.open(ev.data.open)} /> : undefined}>
      {old ? (
        <Card>
          <T>{t.events.needsAgent}</T>
        </Card>
      ) : null}
      {!old && !ev.data && ev.isLoading ? <SkeletonList rows={5} /> : null}
      {!old && !ev.data && ev.error ? <ErrorState error={ev.error} onRetry={() => void ev.refetch()} /> : null}
      {ev.data && !ev.data.events.length ? <EmptyState icon="bell" title={t.events.none} body={t.events.noneBody} /> : null}
      {ev.data?.events.length ? (
        <ListGroup>
          {ev.data.events.map((e) => (
            <ListRow
              key={e.id}
              mono={false}
              left={<Dot level={levelOf(e)} size={10} />}
              title={e.title}
              subtitle={`${ago(e.ts)}${e.body ? ` · ${e.body}` : ''}`}
              onPress={() => router.push(eventHref(e))}
            />
          ))}
        </ListGroup>
      ) : null}
    </DetailScreen>
  );
}
