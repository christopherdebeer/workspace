/**
 * Technic, drawn flat: a piece as a glyph for the tray, a build as a schematic for its card.
 * Pure: SVG strings from pieces, as built (no solver), x along and y up.
 */
import { COLOURS, barsOf, cellsOf, isPlanar, radiusOf, rotXY, type Piece } from './pieces';

const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const f = (v: number) => (Math.round(v * 100) / 100).toString();

/** A gear's outline, teeth and all, as an SVG path about (0,0). */
function gearPath(teeth: number): string {
  const rp = teeth / 16;
  const pts: string[] = [];
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const k = i % 4;
    const r = k === 1 || k === 2 ? rp + 0.1 : rp - 0.1;
    pts.push(`${f(Math.cos(t) * r)},${f(-Math.sin(t) * r)}`);
  }
  return `M${pts.join('L')}Z`;
}
const cross = (x: number, y: number, r: number, colour: string) => `<path d="M${f(x - r)},${f(-y)}H${f(x + r)}M${f(x)},${f(-y - r)}V${f(-y + r)}" stroke="${colour}" stroke-width="${f(r * 0.7)}" stroke-linecap="round"/>`;

/** One piece, in the world's frame (y up): what to draw for it. */
export function drawPiece(p: Piece, dark = '#2a2b2c', paper = '#ebe9e3'): string {
  const c = hex(COLOURS[p.colour].rgb);
  const [x, y] = p.at;
  switch (p.kind) {
    case 'beam': case 'crank': case 'ramp': {
      const [b] = barsOf(p);
      const len = Math.hypot(b.bx - b.ax, b.by - b.ay);
      const ang = (-Math.atan2(b.by - b.ay, b.bx - b.ax) * 180) / Math.PI;
      let holes = '';
      for (const cell of cellsOf(p)) {
        holes += cell.hole === 'axle' ? cross(cell.x, cell.y, 0.26, dark) : cell.hole === 'round' ? `<circle cx="${f(cell.x)}" cy="${f(-cell.y)}" r=".3" fill="${paper}"/>` : '';
      }
      return `<g transform="translate(${f(x)} ${f(-y)}) rotate(${f(ang)})"><rect x="-.5" y="-.5" width="${f(len + 1)}" height="1" rx=".5" fill="${c}"/></g>${holes}`;
    }
    case 'gear': return `<g transform="translate(${f(x)} ${f(-y)})"><path d="${gearPath(p.n)}" fill="${c}"/></g>${cross(x, y, 0.26, dark)}`;
    case 'wheel': { const r = radiusOf(p); return `<circle cx="${f(x)}" cy="${f(-y)}" r="${f(r)}" fill="#1a1a1b"/><circle cx="${f(x)}" cy="${f(-y)}" r="${f(r - 0.6)}" fill="${hex(COLOURS[0].rgb)}"/>${cross(x, y, 0.26, dark)}`; }
    case 'ball': return `<circle cx="${f(x)}" cy="${f(-y)}" r="${f(radiusOf(p))}" fill="${c}"/><circle cx="${f(x - 0.22)}" cy="${f(-y - 0.22)}" r=".18" fill="#fff" opacity=".7"/>`;
    case 'motor': case 'hub': {
      const w = p.kind === 'motor' ? 3 : 4;
      const [dx, dy] = rotXY(w - 1, 1, p.rot);
      const x0 = Math.min(x, x + dx) - 0.5, x1 = Math.max(x, x + dx) + 0.5;
      const y0 = Math.min(y, y + dy) - 0.5, y1 = Math.max(y, y + dy) + 0.5;
      let holes = '';
      for (const cell of cellsOf(p)) holes += cell.hole === 'axle' ? cross(cell.x, cell.y, 0.26, dark) : cell.hole === 'round' ? `<circle cx="${f(cell.x)}" cy="${f(-cell.y)}" r=".3" fill="${paper}"/>` : '';
      const screen = p.kind === 'hub' ? `<rect x="${f((x0 + x1) / 2 - 0.7)}" y="${f(-(y0 + y1) / 2 - 0.45)}" width="1.4" height=".9" rx=".15" fill="#5aa86b"/>` : '';
      return `<rect x="${f(x0)}" y="${f(-y1)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" rx=".5" fill="${c}"/>${screen}${holes}`;
    }
    case 'pin': return `<circle cx="${f(x)}" cy="${f(-y)}" r=".3" fill="${c}"/><circle cx="${f(x)}" cy="${f(-y)}" r=".12" fill="${dark}" opacity=".5"/>`;
    case 'axle': return cross(x, y, 0.3, c);
  }
}

/** The pieces' extent (x0, y0, x1, y1), with their size. */
function extent(pieces: Piece[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pieces) {
    const pts = isPlanar(p.kind) ? cellsOf(p) : [{ x: p.at[0], y: p.at[1] }];
    const r = radiusOf(p) || 0.5;
    for (const q of pts) { x0 = Math.min(x0, q.x - r); y0 = Math.min(y0, q.y - r); x1 = Math.max(x1, q.x + r); y1 = Math.max(y1, q.y + r); }
  }
  return pieces.length ? [x0, y0, x1, y1] : [0, 0, 1, 1];
}

/** A build, drawn: back layers first, through pieces over what they go through. */
export function schematic(pieces: Piece[], width: number, height: number, opts: { board?: boolean } = {}): string {
  const [x0, y0, x1, y1] = extent(pieces);
  const pad = 1;
  const w = Math.max(x1 - x0 + pad * 2, (height ? (x1 - x0 + pad * 2) : 1)), h = y1 - y0 + pad * 2;
  const sorted = [...pieces].sort((a, b) => (isPlanar(a.kind) ? a.z : a.z + a.n - 0.5) - (isPlanar(b.kind) ? b.z : b.z + b.n - 0.5));
  const body = sorted.map((p) => drawPiece(p)).join('');
  const board = opts.board ? `<rect x="${f(x0 - pad)}" y="${f(-(y1 + pad))}" width="${f(w)}" height="${f(h)}" fill="#d9d5cb"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0 - pad)} ${f(-(y1 + pad))} ${f(w)} ${f(h)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">${board}${body}</svg>`;
}

/** One piece, for the tray: at the origin, filling its tile. */
export function glyph(spec: Omit<Piece, 'at' | 'z'>, size: number): string {
  const p: Piece = { ...spec, at: [0, 0], z: 0 };
  return schematic([p], size, size);
}
