/**
 * The fill on its own, in shapes other than a seal: the same engine and style that fill a seal's
 * interior fill a ring, a box, a frame, four corners, a lens — each with a label whose safe zone
 * is sized to its words. This is how borders and corner pieces are made for the cards.
 */
import { hash } from '../kit/rng';
import { shapeOutline, type Shape, type Sym } from './field';
import type { FillResult, Mark } from './ornament';
import { ornate } from './structure';
import { overlaySvg, sample, textZone } from './seal';
import type { Style } from './styles';

export const SHAPE_KINDS = ['circle', 'ring', 'box', 'frame', 'corners', 'lens'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** a shape's region and the symmetry it fills under, in a 120-unit square centred on 0,0 */
export function shapeOf(kind: ShapeKind, fold: number): { region: Shape; sym: Sym; lines: Shape[] } {
  const c: [number, number] = [0, 0];
  const d2: Sym = { kind: 'd2', c }, rot: Sym = { kind: 'rot', c, fold };
  switch (kind) {
    case 'circle': return { region: { k: 'circle', c, r: 54 }, sym: rot, lines: [{ k: 'circle', c, r: 55 }] };
    case 'ring': return { region: { k: 'ring', c, r0: 30, r1: 54 }, sym: rot, lines: [{ k: 'circle', c, r: 55 }, { k: 'circle', c, r: 29 }] };
    case 'box': return { region: { k: 'box', c, hw: 52, hh: 52, rx: 6 }, sym: d2, lines: [{ k: 'box', c, hw: 53, hh: 53, rx: 7 }] };
    case 'frame': {
      const outer: Shape = { k: 'box', c, hw: 53, hh: 53, rx: 5 }, inner: Shape = { k: 'box', c, hw: 39, hh: 39, rx: 2 };
      return { region: { k: 'diff', a: { k: 'grow', s: outer, by: -1 }, minus: [{ k: 'grow', s: inner, by: 1 }] }, sym: d2, lines: [outer, inner] };
    }
    case 'corners': {
      const box: Shape = { k: 'box', c, hw: 53, hh: 53, rx: 3 };
      return { region: { k: 'union', of: [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => ({ k: 'inter', of: [{ k: 'circle', c: [sx * 53, sy * 53], r: 30 }, { k: 'grow', s: box, by: -1 }] }) as Shape) }, sym: d2, lines: [box] };
    }
    case 'lens': {
      const a: Shape = { k: 'circle', c: [-24, 0], r: 54 }, b: Shape = { k: 'circle', c: [24, 0], r: 54 };
      return { region: { k: 'grow', s: { k: 'inter', of: [a, b] }, by: -1 }, sym: d2, lines: [{ k: 'inter', of: [a, b] }] };
    }
  }
}

/** one shape, filled, with its label; returns the SVG and the fill (for its numbers) */
export function shapeTile(o: { kind: ShapeKind; style: Style; seed: number; label: string; overlay?: boolean; zones?: boolean }): { svg: string; fill: FillResult } {
  const s = sample(o.style, o.seed);
  const { region, sym, lines } = shapeOf(o.kind, [4, 8, 12].includes(s.fold) ? s.fold : 4);
  const size = 8;
  const zones: Shape[] = o.label ? [{ k: 'grow', s: textZone(0, size * 0.34, o.label, size, 0.8), by: s.zoneMargin }] : [];
  const { structure: st, fill: res } = ornate({ region, zones, sym, style: s, seed: hash(o.seed, 0x5a9e, SHAPE_KINDS.indexOf(o.kind)), k: 1, centre: [0, 0], stats: true });
  const col = (x?: string) => (x === 'ink' ? s.ink : x === 'paper' ? s.paper : 'none');
  const svgOf = (m: Mark) => m.k === 'circle'
    ? `<circle cx="${m.x}" cy="${m.y}" r="${m.r}" fill="${col(m.fill)}"${m.w > 0 ? ` stroke="${s.ink}" stroke-width="${m.w}"` : ''}/>`
    : m.k === 'path' ? `<path d="${m.d}" fill="${col(m.fill)}"${m.w > 0 ? ` stroke="${s.ink}" stroke-width="${m.w}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>` : '';
  const id = `sh${o.kind}${o.seed}`;
  const clipped = st.marks.filter((m) => 'clip' in m && m.clip).map(svgOf).join('');
  const marks = `<clipPath id="${id}"><path d="${st.clip}" clip-rule="evenodd"/></clipPath><g clip-path="url(#${id})">${clipped}</g>${st.marks.filter((m) => !('clip' in m && m.clip)).map(svgOf).join('')}${res.marks.map(svgOf).join('')}`;
  const outline = '';
  void lines; void shapeOutline;
  const label = o.label ? `<text x="0" y="${size * 0.34}" text-anchor="middle" font-size="${size}" letter-spacing=".8" font-family="Georgia,'Times New Roman',serif" fill="${s.ink}">${o.label.replace(/[<&]/g, '')}</text>` : '';
  const over = o.overlay || o.zones ? overlaySvg(o.overlay ? res.discs : [], zones, 0.25) : '';
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-60 -60 120 120"><rect x="-60" y="-60" width="120" height="120" fill="${s.paper}"/><g opacity="${s.faint}">${outline}${marks}</g>${label}${over}</svg>`, fill: res };
}
