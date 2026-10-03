// Designtokens voor Nex Pi Control. Twee designs, elk met een donker en een licht thema. Eén bron van waarheid.
//
// Designs:
// - "odyssey" (standaard): het Claude Design-ontwerp. Kubrick-perceptie, dunne kleine letters, haarlijnen,
//   spectrale lichtstroom langs de randen, een rood oog en een gloed die klokwijs rond elk probleem loopt.
//   De ruwe waarden staan in ./odyssey.ts.
// - "classic": het vorige ontwerp (Nex AI-huisstijl), blijft kiesbaar in Instellingen > Weergave.
//
// Hoe wisselen werkt: `colors`, `series`, `type`, `fonts`, `radius`, `levelColor` en `levelSoft` zijn gewone objecten
// die bij een wissel ter plaatse worden bijgewerkt (applyTheme). Stylesheets maak je met
// `themed(() => StyleSheet.create(...))`, die worden per thema en design opnieuw opgebouwd. De root-layout hermount de
// schermen na een wissel, zodat alles meteen klopt.

import { colors as ody } from './odyssey';

export type ThemeName = 'dark' | 'light';
export type ThemePref = 'system' | ThemeName;
export type DesignName = 'odyssey' | 'classic';

export const DEFAULT_DESIGN: DesignName = 'odyssey';

const classicDark = {
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
  bannerTitle: '#FFD9DB',
  bannerText: '#F4A6AA',
  blue: '#60A5FA',
  cyan: '#22D3EE',
  magenta: '#F472B6',
  overlay: 'rgba(5, 5, 10, 0.72)',
  black: '#000000',
  tabBar: '#0E0E16',
  codeBg: '#07070C',
  onAccent: '#FFFFFF',
  neonA: '#8B5CF6',
  neonB: '#8B5CF6',
  neonC: '#8B5CF6',
  neonD: '#8B5CF6',
  // Odyssey-sleutels; in het klassieke design enkel als terugval.
  eye: '#F2545B',
  eyeHot: '#FFD9DB',
  warnGlow: '#F5B942',
  critGlow: '#F2545B',
  abRed: 'rgba(242, 84, 91, 0)',
  abCyan: 'rgba(34, 211, 238, 0)',
  scanline: 'rgba(237, 237, 245, 0)',
  onInk: '#0B0B12',
};

export type Palette = { [K in keyof typeof classicDark]: string };

// Licht thema "Nex Light": koel wit met Nex-paars, cyberpunk-accenten (magenta, cyaan) gedoseerd.
// Alle tekst- en statuskleuren halen WCAG AA (4,5:1) op #F6F5FB en #FFFFFF.
const classicLight: Palette = {
  bg: '#F6F5FB',
  surface: '#FFFFFF',
  surface2: '#F0EEF8',
  surface3: '#E7E4F3',
  line: '#E2DFEE',
  lineStrong: '#CFCBE3',
  text: '#14121F',
  textMuted: '#5B5873',
  textFaint: '#7A7792',
  purple: '#6D28D9',
  purpleSoft: 'rgba(109, 40, 217, 0.10)',
  purpleGlow: 'rgba(109, 40, 217, 0.22)',
  mint: '#047857',
  mintSoft: 'rgba(4, 120, 87, 0.10)',
  amber: '#A15C00',
  amberSoft: 'rgba(161, 92, 0, 0.10)',
  red: '#C8283A',
  redSoft: 'rgba(200, 40, 58, 0.10)',
  redBanner: '#FDECEE',
  bannerTitle: '#8E1426',
  bannerText: '#A3283A',
  blue: '#1D4ED8',
  cyan: '#0E7490',
  magenta: '#BE185D',
  overlay: 'rgba(20, 18, 31, 0.45)',
  black: '#000000',
  tabBar: '#FFFFFF',
  codeBg: '#FBFAFE',
  onAccent: '#FFFFFF',
  neonA: '#6D28D9',
  neonB: '#BE185D',
  neonC: '#0E7490',
  neonD: '#0E7490',
  eye: '#C8283A',
  eyeHot: '#FDECEE',
  warnGlow: '#A15C00',
  critGlow: '#C8283A',
  abRed: 'rgba(200, 40, 58, 0)',
  abCyan: 'rgba(14, 116, 144, 0)',
  scanline: 'rgba(20, 18, 31, 0)',
  onInk: '#F6F5FB',
};

