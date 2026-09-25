/* ---------------------------------------------------------------------------
 * image — pictures from a model that only recognises (pure; no DOM).
 *
 * Measured (jev-1.13.0, 2026-09-25): asked pixel by pixel ("colour of (r,c)
 * for a yellow smiley on black?") Jev paints noise — mostly white, mean
 * confidence 0.39, 1/32 cells above 0.55. Shown WHOLE 8×8 grids it recognises
 * sharply: the smiley 0.82 vs square/cross/random 0.01; a cross 0.84 vs ≤0.04.
 * Same lesson as free text: Jev can't draw, but it knows a picture on sight.
 *
 *   scene     one call: background + up to 3 typed layers (shape, colour)
 *             chosen from closed vocabularies — the prompt's structure
 *   variants  code renders every placement/size of those layers (≤256)
 *   score     one decide_many: a noul per whole grid, "does this depict …?"
 *   evolve    code mutates the best few (shift, grow, shrink, recolour, flip
 *             edge pixels); one more scoring pass keeps the winner
 * ------------------------------------------------------------------------- */
import { choiceOf, type Answers, type Questions } from './types';

export const N = 8;
export const PALETTE = ['.', '#', 'R', 'G', 'B', 'Y', 'O', 'P', 'N'] as const;
export type Color = (typeof PALETTE)[number];
export const COLOR_NAMES: Record<Color, string> = {
  '.': 'black',
  '#': 'white',
  R: 'red',
  G: 'green',
  B: 'blue',
  Y: 'yellow',
  O: 'orange',
  P: 'purple',
  N: 'brown',
};
const BY_NAME: Record<string, Color> = Object.fromEntries(Object.entries(COLOR_NAMES).map(([k, v]) => [v, k as Color]));
export const LEGEND = `Each string is one row, top to bottom. Symbols: ${PALETTE.map((c) => `${c} ${COLOR_NAMES[c]}`).join(', ')}.`;

export type Grid = Color[][];

export const SHAPES: Record<string, string> = {
  none: 'no further element',
  disc: 'a filled circle or ball',
  ring: 'a circle outline',
  square: 'a filled square or box',
  cross: 'a thick plus / cross',
  x: 'a diagonal X',
  triangle: 'a triangle pointing up (tree top, mountain, roof)',
  trunk: 'a short vertical bar (tree trunk, pole, stem)',
  ground: 'a horizontal band along the bottom (ground, grass, sea)',
  sky: 'a horizontal band along the top (sky)',
  stripe: 'a horizontal stripe through the middle',
  face: 'eyes and a smiling mouth drawn on top of the previous element',
  dots: 'a few scattered dots (stars, snow, spots)',
  heart: 'a heart',
};

export interface Layer {
  shape: string;
  color: Color;
  /** centre, in cells; sizes are radii/half-widths. */
  cx: number;
  cy: number;
  size: number;
}
export interface Scene {
  bg: Color;
  layers: Layer[];
}

/* ── the scene call ────────────────────────────────────────────────────── */

const COLOR_OPTIONS = PALETTE.map((c) => COLOR_NAMES[c]);
export const MAX_LAYERS = 3;

export function sceneQuestions(): Questions {
  const qs: Questions = { bg: choiceOf('What is the background colour of this picture?', COLOR_OPTIONS) };
  for (let i = 0; i < MAX_LAYERS; i++) {
    const which = ['main', 'second', 'third'][i];
    qs[`shape${i}`] = { type: 'choice', instructions: `Drawn on the background in order: what is the ${which} element of this picture?`, criteria: { ...SHAPES } };
    qs[`color${i}`] = choiceOf(`What colour is the ${which} element?`, COLOR_OPTIONS);
  }
  return qs;
}

export interface SceneChoice {
  bg: Color;
  layers: Array<{ shape: string; color: Color }>;
}

export function sceneFrom(a: Answers): SceneChoice {
  const col = (k: string, d: Color): Color => BY_NAME[a[k]?.choice ?? ''] ?? d;
  const bg = col('bg', '.');
  const layers: Array<{ shape: string; color: Color }> = [];
  for (let i = 0; i < MAX_LAYERS; i++) {
    const shape = a[`shape${i}`]?.choice ?? 'none';
    if (shape === 'none') break;
    const color = col(`color${i}`, '#');
    // A face implies a head: eval — "yellow smiley on black" chose face FIRST
    // and drew nothing. Put a disc of that colour under it; the face inks black.
    if (shape === 'face' && !layers.some((l) => l.shape === 'disc' || l.shape === 'square')) {
      layers.push({ shape: 'disc', color: color === bg ? '#' : color });
      layers.push({ shape: 'face', color: '.' });
      continue;
    }
    // A layer in the background colour erases what came before ("white cross +
    // black cross" drew a blob) — a no-op at best, so it is dropped.
    if (color === bg && shape !== 'face') continue;
    // The same element twice adds nothing ("face, face, face").
    if (layers.some((l) => l.shape === shape && (l.color === color || shape === 'face'))) continue;
    layers.push({ shape, color });
  }
  return { bg, layers };
}

