// De tekens van de widgets als SVG-tekst voor SvgWidget: ruit, oog, ring, balk, kernbalken, sparkline, spectrale band.
// Alles statisch (geen animatie), kleuren als gewone attributen.

let uid = 0;
const open = (w: number, h: number, vb = `0 0 ${w} ${h}`) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">`;
const r1 = (n: number) => n.toFixed(1);
const clamp = (p: number) => Math.max(0, Math.min(100, Number.isFinite(p) ? p : 0)) / 100;

export function diamond(size: number, color: string, hollow = false): string {
  const h = size / 2;
  const i = 0.75;
  const d = `M${h} ${i} L${size - i} ${h} L${h} ${size - i} L${i} ${h} Z`;
  return `${open(size, size)}<path d="${d}" ${hollow ? `fill="none" stroke="${color}" stroke-width="1"` : `fill="${color}"`}/></svg>`;
}

/** Het observerende oog: donkere lens, dunne irisring, vaste gloed, harde kern. Tekenvlak 32 x 32. */
export function eye(size: number, color: string, lens: string, line: string, hollow = false): string {
  const g = `eye${++uid}`;
  let s =
    `${open(size, size, '0 0 32 32')}<defs><radialGradient id="${g}" cx="16" cy="16" r="11" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="0.95"/><stop offset="0.38" stop-color="${color}" stop-opacity="0.45"/>` +
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient></defs>` +
    `<circle cx="16" cy="16" r="15.5" fill="${lens}"/>` +
    `<circle cx="16" cy="16" r="15.5" fill="none" stroke="${line}" stroke-width="1"/>` +
    `<circle cx="16" cy="16" r="12.25" fill="none" stroke="${color}" stroke-opacity="0.4" stroke-width="0.75"/>`;
  s += hollow
    ? `<circle cx="16" cy="16" r="3.25" fill="none" stroke="${color}" stroke-width="1"/>`
    : `<circle cx="16" cy="16" r="11" fill="url(#${g})"/><circle cx="16" cy="16" r="3" fill="${color}"/>` +
      `<circle cx="14.7" cy="14.7" r="0.85" fill="#FFFFFF" fill-opacity="0.75"/>`;
  return `${s}</svg>`;
}

export function ring(size: number, pct: number, color: string, track: string, stroke = 3): string {
  const c = size / 2;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const p = clamp(pct);
  let s = `${open(size, size)}<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>`;
  if (p > 0) {
    s +=
      `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" ` +
      `stroke-dasharray="${(circ * p).toFixed(2)} ${circ.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`;
  }
  return `${s}</svg>`;
}

export function bar(w: number, pct: number, color: string, track: string, h = 4): string {
  const p = clamp(pct);
  const fw = p > 0 ? Math.max(h, w * p) : 0;
  const r = h / 2;
  return (
    `${open(w, h)}<rect width="${w}" height="${h}" rx="${r}" fill="${track}"/>` +
    (fw ? `<rect width="${r1(fw)}" height="${h}" rx="${r}" fill="${color}"/>` : '') +
    '</svg>'
  );
}

/** Verticale balk per CPU-kern. */
export function cores(w: number, h: number, values: number[], color: string, track: string): string {
  const n = Math.max(1, values.length);
  const gap = n > 8 ? 2 : 4;
  const bw = (w - gap * (n - 1)) / n;
  let s = open(w, h);
  values.forEach((v, i) => {
    const x = i * (bw + gap);
    const fh = Math.max(v > 0 ? 2 : 0, (h * Math.min(100, Math.max(0, v))) / 100);
    s += `<rect x="${r1(x)}" y="0" width="${r1(bw)}" height="${h}" rx="1" fill="${track}"/>`;
    if (fh) s += `<rect x="${r1(x)}" y="${r1(h - fh)}" width="${r1(bw)}" height="${r1(fh)}" rx="1" fill="${color}"/>`;
  });
  return `${s}</svg>`;
}

export interface SparkPal {
  line: string;
  s1: string;
  s2: string;
  s3: string;
  s4: string;
}

/** Lijn van 1,5 dp in het spectrale verloop boven een haarlijn, eindpunt in spectral-4. Geen vulling, geen assen. */
export function spark(w: number, h: number, pts: number[], pal: SparkPal, dim = false): string {
  const vals = pts.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return `${open(w, h)}<line x1="0" y1="${h - 0.5}" x2="${w}" y2="${h - 0.5}" stroke="${pal.line}" stroke-width="1"/></svg>`;
  const g = `sp${++uid}`;
  const min = Math.min(...vals);
  const span = Math.max(...vals) - min || 1;
  const pad = 2;
  const step = (w - pad * 2) / (vals.length - 1);
  const xy = vals.map((v, i) => [pad + i * step, pad + (h - pad * 2) * (1 - (v - min) / span)] as const);
  const d = xy.map((p, i) => `${i ? 'L' : 'M'}${r1(p[0])} ${r1(p[1])}`).join(' ');
  const last = xy[xy.length - 1]!;
  const o = dim ? ' stroke-opacity="0.45"' : '';
  return (
    `${open(w, h)}<defs><linearGradient id="${g}" x1="0" y1="0" x2="${w}" y2="0" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${pal.s1}"/><stop offset="0.34" stop-color="${pal.s2}"/>` +
    `<stop offset="0.67" stop-color="${pal.s3}"/><stop offset="1" stop-color="${pal.s4}"/></linearGradient></defs>` +
    `<line x1="0" y1="${h - 0.5}" x2="${w}" y2="${h - 0.5}" stroke="${pal.line}" stroke-width="1"/>` +
    `<path d="${d}" fill="none" stroke="url(#${g})" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"${o}/>` +
    `<circle cx="${r1(last[0])}" cy="${r1(last[1])}" r="2" fill="${pal.s4}"${dim ? ' fill-opacity="0.45"' : ''}/></svg>`
  );
}

/** De slit-scan band: 2 dp, loopt in en uit aan beide kanten. */
export function band(w: number, pal: SparkPal, h = 2): string {
  const g = `bd${++uid}`;
  return (
    `${open(w, h)}<defs><linearGradient id="${g}" x1="0" y1="0" x2="${w}" y2="0" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0" stop-color="${pal.s1}" stop-opacity="0"/><stop offset="0.18" stop-color="${pal.s1}"/>` +
    `<stop offset="0.42" stop-color="${pal.s2}"/><stop offset="0.62" stop-color="${pal.s3}"/>` +
    `<stop offset="0.82" stop-color="${pal.s4}"/><stop offset="1" stop-color="${pal.s4}" stop-opacity="0"/>` +
    `</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#${g})"/></svg>`
  );
}
