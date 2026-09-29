/**
 * stillwater — a quiet numeracy journey down an endless lily river.
 *
 * There are no rounds and no screens. The boat drifts; the pond holds dew on
 * some of its leaves; the dots at the top ask for a number. Touch (or trace
 * across) leaves whose dew makes that number and the drops lift, drift to the
 * lantern at the bow, and the rower takes a few long strokes further down the
 * river — through pads that shoulder aside and bump and turn, over fish that
 * scatter, past lilies — until the next number settles on the water.
 *
 * Wiring only: the rules are numeracy.ts, the place is world.ts, the fish are
 * fish.ts, the pixels are render.ts/shaders.ts, the words are ui.ts.
 */
import { School } from './fish';
import * as N from './numeracy';
import * as L from './learning';
import { drawOrder, Camera, Mote, Renderer } from './render';
import { Critters, type Critter } from './critters';
import { Atmosphere, DAY, skyAt } from './atmosphere';
import { Sound } from './audio';
import { Overlay } from './ui';
import { glInfo, probe, report } from './report';
import { PROGRAMS } from './render';
import { program } from './gl';
import { layDrops, liveCount, Pad, Pond, seeded } from './world';

const canvas = document.getElementById('pond') as HTMLCanvasElement;
const ui = new Overlay();
const sound = new Sound();
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = matchMedia('(pointer: coarse)').matches;

// ─── who is rowing: one profile per child, each with its own proficiency and facts ──
const startupParams = new URLSearchParams(location.search);
interface Profile {
  id: string;
  name: string;
  last: number;
}
const PROFILES = 'stillwater.profiles.v1';
const readJSON = <T,>(key: string): T | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
};
const writeJSON = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};
let profiles: Profile[] = readJSON<Profile[]>(PROFILES) ?? [];
let profile: Profile | null = null;
const pKey = (id: string, what: string) => `stillwater.p.${id}.${what}`;

let mastery = 0.04;
let totalSolves = 0;
/** When this child last rowed (ms), for the welcome back. */
let lastPlayed = 0;
let activeStage: N.Stage = N.STAGES[0];
let memory = new L.Memory();

/** Load (or create) the profile with this name, adopting any pre-profile save into the first one made. */
function loadProfile(name: string) {
  let pr = profiles.find((q) => q.name.toLowerCase() === name.toLowerCase());
  if (!pr) {
    pr = { id: Math.random().toString(36).slice(2, 10), name, last: 0 };
    if (!profiles.length) {
      const legacy = readJSON<{ mastery?: number; solves?: number; last?: number }>('stillwater.v3');
      if (legacy) {
        writeJSON(pKey(pr.id, 'v3'), legacy);
        const facts = readJSON<unknown>('stillwater.facts.v1');
        if (facts) writeJSON(pKey(pr.id, 'facts.v1'), facts);
      }
    }
    profiles.push(pr);
  }
  profile = pr;
  const saved = readJSON<{ mastery?: number; solves?: number; last?: number }>(pKey(pr.id, 'v3'));
  mastery = 0.04;
  totalSolves = 0;
  lastPlayed = 0;
  if (saved && typeof saved.mastery === 'number') {
    mastery = Math.max(0, Math.min(1, saved.mastery));
    totalSolves = saved.solves ?? 0;
    lastPlayed = saved.last ?? 0;
  }
  memory = startupParams.has('fresh') ? new L.Memory() : new L.Memory(readJSON(pKey(pr.id, 'facts.v1')));
  const levelParam = Number(startupParams.get('level'));
  if (Number.isFinite(levelParam) && startupParams.has('level')) mastery = Math.max(0, Math.min(1, levelParam));
  save();
}
const forcedStage = N.stageForId(startupParams.get('stage'));
if (forcedStage) activeStage = forcedStage;
const save = () => {
  if (!profile) return;
  profile.last = Date.now();
  writeJSON(pKey(profile.id, 'v3'), { mastery, solves: totalSolves, last: profile.last });
  writeJSON(pKey(profile.id, 'facts.v1'), memory);
  writeJSON(PROFILES, profiles);
};
const stage = () => activeStage;

// ─── world ─────────────────────────────────────────────────────────────────
const params = startupParams;
/** `?bare=1`: hide the pads (for looking at the water and the bed). */
const bare = !!params.get('bare');
const urlSeed = Number(params.get('seed'));
/** Test harnesses on software GL run at a few fps; they can ask the river to hurry. */
const timeScale = Math.max(0.1, Math.min(8, Number(params.get('timescale')) || 1));
const rand = seeded(urlSeed || (Date.now() % 100000) + 7);
const pond = new Pond(Math.floor(rand() * 1e9));
/** `?pier=1`: a jetty just ahead at the start (to look at it, and to bump it). */
pond.forcePier = !!params.get('pier');
/** `?at=Y`: start that far down the river (to see its reaches). */
if (params.get('at')) {
  pond.origin = Number(params.get('at')) || 0;
  pond.boat.x = pond.channel(0);
}
/** `?fork=N`: the river forks N units ahead of the start (to look at a fork, and to choose). */
if (params.get('fork')) pond.nextForkY = pond.boat.y + pond.origin + Math.max(-600, Number(params.get('fork')) || 400);
/**
 * Spacing, planted as ecology (P1): when a fact is due, its parts are grown
 * into the dew of the leaves appearing ahead, so by the time they drift into
 * view the river can ask for it.
 */
const planting: number[] = [];
pond.dewFor = (r) => {
  if (!started) return 0; // no dew until a child has begun: the start is just the river
  const n = N.dewForMastery(mastery, r);
  if (n > 0 && planting.length && r() < 0.6) return planting.shift()!;
  return n;
};
// dice-like dew for small counts early on, fading to natural scatter as proficiency grows (P8)
pond.patternFor = (count, r) => count <= 7 && r() < Math.max(0.12, Math.min(0.85, 0.9 - mastery * 1.1));
const school = new School(reduced ? { schools: 2, perSchool: 14, loners: 6 } : { schools: 4, perSchool: 22, loners: 12 }, pond.boat.x, pond.boat.y + 200);

let renderer!: Renderer;
let canvasEl = canvas;
const attempts: string[] = [];
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  report('context-lost', { compiled: renderer?.compiled });
});
/**
 * Start the renderer, retrying on a FRESH canvas with plainer context options
 * if the context arrives lost (iOS 18.7 / Safari 26 did exactly that). Input
 * listeners hang off the canvas, so a replacement takes over its id and place.
 */
for (let attempt = 0; attempt < 3 && !renderer; attempt++) {
  try {
    if (attempt > 0) {
      const fresh = document.createElement('canvas');
      fresh.id = canvasEl.id;
      fresh.tabIndex = 0;
      fresh.setAttribute('aria-label', canvasEl.getAttribute('aria-label') ?? '');
      canvasEl.replaceWith(fresh);
      canvasEl = fresh;
    }
    const r = new Renderer(canvasEl, attempt);
    if (params.get('nosim')) r.simWanted = false;
    renderer = r;
    canvasEl.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      report('context-lost-live', { attempt, compiled: r.compiled });
    });
  } catch (err) {
    attempts.push(`${attempt}: ${(err instanceof Error ? err.message : String(err)).split('\n')[0]} [${(err as { compiled?: string[] }).compiled?.join(',') ?? ''}]`);
  }
}
if (!renderer) {
  document.body.classList.add('nogl');
  ui.say(`the pond could not start (${attempts[attempts.length - 1]?.slice(0, 120)})`, 0);
  report('gl-fail', { attempts, gl: glInfo() });
  probe(PROGRAMS, program);
  throw new Error('stillwater: no renderer');
}
report('boot', { gl: renderer.info(), attempt: renderer.attempt, attempts });
if (params.get('probe')) probe(PROGRAMS, program);

