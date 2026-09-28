import { View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useWake, useWol } from '@/api/hooks';
import { DetailScreen } from '@/components/layout';
import { EmptyState, ErrorState, SkeletonList, toast } from '@/components/overlays';
import { Button, Card, Icon, Row, T } from '@/components/primitives';
import { t } from '@/i18n';
import { ago } from '@/lib/format';
import { colors, space } from '@/theme/tokens';

export default function WolScreen() {
  const q = useWol();
  const wake = useWake();
  return (
    <DetailScreen title={t.wol.title} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {!q.data && q.isLoading ? <SkeletonList rows={2} /> : null}
      {!q.data && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && !q.data.length ? <EmptyState icon="wifi" title={t.wol.none} body={t.wol.noneBody} /> : null}
      <View style={{ gap: space.md }}>
        {q.data?.map((d) => (
          <Card key={d.id}>
            <Row gap={space.md}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="monitor" size={20} color={colors.purple} />
              </View>
              <View style={{ flex: 1 }}>
                <T v="h3">{d.name}</T>
                <T v="monoSmall">
                  {d.mac} · {d.broadcast}
                </T>
                <T v="caption">{`${t.wol.lastWoken}: ${d.last_woken ? t.common.ago(ago(d.last_woken.ts)) : t.common.never}`}</T>
              </View>
              <Button
                label={t.wol.wake}
                kind="secondary"
                onPress={() => wake.mutate(d.id, { onSuccess: () => toast.success(t.wol.sent(d.name)), onError: (e) => toast.error(errorMessage(e)) })}
                loading={wake.isPending && wake.variables === d.id}
              />
            </Row>
          </Card>
        ))}
      </View>
    </DetailScreen>
  );
}
