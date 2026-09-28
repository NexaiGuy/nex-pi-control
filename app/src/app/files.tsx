import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths, UploadType } from 'expo-file-system';
import { router, useLocalSearchParams } from 'expo-router';
import * as ScreenCapture from 'expo-screen-capture';
import * as Sharing from 'expo-sharing';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ApiError, api, authHeaders, baseUrl, buildUrl, errorMessage } from '@/api/client';
import type { DirListing, FileEntry, FileRoot } from '@/api/types';
import { ListGroup, ListRow } from '@/components/ListRow';
import { DetailScreen } from '@/components/layout';
import { ConfirmSheet, EmptyState, ErrorState, PromptSheet, Sheet, SkeletonList, toast, type ConfirmSpec } from '@/components/overlays';
import { Button, Card, Chip, Divider, Icon, IconButton, Row, StatusPill, T } from '@/components/primitives';
import { useEnsureShell } from '@/features/shell/useEnsureShell';
import { t } from '@/i18n';
import { bytes, dateTime } from '@/lib/format';
import { connectionStore } from '@/state/settings';
import { colors, space } from '@/theme/tokens';

const TEXT_EXT = /\.(txt|md|log|conf|cfg|ini|ya?ml|json|toml|env|sh|py|js|ts|tsx|jsx|html?|css|service|timer|rules|csv|xml|sql|php|go|rs|c|h|cpp|java|kt|gradle|properties|lock)$|^[^.]+$/i;

async function download(entry: FileEntry) {
  const conn = connectionStore.get();
  const url = buildUrl(baseUrl(conn, 'shell'), '/v1/files/download', { path: entry.path });
  const dir = new Directory(Paths.cache, 'hal-downloads');
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, entry.name);
  if (target.exists) target.delete();
  const f = await File.downloadFileAsync(url, target, { headers: authHeaders(conn, 'shell') });
  await Sharing.shareAsync(f.uri, { dialogTitle: entry.name });
}