const cam: Camera = { x: pond.boat.x, y: 0, zoom: 1, cssW: 1, cssH: 1 };
let dpr = 1;
let scale = touch ? 0.8 : 1;

function resize() {
  cam.cssW = innerWidth;
  cam.cssH = innerHeight;
  cam.zoom = Math.max(0.85, Math.min(1.5, Math.min(cam.cssW / 400, cam.cssH / 760)));
  dpr = Math.min(devicePixelRatio || 1, 2);
  renderer.resize(cam.cssW, cam.cssH, dpr, scale);
  const need = cam.cssW / (2 * cam.zoom) + 160;
  if (need > pond.halfW) pond.regrow(need, cam.y - cam.cssH / cam.zoom);
}
addEventListener('resize', resize);
resize();

/** Where the boat sits on screen (fraction from the top). */
const BOAT_AT = 0.7;
const followY = () => pond.boat.y + ((BOAT_AT - 0.5) * cam.cssH) / cam.zoom;
cam.y = followY();

const toScreen = (x: number, y: number): [number, number] => [
  (x - cam.x) * cam.zoom + cam.cssW / 2,
  cam.cssH / 2 - (y - cam.y) * cam.zoom,
];
/** Stereo position of a world x, from where it is on screen (-0.8 left … 0.8 right). */
const panAt = (x: number) => Math.max(-0.8, Math.min(0.8, ((x - cam.x) * cam.zoom) / (cam.cssW / 2) * 0.8));
const toWorld = (sx: number, sy: number): [number, number] => [
  cam.x + (sx - cam.cssW / 2) / cam.zoom,
  cam.y - (sy - cam.cssH / 2) / cam.zoom,
];

// ─── the numeracy loop ─────────────────────────────────────────────────────
let target: N.Target | null = null;
let selection: Pad[] = [];
/** While > 0 (seconds), touches are ignored: the dew is lifting, or slipping back. */
let lock = 0;
let releaseAt = 0;
let nextTargetAt = Infinity; // until a child has picked their name
let firstTarget = true;
let lastSolved: number | undefined;
let checkAt = 0;

/**
 * Leaves with dew that a child can plainly see: the WHOLE leaf on screen,
 * below the number display and above the boat. A leaf half under the header
 * or half off the side is not an answer anyone can find (playtest: an ask
 * whose only answer lay there was maddening).
 */
function visibleDewy(): Pad[] {
  const out: Pad[] = [];
  for (const p of pond.pads) {
    if (!liveCount(p)) continue;
    const [sx, sy] = toScreen(p.x, p.y);
    const inset = p.r * cam.zoom * 0.7;
    if (sx - inset < 8 || sx + inset > cam.cssW - 8) continue;
    if (sy - inset < cam.cssH * 0.2 || sy + inset > cam.cssH * (BOAT_AT - 0.05)) continue;
    out.push(p);
  }
  return out;
}

/** Leaves in view that could take new dew (dry, not a lily). */
function visibleDry(): Pad[] {
  return pond.pads
    .filter((p) => {
      if (p.drops.length || p.flower) return false;
      const [sx, sy] = toScreen(p.x, p.y);
      // wholly in clear view, as visibleDewy asks, and a little further from the edges
      const inset = p.r * cam.zoom * 0.7;
      return sx - inset > 8 && sx + inset < cam.cssW - 8 && sy - inset > cam.cssH * 0.22 && sy + inset < cam.cssH * (BOAT_AT - 0.08);
    })
    .sort((a, b) => b.r - a.r);
}

function condense(p: Pad, count: number) {
  p.drops = layDrops(count, p.r, rand);
  sound.glint();
}

function counts(pads: Pad[]) {
  return pads.map(liveCount);
}

let unsolvableSince = 0;
let targetFriction = 0;

/** Leaves well inside the view: an ask drawn from these stays answerable a while as the river moves. */
function targetDewy(): Pad[] {
  return visibleDewy().filter((p) => {
    const [, sy] = toScreen(p.x, p.y);
    return sy > cam.cssH * 0.25 && sy < cam.cssH * (BOAT_AT - 0.16);
  });
}

