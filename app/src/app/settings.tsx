import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { cacheClear } from '@/api/cache';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, PromptSheet, Sheet, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Card, Chip, Divider, Icon, IconButton, KeyValue, Row, SectionTitle, T } from '@/components/primitives';
import { authenticate } from '@/features/lock/LockGate';
import { ConnectionForm } from '@/features/onboarding/ConnectionForm';
import { QrScanner } from '@/features/onboarding/QrScanner';
import { t } from '@/i18n';
import { DEFAULT_CONNECTION, connectionStore, prefsStore, saveConnection, savePrefs, serverName, wipeAll, type Connection, type Prefs } from '@/state/settings';
import { useStore } from '@/state/store';
import { colors, space } from '@/theme/tokens';

function Stepper({ label, value, step, min, max, onChange }: { label: string; value: number; step: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between', minHeight: 48 }}>
      <T style={{ flex: 1 }}>{label}</T>
      <Row gap={4}>
        <IconButton icon="minus" label={t.settings.lower(label)} onPress={() => onChange(Math.max(min, value - step))} size={16} />
        <T v="mono" style={{ minWidth: 40, textAlign: 'center' }}>
          {value}
        </T>
        <IconButton icon="plus" label={t.settings.higher(label)} onPress={() => onChange(Math.min(max, value + step))} size={16} />
      </Row>
    </Row>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row style={{ justifyContent: 'space-between', minHeight: 48 }}>
      <T style={{ flex: 1 }}>{label}</T>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.purple, false: colors.surface3 }} thumbColor={colors.text} accessibilityLabel={label} />
    </Row>
  );
}

