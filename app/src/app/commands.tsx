import { useState } from 'react';
import { View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useCommands, useRunCommand } from '@/api/hooks';
import type { Command, CommandResult } from '@/api/types';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, EmptyState, ErrorState, LogView, Sheet, SkeletonList, toast, type ConfirmSpec } from '@/components/overlays';
import { Card, Icon, Row, StatusPill, T, type IconName } from '@/components/primitives';
import { t } from '@/i18n';
import { ago } from '@/lib/format';
import { colors, space } from '@/theme/tokens';

export default function CommandsScreen() {
  const q = useCommands();
  const run = useRunCommand();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [out, setOut] = useState<{ cmd: Command; res: CommandResult | null } | null>(null);

  const start = (c: Command) => {
    setOut({ cmd: c, res: null });
    run.mutate(c.id, {
      onSuccess: (res) => {
        setOut({ cmd: c, res });
        if (res.ok) toast.success(`${c.name}: ${t.common.done}`);
        else toast.error(`${c.name}: ${res.reason}`);
      },
      onError: (e) => {
        setOut(null);
        toast.error(errorMessage(e));
      },
    });
  };

  return (
    <DetailScreen title={t.commands.title} onRefresh={() => void q.refetch()} refreshing={q.isRefetching}>
      {!q.data && q.isLoading ? <SkeletonList rows={3} /> : null}
      {!q.data && q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data && !q.data.length ? <EmptyState icon="zap" title={t.commands.none} body={t.commands.noneBody} /> : null}
      <View style={{ gap: space.md }}>
        {q.data?.map((c) => (
          <Card
            key={c.id}
            glow={c.dangerous ? 'warning' : undefined}
            onPress={() =>
              setConfirm({
                title: c.name,
                effect: c.effect || c.description,
                confirmLabel: t.commands.run,
                dangerous: c.dangerous,
                icon: 'play',
                onConfirm: () => start(c),
              })
            }
            accessibilityLabel={`${c.name}. ${c.description}`}
          >
            <Row gap={space.md}>
              <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: c.dangerous ? colors.amberSoft : colors.purpleSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={(c.icon as IconName) || 'terminal'} size={20} color={c.dangerous ? colors.amber : colors.purple} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <T v="h3">{c.name}</T>
                <T v="caption">{c.description}</T>
                <T v="monoSmall">
                  {t.commands.lastRun}: {c.last_run ? `${t.common.ago(ago(c.last_run.ts))} · ${c.last_run.result}` : t.common.never}
                </T>
              </View>
              <Icon name="play-circle" size={24} color={colors.purple} />
            </Row>
          </Card>
        ))}
      </View>
      <Sheet visible={!!out} onClose={() => !run.isPending && setOut(null)} title={out?.cmd.name}>
        {out ? (
          <View style={{ gap: space.md }}>
            {out.res ? (
              <StatusPill level={out.res.ok ? 'ok' : 'critical'} label={out.res.ok ? t.common.done : out.res.reason || 'Mislukt'} />
            ) : (
              <StatusPill level="info" label={t.common.busy} />
            )}
            <T v="label">{t.commands.output.toUpperCase()}</T>
            <LogView lines={(out.res?.output ?? ['…']).map((m) => ({ message: m }))} />
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}