// ─── the learning arc (LEARNING-DESIGN.md) ────────────────────────────────
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => {
  const k = clamp01((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
let welcome = false;
let stretch = new L.Stretch(null, false);

/** The ask in play: how it was framed, and what the child did with it (P2, silently). */
interface Ask {
  stage: N.Stage;
  value: number;
  phase: L.Phase;
  /** "in two leaves" (a number bond). */
  bond: boolean;
  /** The same number again, another way (consolidate). */
  again: boolean;
  shownAt: number;
  lastTouchAt: number;
  scaffold: number;
}
let ask: Ask | null = null;
/** The reach just answered, for the consolidate that follows it. */
let lastReach: { stage: N.Stage; value: number; parts: number[] } | null = null;

const timesOverGroups = () => N.stageWeight(N.STAGES[4], mastery) > N.stageWeight(N.STAGES[3], mastery);
const inBand = (f: L.Fact) => N.stageWeight(L.stageOfFact(f, N.STAGES, timesOverGroups()), mastery) > 0.12;

/** A due fact the visible dew can make now, asked in its own form. */
function dueActivity(seen: Pad[]): { stage: N.Stage; target: N.Target } | null {
  for (const f of memory.due(Date.now(), inBand)) {
    // not the number just asked (several due facts can share a number)
    if (f.value === lastSolved) continue;
    const st = L.stageOfFact(f, N.STAGES, timesOverGroups());
    if (!N.solvable(st, counts(seen), f.value)) continue;
    return { stage: st, target: st.rule === 'groups' ? { value: f.value, rows: f.parts[0], cols: f.parts[1] } : { value: f.value } };
  }
  return null;
}

/** The reach's number again: a sum another way, a product the other way round. */
function againActivity(seen: Pad[]): { stage: N.Stage; target: N.Target } | null {
  if (!lastReach) return null;
  const { stage: st, value, parts } = lastReach;
  if (!N.solvable(st, counts(seen), value)) return null;
  if (st.rule === 'groups') {
    const [m, k] = parts;
    return { stage: st, target: { value, rows: k, cols: m } };
  }
  return { stage: st, target: { value } };
}

/** Plant the most urgent due fact's parts into the leaves growing ahead. */
function plantDue() {
  if (planting.length) return;
  const f = memory.due(Date.now(), inBand)[0];
  if (!f) return;
  if (f.rule === 'groups') for (let i = 0; i < f.parts[0]; i++) planting.push(f.parts[1]);
  else planting.push(...f.parts);
}

function setTarget() {
  const phase = stretch.phase;
  if (phase === 'finale') {
    startFinale();
    return;
  }
  const m = clamp01(mastery + L.PHASE_OFFSET[phase]);
  const safe = targetDewy();
  const seen = safe.length >= 2 ? safe : visibleDewy();
  let again = false;
  let dueAsk = false;
  let activity: { stage: N.Stage; target: N.Target } | null = null;
  if (forcedStage) {
    const t = N.chooseTarget(forcedStage, counts(seen), rand, lastSolved);
    activity = t ? { stage: forcedStage, target: t } : null;
  } else {
    // a returning child's warm-up, and every reach, look first for what's due
    if (phase === 'reach' || (phase === 'warm' && welcome)) {
      activity = dueActivity(seen);
      dueAsk = !!activity;
    }
    if (!activity && phase === 'consolidate') {
      activity = againActivity(seen);
      again = !!activity;
    }
    activity ??= N.chooseActivity(m, counts(seen), rand, lastSolved);
  }

  let st = activity?.stage ?? forcedStage ?? N.pickStage(m, rand);
  let t = activity?.target ?? N.chooseTarget(st, counts(visibleDewy()), rand, lastSolved);

  if (!t) {
    const value = st.min + Math.floor(rand() * (st.max - st.min + 1));
    const broad = visibleDewy();
    const dry = visibleDry();
    const all = [...broad, ...dry];
    const fix = N.repair(st, counts(all), value);
    if (fix) {
      fix.forEach((c, i) => condense(all[i], c));
      const k = st.rule === 'groups' ? [...fix.values()][0] : undefined;
      t = st.rule === 'groups' && k ? { value, rows: value / k, cols: k } : { value };
    } else {
      nextTargetAt = pond.t + 1;
      return;
    }
  }

  // a reach at adding is sometimes a bond: this number in exactly two leaves (P5)
  const bond =
    !forcedStage && phase === 'reach' && st.rule === 'sum' && st.id !== 'gather' && t.value >= 5 && rand() < (dueAsk ? 0.6 : 0.4) &&
    !!L.solutionFor('sum', counts(visibleDewy()), t.value, 2, 2);

  activeStage = st;
  target = t;
  targetFriction = 0;
  unsolvableSince = 0;
  ask = { stage: st, value: t.value, phase, bond, again, shownAt: pond.t, lastTouchAt: pond.t, scaffold: 0 };
  // the dots under the numeral: full while this form is new to the child, fading as they grow past it
  const support = 1 - smooth(st.difficulty - 0.02, st.difficulty + 0.3, mastery);
  ui.setTarget(t, st.display, st.id === 'times' ? support * 0.5 : support);
  const w = N.numberWord(t.value);
  ui.say(bond ? `${w} · in two leaves` : again ? (st.rule === 'groups' ? `${w} again · the other way round` : `${w} again · another way`) : N.hintFor(st, t, firstTarget), firstTarget ? 9 : 5);
  firstTarget = false;
  plantDue();
}

// ─── the finale: the dew in view chimes its count and rises (P6) ───────────
interface Chime {
  at: number;
  pad: Pad;
  n: number;
}
let chimes: Chime[] = [];

function startFinale() {
  const leaves = visibleDewy()
    .filter((p) => !p.selected)
    .sort((a, b) => a.x - b.x)
    .slice(0, 4);
  let at = pond.t + 0.4;
  for (const p of leaves) {
    const n = liveCount(p);
    for (let j = 0; j < n; j++) chimes.push({ at: at + j * 0.26, pad: p, n: j });
    at += n * 0.26 + 0.5;
  }
  lock = at - pond.t + 0.3;
  report('learn', learnSummary());
  stretch.finished();
  stretch = new L.Stretch(stretch);
  nextTargetAt = at + L.PHASE_PAUSE.finale;
}

function stepChimes() {
  if (!chimes.length) return;
  const due = chimes.filter((c) => c.at <= pond.t);
  chimes = chimes.filter((c) => c.at > pond.t);
  for (const c of due) {
    const p = c.pad;
    sound.note(c.n, panAt(p.x));
    const d = p.drops.find((dd) => dd.to > 0);
    if (!d) continue;
    d.to = 0;
    const cs = Math.cos(p.ang);
    const sn = Math.sin(p.ang);
    lifts.push({ x0: p.x + cs * d.x * p.r - sn * d.y * p.r, y0: p.y + sn * d.x * p.r + cs * d.y * p.r, t: 0, dur: 1.6 + rand() * 0.5, delay: 0, bend: (rand() * 2 - 1) * 70, radius: d.r * p.r });
    p.bob = Math.min(1, p.bob + 0.25);
  }
}

function learnSummary() {
  const now = Date.now();
  const facts = Object.keys(memory.items);
  return {
    mastery: Math.round(mastery * 100) / 100,
    firstTry: Math.round(stretch.firstTryRate() * 100) / 100,
    meanQ: stretch.outcomes.length ? Math.round((stretch.outcomes.reduce((a, o) => a + o.q, 0) / stretch.outcomes.length) * 100) / 100 : null,
    asks: stretch.outcomes.length,
    facts: facts.length,
    fluent: facts.filter((k) => memory.fluent(k, now)).length,
    due: memory.due(now, () => true, 99).length,
  };
}

// ─── the river helps, it never tells (P7) ──────────────────────────────────
const HELP_AT = [7, 14, 22];

function scaffold() {
  if (!target || !ask || lock > 0 || selection.length) return;
  if (ask.scaffold >= HELP_AT.length || pond.t - ask.lastTouchAt < HELP_AT[ask.scaffold]) return;
  const seen = visibleDewy();
  const sol = L.solutionFor(ask.stage.rule, counts(seen), ask.value, ask.stage.maxParts, ask.bond ? 2 : undefined);
  if (!sol) return;
  ask.scaffold++;
  const pads = sol.map((i) => seen[i]);
  if (ask.scaffold === 2) {
    // one leaf of an answer drifts gently toward the boat
    const p = pads[0];
    const [bx, by] = pond.bow();
    const d = Math.hypot(bx - p.x, by - p.y) || 1;
    p.vx += ((bx - p.x) / d) * 22;
    p.vy += ((by - p.y) / d) * 22;
    p.bob = Math.min(1, p.bob + 0.6);
  } else {
    for (const p of pads) p.bob = Math.min(1, p.bob + 0.7);
  }
  sound.glint();
}

// ─── elegance: the river notices a good answer (P4) ────────────────────────
interface Opening {
  b: import('./world').Bloom;
  t: number;
  size: number;
}
let openings: Opening[] = [];

function openBeside(p: Pad) {
  const b = pond.bloomBeside(p, rand);
  if (b) openings.push({ b, t: 0, size: 13 + rand() * 4 });
}

function stepOpenings(dt: number) {
  for (const o of openings) {
    o.t += dt;
    // a bud rises, then opens
    if (o.t < 0.9) o.b.size = 6 + 3 * (o.t / 0.9);
    else {
      o.b.open = 1;
      const k = Math.min(1, (o.t - 0.9) / 1.4);
      o.b.size = 9 + (o.size - 9) * (1 - (1 - k) * (1 - k));
    }
  }
  openings = openings.filter((o) => o.t < 2.4);
}

/**
 * Physics may carry a needed leaf away. An untouched ask quietly dissolves and
 * is redrawn from the new landscape. Exact condensation repair is reserved for
 * a child already midway through that answer.
 */
function keepSolvable() {
  if (!target || lock > 0) {
    unsolvableSince = 0;
    return;
  }
  const st = stage();
  const seen = visibleDewy();
  if (ask?.bond && !selection.length && !L.solutionFor('sum', counts(seen), target.value, 2, 2)) {
    // the pair that made it in two has drifted off: quietly let it be any leaves
    ask.bond = false;
    ui.say(`gather ${N.numberWord(target.value)} drops`, 4);
  }
  if (N.solvable(st, counts(seen), target.value)) {
    unsolvableSince = 0;
    return;
  }
  if (!unsolvableSince) unsolvableSince = pond.t;
  const lostFor = pond.t - unsolvableSince;
  // quickly: a child should never be left looking for an answer that is not there
  if (lostFor < 0.5) return;

  if (!selection.length) {
    target = null;
    ui.clearTarget();
    ui.quiet();
    nextTargetAt = pond.t + 0.55;
    unsolvableSince = 0;
    return;
  }

  if (lostFor < 1.2) return;
  const dry = visibleDry();
  const all = [...seen, ...dry];
  const fix = N.repair(st, counts(all), target.value);
  if (fix) {
    fix.forEach((c, i) => condense(all[i], c));
    unsolvableSince = 0;
  }
}

function gathered() {
  return selection.reduce((s, p) => s + liveCount(p), 0);
}

function clearSelection() {
  for (const p of selection) p.selected = false;
  selection = [];
  ui.progress(0);
}

function choose(p: Pad) {
  if (!target || lock > 0) return;
  const i = selection.indexOf(p);
  if (i >= 0) {
    // touching a chosen leaf lets it go
    p.selected = false;
    selection.splice(i, 1);
    ui.progress(gathered());
    return;
  }
  if (!liveCount(p)) return;
  p.selected = true;
  selection.push(p);
  if (ask) ask.lastTouchAt = pond.t;
  const st = stage();
  let verdict = N.judge(st, target.value, counts(selection));
  // "in two leaves": a second leaf that doesn't make it starts the pair again from this one
  if (ask?.bond && verdict.kind === 'partial' && selection.length >= 2) verdict = { kind: 'mismatch', gathered: liveCount(p) };
  // passing exactly through ten on the way to a bigger number rings a low bell
  if (st.rule === 'sum' && target.value > 10 && verdict.kind === 'partial' && verdict.gathered === 10) sound.ten(panAt(p.x));
  sound.note(selection.length - 1 + Math.min(4, liveCount(p) - 1), panAt(p.x));
  switch (verdict.kind) {
    case 'partial':
      ui.progress(verdict.gathered);
      break;
    case 'mismatch':
      targetFriction++;
      for (const q of selection.slice(0, -1)) q.selected = false;
      selection = [p];
      ui.progress(verdict.gathered);
      ui.say(ask?.bond ? 'two leaves' : 'leaves that match', 3);
      break;
    case 'over':
      targetFriction++;
      ui.progress(Math.min(verdict.gathered, target.value));
      ui.say('let a few drops return to the water', 3);
      lock = 1.2;
      releaseAt = pond.t + 1.1;
      break;
    case 'solved':
      ui.progress(verdict.gathered);
      solve();
      break;
  }
}

interface Lift {
  x0: number;
  y0: number;
  t: number;
  dur: number;
  delay: number;
  bend: number;
  /** The drop's radius on the leaf (world), where the light begins. */
  radius: number;
}
let lifts: Lift[] = [];
let lantern = 0;

function solve() {
  if (!target) return;
  const value = target.value;
  const chosen = counts(selection);
  const chosenPads = selection.slice();
  const others = counts(visibleDewy().filter((q) => !q.selected));
  sound.gathered();
  ui.solved();
  let k = 0;
  for (const p of selection) {
    const c = Math.cos(p.ang);
    const s = Math.sin(p.ang);
    for (const d of p.drops) {
      if (d.to <= 0) continue;
      d.to = 0;
      const lx = d.x * p.r;
      const ly = d.y * p.r;
      lifts.push({ x0: p.x + c * lx - s * ly, y0: p.y + s * lx + c * ly, t: 0, dur: 1.5 + rand() * 0.6, delay: k++ * 0.07, bend: (rand() * 2 - 1) * 60, radius: d.r * p.r });
    }
    pond.impulses.push({ x: p.x, y: p.y, r: p.r * 0.6, s: 0.6 });
  }
  const done = selection;
  selection = [];
  window.setTimeout(() => done.forEach((p) => (p.selected = false)), 900);
  lock = 2.2;
  lastSolved = value;
  target = null;
  pond.propel(90 + value * 14);
  ui.say(['and the water carries you', 'onward', 'the river opens', 'further down the water'][Math.floor(rand() * 4)], 3);
  const st = stage();
  // what the river learns from how it was made (P1, P2) — never shown
  const phase = ask?.phase ?? 'relief';
  const scaffolds = ask?.scaffold ?? 0;
  const obs: L.Observation = {
    secs: pond.t - (ask?.shownAt ?? pond.t),
    leaves: chosen.length,
    value,
    friction: targetFriction,
    scaffold: scaffolds,
    counting: st.id === 'gather',
  };
  const q = L.quality(obs);
  const fact = L.factOf(st.rule, chosen);
  const { newWay } = memory.record(fact, q, Date.now());
  mastery = N.learn(mastery, st, { value }, targetFriction + scaffolds);
  if (phase === 'reach') lastReach = { stage: st, value, parts: fact.parts };
  stretch.answered({ q, friction: targetFriction });
  ask = null;

  // and how the river answers a good one (P4)
  const e = L.elegance(st.rule, chosen, others, st.maxParts, q, newWay);
  if (e.fewest) openBeside(chosenPads[Math.floor(rand() * chosenPads.length)]);
  if (e.bothWays) {
    openBeside(chosenPads[0]);
    openBeside(chosenPads[chosenPads.length - 1]);
  }
  if (e.double) {
    // the two leaves drift together and touch
    const [a, c] = chosenPads;
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const d = Math.hypot(dx, dy) || 1;
    a.vx += (dx / d) * 16;
    a.vy += (dy / d) * 16;
    c.vx -= (dx / d) * 16;
    c.vy -= (dy / d) * 16;
  }
  if (e.fluent) lantern = Math.min(1.5, lantern + 0.35);

  totalSolves++;
  save();
  nextTargetAt = pond.t + L.PHASE_PAUSE[phase];
}

// ─── input ─────────────────────────────────────────────────────────────────
let pointerId: number | null = null;
let lastHit: Pad | null = null;
let started = false;

function hit(sx: number, sy: number): Pad | null {
  const [wx, wy] = toWorld(sx, sy);
  const order = drawOrder(pond.pads);
  for (let i = order.length - 1; i >= 0; i--) {
    const p = order[i];
    const dx = wx - p.x;
    const dy = wy - p.y;
    if (dx * dx + dy * dy < p.r * p.r * 0.94) return p;
  }
  return null;
}

/**
 * A fingertip is not a point: a tap that lands just off a small dewy leaf was
 * meant for it. Off every leaf, the nearest leaf with dew within a fingertip's
 * slack (about 14 CSS px) counts as touched — a miss on the water would
 * otherwise clear the child's whole selection.
 */
function hitOrNear(sx: number, sy: number): Pad | null {
  const direct = hit(sx, sy);
  if (direct) return direct;
  const [wx, wy] = toWorld(sx, sy);
  const slack = 14 / cam.zoom;
  let best: Pad | null = null;
  let bestD = slack;
  for (const p of pond.pads) {
    if (!liveCount(p)) continue;
    const d = Math.hypot(wx - p.x, wy - p.y) - p.r * 0.97;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function touchPad(p: Pad) {
  p.bob = 1;
  p.vx += (rand() - 0.5) * 6;
  p.vy += (rand() - 0.5) * 6;
  p.va += (rand() - 0.5) * 0.3;
  pond.impulses.push({ x: p.x + p.r * 0.8, y: p.y, r: 8, s: 0.5 });
  pond.impulses.push({ x: p.x - p.r * 0.8, y: p.y, r: 8, s: 0.5 });
}

function begin() {
  if (started) return;
  started = true;
  ui.fadeTitle();
}

/** A name was chosen at the start: load that child's river and let the asks begin. */
function startAs(name: string) {
  loadProfile(name);
  welcome = lastPlayed > 0 && Date.now() - lastPlayed > 6 * 3600_000;
  stretch = new L.Stretch(null, welcome);
  if (welcome) pond.bloomBoost = 2.2;
  ui.hideStart();
  startedAt = pond.t;
  begin();
  nextTargetAt = pond.t + 1.2;
  canvasEl.focus({ preventScroll: true });
}
/**
 * Returning children find their names written on lily pads: one pad each,
 * in the middle of the view, clear of the boat. A pad that drifts out of the
 * band is swapped for another. Tapping the pad starts as that child.
 */
/** A name and the leaf it's written on; `a` fades it out when the leaf sinks or drifts off, and in on a new one. */
interface NameSlot {
  name: string;
  pad: Pad | null;
  a: number;
}
const startNames = profiles
  .slice()
  .sort((a, b) => b.last - a.last)
  .slice(0, 6)
  .map((q) => q.name);
renderer.setNames(startNames);
const nameSlots: NameSlot[] = startNames.map((name) => ({ name, pad: null, a: 0 }));
/** When the start ended (pond time), for fading the names off the leaves. */
let startedAt = -1;
function placeNames(dt: number) {
  if (started) return;
  const inBand = (p: Pad) => {
    const [sx, sy] = toScreen(p.x, p.y);
    // below the title (on the golden-ratio line) and above the name field at the foot
    return sx > 44 && sx < cam.cssW - 44 && sy > cam.cssH * 0.46 && sy < cam.cssH * 0.84 && !pond.onBoat(p.x, p.y);
  };
  // a name stays legible while its leaf is in the band and afloat; otherwise it
  // fades, and once gone is written on another leaf, fading in there
  const ok = (p: Pad | null) => !!p && pond.pads.includes(p) && inBand(p) && p.sink < 0.35;
  const used = nameSlots.map((s) => s.pad).filter((p): p is Pad => !!p);
  for (const slot of nameSlots) {
    const valid = ok(slot.pad);
    if (!valid && slot.a < 0.03) {
      const p = pond.pads
        .filter((q) => !used.includes(q) && q.r >= 24 && ok(q))
        .filter((q) => used.every((u) => Math.hypot(u.x - q.x, u.y - q.y) > q.r + u.r + 30))
        .sort((a, b) => b.r - a.r)[0];
      if (p) {
        slot.pad = p;
        used.push(p);
      } else slot.pad = null;
    }
    const target = ok(slot.pad) ? 1 - Math.min(1, slot.pad!.sink / 0.35) : 0;
    slot.a += (target - slot.a) * (1 - Math.exp(-3.5 * dt));
  }
}

/** The names for the renderer: on their leaves, sized to the leaf, fading once a child has begun. */
function nameSprites() {
  const a = started ? Math.max(0, 1 - (pond.t - startedAt) / 0.9) : 1;
  if (a <= 0) return [];
  return nameSlots
    .filter((s) => s.pad && s.a > 0.01)
    .map((s) => ({ i: startNames.indexOf(s.name), x: s.pad!.x, y: s.pad!.y, h: Math.max(13, Math.min(20, s.pad!.r * cam.zoom * 0.42)) / cam.zoom, a: a * s.a }));
}
{
  const auto = startupParams.get('profile');
  if (auto) startAs(auto);
  else ui.start(profiles.length > 0, startAs);
}

/**
 * Touch on open water is WIND, not a button: a tap is a round puff; a drag is
 * a firm gust that follows the finger and runs on across the water when it
 * lifts — ruffling the surface, pushing and turning pads, scattering fish,
 * fireflies and pollen. So is a touch on a dry leaf. Touch on a leaf holding
 * dew chooses it, and a drag from there traces across dewy leaves.
 */
/** A finger drawn through the water: its path, for the ripples it leaves. */
/**
 * The oars only pull when asked. A tap on the boat, or on the water behind
 * it, is one stroke: the arms push away, the blades go in and pull, and the
 * boat glides on until the next tap (a solved number rows a few strokes by
 * itself). Sliding a finger across, behind the boat, steers. The finger stays
 * behind the boat, off the water it's heading into.
 */
let helm: { t: number; x: number; y: number; moved: boolean; steer: number; sign: number; bias: number } | null = null;
let drag: { x: number; y: number; t: number; vx: number; vy: number; moved: boolean; wx: number; wy: number; last: number } | null = null;

let pointerAt = 0;
canvasEl.addEventListener('pointerdown', (e) => {
  // a second finger while one is down is ignored — unless the first was lost without an
  // up (it happens on phones); then the new touch takes over rather than every tap dying
  if (pointerId !== null) {
    if (performance.now() - pointerAt < 1500 || helm || drag?.moved) return;
    pointerId = null;
    helm = null;
    drag = null;
    lastHit = null;
  }
  pointerAt = performance.now();
  armSound();
  if (!started) {
    // a name on a leaf: that child begins. Anything else is just the river, touched
    const p = hit(e.clientX, e.clientY);
    const name = p && nameSlots.find((s) => s.pad === p && s.a > 0.5)?.name;
    if (name) {
      p.bob = 1;
      startAs(name);
      return;
    }
  }
  pointerId = e.pointerId;
  canvasEl.setPointerCapture(e.pointerId);
  const [bwx, bwy] = toWorld(e.clientX, e.clientY);
  const hitPad = hitOrNear(e.clientX, e.clientY);
  // the boat, or the water astern of it (unless that's a dewy leaf to gather): the helm
  if (pond.onBoat(bwx, bwy) || (pond.behindBoat(bwx, bwy) && !(hitPad && liveCount(hitPad)))) {
    // where on the boat: across (a tap there leans on that oar) and fore or aft of the
    // centre (dragging the front half swings the bow, the back half swings the stern)
    const [lx, ly] = pond.boatLocal(bwx, bwy);
    helm = { t: performance.now(), x: e.clientX, y: e.clientY, moved: false, steer: pond.boat.heading, sign: ly > 0 ? 1 : -1, bias: Math.max(-1, Math.min(1, lx / 30)) };
    pond.boat.helm = { steer: pond.boat.heading };
    return;
  }
  // a leaf with dew is a choice; anywhere else — water or a dry leaf — the touch is wind
  const p = hitPad && liveCount(hitPad) ? hitPad : null;
  lastHit = p;
  if (hitPad && !p) touchPad(hitPad);
  if (p) {
    touchPad(p);
    choose(p);
  } else {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    // one plop: a single clean ring spreading out, like a raindrop or a fingertip
    if (!pond.splash(wx, wy, 6, 2.6)) sound.plop(1, panAt(wx));
    school.scare(wx, wy, 170);
    if (selection.length && lock <= 0) clearSelection();
    // a finger left on the water may then be drawn through it (see pointermove)
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: false, wx, wy, last: performance.now() };
  }
});

canvasEl.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointerId) return;
  if (helm) {
    const dx = e.clientX - helm.x;
    const dy = e.clientY - helm.y;
    if (Math.hypot(dx, dy) > 10) helm.moved = true;
    // sliding across steers (about 30° for a thumb's slide), turning the boat about its
    // centre: the half you hold follows the finger. The oars only pull on a tap
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) pond.boat.helm = { steer: helm.steer + dx * 0.007 * helm.sign };
    return;
  }
  if (drag) {
    // a finger drawn through the water: a line of small ripples along its path, closer
    // and stronger the faster it moves, and the leaves it crosses feel it
    const now = performance.now();
    const dtm = Math.max(1, now - drag.t) / 1000;
    const vx = (e.clientX - drag.x) / dtm;
    const vy = (e.clientY - drag.y) / dtm;
    drag.vx += (vx - drag.vx) * 0.3;
    drag.vy += (vy - drag.vy) * 0.3;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = now;
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const dx = wx - drag.wx;
    const dy = wy - drag.wy;
    const d = Math.hypot(dx, dy);
    if (d >= 5) {
      drag.moved = true;
      const sp = Math.hypot(drag.vx, drag.vy);
      const strength = Math.max(0.12, Math.min(0.45, sp / 1400));
      const step = 6;
      for (let a = step; a <= d; a += step) {
        const x = drag.wx + (dx / d) * a;
        const y = drag.wy + (dy / d) * a;
        pond.impulses.push({ x, y, r: 4.5 + strength * 4, s: strength });
      }
      if (now - drag.last > 220) {
        drag.last = now;
        pond.rings.push({ x: wx, y: wy, t: pond.t, s: 0.35 });
        if (sp > 250) sound.gurgle(0.3 + strength * 0.6, panAt(wx));
        school.scare(wx, wy, 70);
      }
      drag.wx = wx;
      drag.wy = wy;
    }
    return;
  }
  const p = hit(e.clientX, e.clientY);
  if (!p || p === lastHit) return;
  // tracing back onto the previous leaf lets the last one go
  if (selection.length > 1 && selection[selection.length - 2] === p) {
    const last = selection.pop()!;
    last.selected = false;
    ui.progress(gathered());
  } else if (!selection.includes(p)) {
    touchPad(p);
    choose(p);
  }
  lastHit = p;
});

