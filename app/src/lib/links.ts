// Vaste links naar Nex AI en het project. Enkel hier aanpassen.
export const LINKS = {
  website: 'https://nex-ai.be',
  email: 'info@nex-ai.be',
  github: 'https://github.com/NexaiGuy/nex-pi-control',
  install: 'https://github.com/NexaiGuy/nex-pi-control#install',
  privacy: 'https://nex-ai.be/apps/nex-pi-control/privacy',
  product: 'https://nex-ai.be/apps/nex-pi-control',
  playStore: 'https://play.google.com/store/apps/details?id=be.nexai.picontrol',
} as const;

export function mailto(subject: string): string {
  return `mailto:${LINKS.email}?subject=${encodeURIComponent(subject)}`;
}
