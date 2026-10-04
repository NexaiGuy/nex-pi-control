// Staat de app op het cover-scherm van een Galaxy Z Flip (Flex Window, via Good Lock MultiStar)?
// De native kant weet het zeker (scherm 1). Als reserve: een klein, bijna vierkant venster zoals de Flex Window
// (Flip 5: 720 x 748 px, ongeveer 360 x 374 dp). Een gsm in gesplitst scherm is langer dan 460 dp en valt erbuiten.
import { widgetLive } from '@/lib/widgetLive';

export function looksLikeCover(width: number, height: number): boolean {
  if (!(width > 0 && height > 0)) return false;
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  return long <= 460 && short >= 260 && short / long >= 0.8;
}

export function isCoverWindow(width: number, height: number): boolean {
  return widgetLive.isOnCoverDisplay() || looksLikeCover(width, height);
}
