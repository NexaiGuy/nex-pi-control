// Eén terminalsessie: WebView met xterm.js <-> WebSocket naar hal-shell. Headers (CF Access + shell-token) gaan mee bij de upgrade.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { authHeaders, baseUrl } from '@/api/client';
import { t } from '@/i18n';
import { DemoTerminal } from '@/demo';
import { connectionStore } from '@/state/settings';

import { XTERM_HTML } from './xtermHtml';

type RNWebSocketCtor = new (url: string, protocols?: string | string[], options?: { headers: Record<string, string> }) => WebSocket;

/** Het deel van WebSocket dat de sessie gebruikt; de demo-terminal implementeert hetzelfde. */
type Sock = Pick<WebSocket, 'readyState' | 'send' | 'close'>;

function demoSocket(toWeb: (m: object) => void, onOpen: () => void): Sock {
  const term = new DemoTerminal((d) => toWeb({ t: 'o', d }));
  setTimeout(onOpen, 50);
  return {
    readyState: 1,
    send: (raw: string) => {
      try {
        const m = JSON.parse(raw) as { t: string; d?: string };
        if (m.t === 'i' && typeof m.d === 'string') term.input(m.d);
      } catch {
        // negeren
      }
    },
    close: () => undefined,
  } as Sock;
}

export interface TerminalHandle {
  send: (data: string) => void;
  setMods: (m: { ctrl: boolean; alt: boolean }) => void;
  fontSize: (s: number) => void;
  focus: () => void;
  reconnect: () => void;
  close: () => void;
}

export type TermStatus = 'connecting' | 'open' | 'closed' | 'error';

interface Props {
  visible: boolean;
  onStatus: (s: TermStatus, reason?: string) => void;
  onMods: (m: { ctrl: boolean; alt: boolean }) => void;
  onActivity: () => void;
}

export function wsUrl(httpBase: string, cols: number, rows: number): string {
  const u = httpBase.replace(/^http/, 'ws');
  return `${u}/v1/terminal?cols=${cols}&rows=${rows}`;
}

export const TerminalSession = forwardRef<TerminalHandle, Props>(function TerminalSession({ visible, onStatus, onMods, onActivity }, ref) {
  const web = useRef<WebView>(null);
  const ws = useRef<Sock | null>(null);
  const size = useRef({ c: 80, r: 24 });
  const ready = useRef(false);
  const closedByUser = useRef(false);
  const [, force] = useState(0);

  const toWeb = useCallback((m: object) => {
    web.current?.injectJavaScript(`window.__hal&&window.__hal.recv(${JSON.stringify(m)});true;`);
  }, []);

  const connect = useCallback(() => {
    const conn = connectionStore.get();
    ws.current?.close();
    closedByUser.current = false;
    onStatus('connecting');
    if (conn.demo) {
      ws.current = demoSocket(toWeb, () => {
        onStatus('open');
        toWeb({ t: 'focus' });
      });
      force((n) => n + 1);
      return;
    }
    const Ctor = WebSocket as unknown as RNWebSocketCtor;
    const sock = new Ctor(wsUrl(baseUrl(conn, 'shell'), size.current.c, size.current.r), undefined, { headers: authHeaders(conn, 'shell') });
    ws.current = sock;
    sock.onopen = () => {
      onStatus('open');
      toWeb({ t: 'focus' });
    };
    sock.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data)) as { t: string; d?: string };
        if (m.t === 'o') toWeb(m);
        else if (m.t === 'x') {
          toWeb({ t: 'status', d: m.d ?? t.terminal.disconnected });
          closedByUser.current = true;
        }
      } catch {
        // onbekend bericht negeren
      }
    };
    sock.onerror = () => onStatus('error', t.terminal.disconnected);
    sock.onclose = (e) => {
      if (ws.current !== sock) return;
      const code = (e as unknown as { code?: number }).code;
      const reason = code === 4401 ? t.errors.unauthorized : code === 4403 ? t.errors.accessDenied : code === 4409 ? t.errors.maxSessions : code === 4429 ? t.errors.rateLimited(60) : t.terminal.disconnected;
      toWeb({ t: 'status', d: `[${reason}]` });
      onStatus('closed', reason);
    };
    force((n) => n + 1);
  }, [onStatus, toWeb]);

  useImperativeHandle(ref, () => ({
    send: (d) => {
      if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'i', d }));
      onActivity();
    },
    setMods: (m) => toWeb({ t: 'mods', ...m }),
    fontSize: (s) => toWeb({ t: 'font', s }),
    focus: () => toWeb({ t: 'focus' }),
    reconnect: connect,
    close: () => {
      closedByUser.current = true;
      ws.current?.close();
      ws.current = null;
    },
  }));

  useEffect(() => {
    const ping = setInterval(() => {
      if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'p' }));
    }, 25000);
    return () => {
      clearInterval(ping);
      closedByUser.current = true;
      ws.current?.close();
    };
  }, []);

  useEffect(() => {
    if (visible) toWeb({ t: 'fit' });
  }, [visible, toWeb]);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: { t: string; d?: string; c?: number; r?: number; ctrl?: boolean; alt?: boolean };
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (m.t === 'ready') {
      size.current = { c: m.c ?? 80, r: m.r ?? 24 };
      if (!ready.current) {
        ready.current = true;
        connect();
      }
    } else if (m.t === 'i' && typeof m.d === 'string') {
      if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'i', d: m.d }));
      onActivity();
    } else if (m.t === 'r') {
      size.current = { c: m.c ?? 80, r: m.r ?? 24 };
      if (ws.current?.readyState === 1) ws.current.send(JSON.stringify({ t: 'r', c: m.c, r: m.r }));
    } else if (m.t === 'mods') {
      onMods({ ctrl: !!m.ctrl, alt: !!m.alt });
    }
  };

  return (
    <View style={[StyleSheet.absoluteFill, { opacity: visible ? 1 : 0 }]} pointerEvents={visible ? 'auto' : 'none'}>
      <WebView
        ref={web}
        source={{ html: XTERM_HTML, baseUrl: 'about:blank' }}
        originWhitelist={['about:blank']}
        onMessage={onMessage}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        setSupportMultipleWindows={false}
        keyboardDisplayRequiresUserAction={false}
        hideKeyboardAccessoryView
        overScrollMode="never"
        textZoom={100}
        style={{ backgroundColor: '#07070C' }}
        containerStyle={{ backgroundColor: '#07070C' }}
        onShouldStartLoadWithRequest={(req) => req.url === 'about:blank' || req.url.startsWith('data:')}
        accessibilityLabel="Terminal"
      />
    </View>
  );
});
