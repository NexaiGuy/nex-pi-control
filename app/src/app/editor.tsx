import { useLocalSearchParams } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ApiError, api, errorMessage } from '@/api/client';
import type { FileContent } from '@/api/types';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, ErrorState, Skeleton, toast, type ConfirmSpec } from '@/components/overlays';
import { IconButton, StatusPill, T } from '@/components/primitives';
import { t } from '@/i18n';
import { colors, fonts, space } from '@/theme/tokens';

// Eenvoudige syntaxkleuring voor de leesweergave: commentaar, strings, sleutels, getallen.
function highlight(line: string, key: number) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('//') || trimmed.startsWith(';')) {
    return <Text key={key} style={{ color: colors.textFaint }}>{line}</Text>;
  }
  const parts: { text: string; color?: string }[] = [];
  const re = /("[^"]*"|'[^']*'|\b\d+(?:\.\d+)?\b|^\s*[\w.-]+(?=\s*[:=]))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) parts.push({ text: line.slice(last, m.index) });
    const tok = m[0];
    parts.push({ text: tok, color: tok.startsWith('"') || tok.startsWith("'") ? colors.mint : /^\s*\d/.test(tok) && !/[:=]/.test(line.slice(m.index + tok.length, m.index + tok.length + 2)) ? colors.amber : colors.purple });
    last = m.index + tok.length;
    if (tok.length === 0) re.lastIndex++;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return (
    <Text key={key}>
      {parts.map((p, i) => (
        <Text key={i} style={p.color ? { color: p.color } : undefined}>
          {p.text}
        </Text>
      ))}
    </Text>
  );
}

export default function EditorScreen() {
  const { path } = useLocalSearchParams<{ path: string }>();
  const file = String(path ?? '');
  const name = file.split('/').pop() ?? file;
  const q = useQuery<FileContent, ApiError>({ queryKey: ['files', 'read', file], queryFn: () => api.shellGet('/v1/files/read', { path: file }) });
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const [mtime, setMtime] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void ScreenCapture.preventScreenCaptureAsync('editor');
    return () => void ScreenCapture.allowScreenCaptureAsync('editor');
  }, []);

  const [loaded, setLoaded] = useState<FileContent | undefined>(undefined);
  if (q.data !== loaded) {
    // Nieuwe versie van de server: neem ze over tijdens de render (React-aanbevolen i.p.v. een effect).
    setLoaded(q.data);
    if (q.data && !q.data.binary) {
      setText(q.data.content ?? '');
      setMtime(q.data.modified);
    }
  }

  const lines = useMemo(() => text.split('\n'), [text]);
  const dirty = q.data && !q.data.binary && text !== (q.data.content ?? '');

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.shellSend<{ modified: number; size: number }>('PUT', '/v1/files/write', { path: file, content: text, expected_mtime: mtime });
      setMtime(r.modified);
      toast.success(`${name} ${t.settings.saved.toLowerCase()}`);
      setEdit(false);
      void q.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError && e.kind === 'conflict' ? t.files.conflict : errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const canEdit = !!q.data?.writable;
  return (
    <DetailScreen
      title={name}
      scroll={false}
      right={
        canEdit ? (
          edit ? (
            <IconButton icon="save" label={t.common.save} color={dirty ? colors.mint : colors.textMuted} onPress={() => dirty && setConfirm({ title: t.common.save, effect: t.files.saveEffect(name), confirmLabel: t.common.save, icon: 'save', onConfirm: () => void save() })} />
          ) : (
            <IconButton icon="edit-3" label={t.files.edit} onPress={() => setEdit(true)} />
          )
        ) : undefined
      }
    >
      <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
        <T v="monoSmall" numberOfLines={1}>
          {file}
        </T>
        {q.data?.truncated ? <StatusPill level="warning" label={t.files.truncated} /> : null}
        {saving ? <StatusPill level="info" label={t.common.busy} /> : null}
      </View>
      {!q.data && q.isLoading ? (
        <View style={{ padding: space.lg, gap: 8 }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} height={12} width={`${40 + ((i * 37) % 55)}%`} />
          ))}
        </View>
      ) : null}
      {q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data?.binary ? <T v="bodyMuted" style={{ padding: space.lg }}>{t.files.binary}</T> : null}
      {q.data && !q.data.binary ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {edit ? (
            <TextInput
              value={text}
              onChangeText={setText}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textAlignVertical="top"
              style={ed.input}
              accessibilityLabel={`Bewerk ${name}`}
            />
          ) : (
            <ScrollView style={ed.view} contentContainerStyle={{ paddingBottom: 60 }}>
              <ScrollView horizontal>
                <View style={{ flexDirection: 'row' }}>
                  <View style={ed.gutter}>
                    {lines.map((_, i) => (
                      <Text key={i} style={ed.ln}>
                        {i + 1}
                      </Text>
                    ))}
                  </View>
                  <Text style={ed.code} selectable>
                    {lines.map((l, i) => (
                      <Text key={i}>
                        {highlight(l, i)}
                        {'\n'}
                      </Text>
                    ))}
                  </Text>
                </View>
              </ScrollView>
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      ) : null}
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}

const ed = StyleSheet.create({
  view: { flex: 1, backgroundColor: '#07070C' },
  gutter: { paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: colors.line, alignItems: 'flex-end' },
  ln: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.textFaint },
  code: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 18, color: colors.text, paddingHorizontal: 10 },
  input: { flex: 1, backgroundColor: '#07070C', color: colors.text, fontFamily: fonts.mono, fontSize: 13, lineHeight: 19, padding: space.md },
});
