import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, useState } from 'react';
import { AppState, Pressable, Switch, View } from 'react-native';

import { cacheClear } from '@/api/cache';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, PromptSheet, Sheet, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Card, Chip, Divider, Icon, IconButton, KeyValue, Row, SectionTitle, T } from '@/components/primitives';
import { authenticate } from '@/features/lock/LockGate';
import { ConnectionForm } from '@/features/onboarding/ConnectionForm';
import { QrScanner } from '@/features/onboarding/QrScanner';
import { t } from '@/i18n';
import { ListGroup, ListRow } from '@/components/ListRow';
import { activateServer } from '@/features/servers/ServerSwitcher';
import { connectionStore, prefsStore, removeServer, saveConnection, savePrefs, serverName, serversStore, wipeAll, type Connection, type Prefs } from '@/state/settings';
import { floatingPi } from '@/lib/floatingPi';
import { setThemeReturn } from '@/lib/themeReturn';
import { useStore } from '@/state/store';
import { colors, isOdyssey, radius, space, type DesignName, type ThemePref } from '@/theme/tokens';

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
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.purple, false: colors.surface3 }} thumbColor={colors.onAccent} accessibilityLabel={label} />
    </Row>
  );
}

/**
 * Zwevend icoon aan/uit. Zonder toestemming opent Android eerst "Weergeven over andere apps"; bij terugkeer in de app
 * start het icoon vanzelf. Niet zichtbaar in builds zonder de functie (Play Store-variant) of op iOS.
 */
function FloatingIconSetting() {
  const [supported] = useState(() => floatingPi.supported());
  const [on, setOn] = useState(() => floatingPi.enabled());
  const [homeOnly, setHomeOnly] = useState(() => floatingPi.homeOnly());
  const [usage, setUsage] = useState(() => floatingPi.hasUsageAccess());
  const [waiting, setWaiting] = useState(false);
  const [status, setStatus] = useState(() => floatingPi.status());
  useEffect(() => {
    if (!supported) return undefined;
    // Statusregel elke 2 s vernieuwen zolang Instellingen open staat.
    const id = setInterval(() => setStatus(floatingPi.status()), 2000);
    return () => clearInterval(id);
  }, [supported]);
  useEffect(() => {
    if (!supported) return undefined;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Terug uit een Android-instellingenscherm: toestemmingen opnieuw bekijken.
      setUsage(floatingPi.hasUsageAccess());
      floatingPi.recheck();
      if (waiting) {
        setWaiting(false);
        if (floatingPi.canDraw() && floatingPi.start()) setOn(true);
        else toast.error(t.floating.denied);
      } else {
        setOn(floatingPi.enabled());
      }
    });
    return () => sub.remove();
  }, [supported, waiting]);
  if (!supported) return null;
  const toggle = (v: boolean) => {
    if (!v) {
      floatingPi.stop();
      setOn(false);
      setWaiting(false);
      return;
    }
    if (floatingPi.canDraw()) {
      setOn(floatingPi.start());
      return;
    }
    toast.success(t.floating.permission);
    setWaiting(true);
    floatingPi.openPermission();
  };
  const toggleHome = (v: boolean) => {
    floatingPi.setHomeOnly(v);
    setHomeOnly(v);
  };
  return (
    <>
      <SectionTitle>{t.floating.title}</SectionTitle>
      <Card style={{ gap: space.sm }}>
        <Toggle label={t.floating.toggle} value={on || waiting} onChange={toggle} />
        {on ? <Toggle label={t.floating.homeOnly} value={homeOnly} onChange={toggleHome} /> : null}
        {on && !usage ? (
          <>
            <T v="caption">{t.floating.usageNeeded}</T>
            <Button label={t.floating.usageButton} kind="secondary" icon="eye" onPress={() => floatingPi.openUsageAccess()} />
          </>
        ) : null}
        <T v="caption">{t.floating.note}</T>
        {status ? (
          <T v="monoSmall" style={{ color: colors.textMuted }}>
            {t.floating.status(status.running, status.canDraw, status.usageAccess, status.foreground ?? null, status.onHome ?? null, status.bank ?? false)}
          </T>
        ) : null}
      </Card>
    </>
  );
}

