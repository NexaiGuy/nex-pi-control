import * as Haptics from 'expo-haptics';
import { useFocusEffect } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { createRef, useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, errorMessage } from '@/api/client';
import { useShellStart, useShellState, useShellStop } from '@/api/hooks';
import type { ShellStatus } from '@/api/types';
import { AppHeader, DiskBanner } from '@/components/layout';
import { Sheet, toast } from '@/components/overlays';
import { Button, Card, Icon, IconButton, Row, T } from '@/components/primitives';
import { authenticate } from '@/features/lock/LockGate';
import { TerminalSession, type TermStatus, type TerminalHandle } from '@/features/terminal/TerminalSession';
import { t } from '@/i18n';
import { mmss } from '@/lib/format';
import { useKeyboardVisible } from '@/lib/useKeyboard';
import { connectionStore, prefsStore, savePrefs } from '@/state/settings';
import { useStore } from '@/state/store';
import { colors, fonts, radius, space, themed } from '@/theme/tokens';

interface Tab {
  id: number;
  ref: RefObject<TerminalHandle | null>;
  status: TermStatus;
}

const KEYS: { label: string; seq?: string; mod?: 'ctrl' | 'alt' }[] = [
  { label: 'Esc', seq: '\x1b' },
  { label: 'Tab', seq: '\t' },
  { label: 'Ctrl', mod: 'ctrl' },
  { label: 'Alt', mod: 'alt' },
  { label: '←', seq: '\x1b[D' },
  { label: '↑', seq: '\x1b[A' },
  { label: '↓', seq: '\x1b[B' },
  { label: '→', seq: '\x1b[C' },
  { label: '|', seq: '|' },
  { label: '~', seq: '~' },
  { label: '/', seq: '/' },
  { label: '-', seq: '-' },
  { label: 'Home', seq: '\x1b[H' },
  { label: 'End', seq: '\x1b[F' },
  { label: 'PgUp', seq: '\x1b[5~' },
  { label: 'PgDn', seq: '\x1b[6~' },
];

let nextId = 1;

