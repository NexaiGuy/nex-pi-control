// Odyssey-kleuren voor de widgets, exact uit het designsysteem "Nex Pi Control Widgets".
// Statuskleuren zijn tekens (ruit, oog, balk), nooit tekst. Het oog staat altijd op een donkere lens.
import type { ColorProp } from 'react-native-android-widget';

export interface Pal {
  bgTop: ColorProp;
  bgBottom: ColorProp;
  surface: ColorProp;
  /** 1 dp randen en lijnen (10 % alfa). */
  hairline: ColorProp;
  /** Dezelfde haarlijn, vlak op de achtergrond gezet: voor SVG-sporen. */
  line: string;
  ink: ColorProp;
  muted: ColorProp;
  purple: ColorProp;
  mint: ColorProp;
  warn: ColorProp;
  crit: ColorProp;
  onCrit: ColorProp;
  lens: string;
  eyeOk: string;
  eyeWarn: string;
  eyeCrit: string;
  eyeIdle: string;
  eyeOff: string;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
}

const EYE = { lens: '#050508', eyeOk: '#34F5C5', eyeWarn: '#FFB020', eyeCrit: '#FF2A1F', eyeIdle: '#8B5CF6', eyeOff: '#8A8A94' };
const SPECTRAL = { s1: '#8B5CF6', s2: '#F472B6', s3: '#22D3EE', s4: '#34F5C5' };

export const DARK: Pal = {
  bgTop: '#050508',
  bgBottom: '#0B0B12',
  surface: '#0E0E16',
  hairline: 'rgba(242, 242, 240, 0.1)',
  line: '#232329',
  ink: '#F2F2F0',
  muted: '#8A8A94',
  purple: '#8B5CF6',
  mint: '#34F5C5',
  warn: '#FFB020',
  crit: '#FF2A1F',
  onCrit: '#050508',
  ...EYE,
  ...SPECTRAL,
};

export const LIGHT: Pal = {
  bgTop: '#F4F4F1',
  bgBottom: '#F4F4F1',
  surface: '#FFFFFF',
  hairline: 'rgba(11, 11, 18, 0.1)',
  line: '#DCDCDA',
  ink: '#0B0B12',
  muted: '#5A5A64',
  purple: '#7C3AED',
  mint: '#0E9F7E',
  warn: '#B7791F',
  crit: '#D92D20',
  onCrit: '#FFFFFF',
  ...EYE,
  lens: '#0B0B12',
  ...SPECTRAL,
};