export default function FilesScreen() {
  const params = useLocalSearchParams<{ path?: string }>();
  const shell = useEnsureShell();
  const qc = useQueryClient();
  const [path, setPath] = useState<string | null>(params.path ?? null);
  const [sel, setSel] = useState<FileEntry | null>(null);
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null);
  const [prompt, setPrompt] = useState<null | { kind: 'mkdir' | 'rename'; entry?: FileEntry }>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    void ScreenCapture.preventScreenCaptureAsync('files');
    return () => void ScreenCapture.allowScreenCaptureAsync('files');
  }, []);

  const roots = useQuery<FileRoot[], ApiError>({ queryKey: ['files', 'roots'], queryFn: () => api.shellGet('/v1/files/roots'), enabled: shell.active });
  const listing = useQuery<DirListing, ApiError>({ queryKey: ['files', 'list', path], queryFn: () => api.shellGet('/v1/files/list', { path: path! }), enabled: shell.active && !!path });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['files'] });

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const upload = async () => {
    if (!path) return;
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    setUploading(true);
    try {
      const conn = connectionStore.get();
      const f = new File(asset.uri);
      const r = await f.upload(buildUrl(baseUrl(conn, 'shell'), '/v1/files/upload', { dir: path }), {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'file',
        mimeType: asset.mimeType ?? 'application/octet-stream',
        headers: authHeaders(conn, 'shell'),
      });
      if (r.status >= 200 && r.status < 300) {
        toast.success(t.files.uploaded(asset.name));
        refresh();
      } else {
        let msg = t.errors.uploadFailed(r.status);
        try {
          msg = (JSON.parse(r.body) as { message?: string }).message ?? msg;
        } catch {
          // geen JSON
        }
        toast.error(msg);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  if (!shell.active) {
    return (
      <DetailScreen title={t.more.files}>
        <Card style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
          <Icon name="folder" size={28} color={colors.purple} />
          <T v="bodyMuted" style={{ textAlign: 'center' }}>
            {t.files.needsShell}
          </T>
          <Button label={t.terminal.start} icon="play" loading={shell.busy} onPress={() => void shell.ensure()} full />
        </Card>
      </DetailScreen>
    );
  }

  const L = listing.data;
  const entries = (L?.entries ?? []).filter((e) => showHidden || !e.hidden);
  const crumbs = L ? L.path.slice(L.root.length).split('/').filter(Boolean) : [];

  return (
    <DetailScreen
      title={t.more.files}
      onRefresh={refresh}
      refreshing={listing.isRefetching}
      right={path ? <IconButton icon={showHidden ? 'eye' : 'eye-off'} label={t.files.hidden} onPress={() => setShowHidden((v) => !v)} /> : undefined}
    >
      {!path ? (
        <>
          {!roots.data && roots.isLoading ? <SkeletonList rows={4} /> : null}
          {roots.error ? <ErrorState error={roots.error} onRetry={() => void roots.refetch()} /> : null}
          <ListGroup>
            {(roots.data ?? []).map((r, i) => (
              <View key={r.path}>
                {i ? <Divider /> : null}
                <ListRow
                  left={<Icon name={r.writable ? 'folder' : 'lock'} size={18} color={r.writable ? colors.purple : colors.textMuted} />}
                  title={r.label}
                  subtitle={r.path}
                  mono={false}
                  right={!r.writable ? <StatusPill compact level="unknown" label={t.files.readOnly} /> : null}
                  onPress={r.exists ? () => setPath(r.path) : undefined}
                />
              </View>
            ))}
          </ListGroup>
        </>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Row gap={4}>
              <Chip label={t.files.folders} onPress={() => setPath(null)} />
              <Chip label={L?.root.split('/').pop() || '/'} onPress={() => L && setPath(L.root)} />
              {crumbs.map((c, i) => (
                <Chip key={i} label={c} active={i === crumbs.length - 1} onPress={() => L && setPath(`${L.root}/${crumbs.slice(0, i + 1).join('/')}`)} />
              ))}
            </Row>
          </ScrollView>
          {L?.writable ? (
            <Row style={{ marginTop: space.md }}>
              <Button label={t.files.newFolder} kind="secondary" icon="folder-plus" onPress={() => setPrompt({ kind: 'mkdir' })} style={{ flex: 1 }} />
              <Button label={t.files.upload} kind="secondary" icon="upload" onPress={() => void upload()} loading={uploading} style={{ flex: 1 }} />
            </Row>
          ) : (
            <View style={{ marginTop: space.md }}>
              <StatusPill level="unknown" label={t.files.readOnly} />
            </View>
          )}
          <View style={{ marginTop: space.md }}>
            {!L && listing.isLoading ? <SkeletonList /> : null}
            {listing.error ? <ErrorState error={listing.error} onRetry={() => void listing.refetch()} /> : null}
            {L && !entries.length ? <EmptyState icon="folder" title={t.files.empty} /> : null}
            {entries.length ? (
              <ListGroup>
                {L?.parent ? (
                  <ListRow left={<Icon name="corner-left-up" size={18} color={colors.textMuted} />} title=".." onPress={() => setPath(L.parent)} />
                ) : null}
                {entries.map((e) => (
                  <View key={e.path}>
                    <Divider />
                    <ListRow
                      left={<Icon name={e.type === 'dir' ? 'folder' : e.type === 'link' ? 'link' : TEXT_EXT.test(e.name) ? 'file-text' : 'file'} size={18} color={e.type === 'dir' ? colors.purple : colors.textMuted} />}
                      title={e.name}
                      subtitle={`${e.type === 'dir' ? t.files.folder : bytes(e.size)} · ${dateTime(e.modified)} · ${e.mode}`}
                      onPress={() => (e.type === 'dir' ? setPath(e.path) : setSel(e))}
                    />
                  </View>
                ))}
              </ListGroup>
            ) : null}
          </View>
        </>
      )}
      <Sheet visible={!!sel} onClose={() => setSel(null)} title={sel?.name}>
        {sel ? (
          <View style={{ gap: space.sm }}>
            <T v="monoSmall" selectable>
              {sel.path}
            </T>
            <T v="caption">
              {bytes(sel.size)} · {dateTime(sel.modified)} · {sel.mode}
            </T>
            <Button label={L?.writable ? t.files.edit : t.common.open} icon="file-text" onPress={() => { const p = sel.path; setSel(null); router.push({ pathname: '/editor', params: { path: p } }); }} />
            <Button label={t.files.download} kind="secondary" icon="download" onPress={() => { const e = sel; setSel(null); void download(e).catch((err) => toast.error(errorMessage(err))); }} />
            {L?.writable ? (
              <>
                <Button label={t.files.rename} kind="secondary" icon="edit-3" onPress={() => { const e = sel; setSel(null); setPrompt({ kind: 'rename', entry: e }); }} />
                <Button
                  label={t.files.delete}
                  kind="danger"
                  icon="trash-2"
                  onPress={() => {
                    const e = sel;
                    setSel(null);
                    setConfirm({ title: t.files.delete, effect: t.files.deleteEffect(e.name), confirmLabel: t.files.delete, dangerous: true, onConfirm: () => void act(() => api.shellSend('DELETE', '/v1/files', undefined, { path: e.path }), `${e.name} verwijderd`) });
                  }}
                />
              </>
            ) : null}
          </View>
        ) : null}
      </Sheet>
      <PromptSheet
        visible={!!prompt}
        title={prompt?.kind === 'rename' ? t.files.rename : t.files.newFolder}
        initial={prompt?.entry?.name ?? ''}
        placeholder={t.files.namePlaceholder}
        confirmLabel={prompt?.kind === 'rename' ? t.files.rename : t.files.newFolder}
        onClose={() => setPrompt(null)}
        onSubmit={(v) => {
          const p = prompt;
          setPrompt(null);
          if (p?.kind === 'mkdir' && path) void act(() => api.shellSend('POST', '/v1/files/mkdir', { path: `${path}/${v}` }), `${v} aangemaakt`);
          if (p?.kind === 'rename' && p.entry) void act(() => api.shellSend('POST', '/v1/files/rename', { path: p.entry!.path, new_name: v }), t.files.renamed(v));
        }}
      />
      <ConfirmSheet spec={confirm} onClose={() => setConfirm(null)} />
    </DetailScreen>
  );
}