// Mini-voorbeeld van elk thema. Vaste kleuren: het voorbeeld toont het thema, niet het actieve thema.
const SWATCH: Record<ThemePref, { bg: string; bars: string[]; line: string }> = {
  system: { bg: '#F6F5FB', bars: ['#6D28D9', '#34F5C5'], line: '#0B0B12' },
  dark: { bg: '#0B0B12', bars: ['#8B5CF6', '#34F5C5'], line: '#2A2A3D' },
  light: { bg: '#F6F5FB', bars: ['#BE185D', '#047857'], line: '#E2DFEE' },
};

// Mini-voorbeeld van elk design. Vaste kleuren: het voorbeeld toont het design, niet het actieve design.
const DESIGN_SWATCH: Record<DesignName, { bg: string; card: string; edge: string; accent: string; bar: string; thin: boolean }> = {
  odyssey: { bg: '#050508', card: '#0E0E16', edge: 'rgba(242,242,240,0.22)', accent: '#FF2A1F', bar: '#8A8A94', thin: true },
  classic: { bg: '#0B0B12', card: '#14141F', edge: '#2A2A3D', accent: '#8B5CF6', bar: '#34F5C5', thin: false },
};

function DesignPicker({ value, onChange }: { value: DesignName; onChange: (v: DesignName) => void }) {
  const opts: { k: DesignName; label: string; sub?: string }[] = [
    { k: 'odyssey', label: t.settings.designOdyssey, sub: t.settings.designDefault },
    { k: 'classic', label: t.settings.designClassic },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="radiogroup">
      {opts.map(({ k, label, sub }) => {
        const on = value === k;
        const sw = DESIGN_SWATCH[k];
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={t.settings.designA11y(label)}
            style={{
              flex: 1, padding: space.sm, gap: 6, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.surface,
              borderWidth: on ? (isOdyssey() ? 1 : 2) : 1, borderColor: on ? (isOdyssey() ? colors.text : colors.cyan) : colors.line, minHeight: 48,
            }}
          >
            <View style={{ alignSelf: 'stretch', height: 58, borderRadius: sw.thin ? 3 : 8, backgroundColor: sw.bg, overflow: 'hidden', padding: 6, gap: 5, borderWidth: 1, borderColor: colors.line, alignItems: sw.thin ? 'center' : 'stretch' }}>
              {sw.thin ? (
                <>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: sw.accent, opacity: 0.9 }} />
                  <View style={{ alignSelf: 'stretch', height: 18, borderRadius: 2, borderWidth: 1, borderColor: sw.edge, backgroundColor: sw.card }} />
                  <View style={{ alignSelf: 'stretch', height: 1, backgroundColor: sw.bar }} />
                </>
              ) : (
                <>
                  <View style={{ height: 6, borderRadius: 3, backgroundColor: sw.accent }} />
                  <View style={{ height: 6, width: '60%', borderRadius: 3, backgroundColor: sw.bar }} />
                  <View style={{ height: 14, borderRadius: 4, borderWidth: 1, borderColor: sw.edge, backgroundColor: sw.card }} />
                </>
              )}
            </View>
            <T v="caption" style={{ color: on ? colors.text : colors.textMuted }}>
              {label}
            </T>
            {sub ? (
              <T v="monoSmall" style={{ marginTop: -4 }}>
                {sub}
              </T>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function ThemePicker({ value, onChange }: { value: ThemePref; onChange: (v: ThemePref) => void }) {
  const opts: { k: ThemePref; label: string }[] = [
    { k: 'system', label: t.settings.themeSystem },
    { k: 'dark', label: t.settings.themeDark },
    { k: 'light', label: t.settings.themeLight },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="radiogroup">
      {opts.map(({ k, label }) => {
        const on = value === k;
        const sw = SWATCH[k];
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={t.settings.themeA11y(label)}
            style={{
              flex: 1, padding: space.sm, gap: 6, alignItems: 'center', borderRadius: radius.md, backgroundColor: colors.surface,
              borderWidth: on && !isOdyssey() ? 2 : 1, borderColor: on ? (isOdyssey() ? colors.text : colors.cyan) : colors.line, minHeight: 48,
            }}
          >
            <View style={{ alignSelf: 'stretch', height: 52, borderRadius: radius.sm, backgroundColor: sw.bg, overflow: 'hidden', padding: 6, gap: 5, borderWidth: 1, borderColor: colors.line }}>
              {k === 'system' ? <View style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', backgroundColor: '#0B0B12' }} /> : null}
              <View style={{ height: 6, borderRadius: 3, backgroundColor: sw.bars[0] }} />
              <View style={{ height: 6, width: '60%', borderRadius: 3, backgroundColor: sw.bars[1] }} />
              <View style={{ height: 6, borderRadius: 3, backgroundColor: sw.line }} />
            </View>
            <T v="caption" style={{ color: on ? colors.purple : colors.textMuted, }}>
              {label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const conn = useStore(connectionStore);
  const prefs = useStore(prefsStore);
  const { servers, activeId } = useStore(serversStore);
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
      <SectionTitle>{t.settings.appearance}</SectionTitle>
      <Card style={{ gap: space.sm }}>
        <T v="label">{t.settings.design}</T>
        <DesignPicker
          value={prefs.design}
          onChange={(v) => {
            if (v === prefs.design) return;
            setThemeReturn('/settings');
            upd({ design: v });
          }}
        />
        <T v="caption">{t.settings.designNote}</T>
        <View style={{ height: space.sm }} />
        <ThemePicker
          value={prefs.theme}
          onChange={(v) => {
            if (v === prefs.theme) return;
            setThemeReturn('/settings');
            upd({ theme: v });
          }}
        />
        <T v="caption">{t.settings.themeNote}</T>
      </Card>

      <FloatingIconSetting />

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
                const demo = serversStore.get().servers.find((x) => x.demo);
                if (demo) await removeServer(demo.id);
                if (!serversStore.get().servers.length) {
                  await savePrefs({ onboarded: false });
                  router.replace('/onboarding');
                }
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

      <SectionTitle right={<IconButton icon="plus" label={t.settings.addServer} onPress={() => router.push('/add-server')} />}>{t.settings.servers}</SectionTitle>
      <ListGroup>
        {servers.map((sv) => (
          <ListRow
            key={sv.id}
            left={<Icon name={sv.demo ? 'play-circle' : 'cpu'} size={18} color={sv.id === activeId ? colors.purple : colors.textMuted} />}
            title={serverName(sv)}
            subtitle={sv.id === activeId ? t.settings.activeServer : undefined}
            onPress={
              sv.id === activeId
                ? undefined
                : () => {
                    setThemeReturn('/settings');
                    void activateServer(sv.id, qc);
                  }
            }
            a11y={t.settings.switchTo(serverName(sv))}
            right={
              <IconButton
                icon="trash-2"
                label={`${t.settings.removeServer}: ${serverName(sv)}`}
                color={colors.textMuted}
                size={16}
                onPress={() =>
                  setConfirm({
                    title: t.settings.removeServer,
                    effect: t.settings.removeServerEffect(serverName(sv)),
                    confirmLabel: t.settings.removeServer,
                    dangerous: true,
                    onConfirm: async () => {
                      const wasActive = sv.id === serversStore.get().activeId;
                      await removeServer(sv.id);
                      if (wasActive) {
                        cacheClear();
                        qc.clear();
                      }
                      if (!serversStore.get().servers.length) {
                        await savePrefs({ onboarded: false });
                        router.replace('/onboarding');
                      }
                    },
                  })
                }
              />
            }
          />
        ))}
      </ListGroup>

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
        {(['disk', 'service', 'site', 'temp', 'backup', 'updates'] as const).map((k, i) => (
          <View key={k}>
            {i ? <Divider /> : null}
            <Toggle
              label={{ disk: t.settings.notifyDisk, service: t.settings.notifyService, site: t.settings.notifySite, temp: t.settings.notifyTemp, backup: t.settings.notifyBackup, updates: t.settings.notifyUpdates }[k]}
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
