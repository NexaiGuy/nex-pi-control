// Flex Window (cover-scherm van de Flip): het intro speelt native (modules/widget-live, CoverScreen): eerst het Nex
// AI-logo, daarna de draaiende Pi-behuizing als laadscherm. De cijfers mogen pas komen als dat laadscherm lang genoeg
// liep. Intussen halen we de gegevens al op: wat het langst duurt, bepaalt wanneer de cijfers verschijnen.
import { widgetLive } from '@/lib/widgetLive';

/** Nooit langer wachten dan dit, ook als de klok van de native kant iets anders zegt. */
export const MAX_INTRO_WAIT_MS = 6000;

/** Hoe lang de cijfers nog moeten wachten (ms). 0 buiten het intro. */
export function introWaitMs(now: number = Date.now()): number {
  const until = widgetLive.coverIntroUntil();
  if (!until) return 0;
  return Math.min(MAX_INTRO_WAIT_MS, Math.max(0, until - now));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Laadt de gegevens en wacht tegelijk het intro af. */
export async function afterIntro<T>(load: () => Promise<T>): Promise<T> {
  const wait = introWaitMs();
  if (wait <= 0) return load();
  const [value] = await Promise.all([load(), sleep(wait)]);
  return value;
}

/** De servernaam voor het volgende laadscherm (enkel de naam, nooit adressen of sleutels). */
export function rememberCoverCaption(server: string): void {
  if (server) widgetLive.setCoverCaption(server);
}