// Odyssey "Deep Space": de grond is bijna zwart, kaarten zijn monolieten met een haarlijn.
// Paars als tekst gebruikt purple-ink (#A78BFA), zodat kleine labels leesbaar blijven.
const odysseyDark: Palette = {
  bg: ody.dark.bg000,
  surface: ody.dark.surface,
  surface2: ody.dark.surfaceRaised,
  surface3: '#1B1B26',
  line: ody.dark.hairline,
  lineStrong: ody.dark.hairlineStrong,
  text: ody.dark.ink,
  textMuted: ody.dark.inkMuted,
  textFaint: '#6A6A74',
  purple: ody.dark.purpleInk,
  purpleSoft: 'rgba(139, 92, 246, 0.12)',
  purpleGlow: 'rgba(139, 92, 246, 0.30)',
  mint: ody.dark.mint,
  mintSoft: 'rgba(52, 245, 197, 0.10)',
  amber: ody.dark.warn,
  amberSoft: 'rgba(255, 176, 32, 0.10)',
  red: ody.dark.crit,
  redSoft: 'rgba(255, 42, 31, 0.10)',
  redBanner: '#14070A',
  bannerTitle: ody.dark.eyeHot,
  bannerText: '#FF8F86',
  blue: '#60A5FA',
  cyan: ody.dark.spectral3,
  magenta: ody.dark.spectral2,
  overlay: ody.dark.scrim,
  black: '#000000',
  tabBar: ody.dark.bg000,
  codeBg: ody.dark.termBg,
  onAccent: '#FFFFFF',
  neonA: ody.dark.spectral1,
  neonB: ody.dark.spectral2,
  neonC: ody.dark.spectral3,
  neonD: ody.dark.spectral4,
  eye: ody.dark.eye,
  eyeHot: ody.dark.eyeHot,
  warnGlow: ody.dark.warnGlow,
  critGlow: ody.dark.critGlow,
  abRed: ody.dark.abRed,
  abCyan: ody.dark.abCyan,
  scanline: ody.dark.scanline,
  onInk: ody.dark.onInk,
};

// Odyssey "Station White": steriel wit. Elk accent is verdiept zodat tekst 4,5:1 haalt op #FFFFFF en #F4F4F1.
const odysseyLight: Palette = {
  bg: ody.light.bg000,
  surface: ody.light.surface,
  surface2: '#F9F9F7',
  surface3: ody.light.bg100,
  line: ody.light.hairline,
  lineStrong: ody.light.hairlineStrong,
  text: ody.light.ink,
  textMuted: ody.light.inkMuted,
  textFaint: '#73737D',
  purple: ody.light.purple,
  purpleSoft: 'rgba(109, 63, 224, 0.08)',
  purpleGlow: 'rgba(109, 63, 224, 0.20)',
  mint: ody.light.mint,
  mintSoft: 'rgba(8, 122, 93, 0.08)',
  amber: ody.light.warn,
  amberSoft: 'rgba(154, 91, 0, 0.08)',
  red: ody.light.crit,
  redSoft: 'rgba(200, 23, 14, 0.08)',
  redBanner: '#FDF0EE',
  bannerTitle: '#8A1009',
  bannerText: '#A8150C',
  blue: '#1D4ED8',
  cyan: '#0E7490',
  magenta: '#BE185D',
  overlay: ody.light.scrim,
  black: '#000000',
  tabBar: ody.light.bg000,
  codeBg: ody.light.termBg,
  onAccent: '#FFFFFF',
  neonA: ody.light.spectral1,
  neonB: ody.light.spectral2,
  neonC: ody.light.spectral3,
  neonD: ody.light.spectral4,
  eye: ody.light.eye,
  eyeHot: ody.light.eyeHot,
  warnGlow: ody.light.warnGlow,
  critGlow: ody.light.critGlow,
  abRed: ody.light.abRed,
  abCyan: ody.light.abCyan,
  scanline: ody.light.scanline,
  onInk: ody.light.onInk,
};

