// Bewust uitgezet en categorie van één dienst, container of site (agent 1.3.0+). Staat onderaan in elk detailscherm.
import { useState } from 'react';
import { Pressable, Switch, View } from 'react-native';

import { errorMessage } from '@/api/client';
import { useInfo, useLabels, useSetLabel } from '@/api/hooks';
import type { LabelKind, Labeled } from '@/api/types';
import { t } from '@/i18n';
import { supports } from '@/lib/agent';
import { parkedSwitch, reasonLabel } from '@/lib/groups';
import { colors, space } from '@/theme/tokens';

import { ListGroup, ListRow } from './ListRow';
import { PromptSheet, Sheet, toast } from './overlays';
import { Button, Card, Divider, Icon, Row, SectionTitle, T } from './primitives';

export function LabelCard({ kind, name, item }: { kind: LabelKind; name: string; item: Labeled | undefined }) {
  const info = useInfo();
  const ok = supports(info.data, 'labels');
  const labels = useLabels(ok);
  const set = useSetLabel();
  const [pick, setPick] = useState(false);
  const [creating, setCreating] = useState(false);

  if (!info.data || !item) return null;
  if (!ok) {
    return (
      <T v="caption" style={{ marginTop: space.lg }}>
        {t.labels.needsAgent}
      </T>
    );
  }

  const editable = labels.data?.editable !== false;
  const on = parkedSwitch(item);
  const save = (v: { parked?: boolean | null; group?: string | null }) =>
    set.mutate({ kind, name, ...v }, { onSuccess: () => toast.success(t.labels.saved), onError: (e) => toast.error(errorMessage(e)) });

  const note = item.parked_setting === false ? t.labels.alwaysWatch : on && !item.parked ? t.labels.switchOnRunning : on ? t.labels.switchOn : t.labels.switchOff;
  const why = item.parked && item.parked_reason && item.parked_reason !== 'app' ? t.labels.because(reasonLabel(item.parked_reason)) : null;
  const groupText = !item.group ? '–' : item.group_source === 'auto' ? t.labels.categoryAuto(item.group) : item.group;
  const groups = labels.data?.groups ?? [];

  return (
    <>
      <SectionTitle>{t.labels.category}</SectionTitle>
      <Card style={{ gap: space.sm }}>
        <Pressable
          onPress={() => editable && setPick(true)}
          disabled={!editable}
          accessibilityRole="button"
          accessibilityLabel={`${t.labels.category}: ${groupText}`}
          style={({ pressed }) => [{ paddingVertical: space.xs }, pressed && { opacity: 0.6 }]}
        >
          <Row style={{ justifyContent: 'space-between' }}>
            <T v="bodyMuted">{t.labels.category}</T>
            <Row gap={space.xs} style={{ flexShrink: 1 }}>
              <T v="mono" numberOfLines={1} style={{ flexShrink: 1 }}>
                {groupText}
              </T>
              {editable ? <Icon name="chevron-right" size={16} color={colors.textFaint} /> : null}
            </Row>
          </Row>
        </Pressable>
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <T v="h3" style={{ flex: 1 }}>
            {t.labels.switchTitle}
          </T>
          <Switch
            value={on}
            disabled={!editable || set.isPending}
            onValueChange={(v) => save({ parked: v })}
            trackColor={{ true: colors.purple, false: colors.surface3 }}
            thumbColor={colors.text}
            accessibilityLabel={t.labels.switchTitle}
          />
        </Row>
        <T v="caption">{note}</T>
        {why ? <T v="caption">{why}</T> : null}
        {item.parked_setting !== null && item.parked_setting !== undefined && editable ? (
          <Button label={t.labels.backToAuto} kind="ghost" icon="rotate-ccw" onPress={() => save({ parked: null })} />
        ) : null}
        {!editable ? <T v="caption">{t.labels.notEditable}</T> : null}
      </Card>

      <Sheet visible={pick} onClose={() => setPick(false)} title={t.labels.chooseCategory}>
        <View style={{ gap: space.md }}>
          <ListGroup>
            <ListRow
              title={t.labels.automatic}
              subtitle={t.labels.automaticHint}
              mono={false}
              lines={2}
              left={<Icon name={item.group_source === 'auto' ? 'check-circle' : 'circle'} size={18} color={item.group_source === 'auto' ? colors.purple : colors.textFaint} />}
              onPress={() => {
                setPick(false);
                save({ group: null });
              }}
            />
            {groups.map((g) => {
              const active = item.group_source !== 'auto' && item.group === g.name;
              return (
                <View key={g.name}>
                  <Divider />
                  <ListRow
                    title={g.name}
                    subtitle={g.source === 'config' ? t.labels.fromConfig : undefined}
                    mono={false}
                    left={<Icon name={active ? 'check-circle' : 'circle'} size={18} color={active ? colors.purple : colors.textFaint} />}
                    onPress={() => {
                      setPick(false);
                      save({ group: g.name });
                    }}
                  />
                </View>
              );
            })}
          </ListGroup>
          <Button
            label={t.labels.newCategory}
            icon="plus"
            kind="secondary"
            onPress={() => {
              setPick(false);
              setCreating(true);
            }}
          />
        </View>
      </Sheet>
      <PromptSheet
        visible={creating}
        title={t.labels.newCategory}
        placeholder={t.labels.newCategoryPlaceholder}
        confirmLabel={t.common.save}
        onSubmit={(v) => {
          setCreating(false);
          save({ group: v.slice(0, 40) });
        }}
        onClose={() => setCreating(false)}
      />
    </>
  );
}
