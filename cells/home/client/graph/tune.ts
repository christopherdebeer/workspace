/* ---------------------------------------------------------------------------
 * graph/tune.ts — scene tunables (?tune=1 mounts a live panel; ?tune=0 clears).
 *
 * Every hand-tuned constant of the torch/beam/label/edge/bloom system, in one
 * mutable object. The tuner (lil-gui, esm.sh) writes here, persists overrides
 * to localStorage, and pokes the refresh hooks — so feel can be dialled on a
 * PHONE against live data, then the winning values sent back to be hard-coded.
 *
 * Extracted from graph.tsx (decomposition, 2026-07-17) — the tuning surface is
 * data, not render logic, so it lives on its own.
 * ------------------------------------------------------------------------- */
export const TUNE_DEFAULTS = {
  // torch (the scene LIGHTING — owner re-grade 2026-07-12: coneIn/depthIn at 0
  // means the full-brightness plateau starts AT the focal point itself — no
  // graded falloff onset, angle/depth attenuation begin immediately. Floor
  // lowered to 0.09 (was 0.2): the periphery goes darker before the torch
  // picks it up, sharpening the beam's contrast against the rest.)
  coneIn: 0, coneOut: 1.2, depthIn: 0, depthOut: 4, torchFloor: 0.09,
  // label admission (the SELECTOR) — decoupled from the lighting: labels need
  // a sharp instrument even when the light is flat, so admission ranks by its
  // own narrow cone. Owner re-grade 2026-07-12: labelConeOut widened to 1.2
  // (was 0.42) — admission now spans nearly the whole torch cone, not just
  // its dead-centre.
  labelConeIn: 0.02, labelConeOut: 1.2,
  // THE NAME BUDGET (the coupled-workspace co-sizing rule): ONE mind-sized
  // ceiling on how many names are legible at once — the focus band the read
  // ignites into (docs/the-coupled-workspace.md §3; docs/home-graph-experience
  // .md §10). Every tier spends from this, so "how many labels" is a single
  // number tuned to the coupled mind, not a scatter of per-tier caps.
  // 0 = viewport default (mobile 16 / desktop 26 — a few dozen).
  focusBand: 0,
  // Landmarks (register 1) reserve this FRACTION of the band; the rest is the
  // suggestion remainder. So the resting sky is "a few steady names + the
  // whispered candidates that fill the leftover budget."
  landmarkFrac: 0.35,
  beamOn: 0.85, beamOff: 0.2,
  beamOpacity: 0.57, beamSizeMult: 0.3,
  // SUGGESTIONS are a DIFFERENT VOICE, not a small focus chip (the beam's
  // original sin: catches wore result styling, so unrelated items read as
  // answers). beamPill 0 = pill-less whisper — a suggestion never carries the
  // committed-name occluder chip that Landmarks/Focus wear. beamPerCell caps
  // suggestions PER SCREEN TERRITORY so a dense cluster can't monopolise the
  // whisper and starve a sparse region (per-place broadcast, mirrors slices).
  beamPill: 0, beamPerCell: 2,
  // focus labels (owner re-grade 2026-07-12): hits headline (1.17), and
  // neighbours now hold FULL opacity near and far (1/1, was 0.41/0.81) —
  // size still grades the role, opacity no longer does.
  selSizeMult: 0.8, hitSizeMult: 1.17, nbrSizeMult: 0.6, nbrOpFar: 1, nbrOpNear: 1,
  labelFade: 4, // lerp rate: higher = snappier (owner re-grade 2026-07-12: was 1/SLOW, now snappy)
  // nodes — neighbours barely lift (0.2): selection lights the ANCHOR, the
  // neighbourhood whispers; the fan edges carry the structure.
  nodeDim: 1.5, nbrBoost: 0.2, boostSizeGain: 1,
  // edges (owner re-grade 2026-07-12: brought back up from "all but erased" —
  // the resting lattice now reads at rest, authored edges especially (0.24,
  // was 0.035), with focus edges dialled back off full-alpha (0.76, was 1.0)
  // since the resting mat itself now carries more of the structure).
  edgeSimilar: 0.035, edgeMember: 0.06, edgeDerived: 0.06, edgeAuthored: 0.24,
  focusEdgeAlpha: 0.76,
  // flow (2026-07-12): a travelling pulse along FOCUS edges only (the ones
  // already fanning from a selection/hit) — direction is source→target, so
  // the animation reads as energy moving the way the edge actually points.
  // Resting edges stay static on purpose (the file's own standing rule:
  // "lines earn ink only under focus" — movement is the same kind of ink).
  // Dusk only: paper's printed-map metaphor has no motion to carry.
  edgeFlowSpeed: 0.5, edgeFlowWidth: 0.35, edgeFlowGain: 1.4, edgeFlowCycles: 3,
  // bloom — threshold restored to 0.6 (2026-07-12 regression fix): the
  // 2026-07-12 owner re-grade set this to 0.05, which — combined with
  // edgeAuthored's own bump to 0.24 that same pass and the corpus having
  // grown substantially since (ADR-0081's backfill) — reintroduced the
  // EXACT failure ensureComposer()'s own comment already documents: at a
  // threshold this low, the dense core's additive edge/point SUM blooms in
  // its entirety and clips to a white blob that swallows every label in it
  // (confirmed live: the "dusk regression" screenshots this session). 0.6
  // is the value that fixed it the first time — only genuinely bright
  // points/edges bloom, not the whole resting wash.
  bloomStrength: 1.06, bloomRadius: 0.43, bloomThreshold: 0.6, exposure: 0.7,
  bloomMode: 'on' as 'auto' | 'on' | 'off',
  // star render: 0 = soft disc, 1 = bright core + strong diffraction spikes.
  starSpike: 0.55,
  // scene mode: 'dusk' = the luminous dark field; 'paper' = a cartographic
  // star ATLAS — ink stars and fine linework on warm paper, bloom off.
  sceneMode: 'dusk' as 'dusk' | 'paper',
  // ATMOSPHERE (dusk only): the sky is not a flat void — a world-fixed dome
  // darkens from a faint warm horizon glow up to a deep zenith, so the horizon
  // stays level as you turn your head (the planetarium "which way is up" cue).
  // 0 = flat sceneBg (the old void); 1 = full gradient. Dark by design — never
  // blooms, never drowns a star.
  atmosphere: 0.7,
  // FAR-SIDE occlusion (orrery / the re-curled ball): how hard the far hemisphere
  // is hidden behind the near cap. 0 = the shell is fully transparent (see every
  // back-side star through it); 1 = OPAQUE — nothing beyond the horizon rim is
  // drawn at all (a hard clip past the rim, since additive glow can never be
  // fully faded by opacity alone). Rides the curl: only active on the ball.
  farOcclude: 1,
  // places (cartography): constellation captions — COMPUTED from salience
  // hubs + dominant types, with registered VIEWS as the authored layer — and
  // resting orientation anchors (top-salience node per screen region).
  // constNear/Far: approach-fade band as multiples of a cluster's radius —
  // captions read from afar and hand off to fact labels as you arrive.
  // places (owner grade #4): captions many and STRONG (a star atlas names
  // its constellations), tight approach band; anchors as micro-print star
  // names — many, tiny, full-opacity (celestial-chart typography).
  constCap: 32, constOpacity: 1, constNear: 0.5, constFar: 1.2,
  anchorCap: 32, anchorOpacity: 1, anchorSizeMult: 0.1,
  // in-scene label furniture. The name's backing is a DEPTH-ONLY CLIP (owner
  // 2026-07-20: "the observed background / just clipping") — it writes depth
  // but no colour, knocking the busy cloud/edges/labels out of a tight box so
  // the calm sky shows through behind the outlined glyphs. No veil, no chip.
  // pillClip 1 = on, 0 = off (text then reads straight over whatever's behind).
  // labelOutline gives the glyphs their edge definition over the cleared sky.
  pillClip: 1, labelOutline: 0.35,
  // LABEL SIZE is a FIXED SCREEN quantity (owner 2026-07-20: "labels should
  // have fixed size and only fade in/out"). Each label renders at exactly
  // labelPx × its role multiplier, regardless of depth or the node's own
  // radius — so a name never animates large→small and a salient hub doesn't
  // grow a billboard. In the planetarium every star sits at one distance, so
  // this reads as a steady, legible field that only fades in and out; in the
  // orrery the whole set scales together with the globe. labelPx is the one
  // global size dial; the per-role mults (sel/hit/nbr/anchor/beam) grade it.
  labelPx: 17,
  // ZOOM feel + drag momentum. Zoom is ONE continuous axis — telescope (fov) in
  // [0,Z_DOME], un/furl (curl) beyond it — so the two halves get their OWN input
  // sensitivity: magnifying can be geared apart from unfurling (a gesture
  // crossing the seam changes gears there). Both are multipliers on the shipped
  // pinch/wheel gains, so 1 = the current feel. dragMomentum is the glide's
  // per-frame friction: higher = the flung shell coasts longer (0.92 shipped).
  zoomFov: 1, zoomCurl: 1, dragMomentum: 0.92,
};
export const TUNE: typeof TUNE_DEFAULTS = { ...TUNE_DEFAULTS };
export const TUNE_LS = 'parc.home.tune';

