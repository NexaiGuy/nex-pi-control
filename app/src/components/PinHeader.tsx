import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GpioPin } from '@/api/types';
import { colors, fonts, radius } from '@/theme/tokens';
import { t } from '@/i18n';

export const KIND_COLOR: Record<GpioPin['kind'], string> = {
  power: '#F2545B',
  ground: '#5F5F78',
  gpio: '#8B5CF6',
  i2c: '#60A5FA',
  spi: '#F472B6',
  uart: '#F5B942',
  eeprom: '#8A8AA3',
};

export function PinHeader({ pins, onPress, selected }: { pins: GpioPin[]; onPress?: (p: GpioPin) => void; selected?: number }) {
  const rows: [GpioPin, GpioPin][] = [];
  for (let i = 0; i < pins.length; i += 2) rows.push([pins[i]!, pins[i + 1]!]);
  const cell = (p: GpioPin, side: 'l' | 'r') => {
    const on = p.value === 1;
    const color = KIND_COLOR[p.kind];
    return (
      <Pressable
        key={p.pin}
        onPress={() => onPress?.(p)}
        disabled={!onPress || p.bcm === undefined}
        style={[g.cell, side === 'r' && { flexDirection: 'row-reverse' }, selected === p.pin && { backgroundColor: colors.surface3 }]}
        accessibilityRole="button"
        accessibilityLabel={`Pin ${p.pin}, ${p.name}${p.label ? `, ${p.label}` : ''}${p.bcm !== undefined ? (on ? `, ${t.gpio.on1}` : `, ${t.gpio.off0}`) : ''}`}
      >
        <View style={[g.dot, { borderColor: color, backgroundColor: on ? colors.mint : p.bcm !== undefined && p.allowed ? `${color}33` : 'transparent' }]}>
          <Text style={g.num}>{p.pin}</Text>
        </View>
        <View style={[{ flex: 1 }, side === 'r' && { alignItems: 'flex-end' }]}>
          <Text style={[g.name, { color: p.bcm !== undefined && !p.allowed ? colors.textFaint : colors.text }]} numberOfLines={1}>
            {p.name}
          </Text>
          <Text style={g.sub} numberOfLines={1}>
            {p.label ?? p.alt ?? (p.kind === 'gpio' ? '' : p.kind.toUpperCase())}
          </Text>
        </View>
      </Pressable>
    );
  };
  return (
    <View style={g.header}>
      {rows.map(([a, b]) => (
        <View key={a.pin} style={g.row}>
          {cell(a, 'l')}
          {cell(b, 'r')}
        </View>
      ))}
    </View>
  );
}


const g = StyleSheet.create({
  header: { gap: 2 },
  row: { flexDirection: 'row', gap: 2 },
  cell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5, paddingHorizontal: 6, borderRadius: radius.sm, minHeight: 48 },
  dot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  num: { fontFamily: fonts.monoBold, fontSize: 10, color: colors.text },
  name: { fontFamily: fonts.monoMedium, fontSize: 12 },
  sub: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted },
  legend: { width: 10, height: 10, borderRadius: 5 },
});
