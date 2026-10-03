// Updates: systeemupdates (apt) en de agent zelf. Beide lopen als vaste root-unit op de Pi, de app start ze enkel.
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ApiError, errorMessage } from '@/api/client';
import {
  useAgentUpdate, useCheckAgentUpdate, useCheckUpdates, useInfo, useInstallUpdates, useStartAgentUpdate, useUpdates,
} from '@/api/hooks';
import type { AptPackage, UnitRun } from '@/api/types';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, EmptyState, ErrorState, LogView, SkeletonList, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, ButtonRow, Card, Divider, KeyValue, Row, SectionTitle, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { INSTALL_COMMAND, supports } from '@/lib/agent';
import { ago } from '@/lib/format';
import { colors, isOdyssey, space } from '@/theme/tokens';

function RunLog({ run }: { run: UnitRun }) {
  if (!run.log.length) return null;
  return (
    <View style={{ gap: space.xs }}>
      <T v="label">{t.updates.log.toUpperCase()}</T>
      <LogView lines={run.log.slice(-60).map((l) => ({ message: l, level: /^ERROR/.test(l) ? 'err' : undefined }))} />
    </View>
  );
}

function NeedsAgent({ version }: { version: string }) {
  return (
    <Card style={{ gap: space.sm }}>
      <T>{t.updates.needsAgent(version)}</T>
      <T v="mono" selectable>
        {INSTALL_COMMAND}
      </T>
      <Button
        label={t.updates.manualUpdate}
        kind="secondary"
        icon="copy"
        onPress={async () => {
          await Clipboard.setStringAsync(INSTALL_COMMAND);
          toast.success(t.common.copied);
        }}
      />
    </Card>
  );
}

