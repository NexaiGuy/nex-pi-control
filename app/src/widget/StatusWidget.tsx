// Startschermwidget (Android): status, temperatuur, CPU en schijf van de actieve Pi. Toont geen geheimen.
import { FlexWidget, TextWidget, type ColorProp } from 'react-native-android-widget';

import { t } from '@/i18n';

export const WIDGET_NAME = 'PiStatus';

export interface WidgetData {
  server: string;
  status: 'ok' | 'warning' | 'critical' | 'unknown';
  title: string;
  temp: number | null;
  cpu: number | null;
  disk: number | null;
  updatedAt: number | null; // ms
  offline: boolean;
}

interface Pal {
  bg: ColorProp;
  text: ColorProp;
  muted: ColorProp;
  line: ColorProp;
  ok: ColorProp;
  warning: ColorProp;
  critical: ColorProp;
  accent: ColorProp;
}

const LIGHT: Pal = { bg: '#FFFFFF', text: '#14121F', muted: '#5B5873', line: '#E2DFEE', ok: '#047857', warning: '#A15C00', critical: '#C8283A', accent: '#06B6D4' };
const DARK: Pal = { bg: '#14141F', text: '#EDEDF5', muted: '#8A8AA3', line: '#2A2A3D', ok: '#34F5C5', warning: '#F5B942', critical: '#F2545B', accent: '#22D3EE' };

const HEAD = 'SpaceGrotesk_700Bold';
const MONO = 'JetBrainsMono_500Medium';

function fmt(v: number | null, unit: string): string {
  return v === null || Number.isNaN(v) ? '–' : `${Math.round(v)}${unit}`;
}

function time(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Stat({ label, value, p, level }: { label: string; value: string; p: Pal; level?: 'warning' | 'critical' }) {
  return (
    <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
      <TextWidget text={label.toUpperCase()} style={{ fontSize: 10, color: p.muted, letterSpacing: 0.06 }} />
      <TextWidget text={value} style={{ fontSize: 18, color: level ? p[level] : p.text, fontFamily: MONO }} />
    </FlexWidget>
  );
}

function Body({ d, p }: { d: WidgetData; p: Pal }) {
  const color = d.offline || d.status === 'unknown' ? p.muted : p[d.status];
  const tempLevel = d.temp !== null && d.temp >= 80 ? 'critical' : d.temp !== null && d.temp >= 70 ? 'warning' : undefined;
  const diskLevel = d.disk !== null && d.disk >= 90 ? 'critical' : d.disk !== null && d.disk >= 85 ? 'warning' : undefined;
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: p.bg, borderRadius: 22, padding: 14, flexDirection: 'column', justifyContent: 'space-between' }}
    >
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
          <FlexWidget style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />
          <TextWidget text={d.server} style={{ fontSize: 13, color: p.text, fontFamily: MONO }} maxLines={1} truncate="END" />
        </FlexWidget>
        <TextWidget text={d.offline ? t.live.offline : time(d.updatedAt)} style={{ fontSize: 11, color: p.muted }} />
      </FlexWidget>
      <TextWidget text={d.title} style={{ fontSize: 17, color, fontFamily: HEAD }} maxLines={1} truncate="END" />
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', borderTopWidth: 1, borderTopColor: p.line, paddingTop: 6 }}>
        <Stat label={t.overview.temp} value={fmt(d.temp, '°')} p={p} level={tempLevel} />
        <Stat label={t.overview.cpu} value={fmt(d.cpu, '%')} p={p} />
        <Stat label={t.disk.title} value={fmt(d.disk, '%')} p={p} level={diskLevel} />
      </FlexWidget>
    </FlexWidget>
  );
}

/** Licht en donker: Android kiest volgens het systeemthema. */
export function StatusWidget({ data }: { data: WidgetData }) {
  return { light: <Body d={data} p={LIGHT} />, dark: <Body d={data} p={DARK} /> };
}
