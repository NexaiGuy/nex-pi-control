import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { errorMessage } from '@/api/client';
import { useContainerLogs, useContainers, useInfo, useRestartContainer } from '@/api/hooks';
import { LabelCard } from '@/components/LabelCard';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, ErrorState, LogView, SkeletonList, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Card, KeyValue, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { supports } from '@/lib/agent';
import { bytes, pct } from '@/lib/format';
import { containerLevel } from '@/lib/status';
import { space } from '@/theme/tokens';

export default function ContainerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cid = String(id ?? '');
  const c = useContainers();
  const info = useInfo();
  const restart = useRestartContainer();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  // Werkt met id of naam (meldingen verwijzen naar de naam).
  const x = c.data?.containers.find((k) => k.id === cid || k.name === cid);
  const logs = useContainerLogs(x?.id ?? cid);
  const canRestart = supports(info.data, 'container_restart');
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
          <KeyValue k={t.system.health} v={x.state !== 'running' && x.last_health ? `${x.health ?? '–'} (${x.last_health})` : x.health ?? '–'} />
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
      {x ? <LabelCard kind="container" name={x.name} item={x} /> : null}
      <SectionTitle>{t.system.logs}</SectionTitle>
      {!logs.data && logs.isLoading ? <SkeletonList rows={4} /> : null}
      {!logs.data && logs.error ? <ErrorState error={logs.error} onRetry={() => void logs.refetch()} /> : null}
      {logs.data ? <LogView lines={logs.data.lines.map((l) => ({ message: l }))} /> : null}
      {x && canRestart && x.restart_allowed !== false ? (
        <Button
          label={t.system.restartContainer}
          icon="rotate-cw"
          kind="secondary"
          loading={restart.isPending}
          style={{ marginTop: space.md }}
          onPress={() =>
            setConfirm({
              title: t.system.restartContainer,
              effect: t.system.restartContainerEffect(x.name),
              confirmLabel: t.system.restartContainer,
              dangerous: true,
              icon: 'rotate-cw',
              onConfirm: () =>
                restart.mutate(x.name, {
                  onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
                  onError: (e) => toast.error(errorMessage(e)),
                }),
            })
          }
        />
      ) : null}
      <T v="caption" style={{ marginTop: space.md }}>
        {!info.data ? '' : !canRestart ? t.system.restartNeedsAgent : x?.restart_allowed === false ? t.system.restartNotAllowed : ''}
      </T>
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}
