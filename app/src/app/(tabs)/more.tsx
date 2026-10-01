import { router, type Href } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { useEvents, useInfo, useOverview, useShellState, useUpdates } from '@/api/hooks';
import { supports } from '@/lib/agent';
import { Screen } from '@/components/layout';
import { Card, Icon, SectionTitle, T, type IconName } from '@/components/primitives';
import { t } from '@/i18n';
import { colors, radius, space, themed } from '@/theme/tokens';

interface Tool {
  href: Href;
  icon: IconName;
  label: string;
  hint?: string;
  tint?: string;
}

export default function MoreScreen() {
  const { width } = useWindowDimensions();
  const cols = width >= 720 ? 4 : 3;
  const overview = useOverview();
  const shell = useShellState(false);
  const diskAlarm = (overview.data?.disk_alarms.length ?? 0) > 0;
  const info = useInfo();
  const hasMaint = supports(info.data, 'updates');
  const events = useEvents(hasMaint);
  const updates = useUpdates(false, hasMaint);
  const openEvents = hasMaint ? (events.data?.open ?? 0) : 0;
  const aptCount = hasMaint ? (updates.data?.count ?? 0) : 0;

  const groups: { title: string; tools: Tool[] }[] = [
    {
      title: t.more.manage,
      tools: [
        { href: '/files', icon: 'folder', label: t.more.files, hint: shell.data?.active ? t.more.active : t.more.adminMode },
        { href: '/commands', icon: 'zap', label: t.more.commands },
        { href: '/power', icon: 'power', label: t.more.power, tint: colors.red },
        { href: '/wol', icon: 'wifi', label: t.more.wol },
      ],
    },
    {
      title: t.more.hardware,
      tools: [
        { href: '/disks', icon: 'hard-drive', label: t.more.disks, tint: diskAlarm ? colors.red : undefined, hint: diskAlarm ? t.more.alarm : undefined },
        { href: '/gpio', icon: 'toggle-right', label: t.more.gpio },
        { href: '/sensors', icon: 'thermometer', label: t.more.sensors },
        { href: '/pinout', icon: 'grid', label: t.more.pinout },
        { href: '/device', icon: 'cpu', label: t.more.device },
      ],
    },
    {
      title: t.more.overview,
      tools: [
        { href: '/events', icon: 'bell', label: t.more.events, tint: openEvents ? colors.amber : undefined, hint: openEvents ? t.events.open(openEvents) : undefined },
        { href: '/updates', icon: 'download', label: t.more.updates, tint: updates.data?.security_count && hasMaint ? colors.amber : undefined, hint: aptCount ? t.more.updatesCount(aptCount) : undefined },
        { href: '/backups', icon: 'archive', label: t.more.backups },
        { href: '/ports', icon: 'hash', label: t.more.ports },
        { href: '/audit', icon: 'list', label: t.more.audit },
        { href: '/settings', icon: 'settings', label: t.more.settings },
        { href: '/about', icon: 'info', label: t.more.about, tint: colors.mint },
      ],
    },
  ];

  const w = (width - space.lg * 2 - space.md * (cols - 1)) / cols;
  return (
    <Screen title={t.more.title}>
      {groups.map((g) => (
        <View key={g.title}>
          <SectionTitle>{g.title}</SectionTitle>
          <View style={m.grid}>
            {g.tools.map((tool) => (
              <Card key={tool.label} onPress={() => router.push(tool.href)} style={[m.tool, { width: w }]} accessibilityLabel={tool.label}>
                <View style={[m.icon, tool.tint ? { backgroundColor: `${tool.tint}22` } : null]}>
                  <Icon name={tool.icon} size={20} color={tool.tint ?? colors.purple} />
                </View>
                <T v="h3" numberOfLines={1} style={{ fontSize: 14 }}>
                  {tool.label}
                </T>
                {tool.hint ? (
                  <T v="monoSmall" style={tool.tint ? { color: tool.tint } : undefined}>
                    {tool.hint}
                  </T>
                ) : null}
              </Card>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const m = themed(() => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tool: { aspectRatio: 1, padding: space.md, gap: 6, justifyContent: 'flex-end', borderRadius: radius.lg },
  icon: { position: 'absolute', top: space.md, left: space.md, width: 40, height: 40, borderRadius: 12, backgroundColor: colors.purpleSoft, alignItems: 'center', justifyContent: 'center' },
}));
