import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Switch, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useRestartService, useServiceLogs, useServices } from '@/api/hooks';
import { LabelCard } from '@/components/LabelCard';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, ErrorState, LogView, SkeletonList, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Card, KeyValue, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { bytes, duration } from '@/lib/format';
import { serviceLevel } from '@/lib/status';
import { colors, space } from '@/theme/tokens';

export default function ServiceDetail() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const unit = String(name ?? '');
  const [live, setLive] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const svc = useServices('all');
  const logs = useServiceLogs(unit, live);
  const restart = useRestartService();
  const s = svc.data?.find((x) => x.name === unit);
  const st = s ? serviceLevel(s) : null;
  const short = unit.replace(/\.service$/, '');

  const doRestart = () =>
    restart.mutate(unit, {
      onSuccess: (r) => (r.ok ? toast.success(t.system.restartDone(short)) : toast.error(r.message ?? t.errors.generic)),
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <DetailScreen title={short} onRefresh={() => void Promise.all([svc.refetch(), logs.refetch()])} refreshing={logs.isRefetching}>
      <Card style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="mono" style={{ flex: 1 }} numberOfLines={1}>
            {unit}
          </T>
          {st ? <StatusPill level={st.level} label={st.label} /> : null}
        </Row>
        {s ? (
          <>
            <T v="bodyMuted">{s.description}</T>
            <KeyValue k={t.system.uptime} v={s.uptime_seconds !== null ? duration(s.uptime_seconds, 3) : '–'} />
            <KeyValue k={t.system.memory} v={bytes(s.memory_bytes)} />
            <KeyValue k={t.system.restarts} v={String(s.restarts)} />
            <KeyValue k="PID" v={s.main_pid ? String(s.main_pid) : '–'} />
            <KeyValue k="Enabled" v={s.enabled || '–'} />
          </>
        ) : null}
      </Card>
      {s?.restart_allowed ? (
        <Button
          label={t.system.restart}
          icon="refresh-cw"
          loading={restart.isPending}
          style={{ marginTop: space.lg }}
          onPress={() => setConfirm({ title: `${t.system.restart}: ${short}`, effect: t.system.restartEffect(short), confirmLabel: t.system.restart, icon: 'refresh-cw', onConfirm: doRestart })}
        />
      ) : (
        <T v="caption" style={{ marginTop: space.lg }}>
          {t.system.notWhitelisted}
        </T>
      )}
      <LabelCard kind="service" name={unit} item={s} />
      <SectionTitle
        right={
          <Row gap={space.sm}>
            <T v="caption">{t.system.liveTail}</T>
            <Switch value={live} onValueChange={setLive} trackColor={{ true: colors.purple, false: colors.surface3 }} thumbColor={colors.text} accessibilityLabel={t.system.liveTail} />
          </Row>
        }
      >
        {t.system.logs}
      </SectionTitle>
      {!logs.data && logs.isLoading ? <SkeletonList rows={4} /> : null}
      {!logs.data && logs.error ? <ErrorState error={logs.error} onRetry={() => void logs.refetch()} /> : null}
      {logs.data ? (
        <View>
          <LogView lines={logs.data} />
        </View>
      ) : null}
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}
