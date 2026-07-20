/**
 * FullGraph (ADR-0047, v5) — home's primary surface: the WHOLE substrate slice
 * as a full-viewport 3D constellation. The graph IS the workspace; everything
 * else floats over it.
 *
 * v5 (owner direction, 2026-07-10): the 2D canvas map is GONE — the three.js
 * explore mode is the graph, not a mode. One renderer to refine instead of two
 * to keep visually consistent; the semantic [x,y,z] projection was always the
 * fuller signal (the map flattened its third axis away). d3 (the 2D force sim)
 * is no longer loaded at all.
 *
 * Data: `workspace.query {rankBy:'salience'}` (no limit) loads the entire slice,
 * `workspace.graph` supplies the full Reference projection (authored + derived),
 * filtered to edges among visible nodes. Node radius = salience score (degree
 * assist); node hue = type (stable hash). Edge grammar: authored solid,
 * `similarTo` the faint constellation, membership (onBoard/inDoc/inView —
 * ADR-0046) a light dash, other derived dashed.
 *
 * Focus band: the graph loads everything but lifts the *focus band* — the most
 * salient facts (the salience focus tier, widened to ~top 12% so a flat slice
 * still reads as a band, not a handful) — out of it. The band renders bright and
 * labelled; the periphery is loaded but recedes to a dim wash. Selection and
 * console highlights override this resting state.
 *
 * Layout is SEMANTIC: `workspace.project` writes `_home/embed2d` — each fact's
 * [x,y,z] place in embedding meaning-space (PCA over its Titan vector) — and
 * nodes sit at that coordinate scaled into the scene (a scattered ring when a
 * fact has none). A fact's position is its *meaning*, not a force equilibrium.
 *
 * The scene: a luminous additive point cloud (one draw call) with additive
 * backbone edges (`similarTo` dropped — proximity already says it), UnrealBloom
 * (desktop), ACES tone mapping, a camera-aimed TORCH falloff for atmosphere,
 * THE CURL (a fixed camera; the shell morphs): one zoom axis runs telescope →
 * planetarium dome → flat planisphere chart → held globe, by bending the
 * shell's own curvature (sphere-unroll, arc lengths preserved); drag rotates
 * the shell with momentum, turn-to-face slerps it, and CSS2D labels are lit
 * by the beam (plus the selection/highlight set, always).
 */
import * as React from 'react';
import { mcpCall } from './lib';
import { factTitle, type ListEntry } from './facts';
import { ink } from './ink';

// ── decomposition (2026-07-17): the closure-free helpers now live in graph/*.
import { TUNE, TUNE_DEFAULTS, TUNE_LS, tuneEnabled } from './graph/tune';
import {
  loadThree, loadThreeAddons, esmURL, hslToRgb, hexToRgb, paperInkFor,
  makeStarTexture, makeStippleTexture, makeRingTexture,
} from './graph/scene';
import {
  hueOf, TYPE_SERIF, FONT_BY_GROUP, LABEL_FONT, LABEL_HALO,
  placeworthy, MEMBER_RELS, edgeStyle, nodeDOI, shortLabel, type EdgeStyle,
} from './graph/style';
import {
  type GEdge, type EntryPage, type ChangeEvent, type ChangePage, type GraphMeta,
  REVEAL_ENTRY_LIMIT, LIVE_NODE_HEADROOM, LIVE_EDGE_CAPACITY, CHANGE_POLL_MS,
  fetchEntryPage, fetchEdgesForKeys, fetchChangeHead, fetchGraphMeta,
  fetchTuneConfig, saveTuneConfig,
  keysOfResult, isPlumbing,
} from './graph/data';
import { recomputeRanks as recomputeRanksImpl, salienceHubPlaces, membershipPlaces } from './graph/layout';

const { useEffect, useRef, useState } = React;

export interface GraphNode {
  key: string;
  type: string | null;
  score: number;
  label: string;
}

/** Console → graph seam (dispatched by Console.invoke; the openFact pattern). */
export const CONSOLE_RESULT_EVENT = 'home:console-result';


/* eslint-disable @typescript-eslint/no-explicit-any */


/** Errors thrown inside externally-dispatched handlers (event listeners fed by
 *  cross-origin CDN code) surface as a masked "Script error." on Safari.
 *  Re-reporting from this same-origin module keeps the message + stack. */
function guard<A extends unknown[]>(fn: (...a: A) => void): (...a: A) => void {
  return (...a: A) => {
    try {
      fn(...a);
    } catch (err) {
      (window.reportError ?? console.error)(err);
    }
  };
}


interface GraphReach {
  charted: number;
  total: number;
  loading: boolean;
  hasMore: boolean;
  paused: boolean;
}

