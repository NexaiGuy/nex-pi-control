import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';

import { useHistory, useSites } from '@/api/hooks';
import { DetailScreen } from '@/components/layout';
import { Button, Card, KeyValue, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { StatsCard } from '@/features/charts/StatsCard';
import { t } from '@/i18n';
import { dateTime } from '@/lib/format';
import { siteLevel } from '@/lib/status';
import { space } from '@/theme/tokens';

export default function SiteDetail() {
  const { host } = useLocalSearchParams<{ host: string }>();
  const h = String(host ?? '');
  const sites = useSites();
  const hist = useHistory([`site.${h}.latency`], '24h');
  const s = sites.data?.sites.find((x) => x.hostname === h);
  const st = s ? siteLevel(s) : null;
  return (
    <DetailScreen title={h} onRefresh={() => void Promise.all([sites.refetch(), hist.refetch()])} refreshing={sites.isRefetching}>
      {s ? (
        <Card style={{ gap: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="mono">https://{h}</T>
            {st ? <StatusPill level={st.level} label={st.label} /> : null}
          </Row>
          <KeyValue k="HTTP" v={s.status_code ? String(s.status_code) : s.error ?? '–'} />
          <KeyValue k={t.system.latency} v={s.latency_ms !== null && s.latency_ms !== undefined ? `${s.latency_ms} ms` : '–'} />
          <KeyValue k={t.system.tls} v={s.tls_expires_at ? `${dateTime(s.tls_expires_at)} (${s.tls_days_left} d)` : '–'} />
          <KeyValue k={t.system.local} v={s.local ?? '–'} />
          <KeyValue k={t.system.localHttp} v={s.local_status ? `${s.local_status} · ${s.local_latency_ms} ms` : s.local ? s.local_error ?? 'down' : '–'} />
          {s.source ? <KeyValue k={t.system.source} v={s.source} /> : null}
          <KeyValue k={t.system.checked} v={dateTime(s.checked_at)} />
        </Card>
      ) : null}
      <SectionTitle>{t.system.latency}</SectionTitle>
      {hist.data ? <StatsCard title={t.stats.latency24h} unit="ms" data={hist.data} /> : null}
      <Button label={t.system.openSite} icon="external-link" kind="secondary" style={{ marginTop: space.lg }} onPress={() => void Linking.openURL(`https://${h}`)} />
    </DetailScreen>
  );
}