const palettes: Record<DesignName, Record<ThemeName, Palette>> = {
  odyssey: { dark: odysseyDark, light: odysseyLight },
  classic: { dark: classicDark, light: classicLight },
};

// Grafiekkleuren per thema: onderscheidbaar voor kleurenblinden (altijd met label), contrastrijk op de kaartkleur.
const seriesBy: Record<DesignName, Record<ThemeName, readonly string[]>> = {
  classic: {
    dark: ['#8B5CF6', '#34F5C5', '#60A5FA', '#F5B942', '#F472B6', '#A3E635', '#FB923C', '#22D3EE'],
    light: ['#6D28D9', '#0E7490', '#BE185D', '#047857', '#A15C00', '#4D7C0F', '#C2410C', '#1D4ED8'],
  },
  odyssey: {
    dark: ['#A78BFA', '#34F5C5', '#22D3EE', '#FFB020', '#F472B6', '#A3E635', '#FB923C', '#60A5FA'],
    light: ['#6D3FE0', '#0E7490', '#BE185D', '#087A5D', '#9A5B00', '#4D7C0F', '#C2410C', '#1D4ED8'],
  },
};

let currentTheme: ThemeName = 'dark';
let currentDesign: DesignName = DEFAULT_DESIGN;
let themeVersion = 0;

/** Actieve kleuren. Wordt ter plaatse bijgewerkt bij een wissel. */
export const colors: Palette = { ...palettes[currentDesign][currentTheme] };
/** Actieve grafiekkleuren. */
export const series: string[] = [...seriesBy[currentDesign][currentTheme]];

export function getTheme(): ThemeName {
  return currentTheme;
}

export function getDesign(): DesignName {
  return currentDesign;
}

/** True als het Odyssey-design actief is. Gebruik dit in componenten voor Odyssey-specifieke opbouw. */
export function isOdyssey(): boolean {
  return currentDesign === 'odyssey';
}

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const touch = 48;

export interface Radius {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
}

const radiusBy: Record<DesignName, Radius> = {
  classic: { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 },
  // radius-control 4, radius-slab 6, radius-sheet 14
  odyssey: { sm: 4, md: 4, lg: 6, xl: 14, pill: 999 },
};

/** Hoekafronding. Wordt ter plaatse bijgewerkt bij een wissel. */
export const radius: Radius = { ...radiusBy[currentDesign] };

export interface FontSet {
  heading: string;
  headingMedium: string;
  body: string;
  bodyMedium: string;
  mono: string;
  monoMedium: string;
  monoBold: string;
  /** Dunste mono, voor grote cijfers. */
  monoThin: string;
}

const fontsBy: Record<DesignName, FontSet> = {
  classic: {
    heading: 'SpaceGrotesk_700Bold',
    headingMedium: 'SpaceGrotesk_600SemiBold',
    body: 'SpaceGrotesk_400Regular',
    bodyMedium: 'SpaceGrotesk_500Medium',
    mono: 'JetBrainsMono_400Regular',
    monoMedium: 'JetBrainsMono_500Medium',
    monoBold: 'JetBrainsMono_700Bold',
    monoThin: 'JetBrainsMono_500Medium',
  },
  // Nooit vet: hiërarchie komt uit grootte, spatiëring en kleur.
  odyssey: {
    heading: 'SpaceGrotesk_300Light',
    headingMedium: 'SpaceGrotesk_300Light',
    body: 'SpaceGrotesk_300Light',
    bodyMedium: 'SpaceGrotesk_300Light',
    mono: 'JetBrainsMono_300Light',
    monoMedium: 'JetBrainsMono_300Light',
    monoBold: 'JetBrainsMono_300Light',
    monoThin: 'JetBrainsMono_200ExtraLight',
  },
};

