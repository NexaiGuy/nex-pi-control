// src/theme/odyssey.ts
// Odyssey design tokens (Claude Design, 1 oktober 2026). Bron: design/odyssey/design-system/tokens.json.
// Every key below maps 1:1 to a token name: kebab-case in tokens.json, camelCase here.
// De app leest deze waarden via src/theme/tokens.ts (applyTheme). Pas ze hier aan, niet in de schermen.

export type ThemeName = 'dark' | 'light';

const darkColors = {
  bg000: '#050508', // bg-000
  bg100: '#0B0B12', // bg-100
  surface: '#0E0E16', // surface
  surfaceRaised: '#13131C', // surface-raised
  hairline: 'rgba(242,242,240,0.10)', // hairline
  hairlineStrong: 'rgba(242,242,240,0.22)', // hairline-strong
  ink: '#F2F2F0', // ink
  inkMuted: '#8A8A94', // ink-muted
  inkFaint: '#55555E', // ink-faint
  onInk: '#050508', // on-ink
  purple: '#8B5CF6', // purple
  purpleInk: '#A78BFA', // purple-ink
  mint: '#34F5C5', // mint
  warn: '#FFB020', // warn
  warnGlow: '#FFB020', // warn-glow
  crit: '#FF2A1F', // crit
  critGlow: '#FF2A1F', // crit-glow
  eye: '#FF2A1F', // eye
  eyeHot: '#FFD9D2', // eye-hot
  spectral1: '#8B5CF6', // spectral-1
  spectral2: '#F472B6', // spectral-2
  spectral3: '#22D3EE', // spectral-3
  spectral4: '#34F5C5', // spectral-4
  abRed: 'rgba(255,42,31,0.38)', // ab-red
  abCyan: 'rgba(34,211,238,0.38)', // ab-cyan
  scanline: 'rgba(242,242,240,1)', // scanline
  scrim: 'rgba(5,5,8,0.62)', // scrim
  termBg: '#050508', // term-bg
  termInk: '#D8D8D4', // term-ink
  termMuted: '#8A8A94', // term-muted
  termPrompt: '#34F5C5', // term-prompt
  termErr: '#FF6B5E', // term-err
} as const;

const lightColors = {
  bg000: '#F4F4F1', // bg-000
  bg100: '#ECECE8', // bg-100
  surface: '#FFFFFF', // surface
  surfaceRaised: '#FFFFFF', // surface-raised
  hairline: 'rgba(11,11,18,0.12)', // hairline
  hairlineStrong: 'rgba(11,11,18,0.30)', // hairline-strong
  ink: '#0B0B12', // ink
  inkMuted: '#5E5E68', // ink-muted
  inkFaint: '#A4A4AC', // ink-faint
  onInk: '#F4F4F1', // on-ink
  purple: '#6D3FE0', // purple
  purpleInk: '#6D3FE0', // purple-ink
  mint: '#087A5D', // mint
  warn: '#9A5B00', // warn
  warnGlow: '#E59400', // warn-glow
  crit: '#C8170E', // crit
  critGlow: '#FF2A1F', // crit-glow
  eye: '#FF2A1F', // eye
  eyeHot: '#FFD9D2', // eye-hot
  spectral1: '#7C4DEB', // spectral-1
  spectral2: '#E0559C', // spectral-2
  spectral3: '#0BB3CF', // spectral-3
  spectral4: '#10C99B', // spectral-4
  abRed: 'rgba(255,42,31,0.30)', // ab-red
  abCyan: 'rgba(34,211,238,0.34)', // ab-cyan
  scanline: 'rgba(11,11,18,1)', // scanline
  scrim: 'rgba(11,11,18,0.28)', // scrim
  termBg: '#050508', // term-bg
  termInk: '#D8D8D4', // term-ink
  termMuted: '#8A8A94', // term-muted
  termPrompt: '#34F5C5', // term-prompt
  termErr: '#FF6B5E', // term-err
} as const;

export type ColorTokens = { [K in keyof typeof darkColors]: string };

export const colors: Record<ThemeName, ColorTokens> = {
  dark: darkColors,
  light: lightColors,
};

/** Spectral outline stream, in travel order. */
export const spectral: Record<ThemeName, readonly string[]> = {
  dark: [darkColors.spectral1, darkColors.spectral2, darkColors.spectral3, darkColors.spectral4],
  light: [lightColors.spectral1, lightColors.spectral2, lightColors.spectral3, lightColors.spectral4],
};

/** Font family names as registered by @expo-google-fonts (useFonts). Never bold. */
export const fontFamily = {
  display: 'SpaceGrotesk_300Light',
  mono200: 'JetBrainsMono_200ExtraLight',
  mono300: 'JetBrainsMono_300Light',
} as const;

