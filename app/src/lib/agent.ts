// Welke functies kent de agent op de actieve Pi? Oudere agents (voor 1.2.0) sturen geen lijst mee.
import type { Info } from '@/api/types';

export type AgentFeature = 'events' | 'updates' | 'agent_update' | 'container_restart';

export function supports(info: Info | undefined, feature: AgentFeature): boolean {
  return !!info?.features?.includes(feature);
}

/** Het installatiecommando: werkt ook als update, ook voor agents zonder update-knop. */
export const INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash';