/** Lettertypes. Wordt ter plaatse bijgewerkt bij een wissel. */
export const fonts: FontSet = { ...fontsBy[currentDesign] };

export interface TextToken {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  color: string;
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase';
  fontVariant?: 'tabular-nums'[];
}

export type TypeVariant =
  | 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'bodyMuted' | 'label' | 'caption' | 'metric' | 'metricSmall' | 'mono' | 'monoSmall';

const TAB: 'tabular-nums'[] = ['tabular-nums'];

function buildType(design: DesignName): Record<TypeVariant, TextToken> {
  const f = fontsBy[design];
  if (design === 'odyssey') {
    // Klein, strak en dun. letterSpacing in px (React Native kent geen em): em x fontSize.
    return {
      display: { fontFamily: f.heading, fontSize: 24, lineHeight: 30, color: colors.text, letterSpacing: 1.2 },
      h1: { fontFamily: f.heading, fontSize: 15, lineHeight: 20, color: colors.text, letterSpacing: 3.0, textTransform: 'uppercase' },
      h2: { fontFamily: f.heading, fontSize: 13, lineHeight: 18, color: colors.text, letterSpacing: 2.6, textTransform: 'uppercase' },
      h3: { fontFamily: f.heading, fontSize: 13, lineHeight: 18, color: colors.text, letterSpacing: 0.3 },
      body: { fontFamily: f.body, fontSize: 12, lineHeight: 17.4, color: colors.text },
      bodyMuted: { fontFamily: f.body, fontSize: 12, lineHeight: 17.4, color: colors.textMuted },
      label: { fontFamily: f.body, fontSize: 10, lineHeight: 14, color: colors.textMuted, letterSpacing: 1.8, textTransform: 'uppercase' },
      caption: { fontFamily: f.body, fontSize: 11, lineHeight: 15, color: colors.textMuted, letterSpacing: 0.2 },
      metric: { fontFamily: f.monoThin, fontSize: 24, lineHeight: 28, color: colors.text, letterSpacing: -0.2, fontVariant: TAB },
      metricSmall: { fontFamily: f.monoThin, fontSize: 18, lineHeight: 22, color: colors.text, fontVariant: TAB },
      mono: { fontFamily: f.mono, fontSize: 12, lineHeight: 16, color: colors.text, fontVariant: TAB },
      monoSmall: { fontFamily: f.mono, fontSize: 10, lineHeight: 14, color: colors.textMuted, letterSpacing: 0.2, fontVariant: TAB },
    };
  }
  return {
    display: { fontFamily: f.heading, fontSize: 32, lineHeight: 38, color: colors.text, letterSpacing: -0.5 },
    h1: { fontFamily: f.heading, fontSize: 24, lineHeight: 30, color: colors.text, letterSpacing: -0.3 },
    h2: { fontFamily: f.headingMedium, fontSize: 18, lineHeight: 24, color: colors.text },
    h3: { fontFamily: f.headingMedium, fontSize: 15, lineHeight: 20, color: colors.text },
    body: { fontFamily: f.body, fontSize: 15, lineHeight: 21, color: colors.text },
    bodyMuted: { fontFamily: f.body, fontSize: 14, lineHeight: 20, color: colors.textMuted },
    label: { fontFamily: f.bodyMedium, fontSize: 12, lineHeight: 16, color: colors.textMuted, letterSpacing: 0.6 },
    caption: { fontFamily: f.body, fontSize: 12, lineHeight: 16, color: colors.textMuted },
    metric: { fontFamily: f.monoMedium, fontSize: 26, lineHeight: 32, color: colors.text, letterSpacing: -0.5 },
    metricSmall: { fontFamily: f.monoMedium, fontSize: 16, lineHeight: 22, color: colors.text },
    mono: { fontFamily: f.mono, fontSize: 13, lineHeight: 18, color: colors.text },
    monoSmall: { fontFamily: f.mono, fontSize: 11, lineHeight: 15, color: colors.textMuted },
  };
}