export default function SettingsScreen() {
  const conn = useStore(connectionStore);
  const prefs = useStore(prefsStore);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Connection>(conn);
  const [unlocked, setUnlocked] = useState(false);
  const [scan, setScan] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [addSnippet, setAddSnippet] = useState(false);

  useEffect(() => {
    void ScreenCapture.preventScreenCaptureAsync('settings');
    return () => void ScreenCapture.allowScreenCaptureAsync('settings');
  }, []);

  const upd = (p: Partial<Prefs>) => void savePrefs(p);
  const dirty = JSON.stringify(draft) !== JSON.stringify(conn);

  return (
    <DetailScreen title={t.settings.title}>
      <SectionTitle>{t.settings.connection}</SectionTitle>
      <Card style={{ gap: space.md }}>
        {conn.demo && !unlocked ? (
          <>
            <T v="body">{t.demo.banner}</T>
            <Button
              label={t.settings.leaveDemo}
              icon="log-in"
              onPress={async () => {
                cacheClear();
                qc.clear();
                await saveConnection(DEFAULT_CONNECTION);
                await savePrefs({ onboarded: false });
                router.replace('/onboarding');
              }}
            />
          </>
        ) : unlocked ? (
          <>
            <ConnectionForm value={draft} onChange={setDraft} />
            <Row>
              <Button label={t.settings.scan} kind="secondary" icon="camera" onPress={() => setScan(true)} style={{ flex: 1 }} />
              <Button
                label={t.common.save}
                icon="save"
                disabled={!dirty}
                style={{ flex: 1 }}
                onPress={async () => {
                  await saveConnection(draft);
                  cacheClear();
                  await qc.invalidateQueries();
                  toast.success(t.settings.saved);
                }}
              />
            </Row>
          </>
        ) : (
          <>
            <KeyValue k={t.settings.serverName} v={serverName(conn)} />
            <KeyValue k={t.settings.apiUrl} v={conn.apiUrl} />
            <KeyValue k={t.settings.shellUrl} v={conn.shellUrl} />
            <KeyValue k={t.settings.tokens} v={t.settings.secretHidden} />
            <Button
              label={t.settings.edit}
              icon="lock"
              kind="secondary"
              onPress={async () => {
                if (await authenticate(t.settings.editReason)) {
                  setDraft(connectionStore.get());
                  setUnlocked(true);
                }
              }}
            />
          </>
        )}
      </Card>

      <SectionTitle>{t.settings.thresholds}</SectionTitle>
      <Card>
        <Stepper label={t.settings.tempWarn} value={prefs.thresholds.tempC} step={1} min={50} max={85} onChange={(v) => upd({ thresholds: { ...prefs.thresholds, tempC: v } })} />
        <Divider />
        <Stepper label={t.settings.diskWarn} value={prefs.thresholds.diskPct} step={5} min={50} max={98} onChange={(v) => upd({ thresholds: { ...prefs.thresholds, diskPct: v } })} />
        <Divider />
        <Stepper label={t.settings.backupWarn} value={prefs.thresholds.backupHours} step={6} min={6} max={168} onChange={(v) => upd({ thresholds: { ...prefs.thresholds, backupHours: v } })} />
      </Card>

      <SectionTitle>{t.settings.notifications}</SectionTitle>
      <Card>
        {(['disk', 'service', 'site', 'temp', 'backup'] as const).map((k, i) => (
          <View key={k}>
            {i ? <Divider /> : null}
            <Toggle
              label={{ disk: t.settings.notifyDisk, service: t.settings.notifyService, site: t.settings.notifySite, temp: t.settings.notifyTemp, backup: t.settings.notifyBackup }[k]}
              value={prefs.notify[k]}
              onChange={(v) => upd({ notify: { ...prefs.notify, [k]: v } })}
            />
          </View>
        ))}
        <T v="caption" style={{ marginTop: space.sm }}>
          {t.settings.notifyNote}
        </T>
      </Card>

      <SectionTitle>{t.settings.security}</SectionTitle>
      <Card>
        <Toggle
          label={t.settings.biometric}
          value={prefs.biometric}
          onChange={async (v) => {
            if (await authenticate(t.lock.reason)) upd({ biometric: v });
          }}
        />
        <Divider />
        <T style={{ marginVertical: space.sm }}>{t.settings.autoLock}</T>
        <Row style={{ flexWrap: 'wrap' }}>
          {[0, 1, 2, 5, 15].map((m) => (
            <Chip key={m} label={m === 0 ? t.settings.immediately : `${m} min`} active={prefs.autoLockMinutes === m} onPress={() => upd({ autoLockMinutes: m })} />
          ))}
        </Row>
      </Card>

      <SectionTitle right={<IconButton icon="plus" label={t.settings.addSnippet} onPress={() => setAddSnippet(true)} />}>{t.terminal.snippets}</SectionTitle>
      <Card style={{ gap: space.xs }}>
        {prefs.snippets.map((sn, i) => (
          <Row key={i} style={{ justifyContent: 'space-between' }}>
            <T v="mono" style={{ flex: 1 }} numberOfLines={1}>
              {sn}
            </T>
            <Pressable onPress={() => upd({ snippets: prefs.snippets.filter((_, j) => j !== i) })} accessibilityLabel={t.settings.removeSnippet(sn)} hitSlop={10} style={{ padding: 10 }}>
              <Icon name="x" size={16} color={colors.textMuted} />
            </Pressable>
          </Row>
        ))}
      </Card>

      <SectionTitle>{t.about.title}</SectionTitle>
      <Card onPress={() => router.push('/about')} accessibilityLabel={t.about.title}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, gap: 2 }}>
            <T v="h3">{t.app.name}</T>
            <T v="caption">{`${t.about.version(Constants.expoConfig?.version ?? '1.0.0')} · ${t.app.by}`}</T>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textMuted} />
        </Row>
      </Card>

      <Button
        label={t.settings.reset}
        kind="danger"
        icon="trash-2"
        style={{ marginTop: space.xl }}
        onPress={() =>
          setConfirm({
            title: t.settings.reset,
            effect: t.settings.resetEffect,
            confirmLabel: t.settings.reset,
            dangerous: true,
            onConfirm: async () => {
              cacheClear();
              qc.clear();
              await wipeAll();
            },
          })
        }
      />

      <Sheet visible={scan} onClose={() => setScan(false)} title={t.settings.scan} scroll={false}>
        {scan ? (
          <View style={{ paddingBottom: space.lg }}>
            <QrScanner
              onResult={(c) => {
                setDraft(c);
                setUnlocked(true);
                setScan(false);
                toast.success(t.settings.qrRead);
              }}
              onInvalid={() => toast.error(t.onboarding.invalidQr)}
            />
          </View>
        ) : null}
      </Sheet>
      <PromptSheet
        visible={addSnippet}
        title={t.settings.addSnippet}
        placeholder={t.settings.snippetPlaceholder}
        confirmLabel={t.common.save}
        onClose={() => setAddSnippet(false)}
        onSubmit={(v) => {
          setAddSnippet(false);
          upd({ snippets: [...prefs.snippets, v].slice(0, 30) });
        }}
      />
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}
