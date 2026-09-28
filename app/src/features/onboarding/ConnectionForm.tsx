import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ApiError, request } from '@/api/client';
import type { Info } from '@/api/types';
import { Button, Icon, T } from '@/components/primitives';
import { t } from '@/i18n';
import { isLanHttp, normalizeBase, validateUrl, type Connection } from '@/state/settings';
import { colors, fonts, radius, space, touch } from '@/theme/tokens';

function Field({ label, value, onChange, secret, placeholder }: { label: string; value: string; onChange: (v: string) => void; secret?: boolean; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <T v="label">{label.toUpperCase()}</T>
      <View style={f.inputWrap}>
        <TextInput
          value={value}
          onChangeText={onChange}
          secureTextEntry={secret && !show}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          style={f.input}
          accessibilityLabel={label}
          importantForAutofill="no"
          textContentType="none"
        />
        {secret ? (
          <Pressable onPress={() => setShow((s) => !s)} hitSlop={10} accessibilityLabel={show ? t.common.hide : t.common.show} style={{ padding: 6 }}>
            <Icon name={show ? 'eye-off' : 'eye'} size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export async function testConnection(c: Connection): Promise<string> {
  const info = await request<Info>('/v1/info', { conn: { ...c, apiUrl: normalizeBase(c.apiUrl) }, timeoutMs: 12000 });
  return info.version;
}

export function ConnectionForm({ value, onChange }: { value: Connection; onChange: (c: Connection) => void }) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof Connection) => (v: string) => onChange({ ...value, [k]: k === 'name' ? v.slice(0, 40) : v.trim(), demo: false });
  const urlErr = value.apiUrl ? validateUrl(value.apiUrl) : null;
  return (
    <View style={{ gap: space.md }}>
      <Field label={t.settings.serverName} value={value.name} onChange={set('name')} placeholder="raspberrypi" />
      <Field label={t.settings.apiUrl} value={value.apiUrl} onChange={set('apiUrl')} placeholder="https://pi.example.ts.net" />
      {urlErr ? (
        <T v="caption" style={{ color: colors.red }}>
          {t.errors.insecureUrl}
        </T>
      ) : isLanHttp(value.apiUrl) ? (
        <View style={f.warn}>
          <Icon name="alert-triangle" size={14} color={colors.amber} />
          <T v="caption" style={{ color: colors.amber, flex: 1 }}>
            {t.settings.lanWarning}
          </T>
        </View>
      ) : null}
      <Field label={t.settings.shellUrl} value={value.shellUrl} onChange={set('shellUrl')} placeholder="https://pi.example.ts.net:8443" />
      <Field label={t.settings.cfId} value={value.cfId} onChange={set('cfId')} secret />
      <Field label={t.settings.cfSecret} value={value.cfSecret} onChange={set('cfSecret')} secret />
      <Field label={t.settings.agentToken} value={value.agentToken} onChange={set('agentToken')} secret />
      <Field label={t.settings.shellToken} value={value.shellToken} onChange={set('shellToken')} secret />
      <Button
        label={t.settings.test}
        icon="activity"
        kind="secondary"
        loading={testing}
        disabled={!!urlErr || !value.agentToken}
        onPress={async () => {
          setTesting(true);
          setResult(null);
          try {
            const v = await testConnection(value);
            setResult({ ok: true, text: t.settings.testOk(v) });
          } catch (e) {
            setResult({ ok: false, text: e instanceof ApiError ? e.message : t.errors.generic });
          } finally {
            setTesting(false);
          }
        }}
      />
      {result ? (
        <View style={[f.result, { borderColor: result.ok ? colors.mint : colors.red, backgroundColor: result.ok ? colors.mintSoft : colors.redSoft }]} accessibilityLiveRegion="polite">
          <Icon name={result.ok ? 'check-circle' : 'x-octagon'} size={16} color={result.ok ? colors.mint : colors.red} />
          <T v="body" style={{ flex: 1, fontSize: 14 }}>
            {result.text}
          </T>
        </View>
      ) : null}
    </View>
  );
}

const f = StyleSheet.create({
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', minHeight: touch, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface2, paddingHorizontal: space.md,
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.mono, fontSize: 13, paddingVertical: 10 },
  warn: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  result: { flexDirection: 'row', gap: space.sm, alignItems: 'center', borderWidth: 1, borderRadius: radius.md, padding: space.md },
});
