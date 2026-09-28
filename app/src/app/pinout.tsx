import { useGpio } from '@/api/hooks';
import type { GpioPin } from '@/api/types';
import { DetailScreen } from '@/components/layout';
import { Card, SectionTitle, T } from '@/components/primitives';
import { t } from '@/i18n';
import { space } from '@/theme/tokens';

import { PinHeader } from '@/components/PinHeader';

// Statische referentie (werkt ook offline): identiek aan wat de agent teruggeeft.
const STATIC: GpioPin[] = [
  [1, '3V3', 'power'], [2, '5V', 'power'], [3, 'GPIO2', 'i2c', 2, 'SDA1'], [4, '5V', 'power'], [5, 'GPIO3', 'i2c', 3, 'SCL1'], [6, 'GND', 'ground'],
  [7, 'GPIO4', 'gpio', 4, 'GPCLK0'], [8, 'GPIO14', 'uart', 14, 'TXD'], [9, 'GND', 'ground'], [10, 'GPIO15', 'uart', 15, 'RXD'],
  [11, 'GPIO17', 'gpio', 17], [12, 'GPIO18', 'gpio', 18, 'PWM0'], [13, 'GPIO27', 'gpio', 27], [14, 'GND', 'ground'],
  [15, 'GPIO22', 'gpio', 22], [16, 'GPIO23', 'gpio', 23], [17, '3V3', 'power'], [18, 'GPIO24', 'gpio', 24],
  [19, 'GPIO10', 'spi', 10, 'MOSI'], [20, 'GND', 'ground'], [21, 'GPIO9', 'spi', 9, 'MISO'], [22, 'GPIO25', 'gpio', 25],
  [23, 'GPIO11', 'spi', 11, 'SCLK'], [24, 'GPIO8', 'spi', 8, 'CE0'], [25, 'GND', 'ground'], [26, 'GPIO7', 'spi', 7, 'CE1'],
  [27, 'GPIO0', 'eeprom', 0, 'ID_SD'], [28, 'GPIO1', 'eeprom', 1, 'ID_SC'], [29, 'GPIO5', 'gpio', 5], [30, 'GND', 'ground'],
  [31, 'GPIO6', 'gpio', 6], [32, 'GPIO12', 'gpio', 12, 'PWM0'], [33, 'GPIO13', 'gpio', 13, 'PWM1'], [34, 'GND', 'ground'],
  [35, 'GPIO19', 'gpio', 19, 'PCM_FS'], [36, 'GPIO16', 'gpio', 16], [37, 'GPIO26', 'gpio', 26], [38, 'GPIO20', 'gpio', 20, 'PCM_DIN'],
  [39, 'GND', 'ground'], [40, 'GPIO21', 'gpio', 21, 'PCM_DOUT'],
].map(([pin, name, kind, bcm, alt]) => ({ pin: pin as number, name: name as string, kind: kind as GpioPin['kind'], bcm: bcm as number | undefined, alt: alt as string | undefined }));

export default function PinoutScreen() {
  const q = useGpio();
  const pins = q.data?.pins.length ? q.data.pins.map((p) => ({ ...p, value: null })) : STATIC;
  return (
    <DetailScreen title={t.pinout.title}>
      <T v="bodyMuted">{t.pinout.intro}</T>
      <SectionTitle>{t.pinout.header}</SectionTitle>
      <Card style={{ padding: space.sm }}>
        <PinHeader pins={pins} />
      </Card>
      <SectionTitle>{t.pinout.tips}</SectionTitle>
      <Card style={{ gap: space.sm }}>
        <T>{t.pinout.tip1}</T>
        <T>{t.pinout.tip2}</T>
        <T>{t.pinout.tip3}</T>
        <T>{t.pinout.tip4}</T>
      </Card>
    </DetailScreen>
  );
}
