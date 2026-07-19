/* ---------------------------------------------------------------------------
 * graph/style.ts — colour, typography, edge grammar, and the DOI signal.
 *
 * The pure presentation vocabulary the renderer reads: type→hue, type→
 * letterform (the map-reading trick), edge styling, and Furnas degree-of-
 * interest. No three.js, no DOM state — extracted from graph.tsx
 * (decomposition, 2026-07-17). The runtime typography map (`_config/typography`)
 * is set by data.fetchGraphMeta via setTypeGroup().
 * ------------------------------------------------------------------------- */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ink } from '../ink';
import type { GEdge } from './data';

export const hueOf = (t: string): number => {
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
  return h;
};
export const nodeColor = (t: string | null): string => (t ? `hsl(${hueOf(t)} 42% 55%)` : '#9a917f');

// Typography carries ONTOLOGY (the map-reading trick: a river and a road are
// distinguishable by letterform alone). Hue already codes type on the dots;
// letterform repeats it on the labels, so the coding survives at label-only
// zoom. The type→letterform mapping is DATA, not code — the type vocabulary
// evolves at runtime, so a hardcoded set is stale the day it ships. It lives
// in the `_config/typography` fact ({ groups: { <type>: 'act'|'doc'|'kb' } },
// the `_config/suggestions` precedent), loaded with the graph model and
// editable like any fact; unmapped types stay instrument mono.
export const TYPE_SERIF = 'Georgia,"Iowan Old Style","Palatino Linotype",serif';
let TYPE_GROUP: Record<string, string> = {};
/** Install the runtime type→letterform map (from `_config/typography`). */
export const setTypeGroup = (g: Record<string, string>): void => { TYPE_GROUP = g; };
export const typeGroup = (t: string | null): string => (t && TYPE_GROUP[t]) || 'mono';
// SDF font files for the in-scene labels (troika needs real font URLs —
// .woff, not woff2). One face per group; weight/emphasis is carried by
// size, colour, and opacity (the role grade), not by extra font files.
export const FONT_BY_GROUP: Record<string, string> = {
  act: 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.1.0/files/ibm-plex-sans-latin-600-normal.woff',
  doc: 'https://cdn.jsdelivr.net/npm/@fontsource/source-serif-4@5.1.0/files/source-serif-4-latin-400-italic.woff',
  kb: 'https://cdn.jsdelivr.net/npm/@fontsource/source-serif-4@5.1.0/files/source-serif-4-latin-400-normal.woff',
  mono: 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5.1.0/files/ibm-plex-mono-latin-500-normal.woff',
};
// Knockout halo: thin text must survive sitting over a bloom core.
export const LABEL_HALO = 'text-shadow:0 1px 3px #000,0 -1px 3px #000,1px 0 3px #000,-1px 0 3px #000,0 0 2px #000';

// A name fit to stand for a PLACE (or hold an orientation anchor): human
// words, not machine keys. "Design Models world time" qualifies; a run key
// like "machine/weave/run/2026-07-01T21…" is data, not a toponym — first
// screenshots put exactly those in 24px caps across the map.
export const placeworthy = (s: string | null | undefined): boolean =>
  !!s && s.length >= 3 && !s.includes('/') && !/\d{4}-\d{2}/.test(s);

export const MEMBER_RELS = new Set(['onBoard', 'inDoc', 'inView']);
// Warm-light strokes — a dark #5a5142 vanished into the dusk background. Base
// opacities are the CEILING an edge reaches at full interest; at rest the DOI
// scaling below keeps the mat far quieter (the ~9k-edge slice was drowning the
// nodes in a beige wash — figure/ground collapse).
export interface EdgeStyle { stroke: string; dash: number[] | null; opacity: number; width: number }
export function edgeStyle(e: GEdge): EdgeStyle {
  if (e.rel === 'similarTo') return { stroke: ink.edge, dash: null, opacity: 0.06, width: 1 };
  if (MEMBER_RELS.has(e.rel)) return { stroke: ink.edge, dash: [2, 3], opacity: 0.22, width: 1 };
  if (e.derived) return { stroke: ink.edge, dash: [3, 3], opacity: 0.18, width: 1 };
  return { stroke: ink.edgeAuthored, dash: null, opacity: 0.45, width: 1.5 };
}

/**
 * Degree-of-Interest (Furnas) — ONE continuous [0,1] emphasis per node, the
 * unified "focus+context" signal that drives opacity, size, labels, and edge
 * brightness alike (so they can't disagree). It blends intrinsic salience with
 * graph-focus (the current selection/highlight neighbourhood). The renderer
 * layers its SPATIAL focal falloff (the torch) on top. Selection lifts a
 * node's DOI above any spatial penalty, so a selected node's neighbour reads as
 * focused even when it's far from the camera (the disagreement the old stacked
 * dimmers had).
 */
export function nodeDOI(n: any, selKey: string | null, nbr: Set<string> | null, hiSet: Set<string> | null, N: number): number {
  const salN = 1 - (n.rank ?? N) / Math.max(1, N); // 1 = most salient
  const resting = 0.12 + 0.88 * salN * salN; // salience-graded resting emphasis (steep, so the top pops)
  // Selection is ADDITIVE, not subtractive: the selected star and its
  // neighbours are lifted, but the rest of the field keeps its resting
  // brightness — a selection makes ONE thing prominent, it does not black out
  // everything else (owner: "selected items dim the rest too much").
  if (selKey) return n.id === selKey ? 1 : nbr?.has(n.id) ? Math.max(0.8, resting) : resting;
  if (hiSet) return hiSet.has(n.id) ? 1 : resting;
  return resting;
}

// Generous cap — SDF labels WRAP now (maxWidth), so a longer title becomes
// two or three centred lines instead of an ellipsis at 26 chars.
export const shortLabel = (s: string): string => (s.length > 44 ? s.slice(0, 43) + '…' : s);
