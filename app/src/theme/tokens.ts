// Designtokens voor Nex Pi Control. Donker thema, Nex AI-huisstijl. Eén bron van waarheid.

export const colors = {
  bg: '#0B0B12',
  surface: '#14141F',
  surface2: '#1C1C2B',
  surface3: '#24243A',
  line: '#2A2A3D',
  lineStrong: '#3A3A55',
  text: '#EDEDF5',
  textMuted: '#8A8AA3',
  textFaint: '#5F5F78',
  purple: '#8B5CF6',
  purpleSoft: 'rgba(139, 92, 246, 0.16)',
  purpleGlow: 'rgba(139, 92, 246, 0.35)',
  mint: '#34F5C5',
  mintSoft: 'rgba(52, 245, 197, 0.14)',
  amber: '#F5B942',
  amberSoft: 'rgba(245, 185, 66, 0.14)',
  red: '#F2545B',
  redSoft: 'rgba(242, 84, 91, 0.16)',
  redBanner: '#3A1418',
  blue: '#60A5FA',
  overlay: 'rgba(5, 5, 10, 0.72)',
  black: '#000000',
} as const;

// Grafiekkleuren: gevalideerd voor contrast op #14141F, onderscheidbaar voor kleurenblinden (met label).
export const series = ['#8B5CF6', '#34F5C5', '#60A5FA', '#F5B942', '#F472B6', '#A3E635', '#FB923C', '#22D3EE'] as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 } as const;
export const touch = 48;

export const fonts = {
  heading: 'SpaceGrotesk_700Bold',
  headingMedium: 'SpaceGrotesk_600SemiBold',
  body: 'SpaceGrotesk_400Regular',
  bodyMedium: 'SpaceGrotesk_500Medium',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

export const type = {
  display: { fontFamily: fonts.heading, fontSize: 32, lineHeight: 38, color: colors.text, letterSpacing: -0.5 },
  h1: { fontFamily: fonts.heading, fontSize: 24, lineHeight: 30, color: colors.text, letterSpacing: -0.3 },
  h2: { fontFamily: fonts.headingMedium, fontSize: 18, lineHeight: 24, color: colors.text },
  h3: { fontFamily: fonts.headingMedium, fontSize: 15, lineHeight: 20, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.text },
  bodyMuted: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textMuted },
  label: { fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16, color: colors.textMuted, letterSpacing: 0.6 },
  caption: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.textMuted },
  metric: { fontFamily: fonts.monoMedium, fontSize: 26, lineHeight: 32, color: colors.text, letterSpacing: -0.5 },
  metricSmall: { fontFamily: fonts.monoMedium, fontSize: 16, lineHeight: 22, color: colors.text },
  mono: { fontFamily: fonts.mono, fontSize: 13, lineHeight: 18, color: colors.text },
  monoSmall: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 15, color: colors.textMuted },
} as const;

export type Level = 'ok' | 'warning' | 'critical' | 'unknown' | 'info';

export const levelColor: Record<Level, string> = {
  ok: colors.mint,
  warning: colors.amber,
  critical: colors.red,
  unknown: colors.textMuted,
  info: colors.purple,
};

export const levelSoft: Record<Level, string> = {
  ok: colors.mintSoft,
  warning: colors.amberSoft,
  critical: colors.redSoft,
  unknown: 'rgba(138,138,163,0.14)',
  info: colors.purpleSoft,
};