const end = (e: PointerEvent) => {
  if (e.pointerId !== pointerId) return;
  pointerId = null;
  lastHit = null;
  if (helm) {
    if (!helm.moved && performance.now() - helm.t < 350) pond.stroke(helm.bias);
    pond.boat.helm = null;
    helm = null;
  }
  drag = null;
};
canvasEl.addEventListener('pointerup', end);
canvasEl.addEventListener('pointercancel', end);

// keyboard: arrows walk the dewy leaves in view (reading order), Enter/Space chooses
let focusIx = -1;
canvasEl.addEventListener('keydown', (e) => {
  if (!started) return;
  const pads = visibleDewy().sort((a, b) => b.y - a.y || a.x - b.x);
  if (e.key === 'Escape') {
    clearSelection();
    return;
  }
  if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
    e.preventDefault();
    begin();
    const cur = pads.findIndex((p) => p.focus);
    for (const p of pond.pads) p.focus = false;
    if (!pads.length) return;
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    focusIx = ((cur < 0 ? (step > 0 ? -1 : 0) : cur) + step + pads.length) % pads.length;
    pads[focusIx].focus = true;
    ui.announce(`Leaf with ${liveCount(pads[focusIx])} drops${pads[focusIx].selected ? ', chosen' : ''}.`);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const p = pond.pads.find((q) => q.focus);
    if (p) {
      touchPad(p);
      choose(p);
    }
  }
});

