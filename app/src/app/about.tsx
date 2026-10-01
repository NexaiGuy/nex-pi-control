// Over de app: open source, privacy en Nex AI. Ook bereikbaar vóór de onboarding (geen API-aanroepen hier).
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ListGroup, ListRow } from '@/components/ListRow';
import { Button, Card, Icon, IconButton, Row, SectionTitle, T, type IconName } from '@/components/primitives';
import { t } from '@/i18n';
import { LINKS, mailto } from '@/lib/links';
import { colors, fonts, radius, space, themed } from '@/theme/tokens';

function open(url: string) {
  void Linking.openURL(url).catch(() => undefined);
}

function LinkRow({ icon, title, subtitle, url }: { icon: IconName; title: string; subtitle?: string; url: string }) {
  return (
    <ListRow
      left={<Icon name={icon} size={18} color={colors.purple} />}
      title={title}
      subtitle={subtitle}
      mono={false}
      right={<Icon name="external-link" size={16} color={colors.textMuted} />}
      onPress={() => open(url)}
      a11y={title}
    />
  );
}

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const version = Constants.expoConfig?.version ?? '1.0.0';
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={[a.root, { paddingTop: insets.top + space.sm, paddingBottom: insets.bottom + space.xxl }]}>
      <Row>
        <IconButton icon="arrow-left" label={t.common.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <T v="h2" accessibilityRole="header" style={{ flex: 1 }}>
          {t.about.title}
        </T>
      </Row>

      <View style={a.hero}>
        <View style={a.logo}>
          <Icon name="cpu" size={34} color={colors.mint} />
        </View>
        <T v="display" style={{ textAlign: 'center' }}>
          {t.app.name}
        </T>
        <T v="bodyMuted" style={{ textAlign: 'center' }}>
          {t.about.tagline}
        </T>
        <T v="monoSmall" style={{ color: colors.textFaint }}>
          {t.about.version(version)}
        </T>
      </View>

      <Card style={a.nex}>
        <T v="label" style={{ color: colors.mint }}>
          {t.about.madeBy.toUpperCase()}
        </T>
        <T v="body">{t.about.nexPitch}</T>
        <View style={{ gap: space.xs }}>
          {t.about.services.map((x) => (
            <Row key={x}>
              <Icon name="check" size={14} color={colors.mint} />
              <T style={{ flex: 1, fontSize: 14 }}>{x}</T>
            </Row>
          ))}
        </View>
        <T v="h3" style={{ marginTop: space.xs }}>
          {t.about.nexCta}
        </T>
        <Row>
          <Button label={t.about.ctaButton} icon="calendar" onPress={() => open(mailto(t.about.ctaSubject))} style={{ flex: 1 }} />
          <Button label="nex-ai.be" kind="secondary" icon="globe" onPress={() => open(LINKS.website)} style={{ flex: 1 }} />
        </Row>
      </Card>

      <SectionTitle>{t.app.name}</SectionTitle>
      <ListGroup>
        <LinkRow icon="github" title={t.about.source} subtitle="github.com/NexaiGuy/nex-pi-control" url={LINKS.github} />
        <LinkRow icon="book-open" title={t.onboarding.howTo} url={LINKS.install} />
        <LinkRow icon="shield" title={t.about.privacy} url={LINKS.privacy} />
        <LinkRow icon="star" title={t.about.rate} url={LINKS.playStore} />
        <LinkRow icon="mail" title={t.about.contact} url={mailto(t.app.name)} />
      </ListGroup>

      <T v="caption" style={{ textAlign: 'center', marginTop: space.lg }}>
        {t.about.license}
      </T>
      <T v="monoSmall" style={{ textAlign: 'center', color: colors.textFaint, fontFamily: fonts.mono }}>
        © Nex AI · Gent, Belgium
      </T>
    </ScrollView>
  );
}

const a = themed(() => StyleSheet.create({
  root: { paddingHorizontal: space.lg, gap: space.lg },
  hero: { alignItems: 'center', gap: space.sm, marginVertical: space.lg },
  logo: {
    width: 84, height: 84, borderRadius: 26, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.purple,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.sm,
  },
  nex: { gap: space.md, borderColor: colors.purple, borderWidth: 1, borderRadius: radius.lg },
}));
