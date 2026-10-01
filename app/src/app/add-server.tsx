// Nog een Pi toevoegen: dezelfde QR-code of gegevens als bij de eerste server.
import { useQueryClient } from '@tanstack/react-query';
import * as ScreenCapture from 'expo-screen-capture';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { cacheClear } from '@/api/cache';
import { linkStore } from '@/api/hooks';
import { DetailScreen } from '@/components/layout';
import { toast } from '@/components/overlays';
import { Button, Card, T } from '@/components/primitives';
import { ConnectionForm } from '@/features/onboarding/ConnectionForm';
import { QrScanner } from '@/features/onboarding/QrScanner';
import { t } from '@/i18n';
import { DEFAULT_CONNECTION, MAX_SERVERS, addServer, isConfigured, serverName, serversStore, type Connection } from '@/state/settings';
import { space } from '@/theme/tokens';

export default function AddServerScreen() {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [draft, setDraft] = useState<Connection>(DEFAULT_CONNECTION);
  const [busy, setBusy] = useState(false);
  const full = serversStore.get().servers.length >= MAX_SERVERS;

  useEffect(() => {
    void ScreenCapture.preventScreenCaptureAsync('add-server');
    return () => void ScreenCapture.allowScreenCaptureAsync('add-server');
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      await addServer(draft);
      cacheClear();
      qc.clear();
      linkStore.set({ lastOkAt: null, error: null });
      toast.success(t.servers.added(serverName(draft)));
      router.replace('/');
    } catch {
      toast.error(t.settings.maxServers(MAX_SERVERS));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DetailScreen title={t.servers.addTitle}>
      <Card style={{ gap: space.md }}>
        <T v="bodyMuted">{t.servers.addBody}</T>
        {full ? <T>{t.settings.maxServers(MAX_SERVERS)}</T> : null}
        {!full && mode === 'scan' ? (
          <>
            <QrScanner
              onResult={(c) => {
                setDraft(c);
                setMode('manual');
                toast.success(t.onboarding.qrOk);
              }}
              onInvalid={() => toast.error(t.onboarding.invalidQr)}
            />
            <Button label={t.onboarding.paste} kind="ghost" icon="edit-3" onPress={() => setMode('manual')} />
          </>
        ) : null}
        {!full && mode === 'manual' ? (
          <>
            <ConnectionForm value={draft} onChange={setDraft} />
            <Button label={t.settings.scan} kind="ghost" icon="camera" onPress={() => setMode('scan')} />
          </>
        ) : null}
        <Button label={t.servers.add} icon="plus" disabled={full || !isConfigured(draft) || draft.demo} loading={busy} onPress={() => void save()} />
      </Card>
    </DetailScreen>
  );
}