const soundBtn = document.getElementById('sound') as HTMLButtonElement;
/** Any first touch on the river turns the sound on; the button still toggles it. */
function armSound() {
  if (sound.on) return;
  const on = sound.arm();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.textContent = on ? 'sound on' : 'sound off';
}
document.getElementById('newname')?.addEventListener('pointerdown', armSound);
soundBtn.addEventListener('click', () => {
  const on = sound.toggle();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.textContent = on ? 'sound on' : 'sound off';
});

document.addEventListener('visibilitychange', () => {
  sound.suspend(document.hidden);
  last = performance.now();
});

// ─── light and air ─────────────────────────────────────────────────────────
// `?time=0.5` starts at that point of the day (0 afternoon · .3 golden · .5 dusk · .7 night · .9 dawn)
const dayStart = Number.isFinite(Number(params.get('time'))) && params.get('time') !== null ? Number(params.get('time')) : 0.08;
const atmosphere = new Atmosphere(reduced ? { flies: 14, pollen: 16, silt: 30 } : { flies: 56, pollen: 40, silt: 70 });
let lastBugs: Critter[] = [];
const critters = new Critters(reduced ? { dragonflies: 1, butterflies: 2 } : { dragonflies: 2, butterflies: 3 });

function gathers(dt: number, dusk: number): Mote[] {
  const out: Mote[] = [];
  const [bx, by] = pond.bow();
  lifts = lifts.filter((l) => l.t < l.dur + l.delay);
  let arrived = 0;
  for (const l of lifts) {
    l.t += dt;
    const k = Math.max(0, Math.min(1, (l.t - l.delay) / l.dur));
    if (k <= 0) continue;
    const e = k * k * (3 - 2 * k);
    const mx = (l.x0 + bx) / 2 + l.bend;
    const my = (l.y0 + by) / 2 + 40;
    const x = (1 - e) * (1 - e) * l.x0 + 2 * (1 - e) * e * mx + e * e * bx;
    const y = (1 - e) * (1 - e) * l.y0 + 2 * (1 - e) * e * my + e * e * by;
    // the handover: the light begins as the drop itself (its size, pale, at rest on the leaf
    // as the leaf's own drop fades), then warms and brightens as it lifts away
    const wake = smooth(0, 0.35, k * l.dur);
    const size = (l.radius * 2.4 * cam.zoom) * (1 - wake) + (16 - 6 * e) * wake;
    out.push({ x, y, size, r: 1, g: 0.93 + 0.05 * (1 - wake), b: 0.7 + 0.25 * (1 - wake), a: (0.55 + 0.35 * wake) * (1 - e * 0.3), core: 0.6 + 0.4 * wake, z: 1 + 0.08 * Math.sin(e * Math.PI) });
    if (l.t - l.delay + dt >= l.dur) arrived++;
  }
  lantern = Math.min(1.5, lantern + arrived * 0.12) * Math.exp(-0.25 * dt);
  // the lantern: a small warmth by day, the brightest thing on the river at night
  const glow = lantern + dusk * 0.8;
  out.push({ x: bx, y: by, size: 26 + glow * 40, r: 1, g: 0.8, b: 0.45, a: 0.22 + glow * 0.35, core: 0.3, z: 1.02 });
  if (dusk > 0.2) out.push({ x: bx, y: by, size: 140 + glow * 80, r: 1, g: 0.72, b: 0.4, a: 0.05 * dusk + glow * 0.03, core: 0, z: 1 });
  return out;
}