function ThreeGraph({ selectedKey, onSelect, visible, onReach, revealNonce, vantageNonce }: {
  selectedKey: string | null;
  onSelect: (n: GraphNode | null) => void;
  visible: number;
  onReach: (reach: GraphReach) => void;
  revealNonce: number;
  vantageNonce: number;
}): React.JSX.Element {
  const host = useRef<HTMLDivElement | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const reachRef = useRef(onReach);
  reachRef.current = onReach;
  const api = useRef<{
    select: (key: string | null, fly?: boolean) => void;
    setVisible: (f: number) => void;
    reveal: () => void;
    toggleVantage: () => void;
  } | null>(null);
  const lastExternal = useRef<string | null>(null);
  // Loading UX: 'fast' = the first pages are still in flight, 'full' = the
  // scene is up and pages are streaming into it, 'done' = the whole slice
  // has landed (or load failed — either way, nothing left to wait for).
  // `progress` feeds the pill a live count as pages append.
  const [loadState, setLoadState] = useState<'fast' | 'full' | 'done'>('fast');
  const [progress, setProgress] = useState<{ got: number; total: number }>({ got: 0, total: 0 });

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let onResult: ((ev: Event) => void) | null = null;
    let cleanup: (() => void) | null = null;
    let changeTimer: number | null = null;
    let changePolling = false;

    // Progressive mount (2026-07-11 follow-up to the query/edges pagination
    // fix): called TWICE — once with a "fast" model (page 1 of entries+edges,
    // already the most salient facts since the query ranks by salience) for
    // an immediate first paint, then again with the complete model once the
    // rest of the slice has paged in. Each call tears down whatever's
    // currently mounted first, so the second call is a clean rebuild, not an
    // append — the render pipeline below is untouched either way.
    // STREAMING mount (2026-07-12, owner: "far more incremental… instead of
    // two bangs"): mounted ONCE with buffers preallocated at the totals both
    // first pages report, then every arriving page APPENDS into the live
    // scene — drawRange extends, ranks/band recompute per beat, pending
    // edges stitch in as their endpoints land. The closures below all
    // capture nodes/links/idx/byRank BY REFERENCE, so appends grow the same
    // objects the whole render pipeline already reads — no remount, no
    // second bang, and selection survives loading by construction.
    interface StreamApi {
      appendEntries: (items: ListEntry[]) => void;
      appendEdges: (items: GEdge[]) => void;
      removeEntries: (keys: string[]) => void;
      removeEdges: (items: GEdge[]) => void;
      finishStream: () => void;
    }
    function mountScene(meta: GraphMeta, caps: { capN: number; capE: number }, THREE: any, addons: any): StreamApi | null {
      if (disposed) return null;
      cleanup?.();
      cleanup = null;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      ro?.disconnect();
      ro = null;
      if (onResult) { window.removeEventListener(CONSOLE_RESULT_EVENT, onResult); onResult = null; }
      if (!THREE || !addons) {
        el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.6;font:13px ui-monospace,monospace">3D renderer unavailable (offline?)</div>';
        return null;
      }
      const { EffectComposer, RenderPass, UnrealBloomPass, CSS2DRenderer, CSS2DObject, TroikaText } = addons;
      // Live, appendable model state — grown in place by the append API.
      const nodes: any[] = [];
      const links: any[] = [];
      const nodeById = new Map<string, any>();
      const coordMap = meta.coordMap;
      const focusKeys = new Set<string>();
      const idOf = (x: any): string => (x && typeof x === 'object' ? x.id : x);
      const inFocus = (n: any): boolean => !!n && focusKeys.has(n.id);
      const rad = (n: any): number => 2 + n.score * 7 + Math.min(4, Math.sqrt(n.deg) * 1.1);
      const idx = new Map<string, number>();

      const SPREAD = 420;
      // ── THE CELESTIAL SPHERE (docs/home-graph-experience.md §"night sky") ──
      // The graph is a SHELL of stars, not a filled cloud. DIRECTION on the
      // sphere = meaning (the semantic embedding's direction); salience is
      // carried by brightness + size (and a whisper of nearness), NOT by
      // radius. The shell itself CURLS (see the camera block): fully curled it
      // surrounds you (planetarium), unrolled flat it is a chart in front of
      // you (planisphere), re-curled the other way it is a held globe (orrery)
      // — one canonical layout, one zoom axis, the camera never moves.
      const SHELL = SPREAD;
      const GOLDEN = Math.PI * (3 - Math.sqrt(5));
      /** A node's CANONICAL SEAT is a unit direction + a radius (louder stars a
       *  whisper nearer). World position is derived from the seat by the CURL
       *  transform (see the camera block): the shell morphs, the seat is fixed.
       *  A node with no embedding (uncharted) gets a stable golden-spiral seat
       *  by index, so it still lands on the sphere rather than collapsing to 0. */
      const toDir = (c: number[] | undefined, i: number): [number, number, number] => {
        const len = c ? Math.hypot(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0) : 0;
        if (c && len > 1e-6) return [(c[0] ?? 0) / len, (c[1] ?? 0) / len, (c[2] ?? 0) / len];
        const t = ((i % 997) + 0.5) / 997; // pseudo-uniform latitude
        const y = 1 - 2 * t;
        const rr = Math.sqrt(Math.max(0, 1 - y * y));
        const th = i * GOLDEN;
        return [Math.cos(th) * rr, y, Math.sin(th) * rr];
      };
      const seatRadius = (score: number): number => SHELL * (1 - 0.08 * Math.max(0, Math.min(1, score)));

      // ── selection / highlight state ──
      let selKey: string | null = null;
      let nbr: Set<string> | null = null;
      let hiSet: Set<string> | null = null;
      // Ephemeral intent: unlike selection this never changes camera/focus or
      // persists into React state. It only says “this is what a click will hit”.
      let hoverKey: string | null = null;
      // A node can be “hot” immediately while its text waits for a deliberate
      // dwell. Keeping these keys separate prevents pointer scans from emitting
      // a wake of labels.
      let hoverLabelKey: string | null = null;
      const hoverRetiredUntil = new Map<string, number>();
      // Salience visibility (slider): show the top `visCount` by rank; hidden
      // nodes/edges/labels get alpha 0. Never below the focus band. The
      // slider stores a FRACTION so streaming appends can keep re-deriving
      // the count against the live total.
      let visFrac = 1;
      let visCount = 0;
      const isVis = (n: any): boolean => !!n && !n.deleted && (
        n.id === selKey || n.id === hoverKey || hiSet?.has(n.id) ||
        n.rank === undefined || n.rank < visCount
      );
      const neighborsOf = (k: string): Set<string> => {
        const s = new Set<string>();
        for (const l of links) { const a = idOf(l.source), b = idOf(l.target); if (a === k) s.add(b); else if (b === k) s.add(a); }
        return s;
      };

      // ── scene-mode palette (dusk = luminous dark field; paper = ink on a
      // warm chart). Everything colour-like routes through PAL so the mode
      // toggle can restyle the live scene without a rebuild. ──
      const paletteFor = (m: string): Record<string, any> =>
        m === 'paper'
          // outline == bg: the halo's job is to BE the ground (knock out
          // linework behind glyphs), not to add a milky edge around them.
          // Re-graded 2026-07-12 (owner report: "everything the same ink
          // colour, no complementary typography treatment") — the old set
          // (text/accent/dim/capAuth/capComp) were five shades of the same
          // muted olive-brown, indistinguishable at a glance. THREE families
          // now, a cartographic convention (warm=asserted, cool=inferred):
          // near-black ink for base content (unchanged, still dominant),
          // a venetian-red accent for selection ("you are here" — genuinely
          // apart from the browns, not just a lighter/darker one), a rust
          // sienna for AUTHORED places (a human named this), and a cool
          // slate for anything the system inferred rather than asserted —
          // computed constellations AND relation labels share it, tying
          // "the system's own reading of the graph" to one visual language.
          // `answer` is the ONE cool hue on the field — the search/console hit
          // cohort, so a result set reads as a group, not as warm neighbours.
          ? { bg: '#ece2cb', text: '#2b2318', accent: '#9c3a24', dim: '#8f8470', outline: '#ece2cb', pill: [0.925, 0.886, 0.796], capAuth: '#7a4a1f', capComp: '#5a6875', rel: '#5a6875', answer: '#2b6c7a' }
          : { bg: ink.sceneBg, text: ink.text, accent: ink.accent, dim: ink.dim, outline: '#0a0805', pill: [0, 0, 0], capAuth: '#e3c987', capComp: '#b7ad99', rel: '#a89e8a', answer: '#79c8d6' };
      let PAL = paletteFor(TUNE.sceneMode);
      const isPaper = (): boolean => TUNE.sceneMode === 'paper';

      // ── node colour / size / alpha buffers (capacity-allocated; drawRange
      // grows as pages stream in) ──
      const posBuf = new Float32Array(caps.capN * 3);
      const colBuf = new Float32Array(caps.capN * 3);
      const sizeBuf = new Float32Array(caps.capN);
      const alphaBuf = new Float32Array(caps.capN);
      const applyNodeColors = (): void => {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          // Dusk: luminous pastels (additive). Paper: the same hue coding as
          // dark chart INK (normal blending over the warm ground).
          const [r, g, b] = isPaper()
            ? (n.type ? paperInkFor(hueOf(n.type)) : [0.27, 0.24, 0.19])
            : (n.type ? hslToRgb(hueOf(n.type), 0.5, 0.62) : [0.62, 0.6, 0.55]);
          colBuf[i * 3] = r; colBuf[i * 3 + 1] = g; colBuf[i * 3 + 2] = b;
        }
      };
      const refreshSizes = (): void => {
        for (let i = 0; i < nodes.length; i++) sizeBuf[i] = rad(nodes[i]) * 2.4;
      };
      // Stable DOI (salience + graph-focus) baked into the buffer; the shader
      // multiplies the SPATIAL focal falloff on top each frame.
      const nodeAlphaOf = (i: number): number => {
        const n = nodes[i];
        if (!isVis(n)) return 0; // culled by the salience slider
        // Global dimmer — the additive core of a dense slice summed to white;
        // the torch supplies the contrast, points don't need to.
        return TUNE.nodeDim * nodeDOI(n, selKey, nbr, hiSet, nodes.length);
      };

      // ── renderer / scene / camera ──
      let W = el.clientWidth || window.innerWidth, H = el.clientHeight || window.innerHeight;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(PAL.bg);
      // ── the ATMOSPHERE: a world-fixed sky dome behind the stars (dusk only) ──
      // A night sky is not a flat void: it darkens from a faint warm horizon
      // glow (dusk, the ground's airglow) up to a deep zenith. A big inward-
      // facing sphere coloured by world ELEVATION paints that gradient — and
      // because it is world-fixed, the horizon stays level as you turn your
      // head, the planetarium cue for which way is up. Drawn first, depth-test
      // off, so the additive stars glow straight over it; dark by construction
      // so it never blooms or drowns them. Paper mode hides it (print is flat).
      const skyUniforms = { uAtmo: { value: TUNE.atmosphere }, uBase: { value: new THREE.Color(PAL.bg) } };
      const skyMat = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
        uniforms: skyUniforms,
        vertexShader:
          'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader:
          'varying vec3 vDir; uniform float uAtmo; uniform vec3 uBase;' +
          'void main(){ float up = clamp(vDir.y, -1.0, 1.0);' +
          ' vec3 zenith = vec3(0.020, 0.023, 0.043);' +   // deep, faintly indigo overhead
          ' vec3 horizon = vec3(0.115, 0.086, 0.058);' +  // warm dusk band at the equator
          ' vec3 nadir = vec3(0.015, 0.013, 0.012);' +    // near-black underfoot
          ' vec3 col = up >= 0.0 ? mix(horizon, zenith, smoothstep(0.0, 1.0, up)) : mix(horizon, nadir, smoothstep(0.0, 1.0, -up));' +
          ' col += vec3(0.16, 0.10, 0.045) * exp(-abs(up) * 5.5);' + // amber airglow hugging the horizon
          ' col = mix(uBase, col, uAtmo);' +
          ' gl_FragColor = vec4(col, 1.0); }',
      });
      const skyDome = new THREE.Mesh(new THREE.SphereGeometry(SHELL * 8, 32, 24), skyMat);
      skyDome.frustumCulled = false;
      skyDome.renderOrder = -1;
      skyDome.visible = !isPaper();
      scene.add(skyDome);
      const camera = new THREE.PerspectiveCamera(55, W / H, 1, 8000);
      camera.position.set(0, 0, SPREAD * 2.15);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.setSize(W, H);
      // ACES Filmic is calibrated for dusk's HDR-ish additive glow — applied to
      // paper's flat, normal-blended ink/cream palette it desaturates toward
      // grey (2026-07-12 owner report: labels/pills read as "grey, not paper").
      // Paper wants its hex colours literal, so it gets no tone-mapping curve
      // at all. Kept in sync with isPaper() in applyMode() for live toggling.
      renderer.toneMapping = isPaper() ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = isPaper() ? 1 : TUNE.exposure;
      renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none';
      el.innerHTML = '';
      el.appendChild(renderer.domElement);

      const labelRenderer = new CSS2DRenderer();
      labelRenderer.setSize(W, H);
      labelRenderer.domElement.style.cssText = 'position:absolute;inset:0;pointer-events:none;user-select:none;-webkit-user-select:none';
      el.appendChild(labelRenderer.domElement);

      // ── the point cloud (one draw call, additive glow, per-point size) ──
      let disc = makeStarTexture(THREE, TUNE.starSpike);
      let stipple = makeStippleTexture(THREE, TUNE.starSpike); // paper's crisp ink star (mode-swapped in applyMode)
      const geo = new THREE.BufferGeometry();
      // `boost` lets a FOCUS point (selection / neighbour / search hit) bypass
      // the torch: without it, a match off the beam axis multiplied down to the
      // 0.04 floor and "highlighting" survived only as a floating label over an
      // unlit scene (owner feedback: labels lit, nodes and edges not).
      const boostBuf = new Float32Array(caps.capN);
      geo.setAttribute('position', new THREE.BufferAttribute(posBuf, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));
      geo.setAttribute('size', new THREE.BufferAttribute(sizeBuf, 1));
      geo.setAttribute('alpha', new THREE.BufferAttribute(alphaBuf, 1));
      geo.setAttribute('boost', new THREE.BufferAttribute(boostBuf, 1));
      geo.setDrawRange(0, 0); // grows as entry pages stream in
      const nodeBoostOf = (i: number): number => {
        const n = nodes[i];
        if (!isVis(n)) return 0;
        if (n.id === selKey || n.id === hoverKey || hiSet?.has(n.id)) return 1;
        if (nbr?.has(n.id)) return TUNE.nbrBoost; // lit, with a whisper of depth left
        return 0;
      };
      const applyNodeAlpha = (): void => {
        for (let i = 0; i < nodes.length; i++) {
          alphaBuf[i] = nodeAlphaOf(i);
          boostBuf[i] = nodeBoostOf(i);
        }
        (geo.attributes.alpha as any).needsUpdate = true;
        (geo.attributes.boost as any).needsUpdate = true;
      };
      // TORCH falloff: a spotlight cone from the camera aimed at the focal point
      // (orbit target = screen centre). Brightness drops by ANGLE off the beam
      // axis (quick smoothstep between an inner and outer cone), plus a gentle
      // distance attenuation along the beam. Sweeps with the camera, unlike a
      // fixed sphere. `torch()` is shared GLSL, injected into both materials.
      // Torch parameters are UNIFORMS (shared object, both materials) so the
      // tuner can dial them live; depthIn/Out are SPREAD-relative factors.
      const torchUniforms = {
        uFocus: { value: new THREE.Vector3() },
        uCam: { value: new THREE.Vector3() },
        uConeIn: { value: TUNE.coneIn },
        uConeOut: { value: TUNE.coneOut },
        uDepthIn: { value: SPREAD * TUNE.depthIn },
        uDepthOut: { value: SPREAD * TUNE.depthOut },
        uFloor: { value: TUNE.torchFloor },
        uSizeBoost: { value: TUNE.boostSizeGain },
        // Far-side fade for the re-curled BALL end of the curl (s < 0): only
        // there does the surface have a back. Distance-based (the camera is
        // fixed at the origin): fade in over [uFadeNear, uFadeFar] — the ball's
        // centre distance out to its far pole — by strength uFadeK. All three
        // driven from the curl state in tick.
        uFadeK: { value: 0 },
        uFadeNear: { value: 1 },
        uFadeFar: { value: 2 },
        // Hard clip: −z beyond which a vertex is culled outright (0 = disabled).
        // Additive glow can't be faded to nothing by opacity, so full occlusion
        // needs a real clip. Driven by TUNE.farOcclude in tick.
        uFarClip: { value: 0 },
      };
      const TORCH_GLSL =
        'uniform vec3 uFocus; uniform vec3 uCam; uniform float uConeIn; uniform float uConeOut; uniform float uDepthIn; uniform float uDepthOut; uniform float uFloor; uniform float uFadeK; uniform float uFadeNear; uniform float uFadeFar; uniform float uFarClip;' +
        'float torch(vec3 p){ vec3 d = uFocus - uCam; float td = length(d); vec3 axis = d / max(td, 1e-3);' +
        ' vec3 toP = p - uCam; float along = dot(toP, axis); if (along <= 0.0) return uFloor;' +
        ' float radial = length(toP - axis*along);' +
        ' float ang = 1.0 - smoothstep(uConeIn, uConeOut, radial / along);' +
        ' float dep = 1.0 - smoothstep(uDepthIn, uDepthOut, abs(along - td));' +
        ' return max(uFloor, ang * dep); }' +
        // Far-side fade keys on DEPTH along the gaze. The curl seats the ball
        // ahead of the fixed camera (gaze = −Z), so −p.z runs from the near pole
        // (small) to the far pole (large); −p.z is the clean near→far discriminant.
        // uFadeNear is the front, uFadeFar the back; stars behind fade to (1−uFadeK).
        'float farFade(vec3 p){ return 1.0 - uFadeK * smoothstep(uFadeNear, uFadeFar, -p.z); }';
      const ptMat = new THREE.ShaderMaterial({
        uniforms: { uTex: { value: isPaper() ? stipple : disc }, uScale: { value: H / 2 }, uPaper: { value: isPaper() ? 1 : 0 }, ...torchUniforms },
        vertexShader:
          'attribute float size; attribute float alpha; attribute vec3 color; attribute float boost;' +
          'varying float vAlpha; varying vec3 vColor; uniform float uScale; uniform float uSizeBoost; uniform float uPaper;' +
          TORCH_GLSL +
          'void main(){ vColor = color; vec4 mv = modelViewMatrix * vec4(position,1.0); float vd = -mv.z;' +
          // Focus points also grow a little — brightness alone undersold a
          // small match dot; size makes the hit read as an OBJECT.
          // PAPER: no torch — print has uniform lighting; ink weight comes
          // from salience (the DOI already baked into `alpha`), never from
          // where the camera happens to aim. And print dots are SMALL —
          // engraved stipple, not glow discs (×0.6).
          'float lit = uPaper > 0.5 ? 1.0 : max(torch(position), boost);' +
          // Far-fade multiplies the alpha, but a SELECTED/boosted far node keeps
          // a faint glow (floor rises with boost) so a target behind the globe
          // still shows as a whisper — everything unselected on the far side dies.
          'float ff = uPaper > 0.5 ? 1.0 : max(farFade(position), boost * 0.35);' +
          'vAlpha = alpha * lit * ff; gl_PointSize = size * (1.0 + uSizeBoost * boost) * (uPaper > 0.5 ? 0.6 : 1.0) * (uScale / max(vd, 1.0));' +
          // Hard occlusion: cull vertices past the rim outright (unless boosted —
          // a selected far node keeps its whisper). Additive glow can't fade to
          // zero, so clip. Zero uFarClip disables.
          'if (uFarClip > 0.5 && -position.z > uFarClip && boost < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }' +
          'else { gl_Position = projectionMatrix * mv; } }',
        fragmentShader:
          'uniform sampler2D uTex; uniform float uPaper; varying float vAlpha; varying vec3 vColor;' +
          'void main(){ float m = texture2D(uTex, gl_PointCoord).a;' +
          // paper: crisp stipple ink (the ×1.5 gain lifts mid-salience dots
          // from tint to ink — resting DOI alphas were graded for additive
          // glow, a touch thin as literal coverage); dusk: premultiplied
          // additive glow (the original path, byte-identical).
          ' if (uPaper > 0.5) { gl_FragColor = vec4(vColor, min(vAlpha * m * 1.5, 1.0)); }' +
          ' else { gl_FragColor = vec4(vColor * vAlpha * m, 1.0); } }',
        transparent: true,
        depthWrite: false,
        blending: isPaper() ? THREE.NormalBlending : THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      const points = new THREE.Points(geo, ptMat);
      points.frustumCulled = false;
      scene.add(points);

      // Selection highlight: a glowing accent ring parked on the selected node
      // (opacity alone washed out under the focal fade).
      const ringTex = makeRingTexture(THREE);
      const ringMat = new THREE.SpriteMaterial({ map: ringTex, color: ink.accent, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const ring = new THREE.Sprite(ringMat);
      ring.visible = false;
      scene.add(ring);
      const hoverMat = new THREE.SpriteMaterial({ map: ringTex, color: ink.text, transparent: true, opacity: 0.72, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
      const hoverRing = new THREE.Sprite(hoverMat);
      hoverRing.visible = false;
      hoverRing.renderOrder = 12;
      scene.add(hoverRing);
      let ringNode: any = null;
      const showRing = (n: any): void => {
        ringNode = n || null;
        if (!n) { ring.visible = false; return; }
        ring.position.set(n.x, n.y, n.z);
        ring.visible = true;
        // Size is set per-frame (sizeRing) so it stays snug to the star's dot
        // at any FOV — the sprite is fov-projected but the star dot is not, so a
        // fixed world scale would balloon the ring under the telescope.
      };
      // Keep the ring the SAME apparent size as the star dot it hugs, through
      // the telescope: dot px ∝ (H/2)/depth (fov-independent); a sprite of world
      // scale S projects to S·focalPx/depth, so S = rad·k·tan(fov/2) holds the
      // ratio constant. k tuned so it matches the old snug fit at the wide FOV.
      const sizeRing = (): void => {
        if (ring.visible && ringNode) ring.scale.setScalar(rad(ringNode) * 7.3 * Math.tan(camera.fov * Math.PI / 360));
      };
      const showHover = (n: any): void => {
        if (!n || n.id === selKey) { hoverRing.visible = false; return; }
        hoverRing.position.set(n.x, n.y, n.z);
        hoverRing.scale.setScalar(rad(n) * 1.72);
        hoverRing.visible = true;
      };

      // ── edges: additive LineSegments (alpha premultiplied into the colours;
      // capacity-allocated, appended as edge pages stream in) ──
      const eposBuf = new Float32Array(caps.capE * 6);
      const ecolBuf = new Float32Array(caps.capE * 6);
      // Direction, source(0)→target(1) — the flow pulse (below) travels along
      // increasing t, so a fan edge visibly moves the way it actually points.
      const eflowBuf = new Float32Array(caps.capE * 2);
      const edgeRGB: Array<[number, number, number]> = [];
      // Lower than the 2D strokes: additive One/One means overlapping edges SUM,
      // so hubs would otherwise clip to a white hairball. Depth-fade (in the
      // shader below) does the rest of the atmosphere.
      // Quieter than the old 2D strokes AND the previous 3D bases: additive
      // One/One SUMS overlapping edges, and the dense semantic core has enough
      // of them to clip to a white mass under bloom (figure/ground again).
      const edgeBaseAlpha = (l: any): number => (l.rel === 'similarTo' ? TUNE.edgeSimilar : MEMBER_RELS.has(l.rel) ? TUNE.edgeMember : l.derived ? TUNE.edgeDerived : TUNE.edgeAuthored);
      const edgeAlphaOf = (l: any): number => {
        const sN = nodeById.get(idOf(l.source)), tN = nodeById.get(idOf(l.target));
        if (!isVis(sN) || !isVis(tN)) return 0; // salience slider
        // As interesting as its most-interesting endpoint (DOI); shader adds focal fade.
        const d = Math.max(nodeDOI(sN, selKey, nbr, hiSet, nodes.length), nodeDOI(tN, selKey, nbr, hiSet, nodes.length));
        return edgeBaseAlpha(l) * (0.1 + 0.9 * d);
      };
      // An edge CARRIES the focus (and bypasses the torch) when it fans out of
      // the selected node, or joins two search hits — the structure the user
      // asked the graph about, visible even off the beam axis. A hit's whole
      // degree does NOT boost (that would re-paint the hairball).
      const eboostBuf = new Float32Array(caps.capE * 2);
      const edgeBoostOf = (l: any): number => {
        const a = idOf(l.source), b = idOf(l.target);
        if (selKey && (a === selKey || b === selKey)) return 1;
        if (hiSet && hiSet.has(a) && hiSet.has(b)) return 1;
        return 0;
      };
      // Focus edges take the ACCENT — the same hue as the selection ring and
      // anchor label, so "this is the structure you asked about" is one visual
      // statement — at an alpha far above the resting bases (which exist to
      // keep 9k edges from summing to a wash; a dozen fan edges have no such
      // problem). The resting lattice keeps its OWN tuned alpha under a
      // selection — prominence comes from lifting the fan, not from dimming the
      // rest (owner: "edges' existing tuned dim is right").
      const ACCENT_RGB = hexToRgb(ink.accent);
      const applyEdgeColor = (): void => {
        const paper = isPaper();
        const N = nodes.length;
        for (let i = 0; i < links.length; i++) {
          const l = links[i];
          const bo = edgeBoostOf(l);
          let r: number, g: number, b: number, al: number;
          if (bo > 0) {
            [r, g, b] = ACCENT_RGB;
            // Weight the focus FAN by the connection's importance: the far
            // node's salience (edges carry no numeric strength — only a rel
            // type — so target salience is the signal), lifted a notch for
            // AUTHORED assertions over derived/similar kinship. So the fan isn't
            // a uniform starburst: the strongest, most-salient links read first.
            const farId = idOf(l.source) === selKey ? idOf(l.target) : idOf(l.source);
            const farN = nodeById.get(farId);
            const farSal = farN ? 1 - (farN.rank ?? N) / Math.max(1, N) : 0.5;
            const relW = l.derived ? 0.8 : MEMBER_RELS.has(l.rel) ? 0.9 : 1; // authored assertions fullest
            al = TUNE.focusEdgeAlpha * (0.4 + 0.6 * farSal) * relW;
          } else {
            [r, g, b] = edgeRGB[i];
            al = edgeAlphaOf(links[i]);
          }
          if (paper) {
            // The buffer carries ALPHA for the paper shader (grayscale);
            // colour is the fixed edge ink there.
            r = al; g = al; b = al;
            al = 1;
          }
          ecolBuf[i * 6] = r * al; ecolBuf[i * 6 + 1] = g * al; ecolBuf[i * 6 + 2] = b * al;
          ecolBuf[i * 6 + 3] = r * al; ecolBuf[i * 6 + 4] = g * al; ecolBuf[i * 6 + 5] = b * al;
          eboostBuf[i * 2] = bo; eboostBuf[i * 2 + 1] = bo;
        }
        (egeo.attributes.color as any).needsUpdate = true;
        (egeo.attributes.boost as any).needsUpdate = true;
      };
      const egeo = new THREE.BufferGeometry();
      egeo.setAttribute('position', new THREE.BufferAttribute(eposBuf, 3));
      egeo.setAttribute('color', new THREE.BufferAttribute(ecolBuf, 3));
      egeo.setAttribute('boost', new THREE.BufferAttribute(eboostBuf, 1));
      egeo.setAttribute('flow', new THREE.BufferAttribute(eflowBuf, 1));
      egeo.setDrawRange(0, 0); // grows as edge pages stream in (2 vertices/segment)
      // A shader (not LineBasicMaterial) so edges get the SAME depth-fade as the
      // point cloud — otherwise they stay full-bright at every depth and flatten
      // the atmosphere. Per-vertex colour already carries the focus/selection
      // alpha (premultiplied); the shader multiplies in the distance falloff.
      const eMat = new THREE.ShaderMaterial({
        uniforms: {
          ...torchUniforms,
          uPaper: { value: isPaper() ? 1 : 0 },
          uInk: { value: new THREE.Vector3(0.353, 0.31, 0.228) },
          uTime: { value: 0 },
          uFlowSpeed: { value: TUNE.edgeFlowSpeed },
          uFlowWidth: { value: TUNE.edgeFlowWidth },
          uFlowGain: { value: TUNE.edgeFlowGain },
          uFlowCycles: { value: TUNE.edgeFlowCycles },
        },
        vertexShader:
          'attribute vec3 color; attribute float boost; attribute float flow; varying vec3 vColor; varying float vBoost; varying float vFlow; uniform float uPaper;' +
          TORCH_GLSL +
          // Paper skips the torch, same as the points: linework on a printed
          // map doesn't dim by camera aim — its weight hierarchy is carried
          // entirely by the per-rel alphas applyEdgeColor already grades.
          'void main(){ float lit = uPaper > 0.5 ? 1.0 : max(torch(position), boost) * farFade(position); vColor = color * lit; vBoost = boost; vFlow = flow; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv; }',
        fragmentShader:
          'uniform float uPaper; uniform vec3 uInk; uniform float uTime; uniform float uFlowSpeed; uniform float uFlowWidth; uniform float uFlowGain; uniform float uFlowCycles;' +
          'varying vec3 vColor; varying float vBoost; varying float vFlow;' +
          // Flow: a soft travelling pulse along FOCUS edges only (vBoost>0 —
          // the ones already fanning from a selection/hit), source(flow=0)→
          // target(flow=1), so the animation reads as energy moving the way
          // the edge actually points. Dusk only — paper's printed-map
          // metaphor has no motion to carry (matches applyMode's own dusk/
          // paper split for everything else in this shader).
          'void main(){' +
          ' vec3 col = vColor;' +
          ' if (uPaper < 0.5 && vBoost > 0.5) {' +
          '   float p = fract(vFlow * uFlowCycles - uTime * uFlowSpeed);' +
          '   float pulse = smoothstep(0.0, uFlowWidth, p) * smoothstep(1.0, 1.0 - uFlowWidth, p);' +
          '   col += vColor * pulse * uFlowGain;' +
          ' }' +
          ' if (uPaper > 0.5) gl_FragColor = vec4(uInk, min(vColor.r * 2.5, 1.0));' +
          // paper: fixed ink colour, the buffer carries ALPHA (applyEdgeColor
          // writes grayscale there in paper mode), gained ×2.5 so hairlines
          // survive on the ground; dusk: premultiplied additive (original),
          // plus the flow pulse added above.
          ' else gl_FragColor = vec4(col, 1.0); }',
        transparent: true,
        depthWrite: false,
        blending: isPaper() ? THREE.NormalBlending : THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      const lineSegs = new THREE.LineSegments(egeo, eMat);
      lineSegs.frustumCulled = false;
      scene.add(lineSegs);
      applyEdgeColor();

      // ── labels (CSS2D) — a role-typed pool with a FADE lifecycle. Roles:
      // 'sel' (the anchor), 'hit' (a search result), 'nbr' (a selection
      // neighbour), 'beam' (the torch's SUGGESTION — the sweep-to-reveal
      // affordance). The beam had two sins (owner feedback): binary DOM
      // add/remove made labels POP, and beam catches wore the same styling as
      // search hits, so unrelated items read as results. Now every label fades
      // in/out (lerped per frame), and the beam is a visibly SECONDARY voice —
      // smaller, dimmer, lighter weight — that yields collision priority to
      // focus and needs consecutive in-beam syncs before it appears.
      type LabelRole = 'sel' | 'hover' | 'hit' | 'nbr' | 'beam' | 'anchor';
      /** What a sync wants a label to be: its role, plus an optional screen-px
       *  DISPLACEMENT (dense-core collision resolved by nudging the label aside
       *  and drawing a hairline leader back to its node — classic map labeling
       *  keeps the name; dropping it was losing neighbours). */
      interface LabelWant { role: LabelRole; ox?: number; oy?: number }
      // ── SDF labels (troika) — text lives IN the scene now: perspective does
      // the depth-honest sizing the CSS layer had to fake per frame, and the
      // glyphs pass through the same tone mapping + bloom as the geometry (a
      // selected label GLOWS with its node). Each label = a billboarded group:
      //   grp (node position, faces camera)
      //   ├─ leader (hairline back to the node when displaced)
      //   └─ inner (collision displacement, screen-px → world)
      //      ├─ pill (rounded dark quad — legibility over the additive cloud)
      //      └─ text (troika SDF, font by type group, outline halo)
      interface LabelState {
        grp: any; inner: any; text: any; pill: any; leader: any;
        cur: number; role: LabelRole; dying: boolean;
        /** Consecutive syncs this label has LOST its slot — stickiness: it
         *  only starts dying past a grace threshold, so admission churn at
         *  the beam edge / collision boundaries stops popping labels. */
        miss: number;
        /** Smoothed near-field compression (1 = depth-true). */
        scl: number;
        ox: number; oy: number; cox: number; coy: number; mult: number;
        fit: () => void;
      }
      const labelObjs = new Map<string, LabelState>();
      const roleMult = (role: LabelRole): number =>
        role === 'sel' ? TUNE.selSizeMult
        : role === 'hover' ? TUNE.hitSizeMult
        // Search HITS are a broad scan cohort, not committed names — small, so a
        // whole result set can show without swamping the sky (owner: cyan hits
        // far too large, esp. in orrery). Hover keeps the prominent preview size.
        : role === 'hit' ? Math.min(0.55, TUNE.hitSizeMult)
        : role === 'nbr' ? TUNE.nbrSizeMult
        : role === 'anchor' ? TUNE.anchorSizeMult
        : TUNE.beamSizeMult;
      // World-unit font size ≙ the old screen-px formula (px = world·(H/2)/camD),
      // so the owner's size mults keep their meaning exactly.
      const fontWorld = (n: any, mult: number): number => rad(n) * 2.4 * 0.85 * mult;
      const pillGeo = new THREE.PlaneGeometry(1, 1);
      // The pill is a DEPTH-ONLY CLIP occluder (owner: "make them the observed
      // background / just clipping"). It renders FIRST (renderOrder −1) and
      // WRITES DEPTH but NO COLOUR, so the busy additive cloud, edges, and
      // other labels behind a committed name are culled by the depth test —
      // leaving the calm sky-dome background showing through a tight box around
      // the glyphs. No veil, no chip: the text (with its outline) simply sits
      // in a clean patch of sky. A rounded box hugging the layout bounds keeps
      // the knock-out small; fragments outside it discard (no clip there).
      const mkPillMat = (): any =>
        new THREE.ShaderMaterial({
          uniforms: {
            uSize: { value: new THREE.Vector2(1, 1) },
            uInner: { value: new THREE.Vector2(1, 1) },
          },
          vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
          fragmentShader:
            'uniform vec2 uSize; uniform vec2 uInner; varying vec2 vUv;' +
            'void main(){ vec2 p = (vUv - 0.5) * uSize;' +
            ' vec2 ib = uSize * 0.5 * uInner; float r = ib.y * 0.5;' +
            ' vec2 b = max(ib - vec2(r), vec2(0.0));' +
            ' float d = length(max(abs(p) - b, 0.0)) - r;' +
            ' if (d > 0.0) discard;' +      // outside the rounded box: nothing clipped
            ' gl_FragColor = vec4(0.0); }', // inside: write DEPTH only (colorWrite off)
          transparent: false,
          depthTest: true,
          depthWrite: true,
          colorWrite: false,
        });
      /** Size the clip box tightly around the text's layout bounds. */
      const fitPillTo = (text: any, pill: any, centerY: number): void => {
        const b = text.textRenderInfo?.blockBounds;
        if (!b) return;
        const h = b[3] - b[1];
        const qw = (b[2] - b[0]) + h * 0.6; // ~0.3em side padding
        const qh = h * 1.35;                // a little vertical breathing room
        pill.scale.set(qw, qh, 1);
        pill.material.uniforms.uSize.value.set(qw, qh);
        // Inner box (the rounded rect) fills almost the whole quad.
        pill.material.uniforms.uInner.value.set(0.98, 0.94);
        pill.position.set((b[0] + b[2]) / 2, centerY + (b[1] + b[3]) / 2, -1.5);
        pill.visible = true;
      };
      const makeLabel = (n: any, role: LabelRole): LabelState => {
        const grp = new THREE.Group();
        grp.position.set(n.x, n.y, n.z);
        const inner = new THREE.Group();
        grp.add(inner);
        const text = new TroikaText();
        text.text = n.label;
        // ONE consistent voice for every fact name (owner: label layout stays
        // consistent — a selection changes only colour/opacity/visibility, never
        // the glyph layout). KIND is read from colour/emphasis in updateLabels;
        // TYPE is already carried by the star's own hue right beside the name.
        text.font = LABEL_FONT;
        text.fontSize = fontWorld(n, roleMult(role));
        text.anchorX = 'center';
        text.anchorY = 'top';
        // Long titles WRAP into centred lines (~18 chars/line) instead of
        // running off as one strip — maxWidth tracks fontSize (applyFont).
        text.maxWidth = text.fontSize * 10;
        text.lineHeight = 1.15;
        text.textAlign = 'center';
        text.position.y = -rad(n) * 1.15; // hang below the dot
        text.color = PAL.text;
        text.outlineColor = PAL.outline;
        text.outlineWidth = `${Math.round(TUNE.labelOutline * 100)}%`;
        text.fillOpacity = 0;
        text.outlineOpacity = 0;
        text.renderOrder = 9;
        const pill = new THREE.Mesh(pillGeo, mkPillMat());
        pill.visible = false;
        pill.renderOrder = -1; // depth-writing occluder — draws before the cloud
        inner.add(pill);
        inner.add(text);
        const leader = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
          new THREE.LineBasicMaterial({ color: 0x59503f, transparent: true, opacity: 0 }),
        );
        leader.renderOrder = 7;
        leader.visible = false;
        grp.add(leader);
        const st: LabelState = {
          grp, inner, text, pill, leader,
          cur: 0, role, dying: false, miss: 0, scl: 1, ox: 0, oy: 0, cox: 0, coy: 0, mult: roleMult(role),
          fit: () => fitPillTo(text, pill, text.position.y),
        };
        text.sync(st.fit);
        scene.add(grp);
        return st;
      };
      /** Reconcile membership: departures FADE (dying → removed at ~0), not
       *  pop — and only after a GRACE of consecutive losses (stickiness): a
       *  label that loses one sync's collision contest or slips just past the
       *  beam edge keeps its place instead of flickering. */
      const LABEL_GRACE = 8; // syncs ≈ 0.7s at the 5-frame sync cadence
      const reconcileLabels = (want: Map<string, LabelWant>): void => {
        for (const [id, st] of labelObjs) {
          const w = want.get(id);
          if (w) {
            st.role = w.role;
            st.dying = false;
            st.miss = 0;
            // Size tier and displacement are BIRTH-TIME properties (owner,
            // 2026-07-12: selecting a node made its and its neighbours'
            // standing labels resize and slide — jarring). An incumbent label
            // only re-targets opacity/colour on a role change; a fresh label
            // is born at its role's size and offset and FADES in. The cost —
            // a beam label promoted to 'sel' keeps its smaller size — is
            // carried by the accent colour and the selection ring instead.
            // No font/tracking change on role flip: layout stays put, only the
            // colour/opacity re-targets (owner: consistent label layout).
          } else if (st.role === 'hover') {
            // Hover-only labels do not inherit the ambient 0.7s grace: that
            // grace is useful for map labels during orbit, but makes tooltips
            // trail behind the pointer.
            st.miss = LABEL_GRACE + 1;
            st.dying = true;
          } else if (++st.miss > LABEL_GRACE) st.dying = true;
        }
        for (const [id, w] of want) {
          if (labelObjs.has(id)) continue;
          const n = nodeById.get(id);
          if (!n) continue;
          const st = makeLabel(n, w.role);
          st.ox = w.ox ?? 0;
          st.oy = w.oy ?? 0;
          labelObjs.set(id, st);
        }
      };

      // ── bloom (desktop only — fill-rate heavy on phones) ──
      const bigScreen = Math.min(W, H) >= 620 && !(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      let composer: any = null;
      let bloomPass: any = null;
      // Bloom is a TOGGLE now (tuner: auto/on/off — 'on' lets a phone try it),
      // so the composer builds lazily the first frame it's wanted and the tick
      // simply routes around it when it isn't.
      // Paper mode never blooms — ink doesn't glow.
      const useBloom = (): boolean => !isPaper() && (TUNE.bloomMode === 'on' || (TUNE.bloomMode === 'auto' && bigScreen));
      const ensureComposer = (): void => {
        if (composer) return;
        composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, camera));
        // Threshold above the resting wash so only genuinely bright points
        // bloom — at 0.12 the dense core's additive sum ALL bloomed and clipped
        // to a white blob that swallowed its labels.
        bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), TUNE.bloomStrength, TUNE.bloomRadius, TUNE.bloomThreshold);
        composer.addPass(bloomPass);
        // The composer must MATCH the renderer's pixel ratio — on a 2x phone
        // its targets otherwise mismatch the drawing buffer and the scene
        // renders black (why bloom 'on' looked dead on mobile).
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(W, H);
      };
      if (useBloom()) ensureComposer();

      // ── THE CURL: one zoom axis, a FIXED camera, a shell that bends ──
      // (Owner proposal, 2026-07-20.) The camera sits at the origin looking
      // down −Z, permanently — zoom is never camera motion. Drag ROTATES THE
      // SHELL (shellQ): the sky slides around you, one gesture at every zoom.
      // Zoom is one scalar zoomZ ∈ [0,3]:
      //   [0,1]  telescope: fov 4°→82°, shell fully curled (s=+1).
      //   [1,3]  the CURL: s = 2−zoomZ runs +1 → −1 at the resting fov.
      // s is the shell's CURVATURE state — the sphere-unroll family. Each star
      // keeps its azimuth and its ARC distance from the anchor point dead
      // ahead, so the surface never stretches; it only bends:
      //   s=+1  the sphere surrounds you — the PLANETARIUM.
      //   s= 0  fully flat — the PLANISPHERE: the whole sky unfurled onto a
      //         chart in front of you (its rim — the point once directly behind
      //         your head — lands at atan(π)≈72° off-axis, just out of view).
      //   s=−1  re-curled the other way: a globe held in front — the ORRERY —
      //         with the patch you were studying on the near face.
      //   p(s) = r·[ζ·g + ρ·u],  ρ = sin(s·α)/s,  ζ = 1 − (1−cos(s·α))/s
      // (g = the fixed gaze −Z, α = a seat's angle off it, u = its azimuth;
      // the s→0 limit ζ=1, ρ=α is the azimuthal equidistant projection.)
      // The old two-stance machinery (camera distance, enterSky/enterOrrery,
      // the gaze flip, the orrery drag inversion, tip-into-orrery) collapses
      // into this one axis — and the drag SIGN is the same at both ends:
      // rotating the shell reads as drag-the-sky inside and spin-the-globe
      // outside, with no seam and nothing ever hidden behind a transition.
      const FOV_WIDE = 82, FOV_TELE = 4;
      const Z_DOME = 1, Z_FLAT = 2, Z_BALL = 3; // named stops on the zoom axis
      let zoomZ = Z_BALL, zoomZT = Z_BALL;      // arrival opens on the held globe
      let curlS = -1;                           // curvature, derived from zoomZ
      const shellQ = new THREE.Quaternion();    // the shell's orientation
      let shellQT: any = null;                  // eased turn-to-face target
      let velRX = 0, velRY = 0;                 // shell angular momentum (rad/frame)
      let lastInput = performance.now();
      const fwdV = new THREE.Vector3(0, 0, -1); // the fixed gaze
      const focusVec = new THREE.Vector3(0, 0, -SHELL); // torch focal point, dead ahead
      camera.position.set(0, 0, 0);
      camera.quaternion.identity();
      const zoomOf = (z: number): { fov: number; s: number } =>
        z <= Z_DOME
          ? { fov: FOV_TELE * Math.pow(FOV_WIDE / FOV_TELE, Math.max(0, z)), s: 1 }
          : { fov: FOV_WIDE, s: 2 - z };
      // Everything below the camera is derived, so a change to the shell's
      // orientation or curvature marks the layout dirty; tick() re-seats.
      let layoutDirty = true;
      // World-axis shell rotation (premultiplied): drag and momentum.
      const qRotX = new THREE.Quaternion(), qRotY = new THREE.Quaternion();
      const AXIS_X = new THREE.Vector3(1, 0, 0), AXIS_Y = new THREE.Vector3(0, 1, 0);
      const rotateShell = (ax: number, ay: number): void => {
        qRotX.setFromAxisAngle(AXIS_X, ax);
        qRotY.setFromAxisAngle(AXIS_Y, ay);
        shellQ.premultiply(qRotX).premultiply(qRotY).normalize();
        layoutDirty = true;
      };
      // TURN TO FACE: rotate the SHELL so a canonical seat direction arrives at
      // the anchor, dead ahead — eased (slerp) in tick(). Works identically at
      // every curl: under the dome it's the sky wheeling to centre a star; on
      // the ball it's the globe spinning that face toward you.
      const faceQ = new THREE.Quaternion(), faceV = new THREE.Vector3();
      const faceCanon = (dx: number, dy: number, dz: number): void => {
        const len = Math.hypot(dx, dy, dz) || 1;
        faceV.set(dx / len, dy / len, dz / len).applyQuaternion(shellQ);
        shellQT = faceQ.setFromUnitVectors(faceV, fwdV).clone().multiply(shellQ).normalize();
        velRX = velRY = 0;
        lastInput = performance.now();
      };
      // The CURL transform: canonical seat (unit dir + radius) → morphed world
      // position at the current (shellQ, curlS). Writes x/y/z into `out`.
      const curlV = new THREE.Vector3();
      const curlPos = (dx: number, dy: number, dz: number, r0: number, out: { x: number; y: number; z: number }): void => {
        curlV.set(dx, dy, dz).applyQuaternion(shellQ);
        const ca = Math.max(-1, Math.min(1, -curlV.z)); // cos α (gaze = −Z)
        const alpha = Math.acos(ca);
        const sa = Math.sqrt(Math.max(0, 1 - ca * ca));
        const ux = sa > 1e-6 ? curlV.x / sa : 1, uy = sa > 1e-6 ? curlV.y / sa : 0;
        const s = curlS;
        let rho: number, zeta: number;
        if (Math.abs(s) < 1e-3) { rho = alpha; zeta = 1; } // the flat limit
        else { rho = Math.sin(s * alpha) / s; zeta = 1 - (1 - Math.cos(s * alpha)) / s; }
        out.x = r0 * rho * ux;
        out.y = r0 * rho * uy;
        out.z = -r0 * zeta;
      };
      // Re-seat EVERYTHING from canonical seats at the current shell state:
      // nodes → posBuf, edge endpoints, labels, captions, the selection ring.
      // Called only when the shell actually moved; static frames cost nothing.
      const constAnchorScratch = { x: 0, y: 0, z: 0 };
      const morphLayout = (): void => {
        layoutDirty = false;
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          curlPos(n.cdx, n.cdy, n.cdz, n.cr0, n);
          posBuf[i * 3] = n.x; posBuf[i * 3 + 1] = n.y; posBuf[i * 3 + 2] = n.z;
        }
        for (let i = 0; i < links.length; i++) {
          const a = nodeById.get(idOf(links[i].source)), b = nodeById.get(idOf(links[i].target));
          if (!a || !b) continue;
          eposBuf[i * 6] = a.x; eposBuf[i * 6 + 1] = a.y; eposBuf[i * 6 + 2] = a.z;
          eposBuf[i * 6 + 3] = b.x; eposBuf[i * 6 + 4] = b.y; eposBuf[i * 6 + 5] = b.z;
        }
        (geo.attributes.position as any).needsUpdate = true;
        (egeo.attributes.position as any).needsUpdate = true;
        for (const [id, st] of labelObjs) {
          const n = nodeById.get(id);
          if (n) st.grp.position.set(n.x, n.y, n.z);
        }
        for (const c of constellations) {
          curlPos(c.cdx, c.cdy, c.cdz, c.cr0, c); // region centre (crumb / doors)
          curlPos(c.adx, c.ady, c.adz, c.ar0, constAnchorScratch);
          c.ax = constAnchorScratch.x; c.ay = constAnchorScratch.y; c.az = constAnchorScratch.z;
          c.grp.position.set(c.ax, c.ay, c.az);
        }
        if (ringNode) ring.position.set(ringNode.x, ringNode.y, ringNode.z);
        // The atmosphere dome rides the shell: the airglow/horizon stays locked
        // to the same patch of sky as you drag, rather than floating free of the
        // stars it belongs to (the fixed camera means only the shell turns).
        skyDome.quaternion.copy(shellQ);
      };
      // Arrival: open on the held globe, then the chart unrolls toward you and
      // wraps around — the sky rises to envelop you, continuously through flat.
      let framed = false;
      const frameBody = (force = false): void => {
        if ((framed && !force) || !nodes.length) return;
        framed = true;
        zoomZT = Z_DOME;
      };

      // ── picking: a tap (not a drag) selects the nearest node ON SCREEN ──
      // The raycaster is gone (2026-07-13 owner report: "really hard to select
      // nodes"): its 9-WORLD-UNIT cylinder around the pick ray shrinks to a
      // couple of screen px once the camera pulls back, so most taps missed
      // every node and fell through to the forgiving label slop — which then
      // selected some standing label's node instead, reading as "selection is
      // broken". A tap is a SCREEN gesture, so pick in screen space: project
      // every visible node once and take the closest within a finger-sized
      // px threshold. O(N) over a few thousand nodes is nothing per tap, and
      // the threshold is honest — it never silently changes with dolly depth.
      let downX = 0, downY = 0, moved = false;
      const nearestNodeAt = (cx: number, cy: number, maxPx: number): any => {
        // On the shell EVERY star is a distinct direction, so a finger often
        // covers several — a bright foreground one and faint background ones at
        // nearly the same screen point. Nearest-by-pixel alone grabbed the
        // faint straggler you didn't mean. Give brighter stars a wider
        // effective catch: rank by (pixel distance − salience bonus), still
        // gated to the finger radius, so within reach the one that visually
        // dominates wins — you select the star you were looking at.
        let best: any = null;
        let bestScore = Infinity;
        for (const n of nodes) {
          if (!isVis(n)) continue;
          const [sx, sy, sz] = screenXY(n);
          if (sz > 1) continue; // behind the camera
          const d = Math.hypot(sx - cx, sy - cy);
          if (d > maxPx) continue;
          // brighter → wider effective catch; a far-side star in the orrery is
          // pushed DOWN the priority so the near face wins the tap.
          const score = d - (n.score || 0) * 16 + (1 - farFadeAt(n)) * 80;
          if (score < bestScore) { bestScore = score; best = n; }
        }
        return best;
      };
      // A tap over a label's projected rect selects that node — SDF labels are
      // scene objects, so the rect is reconstructed from troika's OWN layout
      // bounds (blockBounds), padded a little for fingers (host is fixed
      // inset:0, so client px == canvas px).
      // Two-tier hit rects (2026-07-12 "nodes are impossible to select"): the
      // first pill-slop cut floored EVERY label's rect at 56×36 plus feather
      // headroom and tested labels before the node raycast — dozens of beam/
      // anchor labels tiled the screen with invisible tap-catchers, so taps
      // aimed at bare nodes kept landing in some label's slop. TIGHT rects
      // (the visible chip: glyphs + the pill's text padding) outrank nodes;
      // the padded finger-slop rects only catch taps that hit nothing else
      // (see onUp's ordering below).
      const labelAt = (cx: number, cy: number, slop: boolean): string | null => {
        for (const [id, st] of labelObjs) {
          if (st.cur < 0.12) continue; // only a barely-there label is skipped — any clearly visible name (all kinds) catches the tap
          const n = nodeById.get(id);
          if (!n) continue;
          // True projected px per world unit × the label's own fixed-size scale.
          const pxPer = pxPerWorld(st.grp.position) * (st.scl || 1);
          const b = st.text.textRenderInfo?.blockBounds as [number, number, number, number] | undefined;
          const fs = st.text.fontSize * pxPer;
          const [sx, sy] = screenXY(n);
          const cxc = sx + st.cox; // label centre column (with displacement)
          if (b) {
            // Block bounds are text-local (anchor top-centre at y=0), hung at
            // text.position.y below the node; world +y is screen −y.
            let top = sy + st.coy - (st.text.position.y + b[3]) * pxPer;
            let bot = sy + st.coy - (st.text.position.y + b[1]) * pxPer;
            const textH = bot - top;
            let w: number;
            if (slop) {
              const vPad = Math.max(8, (36 - textH) / 2); // finger headroom
              top -= vPad; bot += vPad;
              w = Math.max(56, (b[2] - b[0]) * pxPer + 24);
            } else {
              // The visible chip: fitPillTo's text box (~0.5em side pad,
              // ×1.55 height) — what the finger actually SEES as the label.
              top -= textH * 0.28; bot += textH * 0.28;
              w = (b[2] - b[0]) * pxPer + textH;
            }
            if (cx >= cxc - w / 2 && cx <= cxc + w / 2 && cy >= top && cy <= bot) return id;
          } else if (slop) {
            const w = Math.max(56, String(n.label).length * fs * 0.62);
            const ly = sy + st.coy + rad(n) * 1.15 * pxPer;
            if (cx >= cxc - w / 2 && cx <= cxc + w / 2 && cy >= ly - 8 && cy <= ly + fs * 1.6 + 8) return id;
          }
        }
        return null;
      };
      // A finger tap wobbles 8–12px on a phone — the old 6px "it's a drag"
      // threshold was eating most label taps on touch (they registered as
      // micro-orbits, so nothing ever selected).
      let dragThreshold = 6;
      let pointerDown = false;
      let hoverPickRaf = 0;
      let hoverLabelTimer: ReturnType<typeof setTimeout> | null = null;
      const HOVER_LABEL_DWELL_MS = 320;
      const setHover = (n: any | null): void => {
        const key = n?.id ?? null;
        if (key === hoverKey) return;
        if (hoverLabelTimer) {
          clearTimeout(hoverLabelTimer);
          hoverLabelTimer = null;
        }
        const retiredLabel = hoverLabelKey;
        const hadLabel = retiredLabel !== null;
        if (retiredLabel) hoverRetiredUntil.set(retiredLabel, performance.now() + 550);
        hoverLabelKey = null;
        hoverKey = key;
        if (key) hoverRetiredUntil.delete(key);
        showHover(n);
        renderer.domElement.style.cursor = key ? 'pointer' : '';
        // Geometry responds on the next render frame; text does not enter the
        // label pool until this target survives the dwell.
        applyNodeAlpha();
        if (hadLabel) syncBeamLabels();
        if (key) {
          hoverLabelTimer = setTimeout(() => {
            hoverLabelTimer = null;
            if (disposed || hoverKey !== key) return;
            hoverLabelKey = key;
            syncBeamLabels();
          }, HOVER_LABEL_DWELL_MS);
        }
      };
      // ── camera input: drag = turn the gaze; pinch / wheel = the telescope ──
      // Live pointers (for one-finger turn vs two-finger pinch), the last
      // position of the rotating pointer, and the pinch baseline.
      const pointers = new Map<number, { x: number; y: number }>();
      let lastPX = 0, lastPY = 0, lastMoveT = 0;
      let pinchDist0 = 0, pinchZ0 = 0;
      // Radians per pixel that keeps the shell under the finger: a drag the
      // height of the viewport rotates it by ~one field-of-view, so the deeper
      // you telescope in, the finer the turn — a tight zoom stays steerable.
      const rotPerPx = (): number => (camera.fov * Math.PI / 180) / Math.max(H, 1);
      const onDown = (e: PointerEvent): void => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        downX = e.clientX; downY = e.clientY; moved = false; pointerDown = true;
        lastPX = e.clientX; lastPY = e.clientY;
        velRX = velRY = 0; shellQT = null; // a touch stops the glide/turn
        lastInput = performance.now();
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchDist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          pinchZ0 = zoomZ;
        }
        try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* */ }
        if (e.pointerType === 'touch') setHover(null);
      };
      const onMove = (e: PointerEvent): void => {
        const tracked = pointers.get(e.pointerId);
        if (tracked) { tracked.x = e.clientX; tracked.y = e.clientY; }
        if (pointerDown && Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > dragThreshold) {
          moved = true;
          setHover(null);
        }
        // Two fingers → pinch drives the ONE zoom axis: telescope, then the
        // curl. Spread to magnify, pinch to unfurl the sky into the chart and
        // on out to the held globe — a single continuous motion.
        if (pointers.size >= 2) {
          const [a, b] = [...pointers.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          zoomZ = zoomZT = Math.max(0, Math.min(Z_BALL, pinchZ0 + Math.log(pinchDist0 / d) * 1.9));
          layoutDirty = true;
          lastInput = performance.now();
          return;
        }
        // One pointer down → ROTATE THE SHELL (the point under the finger stays
        // under the finger — the same sign at every curl: drag-the-sky under
        // the dome, spin-the-globe on the ball). Momentum keeps the last delta.
        if (pointerDown && tracked) {
          const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
          lastPX = e.clientX; lastPY = e.clientY;
          if (moved) {
            const k = rotPerPx();
            velRY = -dx * k; velRX = -dy * k;
            rotateShell(velRX, velRY);
            lastMoveT = lastInput = performance.now();
          }
          return;
        }
        if (e.pointerType === 'touch' || hoverPickRaf) return;
        const x = e.clientX, y = e.clientY;
        hoverPickRaf = requestAnimationFrame(() => {
          hoverPickRaf = 0;
          const labelKey = labelAt(x, y, false);
          const n = labelKey ? nodeById.get(labelKey) : nearestNodeAt(x, y, 18);
          if (n) setHover(n);
          else {
            setHover(null);
            renderer.domElement.style.cursor = constellationAt(x, y, false) ? 'pointer' : '';
          }
        });
      };
      // Wheel drives the same one zoom axis, eased: scroll forward magnifies
      // (telescope); scroll back unfurls — dome → chart → globe, no seams.
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        zoomZT = Math.max(0, Math.min(Z_BALL, zoomZT + e.deltaY * 0.0011));
        lastInput = performance.now();
      };
      const clearPointer = (id: number): void => {
        pointers.delete(id);
        if (pointers.size < 2) pinchDist0 = 0;
        // A remaining finger becomes the new rotation anchor (no jump).
        const rest = pointers.values().next().value;
        if (rest) { lastPX = rest.x; lastPY = rest.y; }
      };
      const onLeave = (e: PointerEvent): void => {
        clearPointer(e.pointerId);
        if (!pointers.size) pointerDown = false;
        setHover(null);
        renderer.domElement.style.cursor = '';
      };
      const onUp = (e: PointerEvent): void => {
        clearPointer(e.pointerId);
        if (pointers.size) return; // still pinching/turning with another finger
        pointerDown = false;
        // A FLICK ends into a momentum glide (velRX/velRY decay in tick);
        // a finger that came to rest before lifting (>90ms since the last move)
        // carries no throw. Only a genuine TAP falls through to selection.
        if (moved) {
          if (performance.now() - lastMoveT > 90) velRX = velRY = 0;
          return;
        }
        velRX = velRY = 0;
        // TAP, THEN TAP AGAIN (owner choice, 2026-07-20): a FIRST tap on a star
        // selects it IN PLACE — the ring, its neighbourhood and labels light up
        // but the camera holds still (you don't get shoved around every touch).
        // A SECOND tap on the SAME star is the "look at it" gesture: turn to
        // face it and telescope in a step. So motion only happens when you ask.
        const tapNode = (key: string): void => {
          if (key === selKey) {
            const nd = nodeById.get(key);
            if (nd) { faceCanon(nd.cdx, nd.cdy, nd.cdz); zoomZT = Math.max(0, Math.min(zoomZT, Z_DOME) - 0.3); }
          } else {
            api.current?.select(key, false);
          }
        };
        const openConst = (c: Constellation): void => {
          // A caption is a DOOR: an AUTHORED place selects its container fact
          // (context panel: members as neighbours, open ↗ to the board/doc);
          // a computed place turns the shell to centre its region.
          if (c.key && nodeById.has(c.key)) tapNode(c.key);
          else faceCanon(c.cdx, c.cdy, c.cdz);
        };
        // Precedence (owner: VISIBLE LABELS, all kinds, take precedence — the
        // orrery packs the near face with names, and a name is the deliberate
        // target). A tap on a visible fact label or caption wins outright; the
        // selected star's own label routes through tapNode → its look-at, so the
        // "second tap" gesture still lives on the label/dot. Only if no label is
        // hit does the NEAREST on-screen node (finger-sized, far-side-penalised)
        // win; then the padded slop rects; then empty space deselects.
        const lidT = labelAt(e.clientX, e.clientY, false);
        if (lidT) { tapNode(lidT); return; }
        const cT = constellationAt(e.clientX, e.clientY, false);
        if (cT) { openConst(cT); return; }
        const n = nearestNodeAt(e.clientX, e.clientY, e.pointerType === 'touch' ? 36 : 24);
        if (n) { tapNode(n.id); return; }
        const lid = labelAt(e.clientX, e.clientY, true);
        if (lid) { tapNode(lid); return; }
        const c = constellationAt(e.clientX, e.clientY, true);
        if (c) { openConst(c); return; }
        api.current?.select(null);
      };
      renderer.domElement.addEventListener('pointerdown', onDown);
      renderer.domElement.addEventListener('pointermove', onMove);
      renderer.domElement.addEventListener('pointerup', onUp);
      renderer.domElement.addEventListener('pointerleave', onLeave);
      renderer.domElement.addEventListener('pointercancel', onLeave);
      renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

      api.current = {
        select: (key: string | null, doFly = false) => {
          lastExternal.current = key;
          selKey = key; nbr = key ? neighborsOf(key) : null;
          setHover(null);
          if (key) hiSet = null;
          applyNodeAlpha(); applyEdgeColor(); syncBeamLabels();
          const found = key ? nodeById.get(key) : null;
          const d = found && !found.deleted ? found : null;
          showRing(d);
          showCrumb(key);
          if (d && doFly) faceCanon(d.cdx, d.cdy, d.cdz);
          if (key && !d) void hydrateKey(key);
          // Selection completes its own local map: the bounded initial load
          // means a selected node's neighbours may not be in the scene yet —
          // pull them in (see pullNeighbours below).
          if (key) void pullNeighbours(key);
          selectRef.current(d ? { key: d.id, type: d.type, score: d.score, label: d.label } : key ? { key, type: null, score: 0, label: key } : null);
        },
        setVisible: (f: number) => {
          visFrac = f;
          const activeCount = nodes.reduce((n, node) => n + (node.deleted ? 0 : 1), 0);
          visCount = f >= 0.999 ? activeCount : Math.max(focusKeys.size, Math.round(activeCount * f));
          applyNodeAlpha(); applyEdgeColor(); syncBeamLabels();
        },
        reveal: () => { /* installed once the initial page has mounted */ },
        toggleVantage: () => {
          // One axis now: the button eases zoom between the two ends of the
          // curl — under the dome ↔ holding the globe — passing THROUGH the
          // flat chart on the way. Selection, shell orientation, everything
          // else is untouched. (Deselecting is its own gesture: tap empty sky.)
          zoomZT = zoomZT > (Z_DOME + Z_BALL) / 2 ? Z_DOME : Z_BALL;
        },
      };

      onResult = guard((ev: Event): void => {
        const detail = (ev as CustomEvent<{ ok: boolean; value: unknown }>).detail;
        if (!detail?.ok) return;
        const allKeys = keysOfResult(detail.value);
        if (!allKeys.length) return;
        setHover(null);
        // The hit set is the WHOLE result — including facts not yet charted;
        // like a selection pulls its neighbours, a search PULLS ITS HITS into
        // the scene (owner), so they light up as they hydrate rather than being
        // silently dropped for being off-scene.
        hiSet = new Set(allKeys); selKey = null; nbr = null;
        showRing(null);
        applyNodeAlpha(); applyEdgeColor(); syncBeamLabels();
        for (const k of allKeys) if (!nodeById.has(k)) void hydrateKey(k);
        // Turn the shell to the hits already present (their centroid seat
        // direction). Late arrivals land around it as they hydrate — no
        // re-frame churn.
        const pts = allKeys.map((k) => nodeById.get(k)).filter(Boolean);
        if (!pts.length) return;
        const cx = pts.reduce((s, p) => s + p.cdx, 0), cy = pts.reduce((s, p) => s + p.cdy, 0), cz = pts.reduce((s, p) => s + p.cdz, 0);
        if (Math.hypot(cx, cy, cz) > 1e-6) faceCanon(cx, cy, cz);
      });
      window.addEventListener(CONSOLE_RESULT_EVENT, onResult);

      const camPos = new THREE.Vector3();
      // TRUE perspective screen-px per world-unit at a point. focalPx =
      // (H/2)/tan(fov/2), and the scale falls off with CAMERA-SPACE DEPTH (the
      // component along the view axis), not euclidean distance. The old
      // (H/2)/dist silently assumed a 90° lens — so narrowing the telescope FOV
      // ballooned every fixed-size label (~28× at the 4° limit) while the star
      // sprites, whose size ignores FOV, stayed put. Routing all label/caption
      // sizing, collision, and displacement through this keeps a label a fixed
      // pixel size as you telescope — the zoom spreads the field, not the names.
      // (Projection bug surfaced by Sol's investigation, 2026-07-20.)
      const projDepthV = new THREE.Vector3();
      const focalPx = (): number => (H / 2) / Math.tan(camera.fov * Math.PI / 360);
      const camDepth = (pos: any): number => Math.max(1e-3, projDepthV.copy(pos).sub(camPos).dot(fwdV));
      const pxPerWorld = (pos: any): number => focalPx() / camDepth(pos);
      // The JS twin of the shader's farFade: only the re-curled BALL (s < 0)
      // has a far side; it fades by plain camera distance past the ball's
      // centre. Drives label dimming and tap deprioritisation so the far side
      // recedes for the whole scene, not just the dots/edges.
      const farFadeAt = (n: any): number => {
        const k = torchUniforms.uFadeK.value;
        if (k <= 0) return 1;
        return 1 - k * smoothstep(torchUniforms.uFadeNear.value, torchUniforms.uFadeFar.value, -n.z);
      };
      // The label SELECTOR's cone, in JS (decoupled from the lighting torch —
      // the light can be a floodlight while admission stays a sharp beam).
      // axis = camera → focal point.
      const axisV = new THREE.Vector3(), toPV = new THREE.Vector3();
      const smoothstep = (a: number, b: number, x: number): number => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const labelTorchAt = (pos: any): number => {
        const td = axisV.copy(focusVec).sub(camPos).length();
        axisV.multiplyScalar(1 / Math.max(td, 1e-3));
        toPV.copy(pos).sub(camPos);
        const along = toPV.dot(axisV);
        if (along <= 0) return TUNE.torchFloor;
        const radial = toPV.addScaledVector(axisV, -along).length(); // toP - axis*along
        const ang = 1 - smoothstep(TUNE.labelConeIn, TUNE.labelConeOut, radial / along);
        const dep = 1 - smoothstep(SPREAD * TUNE.depthIn, SPREAD * TUNE.depthOut, Math.abs(along - td));
        return Math.max(TUNE.torchFloor, ang * dep);
      };
      // Beam-driven label set: label the nodes the torch is currently lighting
      // (brightest first, capped) plus the pinned set, with hysteresis so labels
      // don't flicker at the beam's edge. This is what lets a sweep of the focal
      // point surface nearby low-salience items.
      const scratchP = new THREE.Vector3();
      const labelTorchNode = (n: any): number => labelTorchAt(scratchP.set(n.x, n.y, n.z));
      // Fewer beam-lit labels on a phone — 28 at once piled up in the core.
      // Quiet default (2026-07-17, Codex P1 "reduce ambient beam labels"):
      // the resting map should show PLACES, not a field of fact names in
      // motion. Ambient cap tightened 12/22 → 8/12; selection/search caps below
      // narrow to "top representatives" so a question freezes the field to its
      // answer, not the whole neighbourhood.
      // Legibility gates (the dense core turned its beam labels into a white
      // pile of 7px mush): a candidate must render big enough to READ, and must
      // not land on top of an already-placed label — greedy, brightest first.
      const projV = new THREE.Vector3();
      const distV = new THREE.Vector3();
      // Third element = NDC z (> 1 means behind the camera — anchor admission
      // must skip those; a behind-camera point still projects to plausible xy).
      const screenXY = (n: any): [number, number, number] => {
        projV.set(n.x, n.y, n.z).project(camera);
        return [((projV.x + 1) / 2) * W, ((1 - projV.y) / 2) * H, projV.z];
      };
      // Text never competes with persistent chrome. This keeps map names out
      // from under the header, the graph controls, and the bottom palette.
      const screenReserved = (sx: number, sy: number, w: number, h: number): boolean =>
        sy - h / 2 < 92 ||
        sy + h / 2 > H - 142 ||
        (sx + w / 2 > W - 292 && sy - h / 2 < 168);
      // TERTIARY layer: the selection fan's REL labels, at edge midpoints —
      // what each connection IS, not just that it exists. Selection-only
      // (search-hit pairs stay unlabelled), capped, and an edge must be long
      // enough on screen for a word to sit on it. Fixed small size and dim
      // colour: these support the neighbourhood, they never compete with it.
      const edgeLabelObjs = new Map<number, any>();
      let edgeLabelSel: string | null = null;
      const syncEdgeLabels = (): void => {
        // A relation label is oriented to the CURRENT selection (its arrow, text
        // and tap-target-far-node). The traversed edge survives across a
        // selection change under the SAME link index, so a reused label would
        // keep pointing at the node you just left — tapping "back" did nothing.
        // Rebuild the whole set when the selection changes.
        if (edgeLabelSel !== selKey) {
          edgeLabelSel = selKey;
          for (const [, obj] of edgeLabelObjs) { scene.remove(obj); obj.element.remove?.(); }
          edgeLabelObjs.clear();
        }
        const want = new Set<number>();
        if (selKey) {
          const cands: Array<[number, number]> = [];
          for (let i = 0; i < links.length; i++) {
            const l = links[i];
            const a = idOf(l.source), b = idOf(l.target);
            if (a !== selKey && b !== selKey) continue;
            const farN = nodeById.get(a === selKey ? b : a);
            if (!farN || !isVis(farN)) continue;
            cands.push([i, farN.rank ?? nodes.length]);
          }
          cands.sort((x, y) => x[1] - y[1]); // label the salient connections first
          const placedMid: Array<[number, number]> = [];
          let added = 0;
          for (const [i] of cands) {
            if (added >= 4) break;
            const l = links[i];
            const aN = nodeById.get(idOf(l.source)), bN = nodeById.get(idOf(l.target));
            const [ax, ay] = screenXY(aN);
            const [bx, by] = screenXY(bN);
            if (Math.hypot(bx - ax, by - ay) < 120) continue; // no room for a word
            const mx = (ax + bx) / 2, my = (ay + by) / 2;
            if (placedMid.some(([px, py]) => Math.abs(px - mx) < 70 && Math.abs(py - my) < 14)) continue;
            placedMid.push([mx, my]);
            want.add(i);
            added++;
          }
        }
        for (const [i, obj] of edgeLabelObjs) {
          if (!want.has(i)) {
            scene.remove(obj);
            obj.element.remove?.();
            edgeLabelObjs.delete(i);
          }
        }
        for (const i of want) {
          if (edgeLabelObjs.has(i)) continue;
          const l = links[i];
          const div = document.createElement('div');
          // Direction relative to the selected fact: → points away (the sel is
          // the source), ← points back (the sel is the target).
          const outgoing = idOf(l.source) === selKey;
          div.textContent = outgoing ? `${l.rel} →` : `← ${l.rel}`;
          // TAPPABLE: a relation is a door — tapping it travels to the fact at
          // the OTHER end of the edge and looks at it. pointer-events:auto so
          // the chip catches the tap; a real hit target padded for fingers.
          div.style.cssText = `font:500 8.5px ui-monospace,monospace;color:${PAL.rel};white-space:nowrap;pointer-events:auto;cursor:pointer;user-select:none;opacity:0.9;padding:6px 8px;margin:-6px -8px`;
          const farKey = outgoing ? idOf(l.target) : idOf(l.source);
          div.addEventListener('click', (ev) => { ev.stopPropagation(); api.current?.select(farKey, true); });
          const obj = new CSS2DObject(div);
          scene.add(obj);
          edgeLabelObjs.set(i, obj);
        }
        positionEdgeLabels();
      };
      // Keep each selected edge's relation WITHIN THE VIEWPORT (owner): the
      // label rides the visible span of its edge, so when the neighbour is off
      // screen the verb is pulled just inside the margin, still tethered by the
      // line, instead of vanishing with its far star. Runs every frame (≤4).
      const EL_V = new THREE.Vector3();
      const clipSpan = (sx: number, sy: number, fx: number, fy: number, xmin: number, ymin: number, xmax: number, ymax: number): [number, number] | null => {
        const dx = fx - sx, dy = fy - sy;
        const p = [-dx, dx, -dy, dy], q = [sx - xmin, xmax - sx, sy - ymin, ymax - sy];
        let t0 = 0, t1 = 1;
        for (let k = 0; k < 4; k++) {
          if (p[k] === 0) { if (q[k] < 0) return null; }
          else { const r = q[k] / p[k]; if (p[k] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; } }
        }
        return [t0, t1];
      };
      const positionEdgeLabels = (): void => {
        if (!edgeLabelObjs.size) return;
        const mX = 40, mTop = 100, mBot = 150; // viewport margins (header / palette)
        for (const [i, obj] of edgeLabelObjs) {
          const l = links[i];
          const selN = l && nodeById.get(selKey ?? '');
          const farN = l && nodeById.get(idOf(l.source) === selKey ? idOf(l.target) : idOf(l.source));
          if (!selN || !farN) { obj.visible = false; continue; }
          const [sx, sy, ssz] = screenXY(selN);
          const [fx, fy, fsz] = screenXY(farN);
          if (ssz > 1) { obj.visible = false; continue; } // anchor end behind camera
          obj.visible = true;
          let tMid = 0.5;
          if (fsz > 1) tMid = 0.14; // neighbour behind camera — hug the selected end
          else {
            const span = clipSpan(sx, sy, fx, fy, mX, mTop, W - mX, H - mBot);
            tMid = span ? (span[0] + span[1]) / 2 : 0.14;
          }
          obj.position.copy(EL_V.set(selN.x, selN.y, selN.z)).lerp(EL_V.set(farN.x, farN.y, farN.z), tMid);
        }
      };

      const beamStreak = new Map<string, number>();
      // Salience order — anchors and beam both admit best-first. LIVE under
      // streaming: refreshed in place (same array identity, closures keep
      // reading it) by recomputeRanks after every appended page.
      const byRank: any[] = [];
      // Recompute rank / focus band / visibility count over the LIVE node set —
      // the per-batch bookkeeping that used to be one-shot model assembly in
      // fetchGraphModel.
      const recomputeRanks = (): void => {
        visCount = recomputeRanksImpl(nodes, meta.focusThreshold, focusKeys, byRank, visFrac);
      };

      // ── constellations: the map's PLACE NAMES ──────────────────────────
      // COMPUTED from the data (salience hubs + dominant member types) — the
      // generic layer. Registered VIEWS are the AUTHORED layer: a view is
      // already a human-named grouping, so it takes the role hand-authored
      // constellation names would otherwise need new machinery for (organ-
      // authored region naming deliberately deferred). Captions are
      // cartographic: faint, tracked-out, uppercase serif at the region's
      // centroid — legible from afar, handing off to fact labels as the
      // camera arrives. The approach fade IS the semantic zoom: continuous,
      // per-region, no tier boundaries to flicker across.
      interface Constellation {
        name: string;
        // Region centre (x/y/z) and caption anchor (ax/ay/az) are MORPHED
        // world positions, re-derived each layout pass from the CANONICAL
        // seats below (unit dir + radius on the un-curled sphere) — captions
        // ride the shell through dome ↔ chart ↔ ball like everything else.
        x: number; y: number; z: number;
        ax: number; ay: number; az: number;
        cdx: number; cdy: number; cdz: number; cr0: number;
        adx: number; ady: number; adz: number; ar0: number;
        r: number; authored: boolean; key?: string;
        grp: any; text: any; pill: any; fs: number; cur: number;
      }
      const constellations: Constellation[] = [];
      const placeOrigin = { x: 0, y: 0, z: 0 };
      const addConstellation = (name: string, cx: number, cy: number, cz: number, cr: number, authored: boolean, key?: string): void => {
        // One caption per name — a view and its placement container (inView
        // edges) are the same place arriving by two routes.
        if (constellations.some((c) => c.name === name)) return;
        // Captions live IN the scene too (owner: pills + occlusion for these
        // as well): billboarded troika text over the same depth-writing pill
        // the labels use. World font size is REGION-proportional — perspective
        // then makes big places read big.
        const grp = new THREE.Group();
        let dx = cx - placeOrigin.x, dy = cy - placeOrigin.y, dz = cz - placeOrigin.z;
        let dd = Math.hypot(dx, dy, dz);
        if (dd < 1) {
          let hash = 0;
          for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
          const a = ((hash % 360) / 180) * Math.PI;
          dx = Math.cos(a); dy = Math.sin(a); dz = 0; dd = 1;
        }
        // Place names sit on the outward shoulder of their territory. Detail
        // can then occupy the centre and emerge as the camera approaches.
        // NOTE: cx/cy/cz arrive in CANONICAL (un-curled sphere) coordinates —
        // computePlaces runs against canonical seats — and are stored as
        // canonical dir+radius; morphLayout derives the world positions.
        const shift = Math.min(cr * 0.38, SPREAD * 0.2);
        const ax = cx + dx / dd * shift, ay = cy + dy / dd * shift, az = cz + dz / dd * shift;
        const text = new TroikaText();
        text.text = name.toUpperCase();
        text.font = FONT_BY_GROUP.kb; // the serif face
        text.fontSize = cr * 0.055;
        text.letterSpacing = 0.12;
        text.anchorX = 'center';
        text.anchorY = 'middle';
        // Authored places carry a whisper of the accent — a view is intent.
        text.color = authored ? PAL.capAuth : PAL.capComp;
        text.outlineColor = PAL.outline;
        // Dusk: hairline (the black pill veil does the masking there). Paper:
        // a REAL knockout — 4% left the caps to be chewed by the tangle
        // (2026-07-12 "captions disappear into the tangle" report; fact
        // labels never had this problem because they get TUNE.labelOutline's
        // 35%). Cartographic convention: area labels overprint detail, but
        // always behind a halo of ground.
        text.outlineWidth = isPaper() ? '14%' : '4%';
        text.fillOpacity = 0;
        text.outlineOpacity = 0;
        text.renderOrder = 9;
        const pill = new THREE.Mesh(pillGeo, mkPillMat());
        pill.visible = false;
        pill.renderOrder = -1;
        grp.add(pill);
        grp.add(text);
        const clen = Math.hypot(cx, cy, cz) || 1;
        const alen = Math.hypot(ax, ay, az) || 1;
        const st: Constellation = {
          name, x: cx, y: cy, z: cz, ax, ay, az, r: cr, authored, key, grp, text, pill, fs: cr * 0.055, cur: 0,
          cdx: cx / clen, cdy: cy / clen, cdz: cz / clen, cr0: clen,
          adx: ax / alen, ady: ay / alen, adz: az / alen, ar0: alen,
        };
        // Seat the caption at its MORPHED position for the current curl.
        curlPos(st.cdx, st.cdy, st.cdz, st.cr0, st);
        curlPos(st.adx, st.ady, st.adz, st.ar0, constAnchorScratch);
        st.ax = constAnchorScratch.x; st.ay = constAnchorScratch.y; st.az = constAnchorScratch.z;
        grp.position.set(st.ax, st.ay, st.az);
        text.sync(() => fitPillTo(text, pill, 0));
        scene.add(grp);
        constellations.push(st);
      };
      // Places are computed ONCE, when the stream completes (finishStream) —
      // they need the whole picture (hubs, membership balls, dominant types),
      // and captions appearing/renaming mid-stream would read as churn.
      const computePlaces = (): void => {
      {
        // Places are computed against CANONICAL seats: temporarily set every
        // node's x/y/z to its un-curled sphere position (the layout helpers
        // read those fields), then mark the layout dirty so the very next
        // frame re-morphs everything back to the current curl.
        for (const n of nodes) { n.x = n.cdx * n.cr0; n.y = n.cdy * n.cr0; n.z = n.cdz * n.cr0; }
        layoutDirty = true;
        const active = nodes.filter((n) => !n.deleted);
        if (active.length) {
          placeOrigin.x = active.reduce((v, n) => v + n.x, 0) / active.length;
          placeOrigin.y = active.reduce((v, n) => v + n.y, 0) / active.length;
          placeOrigin.z = active.reduce((v, n) => v + n.z, 0) / active.length;
        }
        // Place descriptors (salience hubs + membership containers) now come
        // from graph/layout.ts as pure functions; the scene wiring stays here.
        for (const p of salienceHubPlaces(nodes, byRank, SPREAD)) addConstellation(p.name, p.x, p.y, p.z, p.r, false);
        for (const p of membershipPlaces(links, nodeById, idOf, SPREAD)) addConstellation(p.name, p.x, p.y, p.z, p.r, true, p.key);
      }
      // Authored pass, part 2 (async garnish — the scene never waits on it):
      // evaluate registered views, centroid their members present in this
      // slice. A view evaluation costs SECONDS on the gateway, so results are
      // cached (localStorage, 6h) — the sequential version kept the network
      // busy for ~25s per load — and the live pass runs the evals in parallel.
      void (async () => {
        // v2: places are stored in CANONICAL (un-curled sphere) coordinates —
        // older cached entries were world positions and would seat wrong.
        const VC_KEY = 'parc.home.viewplaces.v2';
        try {
          const cached = JSON.parse(localStorage.getItem(VC_KEY) ?? 'null') as { at: number; places: Array<{ name: string; x: number; y: number; z: number; r: number }> } | null;
          if (cached && Date.now() - cached.at < 6 * 3600_000) {
            for (const p of cached.places) addConstellation(p.name, p.x, p.y, p.z, p.r, true);
            return;
          }
        } catch { /* recompute */ }
        try {
          const decl = await mcpCall('read', 'workspace.declarations', { kind: 'view' }).catch(() => null);
          const dv = (decl && decl.ok ? decl.value : null) as any;
          const defs: any[] = Array.isArray(dv) ? dv : (dv?.declarations ?? dv?.views ?? dv?.entries ?? []);
          const ids = defs.map((d: any) => (typeof d === 'string' ? d : (d?.id ?? d?.name))).filter(Boolean).slice(0, 6);
          const places: Array<{ name: string; x: number; y: number; z: number; r: number }> = [];
          await Promise.all(ids.map(async (id) => {
            const r = await mcpCall('read', 'workspace.evaluate', { kind: 'view', id }).catch(() => null);
            if (disposed || !r || !r.ok) return;
            const keys = keysOfResult(r.value).filter((k) => nodeById.has(k));
            if (keys.length < 3) return;
            // Centroid in CANONICAL coordinates (seat dir × radius) — live
            // node positions are morphed by whatever the curl is right now.
            const pts = keys.map((k) => nodeById.get(k));
            const cx = pts.reduce((s, p) => s + p.cdx * p.cr0, 0) / pts.length;
            const cy = pts.reduce((s, p) => s + p.cdy * p.cr0, 0) / pts.length;
            const cz = pts.reduce((s, p) => s + p.cdz * p.cr0, 0) / pts.length;
            const dists = pts.map((p) => Math.hypot(p.cdx * p.cr0 - cx, p.cdy * p.cr0 - cy, p.cdz * p.cr0 - cz)).sort((a, b) => a - b);
            const cr = Math.max(SPREAD * 0.18, dists[Math.floor(dists.length * 0.8)] ?? SPREAD * 0.3);
            const vname = String(id);
            places.push({ name: vname.length > 24 ? vname.slice(0, 23) + '…' : vname, x: cx, y: cy, z: cz, r: cr });
          }));
          if (disposed) return;
          for (const p of places) addConstellation(p.name, p.x, p.y, p.z, p.r, true);
          try { localStorage.setItem(VC_KEY, JSON.stringify({ at: Date.now(), places })); } catch { /* */ }
        } catch { /* views are optional */ }
      })();
      }; // end computePlaces
      const constV = new THREE.Vector3();
      // Tap target: a visible caption's projected rect (troika's real layout
      // bounds, finger-padded).
      // Same two-tier rects as labelAt: tight = the visible caption box,
      // slop = the padded finger fallback (see onUp's precedence comment).
      const constellationAt = (cx: number, cy: number, slop: boolean): Constellation | null => {
        for (const c of constellations) {
          if (c.cur < 0.15) continue;
          const pxPer = pxPerWorld(constV.set(c.ax, c.ay, c.az)) * (c.grp.scale?.x || 1);
          constV.set(c.ax, c.ay, c.az).project(camera);
          if (constV.z > 1) continue;
          const sx = ((constV.x + 1) / 2) * W, sy = ((1 - constV.y) / 2) * H;
          const b = c.text.textRenderInfo?.blockBounds as [number, number, number, number] | undefined;
          const rawH = b ? (b[3] - b[1]) * pxPer : c.fs * 1.4 * pxPer;
          const rawW = b ? (b[2] - b[0]) * pxPer : c.name.length * c.fs * 0.85 * pxPer;
          const w = slop ? Math.max(56, rawW + 24) : rawW + rawH;
          const h = slop ? Math.max(36, rawH + 16) : rawH * 1.55;
          if (Math.abs(cx - sx) < w / 2 && Math.abs(cy - sy) < h / 2) return c;
        }
        return null;
      };
      // Display order: authored places (views, boards, docs) OUTRANK computed
      // ones for the caption budget — a human named those.
      const constOrdered = (): Constellation[] =>
        [...constellations].sort((a, b) => (b.authored ? 1 : 0) - (a.authored ? 1 : 0));
      const updateConstellations = (dt: number): void => {
        const k = Math.min(1, dt * TUNE.labelFade * 0.5); // captions ease slower than labels
        // ONE budget for all captions, tighter on a phone (the container pass
        // pushed mobile past ten captions — a pile, not a map).
        const capTotal = Math.min(TUNE.constCap, Math.min(W, H) < 700 ? 4 : 8);
        let shown = 0;
        // Captions declutter against EACH OTHER in screen space (authored
        // first) — the first render piled three names on the dense core. A
        // losing caption fades, it doesn't pop.
        const placedCaps: Array<[number, number, number, number]> = [];
        const labelRects: Array<[number, number, number, number]> = [];
        for (const [id, st] of labelObjs) {
          if (st.cur < 0.15 || st.dying) continue;
          const n = nodeById.get(id);
          if (!n) continue;
          const pxPer = pxPerWorld(st.grp.position) * (st.scl || 1);
          const bounds = st.text.textRenderInfo?.blockBounds as [number, number, number, number] | undefined;
          const rawH = bounds ? (bounds[3] - bounds[1]) * pxPer : st.text.fontSize * pxPer * 1.3;
          const rawW = bounds ? (bounds[2] - bounds[0]) * pxPer : Math.min(16, String(n.label).length) * st.text.fontSize * pxPer * 0.62;
          const [lx, ly] = screenXY(n);
          labelRects.push([lx + st.cox, ly + st.coy + rawH * 0.58 + 4, rawW + rawH + 8, rawH * 1.55 + 4]);
        }
        for (const c of constOrdered()) {
          let target = 0;
          if (shown < capTotal) {
            // Approach fade: a caption reads from AFAR and yields to fact
            // labels as you close in. The camera never moves now, so "how
            // close you are" is the TELESCOPE: scale the (fixed) distance by
            // the fov's magnification so zooming into a region fades its
            // caption out and hands over to the fact names.
            const zoomMag = Math.tan(camera.fov * Math.PI / 360) / Math.tan(FOV_WIDE * Math.PI / 360);
            const camD = camPos.distanceTo(constV.set(c.ax, c.ay, c.az)) * zoomMag;
            target = TUNE.constOpacity * smoothstep(c.r * TUNE.constNear, c.r * TUNE.constFar, camD);
            if (target > 0.02) {
              // Captions render at a FIXED screen size (below), so the declutter
              // box uses that size, not a depth-projected one.
              const fontPx = TUNE.labelPx * 0.82;
              constV.set(c.ax, c.ay, c.az).project(camera);
              if (constV.z > 1) target = 0;
              else {
                const sx = ((constV.x + 1) / 2) * W, sy = ((1 - constV.y) / 2) * H;
                const w = c.name.length * fontPx * 0.85; // caps + tracking
                const h = fontPx * 1.7;
                if (
                  screenReserved(sx, sy, w, h) ||
                  placedCaps.some(([px2, py2, pw2, ph2]) => Math.abs(px2 - sx) < (pw2 + w) / 2 && Math.abs(py2 - sy) < (ph2 + h) / 2) ||
                  labelRects.some(([px2, py2, pw2, ph2]) => Math.abs(px2 - sx) < (pw2 + w) / 2 && Math.abs(py2 - sy) < (ph2 + h) / 2)
                ) target = 0;
                else {
                  placedCaps.push([sx, sy, w, h]);
                  shown++;
                }
              }
            }
          }
          c.cur += (target - c.cur) * k;
          c.grp.quaternion.copy(camera.quaternion); // billboard
          // Captions are fixed screen size too (via the true fov-aware
          // projection, so the telescope doesn't zoom them): a place-name reads
          // at a steady size and only its approach-fade (opacity) carries
          // distance. A hair under the fact-label size (owner: "all-caps
          // captions too large") — the caps + tracking give them their weight.
          const curPx = c.fs * pxPerWorld(constV.set(c.ax, c.ay, c.az));
          const targetPx = TUNE.labelPx * 0.82;
          c.grp.scale.setScalar(curPx > 0.01 ? targetPx / curPx : 1);
          c.text.fillOpacity = c.cur;
          c.text.outlineOpacity = c.cur;
          // Same depth-clip occluder as the labels: the caption clears a patch
          // of sky behind itself once it is substantially present.
          c.pill.visible = TUNE.pillClip > 0 && c.cur > 0.45;
        }
      };
      // Breadcrumb — "where am I": selecting a fact names its neighbourhood in
      // a transient caption at the top of the scene, then gets out of the way.
      const crumb = document.createElement('div');
      crumb.style.cssText = `position:absolute;top:calc(env(safe-area-inset-top, 0px) + 10px);left:50%;transform:translateX(-50%);z-index:5;pointer-events:none;font-family:${TYPE_SERIF};font-size:11px;font-weight:400;letter-spacing:0.22em;text-transform:uppercase;color:${PAL.capComp};opacity:0;transition:opacity 0.7s;${LABEL_HALO}`;
      el.appendChild(crumb);

      // ── scene-mode switch: restyle the LIVE scene (no rebuild). Dusk is
      // the luminous field; paper is the same map printed as a star atlas —
      // ink on warm ground, normal blending, no bloom. ──
      const applyMode = (): void => {
        PAL = paletteFor(TUNE.sceneMode);
        const paper = isPaper();
        // See the construction-time comment above: paper's flat colours want
        // no filmic curve, or they desaturate toward grey.
        renderer.toneMapping = paper ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = paper ? 1 : TUNE.exposure;
        scene.background = new THREE.Color(PAL.bg);
        // The atmosphere is a dusk phenomenon — paper is a flat cream chart.
        skyDome.visible = !paper;
        skyUniforms.uBase.value.set(PAL.bg);
        ptMat.uniforms.uPaper.value = paper ? 1 : 0;
        ptMat.blending = paper ? THREE.NormalBlending : THREE.CustomBlending;
        // Different PRIMITIVE per mode, not just different constants: paper
        // renders crisp engraved stipple dots, dusk the soft bloomable star.
        ptMat.uniforms.uTex.value = paper ? stipple : disc;
        eMat.uniforms.uPaper.value = paper ? 1 : 0;
        eMat.blending = paper ? THREE.NormalBlending : THREE.CustomBlending;
        applyNodeColors();
        (geo.attributes.color as any).needsUpdate = true;
        applyEdgeColor();
        ringMat.color = new THREE.Color(PAL.accent);
        hoverMat.color = new THREE.Color(PAL.text);
        for (const [, st] of labelObjs) {
          st.text.outlineColor = PAL.outline;
        }
        for (const c of constellations) {
          c.text.color = c.authored ? PAL.capAuth : PAL.capComp;
          c.text.outlineColor = PAL.outline;
          c.text.outlineWidth = paper ? '14%' : '4%'; // see addConstellation
        }
        for (const [, o] of edgeLabelObjs) (o.element as HTMLElement).style.color = PAL.rel;
        crumb.style.color = PAL.capComp;
        // The DOM crumb's baked-in dusk halo is a black smudge on paper.
        crumb.style.textShadow = paper ? 'none' : '0 1px 3px #000,0 -1px 3px #000,1px 0 3px #000,-1px 0 3px #000,0 0 2px #000';
      };
      let crumbTimer: ReturnType<typeof setTimeout> | null = null;
      const showCrumb = (key: string | null): void => {
        const n = key ? nodeById.get(key) : null;
        let best: Constellation | null = null;
        let bestD = Infinity;
        if (n) {
          // Region membership in CANONICAL coordinates — curl-independent.
          const nx = n.cdx * n.cr0, ny = n.cdy * n.cr0, nz = n.cdz * n.cr0;
          for (const c of constellations) {
            const d = Math.hypot(nx - c.cdx * c.cr0, ny - c.cdy * c.cr0, nz - c.cdz * c.cr0);
            if (d < c.r * 1.6 && d < bestD) { best = c; bestD = d; }
          }
        }
        if (crumbTimer) { clearTimeout(crumbTimer); crumbTimer = null; }
        if (!best) { crumb.style.opacity = '0'; return; }
        crumb.textContent = best.name;
        crumb.style.opacity = '0.85';
        crumbTimer = setTimeout(() => { crumb.style.opacity = '0'; }, 3500);
      };

      const syncBeamLabels = (): void => {
        syncEdgeLabels();
        const now = performance.now();
        for (const [id, until] of hoverRetiredUntil) if (until <= now) hoverRetiredUntil.delete(id);
        const hoverSuppressed = (id: string): boolean => (hoverRetiredUntil.get(id) ?? 0) > now;
        const want = new Map<string, LabelWant>();
        type Rect = [number, number, number, number];
        const placed: Rect[] = [];
        const pxOf = (n: any, role: LabelRole): number => {
          // Labels are a FIXED screen size (labelPx × role-mult), independent of
          // depth and node radius — so admission ranks by the size it will
          // actually render at, immediately (no first-frame estimate drift).
          const incumbent = labelObjs.get(n.id);
          return TUNE.labelPx * (incumbent?.mult ?? roleMult(role));
        };
        // Prefer Troika's measured glyph bounds once available. Before its
        // first sync, approximate from the same 10-em wrap used by makeLabel.
        const dimsOf = (n: any, role: LabelRole): [number, number] => {
          const st = labelObjs.get(n.id);
          const pxPer = pxPerWorld(distV.set(n.x, n.y, n.z)) * (st?.scl ?? 1);
          const b = st?.text.textRenderInfo?.blockBounds as [number, number, number, number] | undefined;
          if (b) {
            const rawW = (b[2] - b[0]) * pxPer;
            const rawH = (b[3] - b[1]) * pxPer;
            return [Math.max(34, rawW + rawH + 8), Math.max(16, rawH * 1.55 + 4)];
          }
          const fs = Math.max(6, pxOf(n, role));
          const chars = String(n.label).length;
          const lineChars = 16;
          const lines = Math.max(1, Math.ceil(chars / lineChars));
          return [Math.max(34, Math.min(lineChars, chars) * fs * 0.62 + fs + 8), Math.max(16, lines * fs * 1.2 + 5)];
        };
        const collides = (r: Rect): boolean =>
          placed.some((p) => Math.abs(p[0] - r[0]) < (p[2] + r[2]) / 2 && Math.abs(p[1] - r[1]) < (p[3] + r[3]) / 2);
        const rectOf = (n: any, role: LabelRole, ox = 0, oy = 0): Rect => {
          const [sx, sy] = screenXY(n);
          const [w, h] = dimsOf(n, role);
          // Text hangs below the point; test the box where it actually reads,
          // not centred on the node.
          return [sx + ox, sy + oy + h * 0.56 + 4, w, h];
        };
        const admit = (n: any, role: LabelRole, ox = 0, oy = 0, force = false): boolean => {
          const r = rectOf(n, role, ox, oy);
          if (!force && (screenReserved(r[0], r[1], r[2], r[3]) || collides(r))) return false;
          placed.push(r);
          want.set(n.id, { role, ox, oy });
          return true;
        };
        const mobile = Math.min(W, H) < 700;
        // THE NAME BUDGET (coupled-workspace co-sizing): one mind-sized ceiling
        // on how many names are legible at once — a couple dozen, the focus band
        // the read ignites into. Every register spends from it; this is THE dial
        // to move first (the registers make the count legible, so it can rise).
        const focusBand = TUNE.focusBand > 0 ? TUNE.focusBand : (mobile ? 14 : 22);
        // Register 2 (Focus/ignition): the selection's structure OWNS the band
        // when a question is active — sel + its top neighbours + search hits.
        const neighbourCap = mobile ? 3 : 5;
        const hitCap = mobile ? 6 : 9;
        // Register 1 (Landmarks/orientation): a persistent, grid-distributed
        // slice of the band — the steady "north" the resting sky keeps.
        const anchorCap = Math.min(TUNE.anchorCap, Math.max(2, Math.round(focusBand * TUNE.landmarkFrac)));

        // The selected fact and hover preview are declarations: always label
        // them, even in a reserved screen zone. Hover never changes camera or
        // graph focus; it previews precisely what pointer-up would select.
        if (selKey) {
          const n = nodeById.get(selKey);
          if (n && isVis(n)) admit(n, 'sel', 0, 0, true);
        }
        if (hoverLabelKey && hoverLabelKey === hoverKey && !want.has(hoverLabelKey)) {
          const n = nodeById.get(hoverLabelKey);
          if (n && isVis(n)) admit(n, 'hover', 0, 0, true);
        }

        if (hiSet) {
          let added = 0;
          const hits = [...hiSet]
            .map((id) => nodeById.get(id))
            .filter((n) => n && isVis(n) && !want.has(n.id))
            .sort((a, b) => (a.rank ?? nodes.length) - (b.rank ?? nodes.length));
          for (const n of hits) {
            if (added >= hitCap) break;
            if (admit(n, 'hit')) added++;
          }
        }

        if (selKey && nbr) {
          let added = 0;
          // Preserve incumbent neighbour slots, but within an explicit detail
          // budget. The palette carries the complete neighbourhood; the map
          // presents only the most legible representatives.
          for (const [id, st] of labelObjs) {
            if (added >= neighbourCap) break;
            if (st.role !== 'nbr' || st.dying || !nbr.has(id) || want.has(id)) continue;
            const n = nodeById.get(id);
            if (n && isVis(n) && admit(n, 'nbr', st.ox, st.oy)) added++;
          }
          const cands = [...nbr]
            .map((id) => nodeById.get(id))
            .filter((n) => n && isVis(n) && !want.has(n.id))
            .sort((a, b) => (a.rank ?? nodes.length) - (b.rank ?? nodes.length));
          for (const n of cands) {
            if (added >= neighbourCap) break;
            const [w, h] = dimsOf(n, 'nbr');
            const dx = w * 0.55 + 14;
            const dy = h + 9;
            const prev = labelObjs.get(n.id);
            const tries: Array<[number, number]> = [
              [0, 0], [0, dy], [0, -dy], [dx, 0], [-dx, 0],
              [dx * 0.72, dy * 0.72], [-dx * 0.72, dy * 0.72],
              [dx * 0.72, -dy * 0.72], [-dx * 0.72, -dy * 0.72],
            ];
            if (prev && (prev.ox || prev.oy)) tries.unshift([prev.ox, prev.oy]);
            for (const [ox, oy] of tries) {
              if (admit(n, 'nbr', ox, oy)) { added++; break; }
            }
          }
        }

        // ── REGISTER 1 — LANDMARKS (orientation) ──
        // At rest, a sparse 3×3 wayfinding layer marks broad territories: the
        // standing-highest name per screen region, persistent across visits —
        // the "north" that lets spatial memory accrue. Steady, grid-distributed,
        // pill-backed (a committed name). Spends the reserved slice of the band.
        // Landmarks stand THROUGH a selection: the orientation layer is the
        // resting "north," and a selection makes one thing prominent without
        // erasing the map around it (owner: "labels' existing tuned dim is
        // right, selection is just more prominent"). They share the one name
        // budget with everything else, so the total stays mind-sized.
        let landmarksShown = 0;
        if (anchorCap > 0) {
          const takenCell = new Set<number>();
          const tryAnchor = (n: any): void => {
            if (landmarksShown >= anchorCap || !n || !isVis(n) || want.has(n.id) || hoverSuppressed(n.id) || !placeworthy(n.label)) return;
            const [sx, sy, sz] = screenXY(n);
            if (sz > 1 || sx < 0 || sx > W || sy < 0 || sy > H) return;
            const cell = Math.min(2, Math.floor((sy / H) * 3)) * 3 + Math.min(2, Math.floor((sx / W) * 3));
            if (takenCell.has(cell)) return;
            if (!admit(n, 'anchor')) return;
            takenCell.add(cell);
            landmarksShown++;
          };
          for (const [id, st] of labelObjs) {
            if (st.role === 'anchor' && !st.dying) tryAnchor(nodeById.get(id));
          }
          for (const n of byRank) {
            if (landmarksShown >= anchorCap) break;
            tryAnchor(n);
          }
        }

        // ── REGISTER 3 — SUGGESTIONS (peripheral) ──
        // The whispered "what could I look at next": beam catches near the line
        // of approach. They spend the REMAINDER of the band after landmarks (so
        // total legible names stay mind-sized), are silent while a question owns
        // the scene, and render as a DIFFERENT VOICE (pill-less, dim — see
        // updateLabels) so a suggestion never reads as a result. Distributed
        // per screen TERRITORY (a 4×3 grid, ≤ beamPerCell each) so a dense
        // cluster can't monopolise the whisper and starve a sparse region.
        // The remainder of the ONE budget after everything already admitted
        // (selection, hits, neighbours, landmarks) — so at rest OR under a
        // selection the total legible names stay mind-sized, and the whisper
        // fills whatever is left rather than being silenced outright.
        const suggestBudget = Math.max(0, focusBand - want.size);
        const lit: Array<[string, number]> = [];
        for (const n of nodes) {
          if (!isVis(n) || want.has(n.id) || hoverSuppressed(n.id) || (n.id === hoverKey && hoverLabelKey !== hoverKey)) continue;
          const t = labelTorchNode(n);
          if (t > TUNE.beamOn || (labelObjs.has(n.id) && t > TUNE.beamOff)) {
            lit.push([n.id, t + (labelObjs.get(n.id)?.role === 'beam' ? 0.2 : 0)]);
          }
        }
        lit.sort((a, b) => b[1] - a[1]);
        const inBeam = new Set<string>();
        const cellUsed = new Map<number, number>();
        let added = 0;
        for (const [id] of lit) {
          if (added >= suggestBudget) break;
          const n = nodeById.get(id);
          const [sx, sy, sz] = screenXY(n);
          if (sz > 1) continue; // behind the camera
          // Territory fairness: ≤ beamPerCell suggestions per 4×3 screen cell.
          const cell = Math.min(2, Math.floor((sy / H) * 3)) * 4 + Math.min(3, Math.floor((sx / W) * 4));
          if ((cellUsed.get(cell) ?? 0) >= TUNE.beamPerCell) continue;
          const r = rectOf(n, 'beam');
          if (screenReserved(r[0], r[1], r[2], r[3]) || collides(r)) continue;
          inBeam.add(id);
          const streak = (beamStreak.get(id) ?? 0) + 1;
          beamStreak.set(id, streak);
          if (streak < 2 && !labelObjs.has(id)) continue;
          placed.push(r);
          want.set(id, { role: 'beam' });
          cellUsed.set(cell, (cellUsed.get(cell) ?? 0) + 1);
          added++;
        }
        for (const id of [...beamStreak.keys()]) if (!inBeam.has(id)) beamStreak.delete(id);
        reconcileLabels(want);
      };
      // Label size is a WORLD quantity now (fontWorld) — perspective produces
      // the exact px = world·(H/2)/camD relation the CSS layer used to compute
      // per frame, so depth honesty is structural, not simulated. Roles keep
      // differentiating by multiplier, colour, and opacity.
      const updateLabels = (dt: number): void => {
        const k = Math.min(1, dt * TUNE.labelFade); // ~150ms to settle — a fade, not a pop
        for (const [id, st] of labelObjs) {
          const n = nodeById.get(id);
          st.grp.quaternion.copy(camera.quaternion); // billboard
          const camD = camPos.distanceTo(st.grp.position) || 1;
          const nodePx = rad(n) * 2.4 * (H / 2) / camD; // node's on-screen diameter
          const torch = labelTorchAt(st.grp.position);
          let target: number;
          let color = PAL.text;
          const t = Math.max(0, Math.min(1, (nodePx - 6) / 22)); // 0 = far, 1 = near
          if (st.role === 'sel') {
            // Selection: the one loud name — full accent gold, + the ring.
            target = 1;
            color = PAL.accent;
          } else if (st.role === 'hover') {
            // Preview: accent gold, but a step quieter — clearly provisional
            // (the ring/crumb belong to a committed Selection, not this).
            target = 0.72;
            color = PAL.accent;
          } else if (st.role === 'hit') {
            // Answers: the one cool hue — the result cohort reads as a set.
            target = 1;
            color = PAL.answer;
          } else if (st.role === 'nbr') {
            // Neighbours: cream, attached to the Selection by the bright fan.
            target = TUNE.nbrOpFar + (TUNE.nbrOpNear - TUNE.nbrOpFar) * t; // far neighbours recede
          } else if (st.role === 'anchor') {
            // Landmarks: dim warm-grey, small tracked (set on the text) — the
            // steady wayfinding layer, never mistaken for a fact result.
            target = TUNE.anchorOpacity;
            color = PAL.dim;
          } else {
            // Suggestions: cream but faintest of all — the torch's gentle slope
            // keeps them a whisper; opacity, not a different cut, sets them apart.
            // The beam's GENTLE slope: opacity rises smoothly from ~0 at the
            // admission boundary to its ceiling as the beam centres a node —
            // no cliff where labels used to pop.
            target = TUNE.beamOpacity * smoothstep(TUNE.beamOff, 0.95, torch);
          }
          // Paper mode has no additive glow to carry a fractional alpha — the
          // SAME 0.57 ceiling that reads as a soft dusk glow reads as flat gray
          // ink on paper (2026-07-12 owner report: "muddy grey" labels, edges
          // already had this exact compensation via eMat's `min(x*2.5,1)` gain,
          // labels never did). Gains toward full ink as admission approaches
          // its own ceiling, instead of capping at a fraction of it.
          if (isPaper()) target = Math.min(target * 2.5, 1);
          // Far side of the orrery recedes for LABELS too (owner) — the same
          // near/far fade the dots and edges use, so a name on the back of the
          // globe dims out (and, below ~0.2, stops catching taps via labelAt).
          target *= farFadeAt(st.grp.position);
          // Hard cull past the rim when far-occlusion clip is engaged (matches
          // the points' clip), unless this label's node is the selection/hit.
          const clipZ = torchUniforms.uFarClip.value;
          if (clipZ > 0.5 && -st.grp.position.z > clipZ && st.role !== 'sel' && st.role !== 'hit' && st.role !== 'nbr') target = 0;
          if (st.dying) target = 0;
          const opacityK = st.dying && st.role === 'hover' ? Math.min(1, dt * 24) : k;
          st.cur += (target - st.cur) * opacityK;
          if (st.dying && st.cur < 0.03) {
            scene.remove(st.grp);
            st.text.dispose?.();
            st.pill.material.dispose?.();
            labelObjs.delete(id);
            continue;
          }
          // Collision displacement (screen px → world at this depth) eases to
          // its target; the hairline leader spans node → displaced label.
          st.cox += (st.ox - st.cox) * k;
          st.coy += (st.oy - st.coy) * k;
          const pxW = 1 / pxPerWorld(st.grp.position); // world units per screen px (fov-aware)
          const displaced = Math.abs(st.cox) + Math.abs(st.coy) > 1.5;
          st.inner.position.set(st.cox * pxW, -st.coy * pxW, 0);
          if (displaced) {
            st.leader.visible = true;
            const lp = st.leader.geometry.attributes.position;
            lp.setXYZ(0, 0, 0, 0);
            lp.setXYZ(1, st.cox * pxW, -st.coy * pxW - rad(n) * 0.6, 0);
            lp.needsUpdate = true;
            st.leader.material.opacity = 0.55 * st.cur;
          } else st.leader.visible = false;
          st.text.color = color;
          st.text.fillOpacity = st.cur;
          st.text.outlineOpacity = st.cur;
          // The clip occluder (renderOrder −1, depth-only) switches on once the
          // label is substantially present — a faint whisper clips nothing, so
          // the sky doesn't flicker with half-formed knock-outs. SUGGESTIONS
          // clip only when beamPill is on: a whisper normally carries no
          // committed-name clearing, the register differentiator.
          const clip = TUNE.pillClip > 0 && (st.role !== 'beam' || TUNE.beamPill > 0.5);
          st.pill.visible = clip && st.cur > 0.45;
          // FIXED SCREEN SIZE: scale the world-unit glyph so it lands at exactly
          // labelPx × role-mult on screen — via the TRUE perspective (pxPerWorld,
          // fov-aware), so it stays that pixel size as you telescope in. Applied
          // DIRECTLY (no easing): a label never animates its size, it only fades
          // (st.cur). The node-radius term in fontWorld cancels out here, so a
          // big hub gets a big DOT, not a big name.
          const fsPx = st.text.fontSize * pxPerWorld(st.grp.position); // true projected px
          const targetPx = TUNE.labelPx * st.mult;
          st.scl = fsPx > 0.01 ? targetPx / fsPx : 1;
          st.inner.scale.setScalar(st.scl);
        }
      };

      const clock = new THREE.Clock();
      let beamFrame = 0;
      const tick = (): void => {
        if (disposed) return;
        raf = requestAnimationFrame(tick);
        const delta = clock.getDelta();
        // ── advance the SHELL (the camera never moves; no idle auto-spin — a
        // place you inhabit holds still, the sphere waits for your hand). ──
        const dragging = pointerDown && moved;
        if (shellQT) {
          // Eased turn-to-face: slerp the shell toward its target orientation.
          shellQ.slerp(shellQT, Math.min(1, delta * 10));
          layoutDirty = true;
          if (shellQ.angleTo(shellQT) < 0.002) { shellQ.copy(shellQT); shellQT = null; }
        } else if (!dragging && (Math.abs(velRX) > 1e-5 || Math.abs(velRY) > 1e-5)) {
          // Momentum glide: carry the last drag's angular velocity, decay it —
          // a hand-thrown globe coasting to rest.
          rotateShell(velRX, velRY);
          velRX *= 0.92; velRY *= 0.92;
          if (Math.abs(velRX) < 1e-5) velRX = 0;
          if (Math.abs(velRY) < 1e-5) velRY = 0;
        }
        // Ease the one zoom axis; derive fov + curvature; re-seat if the shell
        // moved or bent this frame.
        if (Math.abs(zoomZT - zoomZ) > 1e-4) {
          zoomZ += (zoomZT - zoomZ) * Math.min(1, delta * 6);
          if (Math.abs(zoomZT - zoomZ) < 1e-4) zoomZ = zoomZT;
        }
        const zs = zoomOf(zoomZ);
        if (Math.abs(zs.s - curlS) > 1e-5) { curlS = zs.s; layoutDirty = true; }
        if (Math.abs(camera.fov - zs.fov) > 1e-3) { camera.fov = zs.fov; camera.updateProjectionMatrix(); }
        if (layoutDirty) morphLayout();
        // The atmosphere belongs to the DOME: full when the sky is curled
        // around you, gone by the time it has unfurled flat (a chart has no
        // airglow). Rides the curvature.
        skyUniforms.uAtmo.value = TUNE.atmosphere * Math.max(0, curlS);
        // Far-side fade: only the re-curled ball (s<0) has a back. Keyed on gaze
        // depth (−z): near pole ≈SHELL, equator ≈2·SHELL, far pole ≈3·SHELL (at
        // s=−1). Additive glow reads through the shell even at 40%, so we kill
        // the back HARD — fade to ~0 starting AT the equator (the visible rim),
        // so at rest you see the near cap solid and the far hemisphere is gone;
        // only edges trail off into the dark, and a selected far node keeps a
        // faint glow (selection boost is applied AFTER farFade in the shader).
        // −z spans r0 (near cap) to 3·r0 (far pole); the equator/rim is at 2·r0.
        // TUNE.farOcclude ∈ [0,1] sets how hard the far hemisphere is hidden:
        //   soft fade (uFadeK) always ramps up with the knob, AND at high values a
        //   hard clip (uFarClip) culls everything past the rim — additive glow
        //   can't be faded to nothing, so opacity alone never fully occludes.
        if (curlS < -0.05) {
          const occ = Math.max(0, Math.min(1, TUNE.farOcclude));
          const rim = SHELL * (1 + 1 * -curlS);          // equator/rim −z (2·SHELL at s=−1)
          torchUniforms.uFadeK.value = -curlS * occ;     // fade strength scales with the knob
          torchUniforms.uFadeNear.value = rim * 0.78;    // start fading before the rim
          torchUniforms.uFadeFar.value = rim * 1.0;      // fully faded by the rim
          // Hard clip engages in the top of the knob's range (0.6→1), tightening
          // from just past the rim down toward the rim itself at max.
          torchUniforms.uFarClip.value = occ > 0.6
            ? rim * (1.08 - 0.08 * ((occ - 0.6) / 0.4))   // 1.08·rim → 1.0·rim
            : 0;
        } else { torchUniforms.uFadeK.value = 0; torchUniforms.uFarClip.value = 0; }
        // Feed the beam (fixed camera + focal point) to the torch + labels.
        camPos.copy(camera.position);
        torchUniforms.uFocus.value.copy(focusVec);
        torchUniforms.uCam.value.copy(camPos);
        eMat.uniforms.uTime.value = clock.elapsedTime;
        // Re-pick the beam-lit label set a few times a second (DOM churn is the
        // cost; the beam moves slowly), then size/opacity every frame.
        if ((beamFrame = (beamFrame + 1) % 5) === 0) syncBeamLabels();
        updateLabels(delta);
        updateConstellations(delta);
        positionEdgeLabels(); // keep selected relations inside the viewport
        sizeRing();           // hold the selection ring snug to its star at any FOV

        if (useBloom()) {
          ensureComposer();
          composer.render();
        } else renderer.render(scene, camera);
        labelRenderer.render(scene, camera);
      };
      tick();

      const resize = (): void => {
        const w = el.clientWidth, h = el.clientHeight;
        if (!w || !h) return;
        W = w; H = h;
        camera.aspect = W / H; camera.updateProjectionMatrix();
        renderer.setSize(W, H); labelRenderer.setSize(W, H); composer?.setSize(W, H);
        ptMat.uniforms.uScale.value = H / 2;
      };
      ro = new ResizeObserver(resize);
      ro.observe(el);

      // ── the tuner (?tune=1, sticky; ?tune=0 clears): lil-gui over TUNE.
      // Touch-friendly, loads from esm.sh like the rest of the 3D stack, and
      // only ever mounts behind the flag — a field instrument for dialling the
      // torch/beam/label/edge/bloom feel on live data. `copy values` puts the
      // current JSON on the clipboard to send back for hard-coding.
      let gui: any = null;
      if (tuneEnabled()) {
        void import(/* @vite-ignore */ esmURL('lil-gui@0.19.2')).then((m: any) => {
          if (disposed) return;
          const GUI = m.default ?? m.GUI;
          gui = new GUI({ title: 'graph tune' });
          gui.domElement.style.cssText = 'position:fixed;top:164px;right:8px;z-index:60;max-height:calc(100dvh - 176px);overflow-y:auto';
          // Persist to BOTH the fast local cache (immediate, for next paint)
          // and the substrate config fact (debounced — a drag fires onChange
          // continuously; only write the fact once the dial settles).
          let saveTimer: ReturnType<typeof setTimeout> | null = null;
          const persist = (): void => {
            try { localStorage.setItem(TUNE_LS, JSON.stringify(TUNE)); } catch { /* */ }
            if (saveTimer) clearTimeout(saveTimer);
            saveTimer = setTimeout(() => { void saveTuneConfig({ ...TUNE }); }, 700);
          };
          let lastSpike = TUNE.starSpike;
          const refresh = (): void => {
            if (TUNE.starSpike !== lastSpike) {
              lastSpike = TUNE.starSpike;
              const t = makeStarTexture(THREE, TUNE.starSpike);
              disc.dispose?.();
              disc = t;
              const st2 = makeStippleTexture(THREE, TUNE.starSpike);
              stipple.dispose?.();
              stipple = st2;
              // Each mode keeps ITS OWN texture current under the spike dial —
              // dusk the soft bloomable star, paper the crisp ink star.
              ptMat.uniforms.uTex.value = isPaper() ? st2 : t;
            }
            torchUniforms.uConeIn.value = TUNE.coneIn;
            torchUniforms.uConeOut.value = TUNE.coneOut;
            torchUniforms.uDepthIn.value = SPREAD * TUNE.depthIn;
            torchUniforms.uDepthOut.value = SPREAD * TUNE.depthOut;
            torchUniforms.uFloor.value = TUNE.torchFloor;
            torchUniforms.uSizeBoost.value = TUNE.boostSizeGain;
            eMat.uniforms.uFlowSpeed.value = TUNE.edgeFlowSpeed;
            eMat.uniforms.uFlowWidth.value = TUNE.edgeFlowWidth;
            // Edge flow is selection-only already (focus edges carry the pulse);
            // disable it on mobile/coarse-pointer screens (Codex P1) — the moving
            // ink is fill-rate cost and visual noise where the viewport is small.
            eMat.uniforms.uFlowGain.value = bigScreen ? TUNE.edgeFlowGain : 0;
            eMat.uniforms.uFlowCycles.value = TUNE.edgeFlowCycles;
            if (useBloom()) ensureComposer();
            if (bloomPass) {
              bloomPass.strength = TUNE.bloomStrength;
              bloomPass.radius = TUNE.bloomRadius;
              bloomPass.threshold = TUNE.bloomThreshold;
            }
            // Paper stays untone-mapped regardless of the exposure knob — see
            // applyMode()'s comment. Every OTHER slider change routes through
            // this same refresh(), so it has to hold that line too, not just
            // the sceneMode toggle.
            renderer.toneMappingExposure = isPaper() ? 1 : TUNE.exposure;
            applyNodeAlpha();
            applyEdgeColor();
            // Re-grade the live SDF labels (size mults / outline are layout
            // properties, applied at assignment — a tuner change re-syncs).
            for (const [id, st] of labelObjs) {
              const n = nodeById.get(id);
              if (!n) continue;
              st.mult = roleMult(st.role);
              st.text.fontSize = fontWorld(n, st.mult);
              st.text.maxWidth = st.text.fontSize * 10;
              st.text.outlineWidth = `${Math.round(TUNE.labelOutline * 100)}%`;
              st.text.sync(st.fit);
            }
            // Captions refit their clip box too.
            for (const c of constellations) c.text.sync(() => fitPillTo(c.text, c.pill, 0));
            persist();
          };
          const add = (folder: any, key: keyof typeof TUNE, min: number, max: number, step = 0.01): void => {
            folder.add(TUNE, key, min, max, step).onChange(refresh);
          };
          gui.add(TUNE, 'sceneMode', ['dusk', 'paper']).name('scene').onChange(() => { applyMode(); refresh(); });
          gui.add(TUNE, 'atmosphere', 0, 1, 0.02).name('atmosphere').onChange(persist); // tick applies it (rides the curl)
          gui.add(TUNE, 'farOcclude', 0, 1, 0.02).name('far occlude').onChange(persist); // orrery back-face hide; tick applies it
          const torchF = gui.addFolder('torch');
          // Mins go to TRUE zero — the owner's grade railed the old bottom stops
          // (coneIn 0.02, depthIn 0.05), so the instrument was clipping intent.
          add(torchF, 'coneIn', 0, 0.5);
          add(torchF, 'coneOut', 0.1, 1.2);
          add(torchF, 'depthIn', 0, 1.5);
          add(torchF, 'depthOut', 0.3, 4);
          add(torchF, 'torchFloor', 0, 0.2, 0.005);
          // The ONE name budget + register split (coupled-workspace co-sizing).
          const budgetF = gui.addFolder('name budget');
          add(budgetF, 'focusBand', 0, 60, 1);     // 0 = viewport default (16/26)
          add(budgetF, 'landmarkFrac', 0, 0.8, 0.05); // landmark share of the band
          add(budgetF, 'beamPerCell', 1, 5, 1);    // suggestions per screen territory
          add(budgetF, 'beamPill', 0, 1, 0.01);    // suggestion pill (0 = pill-less whisper)
          const beamF = gui.addFolder('beam');
          add(beamF, 'labelConeIn', 0.02, 0.5);
          add(beamF, 'labelConeOut', 0.1, 1.2);
          add(beamF, 'beamOn', 0.05, 0.9);
          add(beamF, 'beamOff', 0.02, 0.8);
          add(beamF, 'beamOpacity', 0, 1);
          add(beamF, 'beamSizeMult', 0.3, 1.5);
          const labelsF = gui.addFolder('labels');
          add(labelsF, 'selSizeMult', 0.8, 2.5);
          add(labelsF, 'hitSizeMult', 0.8, 2.5);
          add(labelsF, 'nbrSizeMult', 0.6, 2);
          add(labelsF, 'nbrOpFar', 0.1, 1);
          add(labelsF, 'nbrOpNear', 0.3, 1);
          add(labelsF, 'labelFade', 1, 20, 0.5);
          add(labelsF, 'pillClip', 0, 1, 1); // depth-clip the busy field behind a name (0=off)
          add(labelsF, 'labelOutline', 0, 0.35, 0.005);
          add(labelsF, 'labelPx', 6, 40, 1); // fixed on-screen label size (× role mult)
          const nodesF = gui.addFolder('nodes');
          add(nodesF, 'nodeDim', 0.1, 3);
          add(nodesF, 'nbrBoost', 0, 1);
          add(nodesF, 'boostSizeGain', 0, 1.5);
          add(nodesF, 'starSpike', 0, 1, 0.01); // 0 = soft disc, 1 = full diffraction star
          const edgesF = gui.addFolder('edges');
          add(edgesF, 'edgeSimilar', 0, 0.3, 0.005);
          add(edgesF, 'edgeMember', 0, 0.5, 0.005);
          add(edgesF, 'edgeDerived', 0, 0.5, 0.005);
          add(edgesF, 'edgeAuthored', 0, 1, 0.005);
          add(edgesF, 'focusEdgeAlpha', 0, 1);
          add(edgesF, 'edgeFlowSpeed', 0, 2, 0.05); // cycles/sec along the edge
          add(edgesF, 'edgeFlowWidth', 0.05, 0.5, 0.01); // pulse width (0..1 of the edge)
          add(edgesF, 'edgeFlowGain', 0, 3, 0.05); // brightness added at the pulse's peak
          add(edgesF, 'edgeFlowCycles', 1, 8, 1); // pulses per edge, source→target
          // Ranges widened where the owner's grade railed the old stops
          // (constCap/anchorCap max, anchorSizeMult min, labelOutline max).
          const placesF = gui.addFolder('places');
          add(placesF, 'constCap', 0, 32, 1);
          add(placesF, 'constOpacity', 0, 1);
          add(placesF, 'constNear', 0.2, 2.5);
          add(placesF, 'constFar', 0.6, 5);
          add(placesF, 'anchorCap', 0, 32, 1);
          add(placesF, 'anchorOpacity', 0, 1);
          add(placesF, 'anchorSizeMult', 0.1, 1.5);
          const postF = gui.addFolder('bloom');
          postF.add(TUNE, 'bloomMode', ['auto', 'on', 'off']).onChange(refresh);
          add(postF, 'bloomStrength', 0, 2);
          add(postF, 'bloomRadius', 0, 1.5);
          add(postF, 'bloomThreshold', 0, 1);
          add(postF, 'exposure', 0.4, 2.5);
          gui.add({ copy: () => { void navigator.clipboard?.writeText(JSON.stringify(TUNE, null, 2)); } }, 'copy').name('copy values');
          // `paste values` closes the loop `copy values` opened: a grade JSON
          // from another device/session (or hard-coded defaults under trial)
          // drops straight back into the live instrument. Unknown keys are
          // ignored; types are checked against the defaults' shapes.
          const applyTune = (text: string | null | undefined): void => {
            let obj: Record<string, unknown>;
            try { obj = JSON.parse(text ?? ''); } catch { return; }
            if (!obj || typeof obj !== 'object') return;
            for (const k of Object.keys(TUNE_DEFAULTS) as Array<keyof typeof TUNE>) {
              const v = obj[k];
              if (v === undefined || typeof v !== typeof TUNE_DEFAULTS[k]) continue;
              if (k === 'bloomMode' && !['auto', 'on', 'off'].includes(v as string)) continue;
              if (k === 'sceneMode' && !['dusk', 'paper'].includes(v as string)) continue;
              (TUNE as any)[k] = v;
            }
            applyMode();
            refresh(); // also persists
            gui.controllersRecursive().forEach((c: any) => c.updateDisplay());
          };
          gui.add({
            paste: () => {
              // Clipboard read needs a permission grant some browsers refuse
              // (iOS Safari prompts, Firefox denies) — fall back to a prompt box.
              if (navigator.clipboard?.readText) {
                navigator.clipboard.readText().then(applyTune, () => applyTune(window.prompt('paste tune JSON')));
              } else {
                applyTune(window.prompt('paste tune JSON'));
              }
            },
          }, 'paste').name('paste values');
          gui.add({
            reset: () => {
              Object.assign(TUNE, TUNE_DEFAULTS);
              try { localStorage.removeItem(TUNE_LS); } catch { /* */ }
              applyMode();
              refresh();
              gui.controllersRecursive().forEach((c: any) => c.updateDisplay());
            },
          }, 'reset').name('reset defaults');
        }).catch(() => null);
      }

      cleanup = () => {
        gui?.destroy?.();
        renderer.domElement.removeEventListener('pointerdown', onDown);
        renderer.domElement.removeEventListener('pointermove', onMove);
        renderer.domElement.removeEventListener('pointerup', onUp);
        renderer.domElement.removeEventListener('pointerleave', onLeave);
        renderer.domElement.removeEventListener('pointercancel', onLeave);
        renderer.domElement.removeEventListener('wheel', onWheel);
        if (hoverPickRaf) cancelAnimationFrame(hoverPickRaf);
        if (hoverLabelTimer) clearTimeout(hoverLabelTimer);
        for (const [, st] of labelObjs) { st.text.dispose?.(); st.pill.material.dispose?.(); }
        pillGeo.dispose();
        for (const [, o] of edgeLabelObjs) o.element.remove?.();
        for (const c of constellations) { c.text.dispose?.(); c.pill.material.dispose?.(); }
        if (crumbTimer) clearTimeout(crumbTimer);
        crumb.remove();
        skyDome.geometry.dispose(); skyMat.dispose();
        geo.dispose(); egeo.dispose(); ptMat.dispose(); eMat.dispose();
        disc.dispose?.(); stipple.dispose?.(); ringTex.dispose?.(); ringMat.dispose(); hoverMat.dispose(); composer?.dispose?.(); renderer.dispose();
      };

      // ── the append API: pages stream INTO the live scene ─────────────────
      // Edges can land before their endpoints (the two streams race) — park
      // them and re-try after each entries append. Whatever's still parked at
      // finishStream points at plumbing-filtered facts and is dropped.
      const pendingEdges: GEdge[] = [];
      const linkIds = new Set<string>();
      const edgeId = (e: GEdge): string => `${e.from}|${e.rel}|${e.to}`;

      /** True = handled (added, or dropped by design/capacity/duplicate).
       * False = an endpoint is not in the chart yet, so park it. */
      const addEdge = (e: GEdge): boolean => {
        if (e.rel === 'similarTo') return true;
        const id = edgeId(e);
        if (linkIds.has(id)) return true;
        const a = nodeById.get(e.from), b = nodeById.get(e.to);
        if (!a || !b) return false;
        if (links.length >= caps.capE) return true;
        const i = links.length;
        const l = { id, source: e.from, target: e.to, rel: e.rel, derived: e.derived };
        links.push(l);
        linkIds.add(id);
        edgeRGB.push(hexToRgb(edgeStyle(e).stroke));
        const ai = idx.get(e.from)!, bi = idx.get(e.to)!;
        eposBuf[i * 6] = posBuf[ai * 3]; eposBuf[i * 6 + 1] = posBuf[ai * 3 + 1]; eposBuf[i * 6 + 2] = posBuf[ai * 3 + 2];
        eposBuf[i * 6 + 3] = posBuf[bi * 3]; eposBuf[i * 6 + 4] = posBuf[bi * 3 + 1]; eposBuf[i * 6 + 5] = posBuf[bi * 3 + 2];
        eflowBuf[i * 2] = 0; eflowBuf[i * 2 + 1] = 1;
        a.deg++; b.deg++;
        return true;
      };
      const commitEdges = (): void => {
        egeo.setDrawRange(0, links.length * 2);
        (egeo.attributes.position as any).needsUpdate = true;
        (egeo.attributes.flow as any).needsUpdate = true;
        refreshSizes();
        (geo.attributes.size as any).needsUpdate = true;
        applyEdgeColor();
      };
      const rebuildEdgeBuffers = (): void => {
        for (const n of nodes) n.deg = 0;
        edgeRGB.length = 0;
        for (let i = 0; i < links.length; i++) {
          const l = links[i];
          const ai = idx.get(idOf(l.source)), bi = idx.get(idOf(l.target));
          if (ai === undefined || bi === undefined) continue;
          eposBuf[i * 6] = posBuf[ai * 3]; eposBuf[i * 6 + 1] = posBuf[ai * 3 + 1]; eposBuf[i * 6 + 2] = posBuf[ai * 3 + 2];
          eposBuf[i * 6 + 3] = posBuf[bi * 3]; eposBuf[i * 6 + 4] = posBuf[bi * 3 + 1]; eposBuf[i * 6 + 5] = posBuf[bi * 3 + 2];
          eflowBuf[i * 2] = 0; eflowBuf[i * 2 + 1] = 1;
          edgeRGB.push(hexToRgb(edgeStyle({ from: idOf(l.source), rel: l.rel, to: idOf(l.target), derived: l.derived }).stroke));
          const a = nodeById.get(idOf(l.source)), b = nodeById.get(idOf(l.target));
          if (a) a.deg++;
          if (b) b.deg++;
        }
        commitEdges();
      };
      const drainPendingEdges = (): void => {
        if (!pendingEdges.length) return;
        let wrote = false;
        for (let i = pendingEdges.length - 1; i >= 0; i--) {
          const before = links.length;
          if (addEdge(pendingEdges[i])) {
            pendingEdges.splice(i, 1);
            if (links.length > before) wrote = true;
          }
        }
        if (wrote) commitEdges();
      };
      const refreshNodes = (): void => {
        recomputeRanks();
        applyNodeColors();
        refreshSizes();
        applyNodeAlpha();
        applyEdgeColor();
        (geo.attributes.position as any).needsUpdate = true;
        (geo.attributes.color as any).needsUpdate = true;
        (geo.attributes.size as any).needsUpdate = true;
        geo.setDrawRange(0, nodes.length);
        syncBeamLabels();
      };
      const appendEntries = (items: ListEntry[]): void => {
        let changed = false;
        let added = false;
        for (const e of items) {
          if (!e?.key || isPlumbing(e)) continue;
          const existing = nodeById.get(e.key);
          if (e._meta?.superseded) {
            if (existing && !existing.deleted) { existing.deleted = true; changed = true; }
            continue;
          }
          if (existing) {
            existing.type = e._meta?.type ?? null;
            existing.score = Number(e._meta?.score) || 0;
            existing.cr0 = seatRadius(existing.score);
            layoutDirty = true; // radius whisper may have shifted
            existing.label = shortLabel(factTitle(e));
            existing.deleted = false;
            const label = labelObjs.get(e.key);
            if (label) { label.text.text = existing.label; label.text.sync?.(); }
            changed = true;
            continue;
          }
          if (nodes.length >= caps.capN) continue;
          const i = nodes.length;
          const n: any = {
            id: e.key,
            type: e._meta?.type ?? null,
            score: Number(e._meta?.score) || 0,
            label: shortLabel(factTitle(e)),
            deg: 0,
            deleted: false,
          };
          // CANONICAL SEAT: embedding DIRECTION + a salience whisper of radius.
          // World position is the seat put through the current curl (the shell
          // may be a dome, a chart, or a ball right now — new arrivals land
          // wherever their seat currently sits).
          [n.cdx, n.cdy, n.cdz] = toDir(coordMap?.[n.id], i);
          n.cr0 = seatRadius(n.score);
          curlPos(n.cdx, n.cdy, n.cdz, n.cr0, n);
          posBuf[i * 3] = n.x; posBuf[i * 3 + 1] = n.y; posBuf[i * 3 + 2] = n.z;
          nodes.push(n);
          nodeById.set(n.id, n);
          idx.set(n.id, i);
          changed = true;
          added = true;
        }
        if (!changed) return;
        refreshNodes();
        if (added) {
          frameBody();
          drainPendingEdges();
        }
      };
      const appendEdges = (items: GEdge[]): void => {
        let wrote = false;
        for (const e of items) {
          const before = links.length;
          if (addEdge(e)) {
            if (links.length > before) wrote = true;
          } else {
            pendingEdges.push(e);
          }
        }
        if (wrote) commitEdges();
      };
      const removeEdges = (items: GEdge[]): void => {
        if (!items.length) return;
        const removeIds = new Set(items.map(edgeId));
        for (let i = pendingEdges.length - 1; i >= 0; i--) {
          if (removeIds.has(edgeId(pendingEdges[i]))) pendingEdges.splice(i, 1);
        }
        let changed = false;
        for (let i = links.length - 1; i >= 0; i--) {
          if (!removeIds.has(links[i].id)) continue;
          linkIds.delete(links[i].id);
          links.splice(i, 1);
          changed = true;
        }
        if (changed) rebuildEdgeBuffers();
      };
      const removeEntries = (keys: string[]): void => {
        if (!keys.length) return;
        const remove = new Set(keys);
        let changed = false;
        for (const key of remove) {
          const n = nodeById.get(key);
          if (n && !n.deleted) { n.deleted = true; changed = true; }
        }
        for (let i = pendingEdges.length - 1; i >= 0; i--) {
          if (remove.has(pendingEdges[i].from) || remove.has(pendingEdges[i].to)) pendingEdges.splice(i, 1);
        }
        let edgeChanged = false;
        for (let i = links.length - 1; i >= 0; i--) {
          if (!remove.has(idOf(links[i].source)) && !remove.has(idOf(links[i].target))) continue;
          linkIds.delete(links[i].id);
          links.splice(i, 1);
          edgeChanged = true;
        }
        if (hoverKey && remove.has(hoverKey)) setHover(null);
        if (selKey && remove.has(selKey)) {
          selKey = null;
          nbr = null;
          showRing(null);
          showCrumb(null);
          selectRef.current(null);
        }
        if (edgeChanged) rebuildEdgeBuffers();
        if (changed) refreshNodes();
      };
      const hydrating = new Set<string>();
      const hydrateKey = async (key: string): Promise<void> => {
        const current = nodeById.get(key);
        if (hydrating.has(key) || (current && !current.deleted)) return;
        hydrating.add(key);
        try {
          const [factRes, edgeRes] = await Promise.all([
            mcpCall('read', 'workspace.peek', { key }),
            mcpCall('read', 'workspace.edges', { keys: [key], derived: false, limit: 2000 }),
          ]);
          if (factRes.ok) {
            const fact = factRes.value as { value?: unknown; _meta?: ListEntry['_meta'] } | null;
            if (fact) appendEntries([{ key, value: fact.value, _meta: fact._meta }]);
          }
          if (edgeRes.ok) appendEdges((edgeRes.value as { edges?: GEdge[] } | null)?.edges ?? []);
          if (selKey === key) api.current?.select(key, true);
        } finally {
          hydrating.delete(key);
        }
      };
      // Selection pulls the whole NEIGHBOURHOOD (2026-07-18 owner ask): the
      // bounded initial load charts the salience shortlist, so a selected
      // node's neighbours may not be in the scene yet — its edges sit parked
      // in pendingEdges with nothing to land on. One `edges({around})` read
      // returns the incident edges AND card-hydrated neighbour entries in a
      // single round trip; unseen neighbours are appended (placed by the
      // atlas coordMap when charted), their edges drain from the park, and
      // the neighbour ring recomputes so the new arrivals join it. Cached
      // per key for the mount — the 12s change poll owns later arrivals.
      const pulledNeighbours = new Set<string>();
      const pullNeighbours = async (key: string): Promise<void> => {
        if (pulledNeighbours.has(key)) return;
        pulledNeighbours.add(key);
        try {
          const r = await mcpCall('read', 'workspace.edges', { around: key, shape: 'card' });
          if (!r.ok) { pulledNeighbours.delete(key); return; }
          const v = (r.value ?? {}) as {
            outbound?: GEdge[];
            inbound?: GEdge[];
            entries?: Record<string, { value?: unknown; _meta?: ListEntry['_meta'] } | null>;
          };
          const fresh: ListEntry[] = [];
          for (const [k, entry] of Object.entries(v.entries ?? {})) {
            if (!entry || entry._meta?.superseded) continue;
            const cur = nodeById.get(k);
            if (cur && !cur.deleted) continue;
            fresh.push({ key: k, value: entry.value, _meta: entry._meta });
          }
          if (fresh.length) appendEntries(fresh);
          // Plumbing endpoints (`_types/…` backbone targets) never chart, so
          // don't park their edges — they would sit in pendingEdges forever.
          const edges = [...(v.outbound ?? []), ...(v.inbound ?? [])]
            .filter((e) => !e.from.startsWith('_') && !e.to.startsWith('_'));
          if (edges.length) appendEdges(edges);
          if ((fresh.length || edges.length) && selKey === key) {
            nbr = neighborsOf(key);
            applyNodeAlpha(); applyEdgeColor(); syncBeamLabels();
          }
        } catch {
          pulledNeighbours.delete(key); // a failed pull may retry on re-select
        }
      };
      const finishStream = (): void => {
        pendingEdges.length = 0;
        computePlaces();
        applyNodeAlpha();
        applyEdgeColor();
        syncBeamLabels();
      };
      return { appendEntries, appendEdges, removeEntries, removeEdges, finishStream };
    }

    (async () => {
      // Fast orientation first: chart the salience shortlist, then ask the
      // Reference projection only for authored edges touching those keys.
      // A change cursor captured in parallel closes the race and keeps this
      // mounted scene reconciled without reloading the page.
      setLoadState('fast');
      const [THREE, addons, meta, initial, initialHead, tuneCfg] = await Promise.all([
        loadThree(),
        loadThreeAddons(),
        fetchGraphMeta(),
        fetchEntryPage(),
        fetchChangeHead(),
        fetchTuneConfig(),
      ]);
      if (disposed) return;
      // Merge the substrate-stored tuning BEFORE the scene builds its materials
      // (they read TUNE at construction). The `_config` fact wins over the
      // localStorage cache when present. Unknown keys are ignored downstream.
      if (tuneCfg) Object.assign(TUNE, tuneCfg);
      const stream = mountScene(meta, {
        capN: Math.max(256, initial.total + LIVE_NODE_HEADROOM),
        capE: LIVE_EDGE_CAPACITY,
      }, THREE, addons);
      if (!stream) {
        setLoadState('done');
        return;
      }
      stream.appendEntries(initial.items);
      let charted = initial.items.length;
      let graphTotal = initial.total;
      let nextCursor = initial.nextCursor;
      let revealing = false;
      let autoPaused = false;
      let revealTimer: ReturnType<typeof setTimeout> | null = null;
      const reportReach = (loading = revealing): void => reachRef.current({
        charted,
        total: graphTotal,
        loading,
        hasMore: !!nextCursor,
        paused: autoPaused,
      });
      setProgress({ got: charted, total: graphTotal });
      setLoadState('full');
      reportReach(true);

      const edgePage = await fetchEdgesForKeys(initial.items.map((entry) => entry.key));
      if (disposed) return;
      stream.appendEdges(edgePage.items);
      stream.finishStream();
      setProgress({ got: charted, total: graphTotal });
      setLoadState('done');
      reportReach(false);

      // Fetch ONE small page and append it — the map accretes a couple hundred
      // stars at a time. Returns true if there is more to chart.
      const revealOnce = async (): Promise<boolean> => {
        if (disposed || revealing || !nextCursor) return false;
        revealing = true;
        reportReach(true);
        const cursor = nextCursor;
        try {
          const page = await fetchEntryPage(cursor, REVEAL_ENTRY_LIMIT);
          if (disposed || !page.ok) return false;
          graphTotal = page.total || graphTotal;
          nextCursor = page.nextCursor;
          const fresh = page.items.filter((entry) => !!entry?.key);
          stream.appendEntries(fresh);
          charted = Math.min(graphTotal, charted + fresh.length);
          setProgress({ got: charted, total: graphTotal });
          reportReach(true);
          const moreEdges = await fetchEdgesForKeys(fresh.map((entry) => entry.key));
          if (!disposed) stream.appendEdges(moreEdges.items);
          return !!nextCursor;
        } finally {
          revealing = false;
        }
      };
      // The self-paced pump: after the fast orientation page, the rest fills in
      // AUTOMATICALLY — small page, a breath for the GPU/DOM, next page — until
      // the whole substrate is charted. No manual "+n" tap; the button is now a
      // pause/resume for this trickle.
      const REVEAL_GAP_MS = 140;
      const pump = async (): Promise<void> => {
        if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
        if (disposed || autoPaused) { reportReach(false); return; }
        const more = await revealOnce();
        if (disposed) return;
        if (more && !autoPaused) revealTimer = setTimeout(() => { void pump(); }, REVEAL_GAP_MS);
        else reportReach(false);
      };
      // The button toggles the trickle: pause it mid-fill, or resume/kick it.
      if (api.current) api.current.reveal = () => {
        autoPaused = !autoPaused;
        if (!autoPaused) void pump();
        else { if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; } reportReach(false); }
      };
      // Kick the auto-fill once the orientation page has settled.
      if (nextCursor) void pump();

      let sinceSeq: number | null = initialHead;
      const pollChanges = async (): Promise<void> => {
        if (disposed || changePolling) return;
        changePolling = true;
        try {
          if (sinceSeq === null) {
            sinceSeq = await fetchChangeHead();
            return;
          }
          const r = await mcpCall('read', 'workspace.changes', {
            sinceSeq,
            limit: 200,
            scope: { ops: ['write', 'supersede', 'link', 'unlink'] },
            include: 'entries',
          });
          if (!r.ok || disposed) return;
          const page = (r.value ?? {}) as ChangePage;
          const events = page.events ?? [];
          const upserts: ListEntry[] = [];
          const removals: string[] = [];
          for (const [key, entry] of Object.entries(page.entries ?? {})) {
            if (!entry || entry._meta?.superseded) removals.push(key);
            else upserts.push({ ...entry, key });
          }
          if (upserts.length) stream.appendEntries(upserts);
          if (removals.length) stream.removeEntries(removals);
          const links: GEdge[] = [];
          const unlinks: GEdge[] = [];
          for (const event of events) {
            if (typeof event.key !== 'string' || typeof event.rel !== 'string' || typeof event.to !== 'string') continue;
            const edge = { from: event.key, rel: event.rel, to: event.to };
            if (event.op === 'link') links.push(edge);
            else if (event.op === 'unlink') unlinks.push(edge);
          }
          if (unlinks.length) stream.removeEdges(unlinks);
          if (links.length) stream.appendEdges(links);
          const lastEventSeq = events.reduce((max, event) => typeof event.seq === 'number' ? Math.max(max, event.seq) : max, sinceSeq);
          sinceSeq = events.length >= 200 ? lastEventSeq : typeof page.seq === 'number' ? page.seq : lastEventSeq;
        } finally {
          changePolling = false;
        }
      };
      void pollChanges();
      changeTimer = window.setInterval(() => { void pollChanges(); }, CHANGE_POLL_MS);
    })().catch((err) => {
      (window.reportError ?? console.error)(err);
      // A rejected fetch/setup left the scene host empty — a blank page reads as
      // "broken", not "recoverable". Match the loadThree()/loadThreeAddons()
      // failure fallback above (line ~471) so any init failure degrades to a
      // legible message instead of silence.
      setLoadState('done');
      if (!disposed && el) {
        el.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;opacity:.6;font:13px ui-monospace,monospace;text-align:center;padding:2rem">graph failed to load — check the console, or reload</div>';
      }
    });

    return () => {
      disposed = true;
      if (changeTimer !== null) clearInterval(changeTimer);
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      if (onResult) window.removeEventListener(CONSOLE_RESULT_EVENT, onResult);
      cleanup?.();
      api.current = null;
      if (el) el.innerHTML = '';
    };
  }, []);

  useEffect(() => {
    if (selectedKey === lastExternal.current) return;
    lastExternal.current = selectedKey;
    api.current?.select(selectedKey, true);
  }, [selectedKey]);

  useEffect(() => { api.current?.setVisible(visible); }, [visible]);

  const lastRevealNonce = useRef(revealNonce);
  useEffect(() => {
    if (revealNonce === lastRevealNonce.current) return;
    lastRevealNonce.current = revealNonce;
    api.current?.reveal();
  }, [revealNonce]);

  const lastVantageNonce = useRef(vantageNonce);
  useEffect(() => {
    if (vantageNonce === lastVantageNonce.current) return;
    lastVantageNonce.current = vantageNonce;
    api.current?.toggleVantage();
  }, [vantageNonce]);

  return (
    <>
      {/* `host` is imperative-only territory below (innerHTML/appendChild
          straight to the DOM node for the three.js canvas + CSS2D labels) —
          React must never render children into it, or the two reconcilers
          fight over the same subtree. No loading pill: the graph-controls bar
          already reports charting state (owner, 5fe59d7). */}
      <div ref={host} style={{ position: 'fixed', inset: 0, background: ink.sceneBg, overflow: 'hidden' }} />
    </>
  );
}

