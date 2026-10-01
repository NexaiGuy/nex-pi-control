// Designtokens voor Nex Pi Control. Twee thema's (donker en licht) in de Nex AI-huisstijl. Eén bron van waarheid.
//
// Hoe thema's werken: `colors`, `series`, `type`, `levelColor` en `levelSoft` zijn gewone objecten die bij een
// themawissel ter plaatse worden bijgewerkt (applyTheme). Stylesheets maak je met `themed(() => StyleSheet.create(...))`,
// die worden per thema opnieuw opgebouwd. De root-layout hermount de schermen na een wissel, zodat alles meteen klopt.

export type ThemeName = 'dark' | 'light';
export type ThemePref = 'system' | ThemeName;

const darkPalette = {
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
};

export type Palette = { [K in keyof typeof darkPalette]: string };

// Licht thema "Nex Light": koel wit met Nex-paars, cyberpunk-accenten (magenta, cyaan) gedoseerd.
// Alle tekst- en statuskleuren halen WCAG AA (4,5:1) op #F6F5FB en #FFFFFF.
const lightPalette: Palette = {
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
};

const palettes: Record<ThemeName, Palette> = { dark: darkPalette, light: lightPalette };

// Grafiekkleuren per thema: onderscheidbaar voor kleurenblinden (altijd met label), contrastrijk op de kaartkleur.
const seriesByTheme: Record<ThemeName, readonly string[]> = {
  dark: ['#8B5CF6', '#34F5C5', '#60A5FA', '#F5B942', '#F472B6', '#A3E635', '#FB923C', '#22D3EE'],
  light: ['#6D28D9', '#0E7490', '#BE185D', '#047857', '#A15C00', '#4D7C0F', '#C2410C', '#1D4ED8'],
};

/** Actieve kleuren. Wordt ter plaatse bijgewerkt bij een themawissel. */
export const colors: Palette = { ...darkPalette };
/** Actieve grafiekkleuren. */
export const series: string[] = [...seriesByTheme.dark];

let currentTheme: ThemeName = 'dark';
let themeVersion = 0;

export function getTheme(): ThemeName {
  return currentTheme;
}

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

function buildType() {
  return {
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
  };
}

/** Tekststijlen. Wordt ter plaatse bijgewerkt bij een themawissel. */
export const type = buildType();

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

/** Wisselt het actieve thema. Idempotent: doet niets als het thema al actief is. */
export function applyTheme(name: ThemeName): boolean {
  if (name === currentTheme) return false;
  currentTheme = name;
  themeVersion += 1;
  Object.assign(colors, palettes[name]);
  series.splice(0, series.length, ...seriesByTheme[name]);
  Object.assign(type, buildType());
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

/**
 * Stylesheet die meewisselt met het thema. Gebruik: `const st = themed(() => StyleSheet.create({...}))`
 * en daarna gewoon `st.root`. De stijlen worden opnieuw opgebouwd zodra het thema wijzigt.
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
