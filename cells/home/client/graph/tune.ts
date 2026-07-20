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
};
export const TUNE: typeof TUNE_DEFAULTS = { ...TUNE_DEFAULTS };
export const TUNE_LS = 'parc.home.tune';
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
