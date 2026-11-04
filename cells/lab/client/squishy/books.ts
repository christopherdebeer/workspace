/**
 * Squishy: cookbooks with their titles on. A catalogue of books, made up (what the kitchen's read, and
 * what it's looked at: Tanizaki and Alexander, Fuchsia Dunlop and Elizabeth David, Ghibli's kitchens,
 * the old animators' squash and stretch, put through a grammar so none is quite any of them), each
 * lettered once onto an atlas: its cloth, its cover, its spine. A book anywhere in a level is one of
 * them by its slot; it's drawn here with each face saying which book and which face it is, and the
 * shader reads its colour, its cover and its spine from the atlas.
 *
 * The atlas: SLOTS cells, COLS across, each CELL square: its cover in the top 3/4 (4:3), its spine in
 * the bottom quarter (4:1); its corner pixel is its cloth.
 */
import { hash } from '../kit/rng';
import type { V3 } from './level';

export const SLOTS = 48, COLS = 8, ROWS = SLOTS / COLS, CELL = 256;
/** what a book's faces are, to the shader */
export const FACE = { cover: 0, spine: 1, pages: 2, back: 3 } as const;

export interface Book { title: string; author: string; style: number; cloth: string; ink: string; accent: string; serif: string; emblem: number }

// ─── the catalogue ───────────────────────────────────────────────────────────────────────────────
const N = ['Steam', 'Salt', 'Rice', 'Flour', 'Butter', 'Honey', 'Pepper', 'Broth', 'Bread', 'Tea', 'Dough', 'Pleats', 'Lanterns', 'Windows', 'Spoons',
  'Kettles', 'Peaches', 'Blossom', 'Mornings', 'Patience', 'Crumbs', 'Sesame', 'Ginger', 'Plums', 'Shadows', 'Bamboo', 'Jelly', 'Puddings', 'Buns', 'Dumplings'];
const ONE = ['Steam', 'Salt', 'Rice', 'Flour', 'Butter', 'Honey', 'Broth', 'Bread', 'Tea', 'Dough', 'Patience', 'Sesame', 'Ginger', 'Bamboo', 'Shadow', 'Morning'];
const ADJ = ['Patient', 'Gentle', 'Quiet', 'Humble', 'Golden', 'Tender', 'Little', 'Slow', 'Wobbly', 'Plain', 'Simple', 'Honest', 'Generous', 'Sticky', 'Pillowy',
  'Tiled', 'Sunlit', 'Small', 'Second', 'Everyday', 'Spirited', 'Unhurried'];
