import type { Container, Service, Site } from '@/api/types';
import { t } from '@/i18n';
import type { Level } from '@/theme/tokens';

export function serviceLevel(s: Service): { level: Level; label: string } {
  if (s.active === 'failed') return { level: 'critical', label: t.system.states.failed };
  if (s.active === 'active') return { level: 'ok', label: s.sub === 'running' ? t.system.states.active : s.sub };
  if (s.active === 'activating' || s.active === 'reloading') return { level: 'warning', label: t.system.states.starting };
  return { level: 'unknown', label: t.system.states.inactive };
}

export function containerLevel(c: Container): { level: Level; label: string } {
  if (c.health === 'unhealthy') return { level: 'critical', label: t.system.states.unhealthy };
  if (c.state === 'running') return { level: 'ok', label: c.health === 'healthy' ? t.system.states.healthy : t.system.states.running };
  if (c.state === 'restarting') return { level: 'warning', label: t.system.states.restarting };
  if (c.state === 'exited' && c.exit_code) return { level: 'critical', label: `${t.system.states.stopped} (${c.exit_code})` };
  return { level: 'unknown', label: t.system.states.stopped };
}

export function siteLevel(s: Site): { level: Level; label: string } {
  switch (s.state) {
    case 'up':
      return { level: 'ok', label: `${s.status_code ?? ''} ${t.system.states.online}` };
    case 'protected':
      return { level: 'ok', label: `${s.status_code ?? ''} ${t.system.protected}` };
    case 'warning':
      return { level: 'warning', label: `${s.status_code ?? ''}` };
    default:
      return { level: 'critical', label: s.status_code ? `${s.status_code} ${t.live.offline}` : t.live.offline };
  }
}
