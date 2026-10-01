// Na een themawissel worden de schermen opnieuw opgebouwd (zie app/_layout.tsx).
// Hier onthouden we waar de gebruiker was, zodat hij daarna op hetzelfde scherm terechtkomt.
let pending: string | null = null;

export function setThemeReturn(route: string): void {
  pending = route;
}

export function takeThemeReturn(): string | null {
  const r = pending;
  pending = null;
  return r;
}