const ING = ['Steaming', 'Folding', 'Waiting', 'Simmering', 'Kneading', 'Proving', 'Pleating', 'Wobbling', 'Baking', 'Bouncing', 'Resting', 'Pouring', 'Setting', 'Squashing'];
const THING = ['Dumpling', 'Bun', 'Pudding', 'Kettle', 'Steamer', 'Teapot', 'Ladle', 'Jelly', 'Loaf', 'Peach', 'Lantern', 'Larder'];
const PLACE = ['Lantern Street', 'Willow Lane', 'Harbour', 'Hillside', 'Back Door', 'Upstairs', 'Night Market', 'Orchard', 'Station', 'Corner'];
const T: Array<(p: <A>(a: A[]) => A) => string> = [
  (p) => `The ${p(ADJ)} ${p(THING)}`,
  (p) => `${p(ONE)}, ${p(ONE)} & ${p(ONE)}`,
  (p) => `In Praise of ${p(N)}`,
  (p) => `A Pattern Language for ${p(N)}`,
  (p) => `The Timeless Way of ${p(ING)}`,
  (p) => `Notes from a ${p(ADJ)} Kitchen`,
  (p) => `The Art of ${p(ING)}`,
  (p) => `The Joy of ${p(ING)}`,
  (p) => `${p(['Twelve', 'Forty', 'A Hundred', 'Seven', 'Sixty'])} Ways with ${p(N)}`,
  (p) => `On ${p(ING)}`,
  (p) => `My Neighbour the ${p(THING)}`,
  (p) => `The ${p(THING)} Who ${p(['Bounced', 'Wobbled', 'Waited', 'Rose', 'Stayed', 'Wandered'])}`,
  (p) => `Every Grain of ${p(ONE.filter((w) => w !== 'Rice'))}`,
  (p) => `${p(PLACE)} Kitchen`,
  (p) => `Small Things, ${p(['Well Made', 'Slowly', 'Steamed', 'Shared'])}`,
  (p) => `${p(ONE)} ${p(ONE)} ${p(ONE)} ${p(ONE)}`,
  (p) => `Spirited ${p(N)}`,
  (p) => `Ways of ${p(['Tasting', 'Folding', 'Waiting', 'Steaming'])}`,
  (p) => `Mastering the Art of ${p(ADJ)} ${p(ING)}`,
  (p) => `Squash & Stretch`,
  (p) => `A Treatise on Soft ${p(['Bodies', 'Things', 'Landings'])}`,
  (p) => `${p(ADJ)} & ${p(ADJ)}`,
  (p) => `The ${p(['Moving', 'Wandering', 'Floating'])} ${p(['Oven', 'Larder', 'Teahouse', 'Kitchen'])}`,
  (p) => `${p(N)} for ${p(['Beginners', 'the Weekend', 'One', 'a Crowd', 'Rainy Days'])}`,
  (p) => `The ${p(['Book', 'Little Book', 'Pocket Book', 'Year'])} of ${p(N)}`,
];
const FIRST = ['Fen', 'Elsie', 'Nora', 'Hiro', 'Mei', 'Ada', 'Kit', 'Yuki', 'Ines', 'Otto', 'Clem', 'Ren', 'Lin', 'Ivo', 'Saoirse', 'June', 'Tomas', 'Wren'];
const LAST = ['Dunmore', 'Davies-Hart', 'Slate', 'Hazel', 'Ottoline', 'Rowden', 'Norcross', 'Mori', 'Takeda', 'Lin', 'Hara', 'Alexander', 'Miyake',
  'Tanizawa', 'Okonkwo', 'Ferrante', 'Wei', 'Lindqvist', 'Bramley', 'Ashworth'];
const CLOTH = ['#7d1f17', '#1f3156', '#2e4f36', '#b8862f', '#5a2a4a', '#2c2a28', '#7a5a3a', '#355f6b', '#a24a2a', '#e8dcc4', '#c9b98f', '#3d5a2a'];
const PAPER = ['#efe6d2', '#f4ede0', '#e9d9b8', '#dfe6dc', '#f2dccf'];
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const SANS = '"Avenir Next", Avenir, Futura, "Gill Sans", "Helvetica Neue", Arial, sans-serif';
const DIDONE = 'Didot, "Bodoni 72", "Bodoni MT", Georgia, serif';
const TYPE = '"American Typewriter", "Courier New", monospace';

let cat: Book[] | null = null;
/** the catalogue: the same each time, each book its own title, author, look */
export function catalogue(): Book[] {
  if (cat) return cat;
  const out: Book[] = [], seen = new Set<string>(), uses = new Map<number, number>();
  for (let i = 0; out.length < SLOTS; i++) {
    let k = 0;
    // (each word once in a title: no "Salt Salt")
    const took = new Set<unknown>();
    const p = <A>(a: A[]): A => { for (let n = 0; ; n++) { const w = a[hash(i, 0xb00c, k++) % a.length]; if (!took.has(w) || n > 8) { took.add(w); return w; } } };
    // (and no way of naming one more than three times)
    const ti = hash(i, 0x7171) % T.length;
    if ((uses.get(ti) ?? 0) >= 3) continue;
    const title = T[ti](p);
    if (seen.has(title) || /\b(\w+) \1\b/.test(title)) continue;
    seen.add(title); uses.set(ti, (uses.get(ti) ?? 0) + 1);
    const style = hash(i, 0x5717) % 4;
    const paper = style === 2;
    const cloth = paper ? p(PAPER) : p(CLOTH);
    const light = paper || cloth === '#e8dcc4' || cloth === '#c9b98f';
    out.push({
      title, author: `${p(FIRST)} ${p(LAST)}`, style, cloth,
      ink: light ? p(['#2a2420', '#7d1f17', '#1f3156']) : p(['#e9cf86', '#f3ead8', '#d8b36a']),
      accent: p(['#c0392b', '#e0a63a', '#2f6f8f', '#6e8b3d', '#d7745b', '#2a2420']),
      serif: style === 2 ? SANS : p([SERIF, SERIF, DIDONE, TYPE]), emblem: hash(i, 0xe3b) % 6,
    });
  }
  return (cat = out);
}
/** a book's slot, from something about where it is */
export const slotOf = (...k: number[]): number => hash(...k.map((v) => Math.round(v * 10)), 0xb0) % SLOTS;