async function waitForShell(timeoutMs = 20000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      await api.shellGet<ShellStatus>('/v1/status');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

export default function TerminalScreen() {
  const insets = useSafeAreaInsets();
  const conn = useStore(connectionStore);
  const snippets = useStore(prefsStore, (p) => p.snippets);
  const state = useShellState(10000);
  const start = useShellStart();
  const stop = useShellStop();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState(0);
  const [mods, setMods] = useState({ ctrl: false, alt: false });
  const [font, setFont] = useState(13);
  const [starting, setStarting] = useState(false);
  const [snipOpen, setSnipOpen] = useState(false);
  const [idleLeft, setIdleLeft] = useState(900);
  const lastActivity = useRef(0);
  const markActivity = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);
  const kb = useKeyboardVisible();

  // Geen screenshots of app-switcher-preview van de terminal.
  useFocusEffect(
    useCallback(() => {
      void ScreenCapture.preventScreenCaptureAsync('terminal');
      return () => void ScreenCapture.allowScreenCaptureAsync('terminal');
    }, []),
  );

  useEffect(() => {
    const id = setInterval(() => {
      const open = tabs.some((x) => x.status === 'open');
      setIdleLeft(open ? 900 : Math.max(0, 900 - (Date.now() - lastActivity.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [tabs]);

  const shellActive = !!state.data?.active;
  const configured = !!conn.shellUrl && !!conn.shellToken;

  const setStatus = useCallback((id: number, status: TermStatus, reason?: string) => {
    setTabs((ts) => ts.map((x) => (x.id === id ? { ...x, status } : x)));
    if (status === 'closed' && reason) markActivity();
  }, [markActivity]);

  const openTab = async () => {
    if (tabs.length >= 4) return;
    if (!(await authenticate(t.terminal.biometricReason))) return;
    const id = nextId++;
    setTabs((ts) => [...ts, { id, ref: createRef<TerminalHandle>(), status: 'connecting' }]);
    setActive(tabs.length);
  };

  const startShell = async () => {
    if (!(await authenticate(t.terminal.biometricReason))) return;
    setStarting(true);
    try {
      if (!shellActive) {
        const r = await start.mutateAsync(undefined);
        if (!r.ok) throw new Error(r.message);
      }
      if (!(await waitForShell())) throw new Error(t.errors.shellNoAnswer);
      await state.refetch();
      const id = nextId++;
      setTabs([{ id, ref: createRef<TerminalHandle>(), status: 'connecting' }]);
      setActive(0);
      markActivity();
    } catch (e) {
      toast.error(e instanceof Error && !(e as { kind?: string }).kind ? e.message : errorMessage(e));
    } finally {
      setStarting(false);
    }
  };

  const stopShell = () => {
    tabs.forEach((x) => x.ref.current?.close());
    setTabs([]);
    stop.mutate(undefined, { onSuccess: () => toast.info(t.terminal.stop), onError: (e) => toast.error(errorMessage(e)) });
  };

  const closeTab = (idx: number) => {
    tabs[idx]?.ref.current?.close();
    setTabs((ts) => ts.filter((_, i) => i !== idx));
    setActive((a) => Math.max(0, Math.min(a, tabs.length - 2)));
    markActivity();
  };

  const cur = tabs[active];
  const press = (k: (typeof KEYS)[number]) => {
    void Haptics.selectionAsync();
    if (k.mod) {
      const next = { ...mods, [k.mod]: !mods[k.mod] };
      setMods(next);
      cur?.ref.current?.setMods(next);
    } else if (k.seq) {
      cur?.ref.current?.send(k.seq);
    }
  };

  const changeFont = (d: number) => {
    const s = Math.max(9, Math.min(22, font + d));
    setFont(s);
    tabs.forEach((x) => x.ref.current?.fontSize(s));
  };

  // --- Vergrendelde staat -------------------------------------------------------------
  if (!tabs.length) {
    return (
      <View style={[st.root, { paddingTop: insets.top, paddingHorizontal: space.lg }]}>
        <AppHeader title={t.tabs.terminal} />
        <DiskBanner />
        <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
          <View style={st.lockIcon}>
            <Icon name={shellActive ? 'terminal' : 'shield'} size={28} color={colors.purple} />
          </View>
          <T v="h2">{shellActive ? t.terminal.adminActive : t.terminal.locked}</T>
          <T v="bodyMuted" style={{ textAlign: 'center' }}>
            {t.terminal.lockedBody}
          </T>
          {!configured ? (
            <T v="caption" style={{ color: colors.amber, textAlign: 'center' }}>
              {t.terminal.notConfigured}
            </T>
          ) : null}
          <Button label={shellActive ? t.terminal.newTab : t.terminal.start} icon="play" onPress={startShell} loading={starting} disabled={!configured} full />
          {shellActive ? <Button label={t.terminal.stop} kind="secondary" icon="square" onPress={stopShell} full /> : null}
        </Card>
      </View>
    );
  }

  // --- Actieve terminal -----------------------------------------------------------------
  return (
    <KeyboardAvoidingView style={[st.root, { paddingTop: insets.top }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={st.top}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingRight: space.sm }}>
          {tabs.map((x, i) => (
            <Pressable key={x.id} onPress={() => setActive(i)} onLongPress={() => closeTab(i)} style={[st.tab, i === active && st.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: i === active }} accessibilityLabel={t.terminal.tabHint(i + 1)}>
              <View style={[st.tabDot, { backgroundColor: x.status === 'open' ? colors.mint : x.status === 'connecting' ? colors.amber : colors.red }]} />
              <Text style={st.tabText}>{`sh ${i + 1}`}</Text>
            </Pressable>
          ))}
          {tabs.length < 4 ? <IconButton icon="plus" label={t.terminal.newTab} onPress={() => void openTab()} color={colors.textMuted} size={18} /> : null}
        </ScrollView>
        <View style={st.chip} accessibilityLabel={t.terminal.stopsIn(mmss(idleLeft))}>
          <View style={[st.tabDot, { backgroundColor: colors.mint }]} />
          <Text style={st.chipText}>{tabs.some((x) => x.status === 'open') ? t.terminal.sessionActive : t.terminal.stopsIn(mmss(idleLeft))}</Text>
        </View>
        <Pressable onPress={stopShell} style={st.stop} accessibilityRole="button" accessibilityLabel={t.terminal.stop}>
          <Icon name="square" size={12} color="#fff" />
          <Text style={st.stopText}>{t.terminal.stop}</Text>
        </Pressable>
      </View>
      <View style={{ flex: 1 }}>
        {tabs.map((x, i) => (
          <TerminalSession
            key={x.id}
            ref={x.ref}
            visible={i === active}
            onStatus={(s, r) => setStatus(x.id, s, r)}
            onMods={setMods}
            onActivity={markActivity}
          />
        ))}
        {cur && (cur.status === 'closed' || cur.status === 'error') ? (
          <View style={st.reconnect}>
            <Button label={t.terminal.reconnect} icon="rotate-cw" kind="secondary" onPress={() => cur.ref.current?.reconnect()} />
          </View>
        ) : null}
      </View>
      <View style={[st.keys, { paddingBottom: kb ? 6 : Math.max(insets.bottom, 6) + 58 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6, paddingHorizontal: space.sm }}>
          <Pressable onPress={() => setSnipOpen(true)} style={[st.key, { backgroundColor: colors.purpleSoft }]} accessibilityLabel={t.terminal.snippets}>
            <Icon name="zap" size={14} color={colors.purple} />
          </Pressable>
          {KEYS.map((k) => {
            const on = k.mod ? mods[k.mod] : false;
            return (
              <Pressable key={k.label} onPress={() => press(k)} style={[st.key, on && st.keyOn]} accessibilityRole="button" accessibilityLabel={k.label} accessibilityState={{ selected: on }}>
                <Text style={[st.keyText, on && { color: colors.bg }]}>{k.label}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => changeFont(-1)} style={st.key} accessibilityLabel={t.terminal.smaller}>
            <Text style={st.keyText}>A-</Text>
          </Pressable>
          <Pressable onPress={() => changeFont(1)} style={st.key} accessibilityLabel={t.terminal.larger}>
            <Text style={st.keyText}>A+</Text>
          </Pressable>
        </ScrollView>
      </View>
      <Sheet visible={snipOpen} onClose={() => setSnipOpen(false)} title={t.terminal.snippets}>
        <View style={{ gap: space.sm }}>
          {snippets.map((sn, i) => (
            <Pressable
              key={i}
              onPress={() => {
                cur?.ref.current?.send(sn);
                setSnipOpen(false);
                cur?.ref.current?.focus();
              }}
              onLongPress={() => void savePrefs((p) => ({ ...p, snippets: p.snippets.filter((_, j) => j !== i) }))}
              style={st.snip}
              accessibilityRole="button"
              accessibilityLabel={`${sn}. ${t.terminal.removeHint}`}
            >
              <Icon name="corner-down-right" size={14} color={colors.purple} />
              <Text style={st.snipText} numberOfLines={2}>
                {sn}
              </Text>
            </Pressable>
          ))}
          <Row style={{ marginTop: space.sm }}>
            <T v="caption">{t.terminal.snippetsHint}</T>
          </Row>
        </View>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const st = themed(() => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  lockIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: 1, borderBottomColor: colors.line },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 36, borderRadius: radius.sm, backgroundColor: colors.surface },
  tabActive: { backgroundColor: colors.surface3, borderWidth: 1, borderColor: colors.purple },
  tabDot: { width: 7, height: 7, borderRadius: 4 },
  tabText: { color: colors.text, fontFamily: fonts.mono, fontSize: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.mintSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { color: colors.mint, fontFamily: fonts.mono, fontSize: 11 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.red, borderRadius: radius.sm, paddingHorizontal: 12, minHeight: 36 },
  stopText: { color: '#fff', fontFamily: fonts.headingMedium, fontSize: 13 },
  keys: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface, paddingTop: 6 },
  key: { minWidth: 44, height: 40, borderRadius: 8, backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  keyOn: { backgroundColor: colors.mint },
  keyText: { color: colors.text, fontFamily: fonts.monoMedium, fontSize: 13 },
  reconnect: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.lg },
  snip: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.surface2, borderRadius: radius.md, padding: space.md, minHeight: 48 },
  snipText: { color: colors.text, fontFamily: fonts.mono, fontSize: 13, flex: 1 },
}));
