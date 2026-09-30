/**
 * The trees, painted once per seed into one atlas (a 2D canvas), then drawn as
 * billboards by the renderer, which fogs and lights them for their distance
 * and the weather. Painted, not modelled: birch bark is a cream trunk with dark
 * lenticels and black scars; a bare tree is a few recursive strokes; a leafy
 * crown is dabs of three greens with sky between.
 *
 * Layout (2048 × 2048): two rows of 256 × 768 cells for trees (a bare, leaning
 * tree takes two cells side by side: it spreads), and 32 tufts of 256 × 128
 * below.
 */
import { hash, seeded, type Rand } from './rng';

export interface Sprite {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** width / height */
  aspect: number;
}
export type SpriteKey = 'birch' | 'birchBare' | 'bare' | 'beech' | 'tuft' | 'tuftGreen';

export const ATLAS = 2048;
const CW = 256;
const CH = 768;

export interface Atlas {
  canvas: HTMLCanvasElement;
  sprites: Sprite[];
  keys: Record<SpriteKey, number[]>;
}

type Ctx = CanvasRenderingContext2D;

const pickOf = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** Sun from the left, always (so a wood's light agrees with itself). */
const SUN = -1;

function birch(ctx: Ctx, x0: number, y0: number, W: number, H: number, r: Rand, leafy: boolean) {
  const cx = x0 + W / 2 + (r() - 0.5) * W * 0.1;
  const base = y0 + H - 2;
  const tw = W * (0.08 + 0.05 * r());
  const bend = (r() - 0.5) * W * 0.12;
  const lean = (r() - 0.5) * W * 0.12;
  const at = (t: number) => cx + Math.sin(t * Math.PI * 0.9) * bend + lean * t;
  const width = (t: number) => tw * (1 - 0.6 * t) + (t < 0.06 ? (0.06 - t) * tw * 4 : 0);
  const top = 0.97;
  const edge = (side: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * top;
      pts.push([at(t) + side * width(t) * 0.5, base - t * (H - 8)]);
    }
    return pts;
  };
  const L = edge(-1);
  const R = edge(1).reverse();
  const trunk = new Path2D();
  [...L, ...R].forEach(([x, y], i) => (i ? trunk.lineTo(x, y) : trunk.moveTo(x, y)));
  trunk.closePath();
  const g = ctx.createLinearGradient(cx - tw, 0, cx + tw, 0);
  // lit on the sun side, cool grey-green in shade
  g.addColorStop(0, SUN < 0 ? '#f1eee0' : '#8e948a');
  g.addColorStop(0.45, '#e2dfcf');
  g.addColorStop(0.8, '#a8ab9c');
  g.addColorStop(1, SUN < 0 ? '#7f867c' : '#f1eee0');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fill(trunk);
  ctx.clip(trunk);
  // the dark foot of an old birch: fissured, darkening downwards, never a band
  const foot = 0.05 + 0.08 * r();
  for (let i = 0; i < 140; i++) {
    const t = Math.pow(r(), 2.2) * foot * 1.6;
    const y = base - t * (H - 8);
    const w = width(t);
    const x = at(t) - w / 2 + r() * w;
    const len = (H - 8) * foot * (0.15 + r() * 0.5) * (1 - t / (foot * 1.6));
    ctx.strokeStyle = `rgba(${34 + r() * 16},${32 + r() * 14},${28 + r() * 10},${0.35 + 0.5 * (1 - t / (foot * 1.6))})`;
    ctx.lineWidth = 1 + r() * 2.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 3, y - len);
    ctx.stroke();
  }
  // lenticels: thin dark marks across the bark, often in bands, some only a nick
  for (let i = 0; i < 130; i++) {
    const t = foot * 0.8 + Math.pow(r(), 1.2) * (top - foot);
    const y = base - t * (H - 8);
    const w = width(t);
    const len = w * (r() < 0.3 ? 0.08 + r() * 0.15 : 0.25 + r() * 0.6);
    const x = at(t) - w / 2 + r() * (w - len);
    ctx.strokeStyle = `rgba(${34 + r() * 22},${34 + r() * 20},${30 + r() * 14},${0.35 + r() * 0.55})`;
    ctx.lineWidth = 0.7 + r() * (t < 0.35 ? 2 : 1.3);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len / 2, y + (r() - 0.5) * 2.5, x + len, y + (r() - 0.5) * 1.5);
    ctx.stroke();
  }
  // black patches: irregular, wrapping part way round
  const patches = 5 + Math.floor(r() * 7);
  for (let i = 0; i < patches; i++) {
    const t = foot + r() * (top - foot) * 0.85;
    const y = base - t * (H - 8);
    const w = width(t);
    const pw = w * (0.3 + r() * 0.6);
    const ph = 2 + r() * w * 0.5;
    const x = at(t) - w / 2 + r() * (w - pw);
    ctx.fillStyle = `rgba(${26 + r() * 12},${25 + r() * 10},${22 + r() * 8},${0.7 + r() * 0.25})`;
    ctx.beginPath();
    const n = 9;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * Math.PI * 2;
      const rr = 0.65 + r() * 0.45;
      const px = x + pw / 2 + (Math.cos(a) * pw) / 2 * rr;
      const py = y + (Math.sin(a) * ph) / 2 * rr;
      k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.fill();
  }
  // branch scars: dark chevrons, like brows
  for (let i = 0; i < 5; i++) {
    const t = 0.25 + r() * 0.6;
    const y = base - t * (H - 8);
    const w = width(t);
    const x = at(t) + (r() - 0.5) * w * 0.5;
    const s2 = w * (0.2 + r() * 0.15);
    ctx.strokeStyle = 'rgba(30,28,24,.85)';
    ctx.lineWidth = 1.5 + r() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x - s2, y + s2 * 0.35);
    ctx.quadraticCurveTo(x, y - s2 * 0.4, x + s2, y + s2 * 0.35);
    ctx.stroke();
  }
  ctx.restore();
  // twigs and the crown
  const crown = leafy ? 0.5 + r() * 0.12 : 0.55;
  ctx.strokeStyle = 'rgba(46,42,36,.9)';
  ctx.lineCap = 'round';
  const twigs = leafy ? 7 : 16;
  for (let i = 0; i < twigs; i++) {
    const t = crown - 0.08 + r() * (top - crown + 0.05);
    const side = r() < 0.5 ? -1 : 1;
    let x = at(t);
    let y = base - t * (H - 8);
    let a = -Math.PI / 2 + side * (0.5 + r() * 0.7);
    let len = W * (0.12 + r() * 0.25);
    let w = Math.max(0.8, width(t) * 0.22);
    for (let k = 0; k < (leafy ? 3 : 5); k++) {
      const nx = x + Math.cos(a) * len;
      const ny = y + Math.sin(a) * len;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      // bare: fine drooping twigs along it
      if (!leafy)
        for (let j = 0; j < 5; j++) {
          const f = r();
          const sx = x + (nx - x) * f;
          const sy = y + (ny - y) * f;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(sx + side * 6, sy + 4, sx + side * (4 + r() * 10), sy + 10 + r() * 22);
          ctx.stroke();
        }
      x = nx;
      y = ny;
      a += (r() - 0.5) * 0.6 + 0.12 * side;
      len *= 0.7;
      w *= 0.65;
    }
  }
  if (!leafy) return;
  // leaves: dabs of green in clusters, the sun side brighter, sky between
  const greens = ['#2d4a1e', '#3f6326', '#5f8233', '#86a444'];
  const lit = ['#a9c25a', '#c6d57a'];
  const clusters = 7 + Math.floor(r() * 5);
  for (let c = 0; c < clusters; c++) {
    const t = crown + r() * (top - crown);
    const ccx = at(t) + (r() - 0.5) * W * 0.8;
    const ccy = base - t * (H - 8);
    const rad = W * (0.12 + r() * 0.16);
    const dabs = 90 + Math.floor(r() * 90);
    for (let i = 0; i < dabs; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * rad;
      const x = ccx + Math.cos(a) * d * 1.1;
      // birches weep: the lower dabs hang
      const y = ccy + Math.sin(a) * d * 0.8 + Math.pow(r(), 3) * rad * 1.2;
      if (x < x0 + 3 || x > x0 + W - 3 || y < y0 + 3) continue;
      const sunny = (x - ccx) * SUN > rad * 0.1 && r() < 0.55;
      ctx.fillStyle = sunny ? pickOf(r, lit) : pickOf(r, greens);
      ctx.globalAlpha = 0.75 + r() * 0.25;
      ctx.beginPath();
      ctx.ellipse(x, y, 2 + r() * 4, 1.5 + r() * 3, r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** A bare, leaning tree (the first picture): a trunk, then recursive branches that spread. */
function bare(ctx: Ctx, x0: number, y0: number, W: number, H: number, r: Rand) {
  const lean = (r() - 0.5) * 0.7;
  const bx = x0 + W / 2 - Math.sin(lean) * H * 0.25;
  const by = y0 + H - 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#2b2925';
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
    const bend = (r() - 0.5) * 0.3;
    const mx = x + Math.cos(a + bend) * len * 0.5;
    const my = y + Math.sin(a + bend) * len * 0.5;
    const nx = x + Math.cos(a) * len;
    const ny = y + Math.sin(a) * len;
    ctx.lineWidth = w;
    ctx.globalAlpha = depth > 5 ? 0.7 : 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(mx, my, nx, ny);
    ctx.stroke();
    if (depth >= 8 || w < 0.5) return;
    const kids = depth < 2 ? 2 : 2 + (r() < 0.45 ? 1 : 0);
    for (let k = 0; k < kids; k++) {
      // spread outwards, and a little up (the crown is wider than tall)
      const spread = (k / Math.max(1, kids - 1) - 0.5) * (0.9 + r() * 0.6);
      const na = a + spread + (-Math.PI / 2 - a) * 0.12 + (r() - 0.5) * 0.3;
      branch(nx, ny, na, len * (0.68 + r() * 0.16), w * 0.62, depth + 1);
    }
  };
  // the trunk leans; the first fork is low
  branch(bx, by, -Math.PI / 2 + lean, H * (0.3 + r() * 0.12), W * 0.03 + 3, 0);
  ctx.globalAlpha = 1;
}

/** A small beech keeping last year's russet leaves (the first picture, right). */
function beech(ctx: Ctx, x0: number, y0: number, W: number, H: number, r: Rand) {
  const cx = x0 + W / 2;
  const base = y0 + H - 2;
  ctx.strokeStyle = '#2e2a25';
  ctx.lineCap = 'round';
  ctx.lineWidth = W * 0.05;
  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.lineTo(cx + (r() - 0.5) * 10, base - H * 0.75);
  ctx.stroke();
  const browns = ['#7a4f33', '#8f6040', '#a27450', '#5f4030', '#b08058'];
  for (let i = 0; i < 1400; i++) {
    const t = 0.15 + Math.pow(r(), 0.8) * 0.8;
    const spread = W * 0.45 * Math.sin(t * Math.PI) * (0.6 + 0.4 * r());
    const x = cx + (r() - 0.5) * 2 * spread;
    const y = base - t * H * 0.95;
    ctx.fillStyle = pickOf(r, browns);
    ctx.globalAlpha = 0.5 + r() * 0.5;
    ctx.fillRect(x, y, 2 + r() * 3, 1.5 + r() * 2);
  }
  ctx.globalAlpha = 1;
  // a few twigs showing through
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 25; i++) {
    const y = base - (0.2 + r() * 0.7) * H;
    ctx.beginPath();
    ctx.moveTo(cx, y);
    ctx.lineTo(cx + (r() - 0.5) * W * 0.9, y - r() * 40);
    ctx.stroke();
  }
}

/** A tuft of dry grass, now and then with a bramble arching over it. */
function tuft(ctx: Ctx, x0: number, y0: number, W: number, H: number, r: Rand, lush: boolean) {
  const straw = ['#b8995c', '#9c7a45', '#7e6238', '#c9b07a', '#6a5634'];
  const green = lush ? ['#4f7a2a', '#6d9636', '#3b5e22', '#8cae4a'] : ['#5c6a33', '#72803e', '#48562a'];
  const base = y0 + H - 2;
  const blades = 70 + Math.floor(r() * 60);
  for (let i = 0; i < blades; i++) {
    const x = x0 + W * (0.2 + r() * 0.6);
    const h = H * (0.3 + r() * 0.65);
    const lean = (r() - 0.5) * W * 0.5;
    ctx.strokeStyle = r() < (lush ? 0.85 : 0.2) ? pickOf(r, green) : pickOf(r, straw);
    ctx.lineWidth = 0.8 + r() * 1.4;
    ctx.globalAlpha = 0.7 + r() * 0.3;
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.quadraticCurveTo(x + lean * 0.3, base - h * 0.6, x + lean, base - h);
    ctx.stroke();
  }
  if (r() < 0.35) {
    ctx.strokeStyle = '#4a2f2a';
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.85;
    const x = x0 + W * (0.25 + r() * 0.2);
    ctx.beginPath();
    ctx.moveTo(x, base);
    ctx.bezierCurveTo(x + W * 0.1, base - H * 0.9, x + W * 0.45, base - H * 0.9, x + W * (0.55 + r() * 0.2), base - H * 0.2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** Paint a seed's atlas. */
export function paintAtlas(seed: number): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const ctx = canvas.getContext('2d')!;
  const sprites: Sprite[] = [];
  const keys: Record<SpriteKey, number[]> = { birch: [], birchBare: [], bare: [], beech: [], tuft: [], tuftGreen: [] };
  const add = (key: SpriteKey, x: number, y: number, w: number, h: number) => {
    keys[key].push(sprites.length);
    sprites.push({ u0: x / ATLAS, v0: y / ATLAS, u1: (x + w) / ATLAS, v1: (y + h) / ATLAS, aspect: w / h });
  };
  const r = (i: number) => seeded(hash(seed, 101, i));
  // row 0: six leafy birches, two bare ones
  for (let i = 0; i < 8; i++) {
    const leafy = i < 6;
    birch(ctx, i * CW, 0, CW, CH, r(i), leafy);
    add(leafy ? 'birch' : 'birchBare', i * CW, 0, CW, CH);
  }
  // row 1: three wide bare trees, two beeches
  for (let i = 0; i < 3; i++) {
    bare(ctx, i * 2 * CW, CH, 2 * CW, CH, r(20 + i));
    add('bare', i * 2 * CW, CH, 2 * CW, CH);
  }
  for (let i = 0; i < 2; i++) {
    beech(ctx, (6 + i) * CW, CH, CW, CH, r(30 + i));
    add('beech', (6 + i) * CW, CH, CW, CH);
  }
  // below: 32 tufts, dry straw and green
  for (let i = 0; i < 32; i++) {
    const x = (i % 8) * CW;
    const y = 2 * CH + Math.floor(i / 8) * 128;
    const lush = i % 2 === 1;
    tuft(ctx, x, y, CW, 128, r(40 + i), lush);
    add(lush ? 'tuftGreen' : 'tuft', x, y, CW, 128);
  }
  return { canvas, sprites, keys };
}
