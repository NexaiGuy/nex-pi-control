// Drempel- en meldingslogica. Pure functies: getest en gedeeld door de app en de achtergrondtaak.
import type { Overview } from '@/api/types';
import { t } from '@/i18n';
import type { NotifyPrefs, Thresholds } from '@/state/settings';

export type AlertKind = 'disk' | 'service' | 'site' | 'temp' | 'backup' | 'diskUsage';

export interface Alert {
  key: string; // stabiel, om veranderingen te detecteren
  kind: AlertKind;
  level: 'warning' | 'critical';
  text: string;
}

export function evaluateAlerts(o: Overview, th: Thresholds): Alert[] {
  const out: Alert[] = [];
  for (const d of o.disk_alarms) {
    out.push({ key: `disk:${d.device}`, kind: 'disk', level: 'critical', text: `${d.message} ${d.reasons[0] ?? ''}`.trim() });
  }
  for (const m of o.mounts) {
    if (m.percent >= th.diskPct) {
      out.push({ key: `diskUsage:${m.mountpoint}`, kind: 'diskUsage', level: m.percent >= 95 ? 'critical' : 'warning', text: t.notify.diskUsage(m.mountpoint, Math.round(m.percent)) });
    }
  }
  const temp = o.system.temperature_c;
  if (temp !== null && temp >= th.tempC) {
    out.push({ key: 'temp', kind: 'temp', level: temp >= th.tempC + 10 ? 'critical' : 'warning', text: t.notify.temp(Math.round(temp)) });
  }
  for (const r of o.health.reasons) {
    if (r.code === 'services_failed') out.push({ key: `service:${r.text}`, kind: 'service', level: 'warning', text: r.text });
    if (r.code === 'sites_down') out.push({ key: `site:${r.text}`, kind: 'site', level: 'warning', text: r.text });
  }
  const age = o.counts.last_backup_age_seconds;
  if (age !== null && age > th.backupHours * 3600) {
    out.push({ key: 'backup', kind: 'backup', level: 'warning', text: t.notify.backupAge(Math.round(age / 3600)) });
  }
  return out;
}

export function enabledFor(kind: AlertKind, prefs: NotifyPrefs): boolean {
  switch (kind) {
    case 'disk':
    case 'diskUsage':
      return prefs.disk;
    case 'service':
      return prefs.service;
    case 'site':
      return prefs.site;
    case 'temp':
      return prefs.temp;
    case 'backup':
      return prefs.backup;
  }
}

/** Welke meldingen zijn nieuw ten opzichte van de vorige keer, en welke zijn opgelost. */
export function diffAlerts(previous: string[], current: Alert[], prefs: NotifyPrefs): { fired: Alert[]; resolved: string[] } {
  const prev = new Set(previous);
  const cur = new Set(current.map((a) => a.key));
  const fired = current.filter((a) => !prev.has(a.key) && enabledFor(a.kind, prefs));
  const resolved = previous.filter((k) => !cur.has(k));
  return { fired, resolved };
}

export function levelFromPercent(v: number | null | undefined, warn: number, crit: number): 'ok' | 'warning' | 'critical' {
  if (v === null || v === undefined) return 'ok';
  if (v >= crit) return 'critical';
  if (v >= warn) return 'warning';
  return 'ok';
}
