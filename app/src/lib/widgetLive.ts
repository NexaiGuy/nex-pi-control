// Live widgets: houdt de widgets vers zolang je naar je startscherm kijkt (native module modules/widget-live, enkel
// Android). Android zelf ververst widgets hooguit om de 30 minuten; deze dienst vraagt ze opnieuw te tekenen bij het
// ontgrendelen, bij elke terugkeer naar je startscherm en daarna elke [interval] seconden.
//
// De keuze aan/uit en het interval bewaart de native kant zelf (ook "Uitzetten" in de melding). Builds zonder de plugin
// (plugins/withWidgetLive.js met enabled: false) of iOS: alles is een no-op.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

import { t } from '@/i18n';
import { hydratedStore, prefsStore, savePrefs } from '@/state/settings';

interface WidgetLiveNative {
  isSupported(): boolean;
  isEnabled(): boolean;
  isRunning(): boolean;
  start(labels: Record<string, string>): boolean;
  resume(): boolean;
  stop(): void;
  getInterval(): number;
  setInterval(seconds: number): void;
  hasUsageAccess(): boolean;
  status(): WidgetLiveStatus;
  /** Flex Window: tot wanneer (ms) het intro van de cover-widget loopt, 0 = geen intro. */
  coverIntroUntil(): number;
  /** Flex Window: servernaam onder de draaiende behuizing in het laadscherm. */
  setCoverCaption(text: string): void;
  /** Staat de app op het cover-scherm (Good Lock MultiStar)? */
  isOnCoverDisplay(): boolean;
  /** Flex Window: het intro meteen tonen. false: geen widget op het cover-scherm. */
  playCoverIntro(): boolean;
  /** Flex Window: de cijfers in de native layout (JSON uit src/widget/coverModel.ts). false: niet getekend. */
  renderCover(json: string): boolean;
}

export interface WidgetLiveStatus {
  running: boolean;
  enabled: boolean;
  intervalS: number;
  usageAccess: boolean;
  /** Widgets van Nex Pi Control op je startscherm. */
  widgets: number;
  /** Scherm aan, ontgrendeld en de app dicht. */
  looking: boolean;
  /** Startscherm vooraan (null: onbekend, zonder gebruiksgegevens of niet aan het kijken). */
  onHome: boolean | null;
  /** ms, laatste verversing (null: nog geen). */
  lastRefresh: number | null;
  /** Flex Window-widgets op het cover-scherm (oudere builds: ontbreekt). */
  coverWidgets?: number;
  /** Cover-scherm nu aan. */
  coverOn?: boolean;
}

/** Keuzes in Instellingen (seconden). */
export const LIVE_INTERVALS = [30, 60, 120, 300] as const;
export const DEFAULT_LIVE_INTERVAL = 60;

const native = Platform.OS === 'android' ? requireOptionalNativeModule<WidgetLiveNative>('WidgetLive') : null;

function call<T>(fn: (n: WidgetLiveNative) => T, fallback: T): T {
  if (!native) return fallback;
  try {
    return fn(native);
  } catch {
    return fallback;
  }
}

function labels(seconds: number): Record<string, string> {
  return { title: 'Nex Pi Control', text: t.widgetLive.notifText(seconds), stop: t.widgetLive.stop, channel: t.widgetLive.channel, loading: t.widgetLive.coverLoading };
}

export const widgetLive = {
  /** In deze build aanwezig? */
  supported: (): boolean => call((n) => n.isSupported(), false),
  /** Staat het aan (keuze van de gebruiker)? */
  enabled: (): boolean => call((n) => n.isEnabled(), false),
  interval: (): number => call((n) => n.getInterval(), DEFAULT_LIVE_INTERVAL),
  /** Aanzetten (of de melding bijwerken als hij al draait). */
  start: (): boolean => call((n) => n.start(labels(n.getInterval())), false),
  stop: (): void => call((n) => n.stop(), undefined),
  setInterval: (seconds: number): void =>
    call((n) => {
      n.setInterval(seconds);
      // Draait hij, dan krijgt de melding meteen de nieuwe tekst.
      if (n.isEnabled()) n.start(labels(n.getInterval()));
    }, undefined),
  hasUsageAccess: (): boolean => call((n) => n.hasUsageAccess(), false),
  status: (): WidgetLiveStatus | null => call((n) => n.status(), null),
  /** Flex Window: tot wanneer (ms, wandklok) het intro loopt. 0: geen intro of geen native module. */
  coverIntroUntil: (): number =>
    call((n) => {
      const v = n.coverIntroUntil();
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }, 0),
  setCoverCaption: (text: string): void => call((n) => n.setCoverCaption(text), undefined),
  /** Staat de app zelf op het cover-scherm van een Flip (via Good Lock MultiStar)? */
  isOnCoverDisplay: (): boolean => call((n) => n.isOnCoverDisplay() === true, false),
  playCoverIntro: (): boolean => call((n) => n.playCoverIntro() === true, false),
  renderCover: (json: string): boolean => call((n) => n.renderCover(json) === true, false),
};

/**
 * Bij elk openen van de app: staat het aan, dan draait de dienst (opnieuw) met de teksten in de taal van de app.
 * De eerste keer gaat het vanzelf aan zodra er een widget van Nex Pi Control op je startscherm staat. Zet je het
 * daarna uit, dan blijft het uit.
 */
export function syncWidgetLive(): void {
  if (!widgetLive.supported()) return;
  if (widgetLive.enabled()) {
    widgetLive.start();
    return;
  }
  // Voorkeuren nog niet geladen: niet beslissen, anders zou een eerder "uit" even als "nog nooit gevraagd" lijken.
  if (!hydratedStore.get()) return;
  if (prefsStore.get().widgetLiveAsked) return;
  const s = widgetLive.status();
  if (!s || s.widgets < 1) return;
  void savePrefs({ widgetLiveAsked: true });
  widgetLive.start();
}