/** Tekststijlen. Wordt ter plaatse bijgewerkt bij een wissel. */
export const type: Record<TypeVariant, TextToken> = buildType(currentDesign);

export type Level = 'ok' | 'warning' | 'critical' | 'unknown' | 'info';

function buildLevels(c: Palette): { color: Record<Level, string>; soft: Record<Level, string> } {
  return {
    color: { ok: c.mint, warning: c.amber, critical: c.red, unknown: c.textMuted, info: c.purple },
    soft: { ok: c.mintSoft, warning: c.amberSoft, critical: c.redSoft, unknown: 'rgba(138,138,163,0.14)', info: c.purpleSoft },
  };
}

const initialLevels = buildLevels(colors);
export const levelColor: Record<Level, string> = { ...initialLevels.color };
export const levelSoft: Record<Level, string> = { ...initialLevels.soft };

/**
 * Wisselt het actieve thema en (optioneel) het design. Idempotent: doet niets als beide al actief zijn.
 * Zonder `design` blijft het huidige design staan.
 */
export function applyTheme(name: ThemeName, design: DesignName = currentDesign): boolean {
  if (name === currentTheme && design === currentDesign) return false;
  currentTheme = name;
  currentDesign = design;
  themeVersion += 1;
  Object.assign(colors, palettes[design][name]);
  series.splice(0, series.length, ...seriesBy[design][name]);
  Object.assign(fonts, fontsBy[design]);
  Object.assign(radius, radiusBy[design]);
  // Eerst sleutels leegmaken: een odyssey-stijl (textTransform, fontVariant) mag niet blijven hangen in classic.
  const nextType = buildType(design);
  for (const k of Object.keys(nextType) as TypeVariant[]) type[k] = nextType[k];
  const lv = buildLevels(colors);
  Object.assign(levelColor, lv.color);
  Object.assign(levelSoft, lv.soft);
  return true;
}

/** Kiest het thema uit de voorkeur en het systeemthema van de gsm. */
export function resolveTheme(pref: ThemePref, system: string | null | undefined): ThemeName {
  if (pref === 'light' || pref === 'dark') return pref;
  return system === 'light' ? 'light' : 'dark';
}

/** Een geldig design uit opgeslagen voorkeuren; onbekend of leeg wordt het standaarddesign. */
export function resolveDesign(pref: unknown): DesignName {
  return pref === 'classic' || pref === 'odyssey' ? pref : DEFAULT_DESIGN;
}

/**
 * Stylesheet die meewisselt met thema en design. Gebruik: `const st = themed(() => StyleSheet.create({...}))`
 * en daarna gewoon `st.root`. De stijlen worden opnieuw opgebouwd zodra het thema of design wijzigt.
 */
export function themed<T extends object>(factory: () => T): T {
  let cache = factory();
  let version = themeVersion;
  const current = (): T => {
    if (version !== themeVersion) {
      cache = factory();
      version = themeVersion;
    }
    return cache;
  };
  return new Proxy({} as T, {
    get: (_t, key) => (current() as Record<PropertyKey, unknown>)[key],
    has: (_t, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_t, key) => {
      const d = Reflect.getOwnPropertyDescriptor(current(), key);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

// Odyssey-beweging en gloed, doorgegeven vanuit odyssey.ts zodat componenten één import hebben.
export { easing, glow, motion, opacity as odysseyOpacity, roundedRectPerimeter } from './odyssey';
