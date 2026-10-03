// Zwevend icoon: de draaiende Pi-behuizing boven andere apps (native module modules/floating-pi, enkel Android).
//
// De keuze aan/uit bewaart de native kant zelf (ook als je de bubbel naar het kruis sleept of "Verbergen" tikt in de
// melding). Builds zonder de plugin (plugins/withFloatingIcon.js met enabled: false) of iOS: alles is een no-op.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import type { Level } from '@/theme/tokens';
import { t } from '@/i18n';

interface FloatingPiNative {
  isSupported(): boolean;
  canDrawOverlays(): boolean;
  openPermissionSettings(): void;
  isEnabled(): boolean;
  isRunning(): boolean;
  start(labels: Record<string, string>): boolean;
  stop(): void;
  setStatus(level: string): void;
  setAppVisible(visible: boolean): void;
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): void;
  isHomeOnly(): boolean;
  setHomeOnly(value: boolean): void;
  recheck(): void;
  status(): FloatingPiStatus;
}

export interface FloatingPiStatus {
  running: boolean;
  enabled: boolean;
  canDraw: boolean;
  usageAccess: boolean;
  homeOnly: boolean;
  foreground?: string | null;
  onHome?: boolean | null;
  visible?: boolean;
  /** Er staat een bank- of betaalapp vooraan: het venster is weg. */
  bank?: boolean;
}

const native = Platform.OS === 'android' ? requireOptionalNativeModule<FloatingPiNative>('FloatingPi') : null;

function call<T>(fn: (n: FloatingPiNative) => T, fallback: T): T {
  if (!native) return fallback;
  try {
    return fn(native);
  } catch {
    return fallback;
  }
}

/** Status-ruitje op de bubbel: niets bij ok, amber, rood, of grijs als de Pi onbereikbaar is. */
export type FloatingStatus = Level | 'offline';

export const floatingPi = {
  /** In deze build aanwezig? */
  supported: (): boolean => call((n) => n.isSupported(), false),
  /** Toestemming "Weergeven over andere apps" gegeven? */
  canDraw: (): boolean => call((n) => n.canDrawOverlays(), false),
  /** Staat het aan (keuze van de gebruiker)? */
  enabled: (): boolean => call((n) => n.isEnabled(), false),
  openPermission: (): void => call((n) => n.openPermissionSettings(), undefined),
  start: (): boolean =>
    call((n) => n.start({ title: 'Nex Pi Control', text: t.floating.notifText, hide: t.floating.hide, channel: t.floating.channel }), false),
  stop: (): void => call((n) => n.stop(), undefined),
  setStatus: (level: FloatingStatus): void => call((n) => n.setStatus(level), undefined),
  setAppVisible: (visible: boolean): void => call((n) => n.setAppVisible(visible), undefined),
  /** "Toegang tot gebruiksgegevens" gegeven (nodig voor enkel op het startscherm)? */
  hasUsageAccess: (): boolean => call((n) => n.hasUsageAccess(), false),
  openUsageAccess: (): void => call((n) => n.openUsageAccessSettings(), undefined),
  /** Enkel op het startscherm (standaard), of boven alle apps. */
  homeOnly: (): boolean => call((n) => n.isHomeOnly(), true),
  setHomeOnly: (value: boolean): void => call((n) => n.setHomeOnly(value), undefined),
  recheck: (): void => call((n) => n.recheck(), undefined),
  status: (): FloatingPiStatus | null => call((n) => n.status(), null),
};

/**
 * Bij elk openen van de app: staat het aan in Instellingen, dan komt het icoon (terug) op je scherm, ook als je het
 * naar het kruis sleepte. Is de toestemming intussen ingetrokken, dan gaat het uit.
 */
export function syncFloatingPi(): void {
  if (!floatingPi.supported() || !floatingPi.enabled()) return;
  if (floatingPi.canDraw()) floatingPi.start();
  else floatingPi.stop();
}

/**
 * Eerste keer: het zwevende icoon staat standaard aan. Met toestemming start het meteen ('started');
 * zonder toestemming moet de app er één keer om vragen ('ask'). Daarna beslis je zelf in Instellingen ('done').
 */
export function firstRunFloatingPi(alreadyAsked: boolean): 'started' | 'ask' | 'done' {
  if (alreadyAsked || !floatingPi.supported()) return 'done';
  if (floatingPi.enabled()) return 'done';
  if (floatingPi.canDraw()) return floatingPi.start() ? 'started' : 'done';
  return 'ask';
}