/** Drops falling from the lifted blades: a glint each, shrinking toward the water. */
function drips(sky: { sunCol: [number, number, number] }): Mote[] {
  return pond.drips.map((d) => {
    const k = d.age / d.life;
    return { x: d.x, y: d.y + (d.spray ? Math.sin(k * Math.PI) * 10 : (1 - k * k) * 6), size: 3.2 - k * 1.2, r: 0.8 + sky.sunCol[0] * 0.2, g: 0.9, b: 0.95, a: 0.7 * (1 - k * 0.5), core: 1, z: 1 };
  });
}

// ─── frame ─────────────────────────────────────────────────────────────────
let last = performance.now();
let frameMs = 16;
let slowFor = 0;
let fastFor = 0;

function adapt(ms: number, dt: number) {
  frameMs += (ms - frameMs) * 0.05;
  if (frameMs > 23) {
    slowFor += dt;
    fastFor = 0;
  } else if (frameMs < 18.2) {
    // A 60 Hz browser presents at ~16.7 ms. The old <13 ms recovery gate
    // made every temporary down-step effectively permanent.
    fastFor += dt;
    slowFor = 0;
  } else {
    slowFor = fastFor = 0;
  }
  const next = slowFor > 1.8 ? scale - 0.1 : fastFor > 4 ? scale + 0.1 : scale;
  const clamped = Math.max(0.5, Math.min(1, Math.round(next * 10) / 10));
  if (clamped !== scale) {
    scale = clamped;
    slowFor = fastFor = 0;
    renderer.resize(cam.cssW, cam.cssH, dpr, scale);
  }
}