// ─── the atlas (the browser's: it letters them) ──────────────────────────────────────────────────
/** Every book lettered: a canvas of SLOTS cells. */
export function paintAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = COLS * CELL; cv.height = ROWS * CELL;
  const g = cv.getContext('2d')!;
  catalogue().forEach((b, i) => {
    g.save();
    g.translate((i % COLS) * CELL, Math.floor(i / COLS) * CELL);
    g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip();
    g.fillStyle = b.cloth; g.fillRect(0, 0, CELL, CELL);
    cover(g, b, CELL, CELL * 0.75);
    g.translate(0, CELL * 0.75);
    spine(g, b, CELL, CELL * 0.25);
    g.restore();
  });
  return cv;
}
/** words to lines no wider than w, at this font */
function wrap(g: CanvasRenderingContext2D, text: string, w: number): string[] {
  const words = text.split(' '), lines: string[] = [];
  let line = '';
  for (const wd of words) { const t = line ? `${line} ${wd}` : wd; if (g.measureText(t).width > w && line) { lines.push(line); line = wd; } else line = t; }
  if (line) lines.push(line);
  return lines;
}
/** the title, as big as fits in w × h, centred on (cx, cy) */
function fit(g: CanvasRenderingContext2D, text: string, font: (px: number) => string, cx: number, cy: number, w: number, h: number, maxPx: number) {
  let px = maxPx, lines: string[] = [];
  for (; px > 8; px -= 2) { g.font = font(px); lines = wrap(g, text, w); if (lines.length * px * 1.12 <= h && lines.every((l) => g.measureText(l).width <= w)) break; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((l, k) => g.fillText(l, cx, cy + (k - (lines.length - 1) / 2) * px * 1.12));
}
function emblem(g: CanvasRenderingContext2D, b: Book, x: number, y: number, r: number) {
  g.save(); g.translate(x, y); g.strokeStyle = b.ink; g.fillStyle = b.ink; g.lineWidth = Math.max(1.5, r * 0.12);
  switch (b.emblem) {
    case 0: // a dumpling: a dome, its pleats
      g.beginPath(); g.arc(0, r * 0.25, r, Math.PI, 0); g.closePath(); g.stroke();
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(k * r * 0.12, -r * 0.7); g.quadraticCurveTo(k * r * 0.5, -r * 0.2, k * r * 0.7, r * 0.2); g.stroke(); }
      break;
    case 1: // a peach
      g.beginPath(); g.arc(-r * 0.25, 0, r * 0.7, 0, Math.PI * 2); g.arc(r * 0.25, 0, r * 0.7, 0, Math.PI * 2); g.fill();
      g.fillStyle = b.accent; g.beginPath(); g.ellipse(r * 0.4, -r * 0.8, r * 0.4, r * 0.18, -0.5, 0, Math.PI * 2); g.fill();
      break;
    case 2: // a steamer, its lid's rings
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(0, 0, (r * k) / 3, 0, Math.PI * 2); g.stroke(); }
      break;
    case 3: // a bowl and its steam
      g.beginPath(); g.arc(0, 0, r * 0.8, 0, Math.PI); g.closePath(); g.fill();
      for (const k of [-1, 0, 1]) { g.beginPath(); g.moveTo(k * r * 0.35, -r * 0.15); g.bezierCurveTo(k * r * 0.35 + r * 0.25, -r * 0.5, k * r * 0.35 - r * 0.25, -r * 0.7, k * r * 0.35, -r); g.stroke(); }
      break;
    case 4: // a leaf
      g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r, 0, 0, r); g.quadraticCurveTo(-r, 0, 0, -r); g.fill();
      break;
    default: // a little sun
      g.beginPath(); g.arc(0, 0, r * 0.45, 0, Math.PI * 2); g.fill();
      for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; g.beginPath(); g.moveTo(Math.cos(a) * r * 0.65, Math.sin(a) * r * 0.65); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); g.stroke(); }
  }
  g.restore();
}
/** its front cover, w × h (4:3): each style its own way of being a cookbook */
function cover(g: CanvasRenderingContext2D, b: Book, w: number, h: number) {
  const m = 10, ser = (px: number) => `600 ${px}px ${b.serif}`, small = (px: number) => `${px}px ${b.serif}`;
  g.fillStyle = b.ink; g.strokeStyle = b.ink;
  if (b.style === 0) {
    // cloth, a foil title over a rule, an emblem, its author at the foot
    g.lineWidth = 2; g.strokeRect(m + 6, m + 6, w - 2 * m - 12, h - 2 * m - 12);
    fit(g, b.title, ser, w / 2, h * 0.3, w - 60, h * 0.32, 34);
    g.fillRect(w * 0.35, h * 0.5, w * 0.3, 2);
    emblem(g, b, w / 2, h * 0.68, h * 0.1);
    g.font = small(14); g.textAlign = 'center'; g.fillText(b.author.toUpperCase(), w / 2, h * 0.86);
  } else if (b.style === 1) {
    // a band across it, the title on the band
    g.fillStyle = b.accent; g.fillRect(0, h * 0.22, w, h * 0.38);
    g.fillStyle = b.ink; fit(g, b.title, ser, w / 2, h * 0.41, w - 50, h * 0.32, 32);
    emblem(g, b, w * 0.82, h * 0.8, h * 0.07);
    g.font = small(14); g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(b.author, m + 10, h * 0.8);
  } else if (b.style === 2) {
    // a paperback: paper, blocks of colour, a big plain title
    g.fillStyle = b.accent; g.beginPath(); g.arc(w * 0.72, h * 0.66, h * 0.26, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 0.8; g.fillRect(m, h * 0.62, w * 0.34, h * 0.24); g.globalAlpha = 1;
    g.fillStyle = b.ink; g.textAlign = 'left';
    let px = 34; g.font = `700 ${px}px ${b.serif}`;
    let lines = wrap(g, b.title, w - 2 * m - 10);
    while (lines.length * px * 1.05 > h * 0.48 && px > 10) { px -= 2; g.font = `700 ${px}px ${b.serif}`; lines = wrap(g, b.title, w - 2 * m - 10); }
    g.textBaseline = 'top'; lines.forEach((l, k) => g.fillText(l, m + 6, m + 6 + k * px * 1.05));
    g.font = `${13}px ${b.serif}`; g.textBaseline = 'bottom'; g.fillText(b.author, m + 6, h - m);
  } else {
    // a pattern, gingham or stripes, a cream label on it
    g.fillStyle = b.accent; g.globalAlpha = 0.5;
    for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 8, h);
    for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 8);
    g.globalAlpha = 1;
    g.fillStyle = '#f4ede0'; g.fillRect(w * 0.14, h * 0.24, w * 0.72, h * 0.46);
    g.strokeStyle = '#2a2420'; g.lineWidth = 1.5; g.strokeRect(w * 0.14 + 5, h * 0.24 + 5, w * 0.72 - 10, h * 0.46 - 10);
    g.fillStyle = '#2a2420'; fit(g, b.title, ser, w / 2, h * 0.43, w * 0.62, h * 0.26, 28);
    g.font = small(12); g.textAlign = 'center'; g.fillText(b.author, w / 2, h * 0.62);
  }
}
/** its spine, w × h (4:1), read head to tail: bands, the title, the author, a mark at the tail */
function spine(g: CanvasRenderingContext2D, b: Book, w: number, h: number) {
  g.fillStyle = b.cloth; g.fillRect(0, 0, w, h);
  g.fillStyle = b.ink;
  if (b.style === 0) for (const x of [10, 16, w - 16, w - 10]) g.fillRect(x, 6, 2, h - 12);
  if (b.style === 1) { g.fillStyle = b.accent; g.fillRect(18, 0, w * 0.66 - 14, h); g.fillStyle = b.ink; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // (the title from near the head to two thirds down; the author's surname after it; each shrunk to its own room)
  const shrink = (text: string, font: (q: number) => string, px: number, room: number) => { g.font = font(px); while (g.measureText(text).width > room && px > 7) { px -= 1; g.font = font(px); } };
  const t0 = 22, t1 = w * 0.66, a0 = w * 0.69, a1 = w - 22;
  shrink(b.title, (q) => (b.style === 2 ? `700 ${q}px ${b.serif}` : `600 ${q}px ${b.serif}`), Math.round(h * 0.46), t1 - t0);
  g.fillText(b.title, (t0 + t1) / 2, h / 2);
  const sur = b.author.split(' ').slice(-1)[0];
  shrink(sur, (q) => `${q}px ${b.serif}`, Math.round(h * 0.3), a1 - a0);
  g.fillText(sur, (a0 + a1) / 2, h / 2);
  emblem(g, b, w - 11, h / 2, h * 0.15);
}

// ─── a book's faces ──────────────────────────────────────────────────────────────────────────────
type Push = (p: V3, n: V3, mat: number, uv: [number, number]) => void;
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];
const crs = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** what a face says to the shader, on v: a book's slot and which face, and where on the face (v, -1 to 2) */
const code = (slot: number, face: number, v: number) => 100 + 4 * (slot * 4 + face) + (v + 1);
/**
 * A book: its middle c, its spine's way out S, its head's way Hd (its front cover's way out then
 * Hd × S), half its thickness t, half its width from spine to fore-edge w, half its height h.
 */