// ── ONE declarative control list (the tuning surface as DATA) ───────────────
// Every knob's group + range + step, in one array both tuning surfaces read:
// the ?tune=1 lil-gui panel (graph.tsx) AND the command-palette tune panel
// (tune-panel.tsx). Adding a knob here lights it up in both places — no
// per-surface wiring to keep in sync. `live:'persist'` marks a value that tick/
// the input handlers read every frame (atmosphere, far-occlude, zoom feel), so
// changing it needs only a save, not a full scene re-grade; everything else
// routes through the renderer's refresh(). `options` makes it an enum select.
export interface TuneControl {
  key: keyof typeof TUNE_DEFAULTS;
  group: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  live?: 'persist';
  /** In the CURATED subset the palette shows inline by default (the few
   *  high-impact feel dials). The full set is one "more" tap away. */
  quick?: boolean;
}
export const TUNE_SCHEMA: readonly TuneControl[] = [
  { key: 'sceneMode', group: 'scene', label: 'scene', options: ['dusk', 'paper'] },
  { key: 'atmosphere', group: 'scene', label: 'atmosphere', min: 0, max: 1, step: 0.02, live: 'persist', quick: true },
  { key: 'farOcclude', group: 'scene', label: 'far occlude', min: 0, max: 1, step: 0.02, live: 'persist' },
  // zoom feel + momentum — read live in the input handlers / tick.
  { key: 'zoomFov', group: 'zoom & drag', label: 'fov sens', min: 0.2, max: 4, step: 0.05, live: 'persist', quick: true },
  { key: 'zoomCurl', group: 'zoom & drag', label: 'unfurl sens', min: 0.2, max: 4, step: 0.05, live: 'persist', quick: true },
  { key: 'dragMomentum', group: 'zoom & drag', label: 'drag momentum', min: 0.8, max: 0.99, step: 0.005, live: 'persist', quick: true },
  { key: 'coneIn', group: 'torch', min: 0, max: 0.5 },
  { key: 'coneOut', group: 'torch', min: 0.1, max: 1.2 },
  { key: 'depthIn', group: 'torch', min: 0, max: 1.5 },
  { key: 'depthOut', group: 'torch', min: 0.3, max: 4 },
  { key: 'torchFloor', group: 'torch', min: 0, max: 0.2, step: 0.005 },
  { key: 'focusBand', group: 'name budget', min: 0, max: 60, step: 1 },
  { key: 'landmarkFrac', group: 'name budget', min: 0, max: 0.8, step: 0.05 },
  { key: 'beamPerCell', group: 'name budget', min: 1, max: 5, step: 1 },
  { key: 'beamPill', group: 'name budget', min: 0, max: 1 },
  { key: 'labelConeIn', group: 'beam', min: 0.02, max: 0.5 },
  { key: 'labelConeOut', group: 'beam', min: 0.1, max: 1.2 },
  { key: 'beamOn', group: 'beam', min: 0.05, max: 0.9 },
  { key: 'beamOff', group: 'beam', min: 0.02, max: 0.8 },
  { key: 'beamOpacity', group: 'beam', min: 0, max: 1 },
  { key: 'beamSizeMult', group: 'beam', min: 0.3, max: 1.5 },
  { key: 'selSizeMult', group: 'labels', min: 0.8, max: 2.5 },
  { key: 'hitSizeMult', group: 'labels', min: 0.8, max: 2.5 },
  { key: 'nbrSizeMult', group: 'labels', min: 0.6, max: 2 },
  { key: 'nbrOpFar', group: 'labels', min: 0.1, max: 1 },
  { key: 'nbrOpNear', group: 'labels', min: 0.3, max: 1 },
  { key: 'labelFade', group: 'labels', min: 1, max: 20, step: 0.5 },
  { key: 'pillClip', group: 'labels', min: 0, max: 1, step: 1 },
  { key: 'labelOutline', group: 'labels', min: 0, max: 0.35, step: 0.005 },
  { key: 'labelPx', group: 'labels', min: 6, max: 40, step: 1, quick: true },
  { key: 'nodeDim', group: 'nodes', min: 0.1, max: 3, quick: true },
  { key: 'nbrBoost', group: 'nodes', min: 0, max: 1 },
  { key: 'boostSizeGain', group: 'nodes', min: 0, max: 1.5 },
  { key: 'starSpike', group: 'nodes', min: 0, max: 1 },
  { key: 'edgeSimilar', group: 'edges', min: 0, max: 0.3, step: 0.005 },
  { key: 'edgeMember', group: 'edges', min: 0, max: 0.5, step: 0.005 },
  { key: 'edgeDerived', group: 'edges', min: 0, max: 0.5, step: 0.005 },
  { key: 'edgeAuthored', group: 'edges', min: 0, max: 1, step: 0.005 },
  { key: 'focusEdgeAlpha', group: 'edges', min: 0, max: 1 },
  { key: 'edgeFlowSpeed', group: 'edges', min: 0, max: 2, step: 0.05 },
  { key: 'edgeFlowWidth', group: 'edges', min: 0.05, max: 0.5, step: 0.01 },
  { key: 'edgeFlowGain', group: 'edges', min: 0, max: 3, step: 0.05 },
  { key: 'edgeFlowCycles', group: 'edges', min: 1, max: 8, step: 1 },
  { key: 'constCap', group: 'places', min: 0, max: 32, step: 1 },
  { key: 'constOpacity', group: 'places', min: 0, max: 1 },
  { key: 'constNear', group: 'places', min: 0.2, max: 2.5 },
  { key: 'constFar', group: 'places', min: 0.6, max: 5 },
  { key: 'anchorCap', group: 'places', min: 0, max: 32, step: 1 },
  { key: 'anchorOpacity', group: 'places', min: 0, max: 1 },
  { key: 'anchorSizeMult', group: 'places', min: 0.1, max: 1.5 },
  { key: 'bloomMode', group: 'bloom', label: 'bloomMode', options: ['auto', 'on', 'off'] },
  { key: 'bloomStrength', group: 'bloom', min: 0, max: 2 },
  { key: 'bloomRadius', group: 'bloom', min: 0, max: 1.5 },
  { key: 'bloomThreshold', group: 'bloom', min: 0, max: 1 },
  { key: 'exposure', group: 'bloom', min: 0.4, max: 2.5 },
];
// The GROUP order as first seen in TUNE_SCHEMA — both panels render sections
// in this order.
export const TUNE_GROUPS: readonly string[] = [...new Set(TUNE_SCHEMA.map((c) => c.group))];

// Window-event bridge (the idiom used by CONSOLE_RESULT_EVENT / FACT_DETAIL_EVENT):
// the palette panel and the graph's render closures live in sibling component
// trees, so a value change hops across as a CustomEvent. TUNE_EVENT carries one
// {key,value}; TUNE_RESET_EVENT restores defaults; TUNE_OPEN_EVENT asks the
// palette to reveal its tune panel.
export const TUNE_EVENT = 'home:tune-set';
export const TUNE_RESET_EVENT = 'home:tune-reset';
export const TUNE_OPEN_EVENT = 'home:tune-open';
try {
  const saved = JSON.parse(localStorage.getItem(TUNE_LS) ?? 'null');
  if (saved && typeof saved === 'object') Object.assign(TUNE, saved);
} catch { /* defaults */ }
export const tuneEnabled = (): boolean => {
  try {
    const q = new URLSearchParams(location.search).get('tune');
    if (q === '0') localStorage.removeItem(TUNE_LS + '.on');
    else if (q === '1' || location.hash.includes('tune')) localStorage.setItem(TUNE_LS + '.on', '1');
    return q === '1' || location.hash.includes('tune') || localStorage.getItem(TUNE_LS + '.on') === '1';
  } catch { return false; }
};