let perfSent = false;
let scareAcc = 0;
let breezeAt = 6;
let breezeDir = Math.PI * 0.5 + (rand() - 0.5);
function frame(now: number) {
  if (!perfSent && pond.t > 12) {
    perfSent = true;
    report('perf', { frameMs: Math.round(frameMs * 10) / 10, scale, sim: renderer.simOn, dpr });
  }
  const ms = now - last;
  const dt = Math.min(ms / 1000 || 1 / 60, 1 / 20) * timeScale;
  last = now;

  const hh = cam.cssH / (2 * cam.zoom);
  pond.ensure(cam.y + hh + 500);
  pond.cull(cam.y - hh - 600);

  // physics at a fixed step
  const steps = Math.max(1, Math.round(dt * 60));
  for (let i = 0; i < steps; i++) pond.step(dt / steps, { y0: cam.y - hh - 200, y1: cam.y + hh + 300 }, reduced);
  const shift = pond.rebaseIfNeeded();
  if (shift) {
    cam.y -= shift;
    renderer.shiftSim(shift);
    for (const l of lifts) l.y0 -= shift;
  }
  const hw = cam.cssW / (2 * cam.zoom);
  const interest: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < pond.floaters.length; i += 4) {
    const fl = pond.floaters[i];
    if (Math.abs(fl.x - cam.x) < hw + 40 && Math.abs(fl.y - cam.y) < hh + 40) { if (fl.kind === 0) interest.push({ x: fl.x, y: fl.y }); }
  }
  for (const p of pond.pads) if (p.drops.length && Math.abs(p.x - cam.x) < hw && Math.abs(p.y - cam.y) < hh) interest.push({ x: p.x + p.r * 0.9, y: p.y });
  school.step(dt, pond.boat, { x: cam.x, y: cam.y, hw, hh }, shift, (x, y) => pond.flow(x, y), interest);
  // a big fish nosing at the surface: a small ring and a soft sound
  for (const r of school.rises) {
    pond.impulses.push({ x: r.x, y: r.y, r: 5, s: 0.35 });
    pond.rings.push({ x: r.x, y: r.y, t: pond.t, s: 0.3 });
    // (the same drip plink was used here; silent for now, see Round 52)
    for (const fl of pond.floaters) {
      const dx = fl.x - r.x, dy = fl.y - r.y, d = Math.hypot(dx, dy);
      if (fl.kind === 0 && d < 16) {
        fl.vx += dx / Math.max(d, 1) * 3;
        fl.vy += dy / Math.max(d, 1) * 3;
        fl.va += (fl.seed - 0.5) * 0.8;
      }
    }
  }
  school.rises.length = 0;
  if (shift) {
    atmosphere.shift(shift);
    critters.shift(shift);
  }
  // a gentle breeze of the river's own, now and then: a soft patch of wind crossing the
  // water, ruffling it, nudging the leaves and the pollen (touch is no longer wind)
  breezeAt -= dt;
  if (breezeAt <= 0) {
    breezeAt = 9 + rand() * 12;
    breezeDir += (rand() - 0.5) * 1.2;
    const bdx = Math.cos(breezeDir);
    const bdy = Math.sin(breezeDir);
    const hw2 = cam.cssW / (2 * cam.zoom);
    pond.gust({ x: cam.x - bdx * hw2 * 0.8 + (rand() - 0.5) * 120, y: cam.y + (rand() - 0.5) * hh * 1.2, dx: bdx, dy: bdy, s: 0.2 + rand() * 0.16, r: 200 + rand() * 90, life: 4 + rand() * 2.5, radial: false, held: false });
  }
  let breeze = 0;
  scareAcc += dt;
  for (const g of pond.gusts) {
    const lvl = Pond.gustLevel(g);
    breeze = Math.max(breeze, lvl);
    // a breeze moves a gust along; only a strong one startles the fish
    g.x += g.dx * 26 * dt;
    g.y += g.dy * 26 * dt;
    if (scareAcc > 0.25 && lvl > 0.34) school.scare(g.x, g.y, g.r * (0.8 + lvl * 0.6));
  }
  if (scareAcc > 0.25) scareAcc = 0;
  sound.breeze(breeze);
  sound.river(pond.boat.speed, pond.boat.power * pond.boat.rowing * Math.max(0, Math.cos(pond.boat.stroke * Math.PI * 2)), breeze);

  // the camera follows the boat, easing sideways toward the channel
  const b = pond.boat;
  cam.x += (b.x * 0.75 + pond.channel(b.y + 120) * 0.25 - cam.x) * (1 - Math.exp(-1.2 * dt));
  cam.y += (followY() - cam.y) * (1 - Math.exp(-3 * dt));

  // the water's own events: fish bolt from oar catches, splashes and drips make their sounds
  for (const st of pond.startles) school.scare(st.x, st.y, st.r);
  pond.startles.length = 0;
  for (const snd of pond.sounds) {
    const pan = panAt(snd.x);
    if (snd.kind === 'dip') sound.dip(snd.s, pan);
    else if (snd.kind === 'gurgle') sound.gurgle(snd.s, pan);
    // 'drip' (water off the lifted blades, and the release's spray) is not voiced: the
    // pitched plinks read as notes, not water. The ripples still land. See Round 52.
  }
  pond.sounds.length = 0;
  for (const bump of pond.bumps) {
    sound.knock(bump.strength, panAt(bump.x));
    school.scare(bump.x, bump.y);
  }
  pond.bumps.length = 0;

  // the rules
  lock = Math.max(0, lock - dt);
  if (releaseAt && pond.t >= releaseAt) {
    releaseAt = 0;
    clearSelection();
    sound.release();
  }
  if (!target && pond.t >= nextTargetAt) setTarget();
  if (!started) placeNames(dt);
  stepChimes();
  stepOpenings(dt);
  scaffold();
  if (pond.bloomBoost > 1 && pond.t > 90) pond.bloomBoost = 1;
  if (pond.t >= checkAt) {
    checkAt = pond.t + 0.35;
    keepSolvable();
    // a dewy leaf drifting under another sheds the hidden drops rather than hiding them
    shedHidden();
  }

  // `?sinktest=1`: hold the dewy leaf nearest the centre pushed under at one edge (to look at the flooding)
  if (params.get('sinktest')) {
    const v = visibleDewy().sort((a, b) => Math.hypot(a.x - cam.x, a.y - cam.y) - Math.hypot(b.x - cam.x, b.y - cam.y))[0];
    if (v) {
      v.caught = true;
      v.sink = 0.75;
      v.dx = 0.15;
      v.dy = 0.02;
    }
  }
  const order = drawOrder(pond.pads);
  const thread: Array<[number, number]> = [];
  if (selection.length > 1) {
    for (let i = 0; i < selection.length - 1; i++) {
      const a = selection[i];
      const c = selection[i + 1];
      for (let k = 0; k < 12; k++) {
        const u = k / 12;
        const sag = Math.sin(u * Math.PI) * 10;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        thread.push([a.x + dx * u - (dy / l) * sag, a.y + dy * u + (dx / l) * sag]);
      }
    }
    const z = selection[selection.length - 1];
    thread.push([z.x, z.y]);
  }

  // resolution steps BEFORE drawing: resizing the canvas clears it, and after the draw that blanked a frame
  adapt(ms, dt);
  const sky = skyAt(dayStart + pond.t / DAY);
  const field = {
    x: cam.x,
    y: cam.y,
    hw: cam.cssW / (2 * cam.zoom),
    hh,
    flow: (x: number, y: number) => pond.flow(x, y),
    wind: (x: number, y: number) => pond.wind(x, y),
  };
  const air = atmosphere.step(dt, pond.t, field, sky);
  const bugs = started
    ? critters.step(dt, pond.t, field, { pads: order, blooms: pond.blooms, boatAt: (lx, ly) => pond.boatWorld(lx, ly), boatHeading: pond.boat.heading }, sky)
    : [];
  lastBugs = bugs;
  renderer.render(
    {
      cam,
      light: sky,
      time: pond.t,
      pond,
      pads: bare ? [] : order,
      fish: school.fish,
      critters: bugs,
      motes: [...air.above, ...gathers(dt, sky.dusk), ...drips(sky)],
      under: air.below,
      thread,
      lantern: 0.15 + lantern * 0.6 + sky.dusk * 1.1,
      names: nameSprites(),
    },
    dt,
  );
  requestAnimationFrame(frame);
}