export function FullGraph({ selectedKey, onSelect }: { selectedKey: string | null; onSelect: (n: GraphNode | null) => void }): React.JSX.Element {
  // Two independent ideas: FOCUS filters what is already charted; REACH pages
  // more of the substrate into the chart. Keeping both visible prevents a
  // salience filter from masquerading as a data boundary.
  const [visible, setVisible] = useState(1);
  const [revealNonce, setRevealNonce] = useState(0);
  const [vantageNonce, setVantageNonce] = useState(0);
  const [reach, setReach] = useState<GraphReach>({ charted: 0, total: 0, loading: true, hasMore: false, paused: false });
  // ONE compact, de-emphasised control bar (owner: the panels covered too much
  // sky on mobile) — a single translucent pill: focus · vantage · charting.
  const bar: React.CSSProperties = {
    position: 'fixed', right: 10, top: 'calc(max(10px, env(safe-area-inset-top)) + 48px)', zIndex: 20,
    maxWidth: 'calc(100vw - 20px)',
    fontFamily: ink.mono, fontSize: '0.66rem', color: ink.text,
    background: 'rgba(20,17,13,0.42)', border: `1px solid ${ink.line}`,
    borderRadius: 999, backdropFilter: 'blur(6px)',
    padding: '0.24rem 0.4rem 0.24rem 0.6rem',
    display: 'flex', alignItems: 'center', gap: '0.45rem',
  };
  const chip: React.CSSProperties = {
    appearance: 'none', border: `1px solid ${ink.line}`, background: 'transparent',
    color: ink.dim, borderRadius: 999, minHeight: 26, padding: '0.12rem 0.5rem',
    font: `600 0.64rem ${ink.mono}`, cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const short = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k` : `${n}`);
  return (
    <>
      <ThreeGraph
        selectedKey={selectedKey}
        onSelect={onSelect}
        visible={visible}
        onReach={setReach}
        revealNonce={revealNonce}
        vantageNonce={vantageNonce}
      />
      <section aria-label="Graph controls" style={bar}>
        <span style={{ color: ink.dim }}>focus</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={visible}
          onChange={(e) => setVisible(Number(e.target.value))}
          aria-label="Filter charted facts by salience"
          title="Filter the charted facts by salience"
          style={{ width: 60, accentColor: ink.accent, cursor: 'pointer', margin: 0 }}
        />
        <span style={{ color: visible >= 0.999 ? ink.text : ink.dim, fontVariantNumeric: 'tabular-nums', width: 26, textAlign: 'right' }}>
          {visible >= 0.999 ? 'all' : `${Math.round(visible * 100)}%`}
        </span>
        <span style={{ width: 1, height: 18, background: ink.line, opacity: 0.7 }} />
        <button
          type="button"
          onClick={() => setVantageNonce((n) => n + 1)}
          title="Toggle vantage: step outside to hold the whole globe, or back to the centre under the sky (selection kept)"
          style={{ ...chip, color: ink.text }}
        >
          vantage
        </button>
        <button
          type="button"
          disabled={!reach.hasMore}
          onClick={() => { setVisible(1); setRevealNonce((n) => n + 1); }}
          aria-live="polite"
          title={
            !reach.hasMore ? 'All available facts are charted'
              : reach.paused ? 'Resume charting the rest of the substrate'
                : 'The substrate is charting itself — tap to pause the fill-in'
          }
          style={{ ...chip, color: reach.hasMore && !reach.paused ? ink.accent : ink.dim, fontVariantNumeric: 'tabular-nums' }}
        >
          {reach.total ? `${short(reach.charted)}/${short(reach.total)}${reach.hasMore ? (reach.paused ? ' ▸' : '…') : ''}` : '…'}
        </button>
      </section>
    </>
  );
}