/* ── rendering ─────────────────────────────────────────────────────────── */

export function blank(bg: Color): Grid {
  return Array.from({ length: N }, () => Array<Color>(N).fill(bg));
}

const inside = (x: number, y: number) => x >= 0 && x < N && y >= 0 && y < N;

/** Paint one layer onto a grid (in place). Coordinates are cell centres; size ≥ 1. */
export function paint(g: Grid, L: Layer, under?: Layer): void {
  const set = (x: number, y: number, c: Color = L.color) => {
    if (inside(x, y)) g[y][x] = c;
  };
  const { cx, cy, size: s } = L;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const d = Math.hypot(dx, dy);
      switch (L.shape) {
        case 'disc':
          if (d <= s) set(x, y);
          break;
        case 'ring':
          if (d <= s && d > s - 1.1) set(x, y);
          break;
        case 'square':
          if (Math.abs(dx) <= s && Math.abs(dy) <= s) set(x, y);
          break;
        case 'cross':
          if ((Math.abs(dx) <= 1 && Math.abs(dy) <= s) || (Math.abs(dy) <= 1 && Math.abs(dx) <= s)) set(x, y);
          break;
        case 'x':
          if (Math.abs(Math.abs(dx) - Math.abs(dy)) < 0.8 && Math.abs(dx) <= s) set(x, y);
          break;
        case 'triangle':
          // apex at top (cy - s), base at cy + s
          if (dy >= -s && dy <= s && Math.abs(dx) <= ((dy + s) / (2 * s)) * s + 0.5) set(x, y);
          break;
        case 'trunk':
          if (Math.abs(dx) <= 0.6 && dy >= -s && dy <= s) set(x, y);
          break;
        case 'ground':
          if (y >= N - s) set(x, y);
          break;
        case 'sky':
          if (y < s) set(x, y);
          break;
        case 'stripe':
          if (Math.abs(dy) <= s / 2 + 0.01) set(x, y);
          break;
        case 'heart': {
          const u = dx / s;
          const v = -dy / s;
          if (Math.pow(u * u + v * v - 1, 3) - u * u * v * v * v <= 0) set(x, y);
          break;
        }
      }
    }
  if (L.shape === 'dots') {
    const pts = [
      [1, 1],
      [5, 2],
      [2, 5],
      [6, 6],
      [4, 0],
      [0, 4],
    ].slice(0, Math.max(2, Math.min(6, s + 2)));
    for (const [x, y] of pts) set((x + Math.round(cx)) % N, (y + Math.round(cy)) % N);
  }
  if (L.shape === 'face' && under) {
    // Two eyes above centre, a smile below: corners one row up, a flat middle.
    const ink = L.color === under.color ? '.' : L.color;
    const r = under.size;
    const eyeY = Math.floor(under.cy - Math.max(1, r / 3));
    const mouthY = Math.floor(under.cy + Math.max(1, r / 3));
    const left = Math.floor(under.cx - Math.max(1, r / 2));
    const right = Math.floor(under.cx + Math.max(1, r / 2)) - (r >= 3 ? 1 : 0);
    set(left, eyeY, ink);
    set(right, eyeY, ink);
    for (let x = left + 1; x <= right - 1; x++) set(x, mouthY, ink);
    set(left, mouthY - 1, ink);
    set(right, mouthY - 1, ink);
  }
}

export function render(s: Scene): Grid {
  const g = blank(s.bg);
  s.layers.forEach((L, i) => paint(g, L, s.layers[i - 1]));
  return g;
}

export const rows = (g: Grid): string[] => g.map((r) => r.join(''));
export const key = (g: Grid): string => rows(g).join('/');

/* ── variants: every placement/size of the chosen layers ───────────────── */