function shedHidden() {
  const order = drawOrder(pond.pads);
  const idx = new Map(order.map((p, i) => [p, i]));
  for (const p of order) {
    if (!p.drops.length || p.selected) continue;
    const c = Math.cos(p.ang);
    const s = Math.sin(p.ang);
    const i = idx.get(p)!;
    for (const d of p.drops) {
      if (d.to <= 0) continue;
      const wx = p.x + (c * d.x - s * d.y) * p.r;
      const wy = p.y + (s * d.x + c * d.y) * p.r;
      for (let j = i + 1; j < order.length; j++) {
        const q = order[j];
        if (Math.abs(q.y - wy) > q.r || Math.abs(q.x - wx) > q.r) continue;
        if (Math.hypot(q.x - wx, q.y - wy) < q.r * 0.95) {
          d.to = 0;
          break;
        }
      }
    }
  }
}

// debug/test surface: read on demand, not rebuilt per frame
Object.defineProperty(window, '__stillwater', {
  get: () => ({
    renderer: 'webgl2',
    stage: stage().id,
    mastery: Math.round(mastery * 1000) / 1000,
    totalSolves,
    target: target?.value ?? null,
    gathered: gathered(),
    selected: selection.map((p) => p.id),
    boatY: pond.boat.y + pond.origin,
    learning: { phase: stretch.phase, ask: ask ? { value: ask.value, stage: ask.stage.id, bond: ask.bond, again: ask.again, scaffold: ask.scaffold } : null, ...learnSummary() },
    profile: profile?.name ?? null,
    fork: pond.forkState(),
    reach: Object.fromEntries(Object.entries(pond.reachHere(pond.boat.y)).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    names: nameSlots
      .filter((s) => s.pad)
      .map((s) => {
        const [x, y] = toScreen(s.pad!.x, s.pad!.y);
        return { name: s.name, x: Math.round(x), y: Math.round(y), a: Math.round(s.a * 100) / 100 };
      }),
    boat: (() => {
      const [x, y] = toScreen(pond.boat.x, pond.boat.y);
      const b = pond.boat;
      return { x: Math.round(x), y: Math.round(y), power: Math.round(b.power * 100) / 100, heading: Math.round(b.heading * 100) / 100, helm: !!b.helm, speed: Math.round(b.speed), stroke: Math.round(b.stroke * 100) / 100, owed: Math.round((b.strokeTo - b.stroke) * 100) / 100 };
    })(),
    bugs: lastBugs.map((c) => {
      const [x, y] = toScreen(c.x, c.y);
      return { kind: c.kind, x: Math.round(x), y: Math.round(y), wing: Math.round(c.wing * 100) / 100, h: Math.round(c.h * 100) / 100, a: Math.round(c.alpha * 100) / 100 };
    }),
    scale,
    frameMs: Math.round(frameMs * 10) / 10,
    sim: renderer.simOn,
    pads: visibleDewy().map((p) => {
      const [x, y] = toScreen(p.x, p.y);
      return { id: p.id, x: Math.round(x), y: Math.round(y), n: liveCount(p) };
    }),
  }),
});

requestAnimationFrame((t) => {
  last = t;
  requestAnimationFrame(frame);
});

