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
// PROMOTED OWNER TUNE (ADR-0047): these defaults ARE the owner's live
// `_config/home.graph.tune` fact (rev 276, tuned 2026-07-20/21 on-device),
// baked in so GUESTS see the tuned scene, not a stale code baseline — the guest
// read path resolves the bare `_config/home.graph.tune` against the guest's own
// empty slice and falls back here, so this object is what every unauthenticated
// visitor renders. The tuner (?tune=1) still overrides these locally and the
// owner's fact still wins when present; "the winning values sent back to be
// hard-coded" is exactly this sync. When re-promoting, re-peek the fact and
// update BOTH the numbers and any rationale-comment that cites a specific value.
export const TUNE_DEFAULTS = {
  // torch (the scene LIGHTING). Owner tune: a graded onset — coneIn/depthIn lift
  // off zero so the full-brightness plateau has a soft ramp into the focal
  // point, and torchFloor at 0.2 keeps the periphery legibly lit rather than
  // going near-black before the torch reaches it.
  coneIn: 0.5, coneOut: 1.2, depthIn: 1.5, depthOut: 3.85, torchFloor: 0.2,
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
  focusBand: 60,
  // Landmarks (register 1) reserve this FRACTION of the band; the rest is the
  // suggestion remainder. So the resting sky is "a few steady names + the
  // whispered candidates that fill the leftover budget."
  landmarkFrac: 0.8,
  beamOn: 0.05, beamOff: 0.8,
  beamOpacity: 0.28, beamSizeMult: 0.52,
  // SUGGESTIONS are a DIFFERENT VOICE, not a small focus chip (the beam's
  // original sin: catches wore result styling, so unrelated items read as
  // answers). beamPill 0 = pill-less whisper — a suggestion never carries the
  // committed-name occluder chip that Landmarks/Focus wear. beamPerCell caps
  // suggestions PER SCREEN TERRITORY so a dense cluster can't monopolise the
  // whisper and starve a sparse region (per-place broadcast, mirrors slices).
  beamPill: 1, beamPerCell: 5,
  // focus labels (owner re-grade 2026-07-12): hits headline (1.17), and
  // neighbours now hold FULL opacity near and far (1/1, was 0.41/0.81) —
  // size still grades the role, opacity no longer does.
  selSizeMult: 0.8, hitSizeMult: 1.17, nbrSizeMult: 0.6, nbrOpFar: 1, nbrOpNear: 1,
  labelFade: 1, // lerp rate: higher = snappier; owner tune runs it slow/smooth.
  // Stickiness: how many losing syncs (≈5 frames each) a standing label
  // survives before it starts dying — the anti-flicker grace at the beam
  // edge and collision boundaries.
  labelGrace: 8,
  // Focus-register caps (desktop values; mobile derives ~2/3): how many
  // search hits and selection neighbours may spend from the name budget.
  hitCap: 9, nbrCap: 5,
  // nodes — neighbours barely lift: selection lights the ANCHOR, the
  // neighbourhood whispers; the fan edges carry the structure. nodeDim < 1 in
  // the owner tune dims the resting field so the lit selection stands out more.
  nodeDim: 0.79, nbrBoost: 0.24, boostSizeGain: 0,
  // SELECTION REACH: how many hops of neighbours a selection brightens (1 = just
  // the direct neighbours; 2 = neighbours-of-neighbours too). Capped internally
  // so a hub can't ignite the whole field. edgeLabelCap is the other half of the
  // fan — how many relation labels ride the selected node's edges at once (the
  // old hard-coded 4; a densely-linked node wants more).
  neighborHops: 2, edgeLabelCap: 13,
  // The relation chips' own grade (owner 2026-07-31: "tertiary labels are a
  // little too dim"). relOpacity is the chip's ceiling before far-fade;
  // relTone mixes the dim PAL.rel grey toward full text cream (0 = the old
  // whisper, 1 = as loud as a fact name); relSizeMult grades labelPx the way
  // the role mults do (0.5 ≈ the old mono 8.5px at labelPx 17).
  relOpacity: 1, relTone: 0.35, relSizeMult: 0.5,
  // Each ring of the selection fan is this fraction as bright as the one inside
  // it (0.5 = a 2-hop edge reads half a 1-hop spoke). Only matters when
  // neighborHops > 1.
  hopFalloff: 0.5,
  // edges — the resting lattice is kept faint (owner tune pulls authored edges
  // back down to 0.075 and focus edges to 0.25) so lines earn ink mainly under
  // focus and the sky stays calm at rest rather than reading as a dense mat.
  edgeSimilar: 0.035, edgeMember: 0.055, edgeDerived: 0.055, edgeAuthored: 0.075,
  focusEdgeAlpha: 0.25,
  // FILM GRAIN on the dome (scene.ts SKY_FRAG): animated screen-space noise
  // whose amplitude rides the sky's own light (atmosphere lift + nebulae), so
  // the flat background never sizzles and the orrery (dome layers at zero)
  // stays clean. grainAmt = strength; grainScale = fineness (1 = per device
  // px, lower = chunkier); grainSpeed = re-rolls per second (0 = frozen
  // tooth, like a print).
  grainAmt: 0.35, grainScale: 1, grainSpeed: 12,
  // DASH grammar for the ambient mat (the 2D chart's dashed member/derived
  // strokes, finally in the arc shader): duty 1 = solid, lower = the lit
  // fraction of each dash cycle. Per class — authored / member / derived —
  // and the focus fan always draws solid. dashFreq = dash cycles per full
  // turn of great circle, so dash length is a world quantity (≈ 2πR/freq),
  // not a per-edge fraction.
  dashFreq: 40, dashAuthored: 1, dashMember: 1, dashDerived: 1,
  // flow (2026-07-12): a travelling pulse along FOCUS edges only (the ones
  // already fanning from a selection/hit) — direction is source→target, so
  // the animation reads as energy moving the way the edge actually points.
  // Resting edges stay static on purpose (the file's own standing rule:
  // "lines earn ink only under focus" — movement is the same kind of ink).
  // Dusk only: paper's printed-map metaphor has no motion to carry.
  edgeFlowSpeed: 0.95, edgeFlowWidth: 0.33, edgeFlowGain: 1.1, edgeFlowCycles: 8,
  // bloom — the owner tune runs a LOW-threshold / LOW-strength grade: threshold
  // at 0 lets everything contribute a little glow, but strength is pulled right
  // down (0.24, from ~1.06) and exposure to 0.4 so the additive sum never builds
  // to the white-blob clip that a low threshold caused at full strength (the
  // "dusk regression"). The two move together: if you raise bloomStrength back
  // up, raise bloomThreshold with it or the dense core blows out again.
  bloomStrength: 0.24, bloomRadius: 0, bloomThreshold: 0, exposure: 0.4,
  bloomMode: 'on' as 'auto' | 'on' | 'off',
  // star render: 0 = soft disc, 1 = bright core + strong diffraction spikes.
  starSpike: 1,
  // The star sprite's BAKED halo (the residual glow when bloom is off and the
  // sky is dialed to zero): 1 = the soft star, 0 = tight core + spikes only.
  // Dusk only — paper's stipple is already a hard ink shape.
  starHalo: 1,
  // scene mode: 'dusk' = the luminous dark field; 'paper' = a cartographic
  // star ATLAS — ink stars and fine linework on warm paper, bloom off.
  sceneMode: 'dusk' as 'dusk' | 'paper',
  // ATMOSPHERE (dusk only): the sky is not a flat void — a world-fixed dome
  // darkens from a faint warm horizon glow up to a deep zenith, so the horizon
  // stays level as you turn your head (the planetarium "which way is up" cue).
  // 0 = flat sceneBg (the old void); 1 = full gradient. Dark by design — never
  // blooms, never drowns a star.
  atmosphere: 0.22,
  // Deep-sky amount: the fbm nebulae + galactic band + cluster clouds in the
  // dome shader (scene.ts SKY_FRAG). Same discipline as atmosphere — dark by
  // construction, rides the curl fade, hidden entirely in paper mode.
  nebula: 0.55,
  // ── the deep-sky/terrain ALGORITHMIC levers (owner 2026-07-31: "expose far
  // more of the key levers") — every constant that shapes where and how the
  // data paints the sky/globe, tunable live. Groups: projection (where seats
  // land), terrain (how density becomes land), nebula keying (how the dome
  // wisps follow the data).
  // projection: 0 = linear lon=x·π (the raw PCA chart), 1 = histogram-
  // equalized (the slice spread over the whole globe). projLat scales the
  // latitude range (1 = poles).
  projSpread: 1, projLat: 0.92,
  // terrain texture build: splat radius (px on the 512-wide atlas), the
  // brightness budget (alpha = splatGain/√count), and the blur.
  splatRad: 26, splatGain: 1.5, splatBlur: 9,
  // terrain shading: land threshold (cut..cut+band over density), fractal
  // coast amplitude, relief gain, land brightness, night-side floor, and the
  // sun mix (viewer-bias vs shell-fixed — spin moves the terminator by the
  // shell share).
  terrainAmt: 1, landCut: 0.045, landBand: 0.055, coastAmp: 0.05,
  reliefGain: 5, terrainGain: 1, nightFloor: 0.45, sunView: 0.75, sunShell: 0.6,
  // nebula keying: baseline (no-data decoration) + data gain for the wisps
  // and the galactic band.
  nebBase: 0.22, nebData: 2.2, bandBase: 0.25, bandData: 1.6,
  // orrery edges: flight-path lift at the arc midpoint (× angular length).
  arcLift: 0.06,
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
  constCap: 6, constOpacity: 1, constNear: 0.2, constFar: 3.04,
  constSizeMult: 0.82, // caption px as a fraction of labelPx (caps+tracking carry the weight)
  anchorCap: 32, anchorOpacity: 0.52, anchorSizeMult: 0.56,
  // in-scene label furniture. The name's backing is a DEPTH-ONLY CLIP (owner
  // 2026-07-20: "the observed background / just clipping") — it writes depth
  // but no colour, knocking the busy cloud/edges/labels out of a tight box so
  // the calm sky shows through behind the outlined glyphs. No veil, no chip.
  // pillClip 1 = on, 0 = off (text then reads straight over whatever's behind).
  // labelOutline gives the glyphs their edge definition over the cleared sky.
  // orreryPill engages the clip in the ORRERY regardless of pillClip — the
  // dusk sky the resting tune was graded against becomes lit terrain there,
  // and names need their clean patch back over the bright land.
  pillClip: 0, labelOutline: 0.21, orreryPill: 1,
  // The whole-field grade for NODE labels (the rel chips have their own):
  // labelOpacity multiplies every role's target; labelTone mixes the cream
  // voice (neighbours + suggestions) from dim warm-grey (0) to full text
  // cream (1). Selection gold, hit cyan, and landmark grey keep their
  // semantic inks — tone grades the body voice, not the signals.
  labelOpacity: 1, labelTone: 1,
  // LABEL SIZE is a FIXED SCREEN quantity (owner 2026-07-20: "labels should
  // have fixed size and only fade in/out"). Each label renders at exactly
  // labelPx × its role multiplier, regardless of depth or the node's own
  // radius — so a name never animates large→small and a salient hub doesn't
  // grow a billboard. In the planetarium every star sits at one distance, so
  // this reads as a steady, legible field that only fades in and out; in the
  // orrery the whole set scales together with the globe. labelPx is the one
  // global size dial; the per-role mults (sel/hit/nbr/anchor/beam) grade it.
  labelPx: 17,
  // LAYOUT blend (prototype): 0 = nodes seated by MEANING (the semantic
  // embedding direction), 1 = seated by an authored-LINK force layout on the
  // shell; in between, a per-node morph. Read live; drives a re-seat, not a
  // re-grade. Excludes `similarTo` links (those are the semantic signal itself).
  layoutMix: 0,
  // ZOOM feel + drag momentum. Zoom is ONE continuous axis — telescope (fov) in
  // [0,Z_DOME], un/furl (curl) beyond it — so the two halves get their OWN input
  // sensitivity: magnifying can be geared apart from unfurling (a gesture
  // crossing the seam changes gears there). Both are multipliers on the shipped
  // pinch/wheel gains, so 1 = the current feel. dragMomentum is the glide's
  // per-frame friction: higher = the flung shell coasts longer (0.92 shipped).
  zoomFov: 0.2, zoomCurl: 1, dragMomentum: 0.9,
  // FIELD-COMPUTER GLASS (the palette/context sheet over the graph): the frosted
  // pane's blur radius (px) and dark-fill opacity. Not scene render state — the
  // Palette reads these on TUNE_EVENT and re-renders — so they're `live:'persist'`
  // (a tuner change just saves, no graph re-grade). Lower opacity / higher blur =
  // more of the graph shows through; raise opacity if text loses legibility over
  // a bright patch.
  glassBlur: 20, glassOpacity: 0.62,
};
export const TUNE: typeof TUNE_DEFAULTS = { ...TUNE_DEFAULTS };
// Console/harness handle: `__parcTune.projSpread = 0` etc — the frame loop
// watches the rebuild-required levers, so direct writes take effect live.
try { (globalThis as any).__parcTune = TUNE; } catch { /* SSR */ }
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
  { key: 'nebula', group: 'scene', label: 'nebula', min: 0, max: 1, step: 0.02, live: 'persist', quick: true },
  { key: 'grainAmt', group: 'scene', label: 'grain', min: 0, max: 1, step: 0.02, live: 'persist' },
  { key: 'grainScale', group: 'scene', label: 'grain size', min: 0.15, max: 1, step: 0.05, live: 'persist' },
  { key: 'grainSpeed', group: 'scene', label: 'grain speed', min: 0, max: 24, step: 1, live: 'persist' },
  { key: 'projSpread', group: 'projection', label: 'equalize', min: 0, max: 1, step: 0.02, live: 'persist' },
  { key: 'projLat', group: 'projection', label: 'lat range', min: 0.4, max: 1, step: 0.02, live: 'persist' },
  { key: 'splatRad', group: 'terrain', label: 'splat radius', min: 6, max: 64, step: 1, live: 'persist' },
  { key: 'splatGain', group: 'terrain', label: 'splat gain', min: 0.2, max: 5, step: 0.1, live: 'persist' },
  { key: 'splatBlur', group: 'terrain', label: 'blur', min: 0, max: 24, step: 1, live: 'persist' },
  { key: 'terrainAmt', group: 'terrain', label: 'opacity', min: 0, max: 2, step: 0.05, live: 'persist', quick: true },
  { key: 'landCut', group: 'terrain', label: 'land cut', min: 0, max: 0.2, step: 0.005, live: 'persist' },
  { key: 'landBand', group: 'terrain', label: 'coast width', min: 0.01, max: 0.2, step: 0.005, live: 'persist' },
  { key: 'coastAmp', group: 'terrain', label: 'coast noise', min: 0, max: 0.15, step: 0.005, live: 'persist' },
  { key: 'reliefGain', group: 'terrain', label: 'relief', min: 0, max: 12, step: 0.5, live: 'persist' },
  { key: 'terrainGain', group: 'terrain', label: 'land bright', min: 0.2, max: 3, step: 0.05, live: 'persist' },
  { key: 'nightFloor', group: 'terrain', label: 'night floor', min: 0, max: 1, step: 0.02, live: 'persist' },
  { key: 'sunView', group: 'terrain', label: 'sun: viewer', min: 0, max: 1.5, step: 0.05, live: 'persist' },
  { key: 'sunShell', group: 'terrain', label: 'sun: shell', min: 0, max: 1.5, step: 0.05, live: 'persist' },
  { key: 'nebBase', group: 'nebula', label: 'wisp base', min: 0, max: 1, step: 0.02, live: 'persist' },
  { key: 'nebData', group: 'nebula', label: 'wisp data', min: 0, max: 5, step: 0.1, live: 'persist' },
  { key: 'bandBase', group: 'nebula', label: 'band base', min: 0, max: 1, step: 0.02, live: 'persist' },
  { key: 'bandData', group: 'nebula', label: 'band data', min: 0, max: 4, step: 0.1, live: 'persist' },
  { key: 'arcLift', group: 'edges', label: 'arc lift', min: 0, max: 0.4, step: 0.01, live: 'persist' },
  { key: 'farOcclude', group: 'scene', label: 'far occlude', min: 0, max: 1, step: 0.02, live: 'persist' },
  // the field-computer's frosted glass (Palette-side; read on TUNE_EVENT).
  { key: 'glassBlur', group: 'glass', label: 'blur', min: 0, max: 40, step: 1, live: 'persist', quick: true },
  { key: 'glassOpacity', group: 'glass', label: 'opacity', min: 0, max: 1, step: 0.02, live: 'persist', quick: true },
  // 0 = meaning (semantic), 1 = authored-link force layout; the between morphs.
  { key: 'layoutMix', group: 'layout', label: 'meaning ↔ links', min: 0, max: 1, step: 0.02, live: 'persist', quick: true },
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
  { key: 'hitCap', group: 'name budget', label: 'hit cap', min: 0, max: 20, step: 1 },
  { key: 'nbrCap', group: 'name budget', label: 'neighbour cap', min: 0, max: 12, step: 1 },
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
  { key: 'labelGrace', group: 'labels', label: 'stickiness', min: 0, max: 20, step: 1 },
  { key: 'labelOpacity', group: 'labels', label: 'opacity', min: 0.1, max: 1, step: 0.02 },
  { key: 'labelTone', group: 'labels', label: 'tone', min: 0, max: 1, step: 0.02 },
  { key: 'pillClip', group: 'labels', min: 0, max: 1, step: 1 },
  { key: 'orreryPill', group: 'labels', label: 'orrery pill', min: 0, max: 1, step: 1 },
  { key: 'labelOutline', group: 'labels', min: 0, max: 0.35, step: 0.005 },
  { key: 'labelPx', group: 'labels', min: 6, max: 40, step: 1, quick: true },
  { key: 'nodeDim', group: 'nodes', min: 0.1, max: 3, quick: true },
  { key: 'nbrBoost', group: 'nodes', min: 0, max: 1 },
  { key: 'neighborHops', group: 'nodes', label: 'neighbour hops', min: 1, max: 3, step: 1 },
  { key: 'hopFalloff', group: 'nodes', label: 'hop falloff', min: 0.1, max: 1 },
  { key: 'boostSizeGain', group: 'nodes', min: 0, max: 1.5 },
  { key: 'starSpike', group: 'nodes', min: 0, max: 1 },
  { key: 'starHalo', group: 'nodes', label: 'star halo', min: 0, max: 1 },
  { key: 'edgeSimilar', group: 'edges', min: 0, max: 0.3, step: 0.005 },
  { key: 'edgeMember', group: 'edges', min: 0, max: 0.5, step: 0.005 },
  { key: 'edgeDerived', group: 'edges', min: 0, max: 0.5, step: 0.005 },
  { key: 'edgeAuthored', group: 'edges', min: 0, max: 1, step: 0.005 },
  { key: 'dashFreq', group: 'edges', label: 'dash scale', min: 5, max: 120, step: 1 },
  { key: 'dashAuthored', group: 'edges', label: 'authored dash', min: 0.15, max: 1, step: 0.01 },
  { key: 'dashMember', group: 'edges', label: 'member dash', min: 0.15, max: 1, step: 0.01 },
  { key: 'dashDerived', group: 'edges', label: 'derived dash', min: 0.15, max: 1, step: 0.01 },
  { key: 'focusEdgeAlpha', group: 'edges', min: 0, max: 1 },
  { key: 'edgeLabelCap', group: 'edges', label: 'rel labels', min: 0, max: 16, step: 1 },
  { key: 'relOpacity', group: 'edges', label: 'rel opacity', min: 0.2, max: 1, step: 0.02 },
  { key: 'relTone', group: 'edges', label: 'rel tone', min: 0, max: 1, step: 0.02 },
  { key: 'relSizeMult', group: 'edges', label: 'rel size', min: 0.3, max: 1.2, step: 0.02 },
  { key: 'edgeFlowSpeed', group: 'edges', min: 0, max: 2, step: 0.05 },
  { key: 'edgeFlowWidth', group: 'edges', min: 0.05, max: 0.5, step: 0.01 },
  { key: 'edgeFlowGain', group: 'edges', min: 0, max: 3, step: 0.05 },
  { key: 'edgeFlowCycles', group: 'edges', min: 1, max: 8, step: 1 },
  { key: 'constCap', group: 'places', min: 0, max: 32, step: 1 },
  { key: 'constOpacity', group: 'places', min: 0, max: 1 },
  { key: 'constSizeMult', group: 'places', label: 'caption size', min: 0.4, max: 1.5, step: 0.02 },
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
// the palette's tune panel and the graph's render closures live in sibling
// component trees, so a value change hops across as a CustomEvent. TUNE_EVENT
// carries one {key,value}; TUNE_RESET_EVENT restores defaults.
export const TUNE_EVENT = 'home:tune-set';
export const TUNE_RESET_EVENT = 'home:tune-reset';
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