/** Type scale. letterSpacing is in px (React Native has no em): em value x fontSize. */
export const type = {
  headingLg: { fontFamily: fontFamily.display, fontSize: 15, lineHeight: 20, letterSpacing: 3.0, textTransform: 'uppercase' as const }, // type-heading-lg
  headingSm: { fontFamily: fontFamily.display, fontSize: 13, lineHeight: 18, letterSpacing: 2.6, textTransform: 'uppercase' as const }, // type-heading-sm
  label: { fontFamily: fontFamily.display, fontSize: 10, lineHeight: 14, letterSpacing: 1.8, textTransform: 'uppercase' as const }, // type-label
  labelSm: { fontFamily: fontFamily.display, fontSize: 9.5, lineHeight: 13, letterSpacing: 1.71, textTransform: 'uppercase' as const }, // type-label-sm
  body: { fontFamily: fontFamily.display, fontSize: 12, lineHeight: 17.4, letterSpacing: 0 }, // type-body
  dataHero: { fontFamily: fontFamily.mono200, fontSize: 32, lineHeight: 34, letterSpacing: -0.32, fontVariant: ['tabular-nums'] as ('tabular-nums')[] }, // type-data-hero
  dataLg: { fontFamily: fontFamily.mono200, fontSize: 20, lineHeight: 24, letterSpacing: 0, fontVariant: ['tabular-nums'] as ('tabular-nums')[] }, // type-data-lg
  data: { fontFamily: fontFamily.mono300, fontSize: 12, lineHeight: 16, letterSpacing: 0, fontVariant: ['tabular-nums'] as ('tabular-nums')[] }, // type-data
  dataSm: { fontFamily: fontFamily.mono300, fontSize: 10, lineHeight: 14, letterSpacing: 0.2, fontVariant: ['tabular-nums'] as ('tabular-nums')[] }, // type-data-sm
  terminal: { fontFamily: fontFamily.mono300, fontSize: 11, lineHeight: 17, letterSpacing: 0, fontVariant: ['tabular-nums'] as ('tabular-nums')[] }, // type-terminal
} as const;

/** 8 pt grid. */
export const space = {
  half: 4, // space-half
  s1: 8, // space-1
  s2: 16, // space-2
  s3: 24, // space-3
  s4: 32, // space-4
  s5: 40, // space-5
  s6: 48, // space-6
  s8: 64, // space-8
} as const;

export const layout = {
  gutter: 16, // gutter
  touchMin: 44, // touch-min
  headerHeight: 56, // header-height
  tabbarHeight: 64, // tabbar-height
  rowHeight: 48, // row-height
  eyeSize: 44, // eye-size
  phoneWidth: 390, // phone-width
  phoneHeight: 844, // phone-height
} as const;

export const radius = {
  none: 0, // radius-none
  slab: 6, // radius-slab
  control: 4, // radius-control
  sheet: 14, // radius-sheet
  pill: 999, // radius-pill
} as const;

export const stroke = {
  hairline: 0.5, // stroke-hairline (StyleSheet.hairlineWidth on device)
  line: 1, // stroke-line
  glow: 1, // stroke-glow
  aberration: 0.5, // aberration-offset
} as const;

/** Motion in ms. Reanimated: withTiming(v, { duration: motion.dolly, easing: easing.axis }). */
export const motion = {
  fade: 300, // dur-fade
  dolly: 420, // dur-dolly
  sheet: 450, // dur-sheet
  eyeFlicker: 700, // dur-eye-flicker
  cursor: 2000, // dur-cursor
  glowCrit: 2200, // dur-glow-crit
  scan: 2400, // dur-scan
  glowWarn: 4000, // dur-glow-warn
  eyeBreath: 6000, // dur-eye-breath
  spectral: 10000, // dur-spectral
  aberration: 16000, // dur-aberration
} as const;

/** Bezier control points, pass to Easing.bezier(...easing.axis). No springs anywhere. */
export const easing = {
  axis: [0.45, 0, 0.55, 1] as const, // ease-axis
} as const;

export const opacity = {
  spectral: 0.32, // op-spectral
  spectralLight: 0.40, // op-spectral-light
  scanline: 0.025, // op-scanline
  grain: 0.045, // op-grain
  eyeOffline: 0.22, // op-eye-offline
  stale: 0.5, // op-stale
} as const;

/** Clockwise issue glow. Severity 'ok' and 'offline' render no glow. */
export type Severity = 'ok' | 'warning' | 'critical' | 'offline';
export const glow = {
  segment: 0.2, // glow-segment: head plus tail as a share of the perimeter
  tailLayers: [ // stacked dashes, all ending at the head: length share, opacity
    { length: 0.2, opacity: 0.12 },
    { length: 0.14, opacity: 0.28 },
    { length: 0.08, opacity: 0.55 },
    { length: 0.03, opacity: 1 },
  ],
  warning: { periodMs: motion.glowWarn, color: (t: ThemeName) => colors[t].warnGlow, bloom: 0 },
  critical: { periodMs: motion.glowCrit, color: (t: ThemeName) => colors[t].critGlow, bloom: 8 }, // glow-bloom-crit
} as const;

/** Rect perimeter with rounded corners, for strokeDasharray math. */
export const roundedRectPerimeter = (w: number, h: number, r: number): number =>
  2 * (w + h) - (8 - 2 * Math.PI) * r;