/** Where each shape sensibly sits, and how big it can be. */
function placements(shape: string): Array<{ cx: number; cy: number; size: number }> {
  const out: Array<{ cx: number; cy: number; size: number }> = [];
  const centres = [3, 4, 5];
  if (shape === 'ground' || shape === 'sky') for (const s of [1, 2, 3, 4]) out.push({ cx: 4, cy: 4, size: s });
  else if (shape === 'stripe') for (const cy of [3, 4, 5]) for (const s of [1, 2, 3]) out.push({ cx: 4, cy, size: s });
  else if (shape === 'face') out.push({ cx: 4, cy: 4, size: 1 });
  else if (shape === 'trunk') for (const cx of [3.5, 4.5]) for (const cy of [5.5, 6.5]) for (const s of [1, 2]) out.push({ cx, cy, size: s });
  else if (shape === 'dots') for (const s of [2, 4]) out.push({ cx: 0, cy: 0, size: s });
  else {
    for (const cx of centres)
      for (const cy of [...centres, 2])
        for (const s of shape === 'triangle' ? [2, 3] : [1.5, 2.5, 3, 3.5]) out.push({ cx, cy, size: s });
    // Small corner placements (a sun in the sky, a moon, a logo in the corner).
    if (shape === 'disc' || shape === 'square' || shape === 'ring')
      for (const cx of [1.5, 6.5]) for (const cy of [1.5, 2.5]) for (const s of [1, 1.5]) out.push({ cx, cy, size: s });
  }
  return out;
}

/** Smallest radius a face can be drawn on legibly (eval: shrunk heads were ink blots). */
export const MIN_FACE_HEAD = 3;

/** The cartesian product of each layer's placements, deduplicated by picture, capped. */
export function variants(sc: SceneChoice, cap = 256): Scene[] {
  let partial: Scene[] = [{ bg: sc.bg, layers: [] }];
  sc.layers.forEach((L, i) => {
    // A head that carries a face must be big enough to hold one.
    const carriesFace = sc.layers[i + 1]?.shape === 'face';
    const pls = placements(L.shape).filter((pl) => !carriesFace || pl.size >= MIN_FACE_HEAD);
    const next: Scene[] = [];
    for (const p of partial) for (const pl of pls) next.push({ bg: p.bg, layers: [...p.layers, { shape: L.shape, color: L.color, ...pl }] });
    partial = next;
  });
  const seen = new Set<string>();
  const out: Scene[] = [];
  // Spread the cap across the space: stride rather than truncate.
  const stride = Math.max(1, Math.floor(partial.length / cap));
  for (let i = 0; i < partial.length && out.length < cap; i += stride) {
    const k = key(render(partial[i]));
    if (!seen.has(k)) {
      seen.add(k);
      out.push(partial[i]);
    }
  }
  return out;
}

/* ── mutation: local moves around a good picture ───────────────────────── */

export function mutations(s: Scene, perScene = 24): Grid[] {
  const out: Grid[] = [];
  const push = (sc: Scene) => out.push(render(sc));
  s.layers.forEach((L, i) => {
    const withL = (nl: Partial<Layer>) => ({ ...s, layers: s.layers.map((x, j) => (j === i ? { ...x, ...nl } : x)) });
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      push(withL({ cx: L.cx + dx, cy: L.cy + dy }));
    push(withL({ size: L.size + 0.5 }));
    const floor = s.layers[i + 1]?.shape === 'face' ? MIN_FACE_HEAD : 0.5;
    if (L.size - 0.5 >= floor) push(withL({ size: L.size - 0.5 }));
  });
  // Pixel edits at the boundary of each region: flip a cell to a neighbour's colour.
  const g = render(s);
  for (let y = 0; y < N && out.length < perScene; y++)
    for (let x = 0; x < N && out.length < perScene; x++) {
      const nb = [
        [x + 1, y],
        [x, y + 1],
      ].filter(([a, b]) => inside(a, b) && g[b][a] !== g[y][x]);
      for (const [a, b] of nb) {
        const h = g.map((r) => [...r]);
        h[y][x] = g[b][a];
        out.push(h);
      }
    }
  return out.slice(0, perScene);
}

/* ── scoring: whole-picture recognition ────────────────────────────────── */

export const NOULS_PER_ITEM = 32;

/** decide_many items scoring each grid against the prompt (one noul per grid). */
export function scoreItems(prompt: string, grids: Grid[]): Array<{ state: unknown; questions: Questions }> {
  const items: Array<{ state: unknown; questions: Questions }> = [];
  for (let i = 0; i < grids.length; i += NOULS_PER_ITEM) {
    const qs: Questions = {};
    grids.slice(i, i + NOULS_PER_ITEM).forEach((g, j) => {
      qs[`g${i + j}`] = { type: 'noul', instructions: `The picture is: ${rows(g).join(' / ')}. Does this ${N}×${N} picture clearly depict "${prompt}"?` };
    });
    items.push({ state: { prompt, legend: LEGEND }, questions: qs });
  }
  return items;
}

