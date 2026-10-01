// Wisselen tussen Pi's: een sheet vanuit de servernaam bovenaan elk scherm.
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';

import { cacheClear } from '@/api/cache';
import { linkStore } from '@/api/hooks';
import { ListGroup, ListRow } from '@/components/ListRow';
import { Sheet, toast } from '@/components/overlays';
import { Button, Icon, StatusPill } from '@/components/primitives';
import { t } from '@/i18n';
import { serverName, serversStore, switchServer } from '@/state/settings';
import { useStore } from '@/state/store';
import { colors, space } from '@/theme/tokens';

/** Maakt een andere server actief en wist alles wat nog van de vorige server in het geheugen zit. */
export async function activateServer(id: string, qc: QueryClient): Promise<void> {
  await switchServer(id);
  cacheClear();
  qc.clear();
  linkStore.set({ lastOkAt: null, error: null });
}

function hostOf(apiUrl: string): string {
  try {
    return new URL(apiUrl).host;
  } catch {
    return apiUrl;
  }
}

export function ServerSwitcher({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { servers, activeId } = useStore(serversStore);
  const qc = useQueryClient();
  return (
    <Sheet visible={visible} onClose={onClose} title={t.servers.title}>
      <ListGroup>
        {servers.map((s) => {
          const active = s.id === activeId;
          return (
            <ListRow
              key={s.id}
              left={<Icon name={s.demo ? 'play-circle' : 'cpu'} size={18} color={active ? colors.purple : colors.textMuted} />}
              title={serverName(s)}
              subtitle={s.demo ? t.servers.demo : hostOf(s.apiUrl)}
              right={active ? <StatusPill compact level="ok" label={t.settings.activeServer} /> : <Icon name="chevron-right" size={16} color={colors.textMuted} />}
              a11y={active ? serverName(s) : t.settings.switchTo(serverName(s))}
              onPress={
                active
                  ? undefined
                  : async () => {
                      onClose();
                      await activateServer(s.id, qc);
                      toast.success(t.servers.switched(serverName(s)));
                    }
              }
            />
          );
        })}
      </ListGroup>
      <Button
        label={t.servers.add}
        icon="plus"
        style={{ marginTop: space.md }}
        onPress={() => {
          onClose();
          router.push('/add-server');
        }}
      />
      <Button
        label={t.servers.deviceInfo}
        kind="ghost"
        icon="info"
        onPress={() => {
          onClose();
          router.push('/device');
        }}
      />
    </Sheet>
  );
}