export default function UpdatesScreen() {
  const info = useInfo();
  const ok = supports(info.data, 'updates');
  const [fastApt, setFastApt] = useState(false);
  const [fastAgent, setFastAgent] = useState(false);
  const upd = useUpdates(fastApt, ok);
  const agent = useAgentUpdate(fastAgent, supports(info.data, 'agent_update'));
  const check = useCheckUpdates();
  const install = useInstallUpdates();
  const startAgent = useStartAgentUpdate();
  const recheckAgent = useCheckAgentUpdate();
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [showAll, setShowAll] = useState(false);

  const apt = upd.data;
  const aptRunning = !!apt?.upgrade.running;
  const ag = agent.data;
  const agRunning = !!ag?.run.running;
  // Snel pollen zolang iets loopt; daarna terug rustig. Bewust tijdens het renderen: geen effect nodig.
  if (fastApt !== aptRunning && apt) setFastApt(aptRunning);
  if (fastAgent && ag && !agRunning && ag.run.finished_at) setFastAgent(false);

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    try {
      const r = (await fn()) as { message?: string };
      toast.success(okMsg ?? r?.message ?? t.common.done);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (info.data && !ok) {
    return (
      <DetailScreen title={t.updates.title}>
        <NeedsAgent version={info.data.version} />
      </DetailScreen>
    );
  }

  const pkgs = apt ? (showAll ? apt.packages : apt.packages.slice(0, 12)) : [];
  const lastOk = apt?.upgrade.result === 'success';
  const last = apt?.last_upgrade ?? null;
  const kept = new Set(last?.kept_back ?? []);
  // Agent 1.2.3+: `held` per pakket uit de controle zelf. Oudere agents: enkel na een installatie (kept_back).
  const isHeld = (p: AptPackage) => !!p.held || kept.has(p.name);
  const heldCount = apt ? (apt.held_count ?? apt.packages.filter(isHeld).length) : 0;
  const removes = apt?.full_upgrade_removes ?? [];
  const reasons = new Set(apt?.packages.filter(isHeld).map((p) => p.reason ?? 'removal'));

  return (
    <DetailScreen
      title={t.updates.title}
      onRefresh={() => void Promise.all([upd.refetch(), agent.refetch(), info.refetch()])}
      refreshing={upd.isRefetching}
    >
      <SectionTitle>{t.updates.system}</SectionTitle>
      {!apt && upd.isLoading ? <SkeletonList rows={3} /> : null}
      {!apt && upd.error ? <ErrorState error={upd.error} onRetry={() => void upd.refetch()} /> : null}
      {apt ? (
        <Card style={{ gap: space.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1, gap: 2 }}>
              <T v="h3">{aptRunning ? t.updates.installing : apt.count ? t.updates.available(apt.count) : t.updates.upToDate}</T>
              <T v="caption">
                {[apt.checking ? t.updates.checking : apt.checked_at ? t.updates.checkedAt(ago(apt.checked_at)) : t.updates.neverChecked, heldCount ? t.updates.heldCount(heldCount) : null]
                  .filter(Boolean)
                  .join(' · ')}
              </T>
            </View>
            {apt.security_count ? <StatusPill level="warning" label={t.updates.security(apt.security_count)} /> : apt.count ? null : <StatusPill level="ok" label="OK" />}
          </Row>
          {apt.blocked_reason ? (
            <T v="caption" style={{ color: colors.red }}>
              {apt.blocked_reason}
            </T>
          ) : null}
          {apt.reboot_required ? (
            <>
              <T v="caption" style={{ color: colors.amber }}>
                {t.updates.rebootRequired}
              </T>
              <Button label={t.updates.rebootNow} kind="secondary" icon="power" onPress={() => router.push('/power')} />
            </>
          ) : null}
          {apt.error ? (
            <T v="caption" style={{ color: colors.amber }}>
              {apt.error}
            </T>
          ) : null}
          {!apt.allowed ? <T v="caption">{t.updates.disabled}</T> : null}
          <ButtonRow>
            <Button
              label={t.updates.checkNow}
              kind="secondary"
              icon="refresh-cw"
              disabled={!apt.allowed || apt.checking || aptRunning}
              loading={check.isPending}
              style={isOdyssey() ? undefined : { flex: 1 }}
              onPress={() => void run(() => check.mutateAsync(undefined))}
            />
            <Button
              label={t.updates.install}
              icon="download"
              disabled={!apt.allowed || !apt.count || aptRunning || !!apt.blocked_reason}
              loading={install.isPending || aptRunning}
              style={isOdyssey() ? undefined : { flex: 1 }}
              onPress={() =>
                setConfirm({
                  title: t.updates.install,
                  effect: t.updates.installEffect(apt.count),
                  confirmLabel: t.updates.install,
                  dangerous: true,
                  icon: 'download',
                  onConfirm: () =>
                    void run(async () => {
                      const r = await install.mutateAsync(undefined);
                      setFastApt(true);
                      return r;
                    }),
                })
              }
            />
          </ButtonRow>
          {apt.upgrade.started_at ? (
            <>
              <Divider />
              {!aptRunning && apt.upgrade.result ? (
                <KeyValue
                  k={t.updates.lastRun}
                  v={[t.updates.result(lastOk), last && last.upgraded !== null ? t.updates.summary(last.upgraded, last.newly_installed ?? 0) : null, ago(apt.upgrade.finished_at ?? apt.upgrade.started_at)]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ) : null}
              <RunLog run={apt.upgrade} />
            </>
          ) : null}
          {heldCount && !aptRunning ? (
            <>
              <Divider />
              <T v="caption">
                {[
                  reasons.has('removal') || reasons.has('other') ? t.updates.heldRemoval(removes) : null,
                  reasons.has('phased') ? t.updates.heldPhased : null,
                  reasons.has('hold') ? t.updates.heldHold : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </T>
            </>
          ) : null}
          {pkgs.length ? (
            <>
              <Divider />
              <T v="label">{t.updates.packages.toUpperCase()}</T>
              {pkgs.map((p) => (
                <Row key={p.name} style={{ justifyContent: 'space-between' }}>
                  <T v="mono" style={{ flex: 1 }} numberOfLines={1}>
                    {p.name}
                  </T>
                  {p.security ? <StatusPill compact level="warning" label="security" /> : null}
                  {isHeld(p) ? <StatusPill compact level="unknown" label={p.reason === 'phased' ? t.updates.phased : p.reason === 'hold' ? t.updates.onHold : t.updates.keptBack} /> : null}
                  <T v="monoSmall" numberOfLines={1} style={{ maxWidth: '45%' }}>
                    {p.to}
                  </T>
                </Row>
              ))}
              {!showAll && apt.packages.length > 12 ? <Button label={t.updates.showAll(apt.packages.length)} kind="ghost" onPress={() => setShowAll(true)} /> : null}
            </>
          ) : null}
        </Card>
      ) : null}

      <SectionTitle>{t.updates.agent}</SectionTitle>
      {!ag && agent.isLoading ? <SkeletonList rows={2} /> : null}
      {!ag && agent.error && !(agent.error instanceof ApiError && agent.error.kind === 'not_found') ? (
        <ErrorState error={agent.error} onRetry={() => void agent.refetch()} />
      ) : null}
      {ag ? (
        <Card style={{ gap: space.md }}>
          <KeyValue k={t.updates.agentCurrent} v={ag.current} />
          <KeyValue k={t.updates.agentLatest} v={ag.latest ?? '–'} />
          {agRunning || fastAgent ? (
            <T style={{ color: colors.amber }}>{t.updates.agentRunning}</T>
          ) : ag.run.result === 'success' && !ag.update_available ? (
            <StatusPill level="ok" label={t.updates.agentDone(ag.current)} />
          ) : ag.run.started_at && ag.run.result && ag.run.result !== 'success' ? (
            <T style={{ color: colors.red }}>{t.updates.agentFailed}</T>
          ) : ag.update_available && ag.latest ? (
            <StatusPill level="info" label={t.updates.agentAvailable(ag.latest)} />
          ) : ag.error ? (
            <T v="caption">{t.updates.agentCheckFailed}</T>
          ) : !ag.latest ? (
            <T v="caption">{t.updates.agentNoRelease}</T>
          ) : (
            <StatusPill level="ok" label={t.updates.agentUpToDate} />
          )}
          {ag.update_available && ag.notes ? (
            <View style={{ gap: space.xs }}>
              <T v="label">{t.updates.releaseNotes.toUpperCase()}</T>
              <T v="caption">{ag.notes.slice(0, 600)}</T>
            </View>
          ) : null}
          {!ag.allowed ? <T v="caption">{t.updates.disabled}</T> : null}
          <ButtonRow>
            <Button
              label={t.updates.agentCheck}
              kind="secondary"
              icon="refresh-cw"
              loading={recheckAgent.isPending}
              disabled={agRunning}
              style={isOdyssey() ? undefined : { flex: 1 }}
              onPress={() => recheckAgent.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}
            />
            {ag.update_available && ag.latest ? (
              <Button
                label={t.updates.agentUpdate(ag.latest)}
                icon="arrow-up-circle"
                disabled={!ag.allowed || agRunning}
                loading={startAgent.isPending || agRunning}
                style={isOdyssey() ? undefined : { flex: 1 }}
                onPress={() =>
                  setConfirm({
                    title: t.updates.agentUpdate(ag.latest!),
                    effect: t.updates.agentEffect(ag.latest!),
                    confirmLabel: t.updates.agentUpdate(ag.latest!),
                    dangerous: true,
                    icon: 'arrow-up-circle',
                    onConfirm: () =>
                      void run(async () => {
                        const r = await startAgent.mutateAsync(undefined);
                        setFastAgent(true);
                        return r;
                      }),
                  })
                }
              />
            ) : null}
          </ButtonRow>
          {ag.run.started_at ? <RunLog run={ag.run} /> : null}
        </Card>
      ) : null}
      {!apt && !upd.isLoading && !upd.error ? <EmptyState icon="download" title={t.updates.upToDate} /> : null}
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}