export function scoresFrom(res: Array<Answers | null>, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(res[Math.floor(i / NOULS_PER_ITEM)]?.[`g${i}`]?.noul ?? 0);
  return out;
}

/* ── contrastive final ─────────────────────────────────────────────────────
 * Independent nouls are lenient for pictures (a blob scored 0.82 as "a white
 * cross"). Comparison is sharper: one choice over the finalists, each option
 * described by its rows, asks which depicts the prompt BEST. */

const LABELS = 'ABCDEFGHIJKL'.split('');
export const FINAL_DECISIVE = 0.4;
export function finalQuestion(prompt: string, grids: Grid[]): Questions {
  return {
    best: {
      type: 'choice',
      instructions: `Which of these ${N}×${N} pictures depicts "${prompt}" BEST? Each option is its rows, top to bottom.`,
      criteria: Object.fromEntries(grids.slice(0, LABELS.length).map((g, i) => [LABELS[i], rows(g).join(' / ')])),
    },
  };
}
export function finalPick(a: Answers, n: number): { index: number; p: number } {
  const probs = a.best?.probabilities ?? {};
  let index = 0;
  let p = -1;
  for (let i = 0; i < Math.min(n, LABELS.length); i++) {
    const q = probs[LABELS[i]] ?? (a.best?.choice === LABELS[i] ? a.best?.confidence ?? 0 : 0);
    if (q > p) {
      p = q;
      index = i;
    }
  }
  return { index, p: Math.max(0, p) };
}

/* ── the loop ──────────────────────────────────────────────────────────── */

export interface ImageDeps {
  decide(state: unknown, questions: Questions, label: string): Promise<Answers>;
  decideMany(items: Array<{ state: unknown; questions: Questions }>, label: string): Promise<Array<Answers | null>>;
}
export interface Scored {
  grid: Grid;
  score: number;
}
export type ImageEvent =
  | { type: 'scene'; scene: SceneChoice }
  | { type: 'round'; name: string; tried: number; best: Scored[] };

/** Prompt → picture: scene (1 call) → variants scored (1 call) → mutations scored (1 call). */
export async function draw(prompt: string, d: ImageDeps, onEvent?: (e: ImageEvent) => void): Promise<{ best: Scored; top: Scored[]; scene: SceneChoice }> {
  const sc = sceneFrom(await d.decide({ prompt }, sceneQuestions(), 'image:scene'));
  onEvent?.({ type: 'scene', scene: sc });
  const scenes = variants(sc);
  const grids = scenes.map(render);
  const s1 = scoresFrom(await d.decideMany(scoreItems(prompt, grids), `image:score ×${grids.length}`), grids.length);
  const ranked = scenes.map((s, i) => ({ s, grid: grids[i], score: s1[i] })).sort((a, b) => b.score - a.score);
  onEvent?.({ type: 'round', name: 'variants', tried: grids.length, best: ranked.slice(0, 6).map(({ grid, score }) => ({ grid, score })) });

  // Evolve: local moves around the best few, scored in one more pass.
  const seen = new Set(grids.map(key));
  const kids = ranked.slice(0, 6).flatMap((r) => mutations(r.s)).filter((g) => (seen.has(key(g)) ? false : (seen.add(key(g)), true)));
  const s2 = kids.length ? scoresFrom(await d.decideMany(scoreItems(prompt, kids), `image:evolve ×${kids.length}`), kids.length) : [];
  const all: Scored[] = [...ranked.map(({ grid, score }) => ({ grid, score })), ...kids.map((grid, i) => ({ grid, score: s2[i] }))].sort((a, b) => b.score - a.score);
  onEvent?.({ type: 'round', name: 'evolve', tried: kids.length, best: all.slice(0, 6) });

  // Contrastive final over the top 12 distinct pictures.
  const finalists = all.slice(0, LABELS.length);
  const pick = finalists.length > 1 ? finalPick(await d.decide({ prompt, legend: LEGEND }, finalQuestion(prompt, finalists.map((f) => f.grid)), 'image:final'), finalists.length) : { index: 0, p: 1 };
  // The comparison overrides the independent scores only when it is decisive
  // (eval: an unsure final, p≈0.2, swapped a 0.71 smiley for a 0.59 one).
  const best = pick.p >= FINAL_DECISIVE ? finalists[pick.index] ?? all[0] : all[0];
  const top = [best, ...all.filter((x) => x !== best)].slice(0, 6);
  onEvent?.({ type: 'round', name: 'final', tried: finalists.length, best: top });
  return { best, top, scene: sc };
}
