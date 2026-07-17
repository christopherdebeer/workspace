/**
 * The signed-in surface's DARK theme — one source of truth for the graph, the
 * field computer, and everything floating over the dusk canvas. @parc/ui's
 * `theme` is the parchment (light) vocabulary the landing page and fact
 * viewers speak; the graph workspace is a night surface, and before this
 * module each overlay hardcoded its own copy of these values (palette.tsx's
 * local `ink`, graph.tsx stroke literals, app.tsx's boundary fallback) — three
 * palettes that could drift. Now they can't.
 */
export const ink = {
  /** Surface stack: bar/sheet chrome (bg → panel), hairlines, type. */
  bg: '#181511',
  panel: '#221d16',
  line: '#3d362b',
  text: '#efe9dc',
  dim: '#9a917f',
  accent: '#f5c453',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  /** The graph scene: the night ground and the warm-light strokes drawn on it. */
  sceneBg: '#1b1710',
  edge: '#cfc4aa',
  edgeAuthored: '#e8ddc2',
  danger: '#e8a0a0',
} as const;

/** Coarse-pointer (touch) probe — SSR-safe (false on the server; callers that
 *  render differently by it must defer to a post-mount effect so hydration
 *  matches). */
export const isCoarsePointer = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