export function bookFaces(push: Push, mat: number, slot: number, c: V3, S: V3, Hd: V3, t: number, w: number, h: number) {
  const Nc = crs(Hd, S);
  // a face: its middle, its two ways across (each as far as it goes), its normal, and (u, v) at each corner
  const face = (m: V3, U: V3, eu: number, V: V3, ev: number, n: V3, uv: (su: number, sv: number) => [number, number]) => {
    const P = (su: number, sv: number) => add(add(m, U, su * eu), V, sv * ev);
    // (wound counter-clockwise seen from outside: (-,-) (-,+) (+,+) goes round V × U, so the other way when U × V is out)
    const flip = crs(U, V)[0] * n[0] + crs(U, V)[1] * n[1] + crs(U, V)[2] * n[2] > 0;
    const q: Array<[number, number]> = flip ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[-1, -1], [-1, 1], [1, 1], [1, -1]];
    for (const k of [0, 1, 2, 0, 2, 3]) push(P(...q[k]), n, mat, uv(...q[k]));
  };
  const Ud = neg(S), Vd = neg(Hd);
  // the front cover: across from the spine, down from the head; fitted into the cover's 4:3, kept square
  { const f = Math.min(1 / (2 * w), 0.75 / (2 * h)) * 0.94;
    face(add(c, Nc, t), Ud, w, Vd, h, Nc, (su, sv) => [0.5 + (su * w * f), code(slot, 0, 0.5 + (sv * h * f) / 0.75)]); }
  // the spine: head to tail, front to back; fitted into the spine's 4:1
  { const f = Math.min(1 / (2 * h), 0.25 / (2 * t));
    face(add(c, S, w), Vd, h, neg(Nc), t, S, (su, sv) => [0.5 + su * h * f, code(slot, 1, 0.5 + (sv * t * f) / 0.25)]); }
  // the back cover: cloth
  face(add(c, Nc, -t), Ud, w, Vd, h, neg(Nc), () => [0, code(slot, 3, 0)]);
  // the pages' edges, fore-edge, head and tail: (u: cm from the front board, v: how far across, 0–1)
  const pages = (m: V3, A: V3, ea: number, n: V3) => face(m, neg(Nc), t, A, ea, n, (su) => [(su + 1) * t, code(slot, 2, (su + 1) / 2)]);
  pages(add(c, S, -w), Hd, h, neg(S));
  pages(add(c, Hd, h), S, w, Hd);
  pages(add(c, Hd, -h), S, w, neg(Hd));
}
