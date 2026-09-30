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
import { drawOrder, Camera, Mote, PageEntry, Renderer } from './render';
import { Critters, type Critter } from './critters';
import { butterflyId, dragonflyId, fishId, flowerId, Notebook, SPECIES } from './notebook';
import { parseKey, recall } from './learning';
import { Perf } from './perf';
import { RESIDENTS, Story, type ResidentKind } from './story';
import { Atmosphere, DAY, DEPTH_K, skyAt } from './atmosphere';
import { Sound } from './audio';
import { Overlay } from './ui';
import { Curriculum, accepts, overfull, completable, groupsNeed, equation, type Challenge } from './challenges';
import type { SyllabusId } from './challenges';
import { ChallengeUI } from './challenge-ui';
import { glInfo, probe, report } from './report';
import { glyphAtlas, glyphAtlasSteps, glyphIndex, GLYPHS } from './glyphs';
import { PROGRAMS } from './render';
import { program } from './gl';
import { layDrops, liveCount, Pad, Planting, Pond, seeded } from './world';

const canvas = document.getElementById('pond') as HTMLCanvasElement;
const ui = new Overlay();
const mathUI = new ChallengeUI();
let curriculum = new Curriculum();
let relationship: Challenge | null = null;
/** The leaves gathered for it (one collection; for times questions, leaves that match). */
let relationLeaves: Pad[] = [];
let relationSupply = 0;
/** Help asked (0 none, 1 heard and pictured, 2 worked through), and gatherings that were too much. */
let relationHelp = 0;
let relationAttempts = 0;
let relationShownAt = 0;
let relationClearAt = 0;
/** After a gathering was too much: the leaf the river lets go, and when. */
let relationRelease: { pad: Pad; at: number } | null = null;
/** A second wrong try: the answer is shown (not answered) once the wrong one has left its blank. */
let revealAt = 0;
/** Wrong tries a question allows before its answer is shown. */
const TRIES = 2;
/** Facts that were shown, not answered: asked again a few questions later (then as memory decides). */
let againFacts: Array<{ a: number; b: number; mult: boolean; at: number }> = [];
/** For a choose question: the leaves carrying candidate numerals (glyphs.ts), and what each says. */
let numeralLeaves: Pad[] = [];
const optionOf = new Map<Pad, number>();
/** For a choose question: the numerals put in its blanks so far, left to right. */
let chosenValues: number[] = [];
/** Debug: what the question's supply laid, and when (river time). */
let supplyLog: Array<[number, number]> = [];
/** A leaf's numeral as a water state: one numeral (0–9), or two side by side (100 + n). */
const numeralCode = (n: number) => (n <= 9 ? n : 100 + n);
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

let notebook = new Notebook();
let story = new Story();
let mastery = 0.04;
let totalSolves = 0;
let firstPlayed = 0;
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
  const saved = readJSON<{ mastery?: number; solves?: number; last?: number; first?: number }>(pKey(pr.id, 'v3'));
  mastery = 0.04;
  totalSolves = 0;
  lastPlayed = 0;
  firstPlayed = Date.now();
  if (saved && typeof saved.mastery === 'number') {
    mastery = Math.max(0, Math.min(1, saved.mastery));
    totalSolves = saved.solves ?? 0;
    lastPlayed = saved.last ?? 0;
    firstPlayed = saved.first ?? saved.last ?? firstPlayed;
  }
  memory = startupParams.has('fresh') ? new L.Memory() : new L.Memory(readJSON(pKey(pr.id, 'facts.v1')));
  notebook = startupParams.has('fresh') ? new Notebook() : new Notebook(readJSON(pKey(pr.id, 'notebook.v1')));
  pond.plantings = startupParams.has('fresh') ? [] : (readJSON<Planting[]>(pKey(pr.id, 'plantings.v1')) ?? []);
  story = startupParams.has('fresh') ? new Story() : new Story(readJSON(pKey(pr.id, 'story.v1')));
  pond.sproutGrown(cam.y - cam.cssH / (2 * cam.zoom) - 600);
  const levelParam = Number(startupParams.get('level'));
  if (Number.isFinite(levelParam) && startupParams.has('level')) mastery = Math.max(0, Math.min(1, levelParam));
  curriculum = new Curriculum(startupParams.has('fresh') ? null : readJSON(pKey(pr.id, 'curriculum.v1')), mastery);
  // `?year=N` places as a grown-up would (0 Reception … 5 Year 5+); `?maths=N` sets a level directly
  const year = Number(startupParams.get('year'));
  if (startupParams.has('year') && Number.isInteger(year)) curriculum.setYear(year);
  // `?numerals=1`: every skill counts as proved with dew, so the leaves show numerals
  curriculum.forceNumerals = startupParams.has('numerals');
  const level = Number(startupParams.get('maths'));
  if (startupParams.has('maths') && Number.isInteger(level)) curriculum.setLevel(level);
  save();
}
const forcedStage = N.stageForId(startupParams.get('stage'));
if (forcedStage) activeStage = forcedStage;
const save = () => {
  if (!profile) return;
  profile.last = Date.now();
  writeJSON(pKey(profile.id, 'v3'), { mastery, solves: totalSolves, last: profile.last, first: firstPlayed });
  writeJSON(pKey(profile.id, 'facts.v1'), memory);
  writeJSON(pKey(profile.id, 'curriculum.v1'), curriculum.data);
  writeJSON(PROFILES, profiles);
};
const stage = () => activeStage;

// ─── world ─────────────────────────────────────────────────────────────────
const params = startupParams;
/** `?bare=1`: hide the pads (for looking at the water and the bed). */
const bare = !!params.get('bare');
// `?mute=dip,gurgle,knock,plop` silences named sounds, to tell them apart by ear
for (const name of (params.get('mute') ?? '').split(',')) if (name) sound.muted.add(name.trim());
const urlSeed = Number(params.get('seed'));
/** Test harnesses on software GL run at a few fps; they can ask the river to hurry. */
const timeScale = Math.max(0.1, Math.min(8, Number(params.get('timescale')) || 1));
const rand = seeded(urlSeed || (Date.now() % 100000) + 7);
// the river is the same one every visit (one seed per device, kept), so what a
// child plants can be rowed back to; `?seed=` overrides it for a look at another
const riverSeed = (() => {
  if (urlSeed) return urlSeed;
  const kept = readJSON<number>('stillwater.river.v1');
  if (kept) return kept;
  const fresh = Math.floor(Math.random() * 1e9) + 1;
  writeJSON('stillwater.river.v1', fresh);
  return fresh;
})();
const pond = new Pond(riverSeed);
if (params.get('days')) pond.extraDays = Number(params.get('days')) || 0;
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

// ─── relationships: the question at the top, answered with dew (challenges.ts) ──
/** What the leaves hold: `sum` [drops]; `groups` [leaves, drops a leaf]. */
function relationGathered(): number[] {
  if (!relationship) return [];
  if (relationship.mode === 'pick') return chosenValues.slice();
  if (relationship.mode === 'sum') return [relationLeaves.reduce((n, p) => n + liveCount(p), 0)];
  return relationLeaves.length ? [relationLeaves.length, liveCount(relationLeaves[0])] : [];
}
function clearRelation() {
  for (const p of relationLeaves) p.selected = false;
  relationLeaves = [];
  numeralLeaves = [];
  optionOf.clear();
  chosenValues = [];
  selection = relationLeaves;
  relationRelease = null;
  if (relationship) mathUI.progress(relationGathered());
}
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** A fact the memory wants back (P1), for the curriculum to ask if a skill here can carry it. */
function dueFact(): { a: number; b: number; mult: boolean } | null {
  const f = memory.due(Date.now(), (x) => Math.max(...x.parts) <= 12, 3)[0];
  return f ? { a: f.parts[0], b: f.parts[1], mult: f.rule === 'groups' } : null;
}
mathUI.onHelp = (step) => {
  relationHelp = Math.max(relationHelp, step);
  armSound();
  // worked through: the answer has been given, so the question is shown, not answered
  if (step >= 2) revealRelation();
};

/**
 * Shown, not answered: after a second wrong try, or help worked through. The
 * answer goes into the blanks in plain water and is heard; its leaf brightens.
 * No lantern, no surge, no flower — it must never feel like a success. The fact
 * is recorded as not known (so it comes back soon) and asked again a few
 * questions later.
 */
function revealRelation() {
  const c = relationship;
  if (!c) return;
  revealAt = 0;
  mathUI.reveal();
  sound.release();
  // where the answer was: its leaf brightens (a numeral), or the leaves stay as they are (dew)
  for (const [p, v] of optionOf) if (c.answers.includes(v)) { p.bob = 1; pond.impulses.push({ x: p.x, y: p.y, r: p.r * 0.5, s: 0.3 }); }
  curriculum.record(c, false, today());
  const fact = c.skill === 'identify' || c.skill === 'sequence' ? null : c.mult ? L.factOf('groups', new Array(c.a).fill(c.b)) : L.factOf('sum', [c.a, c.b]);
  if (fact) memory.record(fact, 0.1, Date.now());
  stretch.answered({ q: 0.1, friction: relationAttempts });
  if (fact && c.skill !== 'pairs') againFacts = [...againFacts.filter((f) => f.a !== c.a || f.b !== c.b), { a: c.a, b: c.b, mult: c.mult, at: curriculum.data.serial + 3 }].slice(-4);
  for (const p of relationLeaves) p.selected = false;
  relationship = null;
  clearRelation();
  relationClearAt = pond.t + 3.4;
  askNotBefore = pond.t + 3.4 + 1.2;
  nextTargetAt = pond.t + 0.8;
  save();
}
function solveRelation() {
  const c = relationship!;
  const g = relationGathered();
  const chosen = relationLeaves.slice();
  // exactly the dew the child chose rises into the lantern
  let order = 0;
  for (const p of chosen) {
    const cs = Math.cos(p.ang);
    const sn = Math.sin(p.ang);
    for (const d of p.drops) {
      if (d.to <= 0) continue;
      d.to = 0;
      lifts.push({ x0: p.x + (cs * d.x - sn * d.y) * p.r, y0: p.y + (sn * d.x + cs * d.y) * p.r, t: 0, dur: 1.5 + rand() * 0.6, delay: order++ * 0.05, bend: (rand() * 2 - 1) * 60, radius: d.r * p.r });
    }
    pond.impulses.push({ x: p.x, y: p.y, r: p.r * 0.6, s: 0.6 });
  }
  window.setTimeout(() => chosen.forEach((p) => (p.selected = false)), 900);
  solvedThread = { pads: chosen, until: pond.t + 0.9 };
  // a chosen numeral goes up as light from its leaf, as dew would
  if (c.mode === 'pick') {
    for (const p of chosen) for (let k = 0; k < 3; k++) lifts.push({ x0: p.x + (rand() - 0.5) * p.r * 0.6, y0: p.y + (rand() - 0.5) * p.r * 0.6, t: 0, dur: 1.5 + rand() * 0.6, delay: order++ * 0.06, bend: (rand() * 2 - 1) * 60, radius: p.r * 0.12 });
  }
  relationLeaves = [];
  selection = relationLeaves;
  relationRelease = null;
  numeralLeaves = [];
  optionOf.clear();
  chosenValues = [];
  const clean = relationHelp === 0 && relationAttempts === 0;
  curriculum.record(c, clean, today());
  // what the river remembers (P1) and how the stretch goes (P3), as for the counting
  const q = L.quality({ secs: pond.t - relationShownAt, leaves: chosen.length, value: c.total, friction: relationAttempts, scaffold: relationHelp, counting: false });
  // a numeral question is about the numeral, not a fact to be remembered
  const fact = c.skill === 'identify' || c.skill === 'sequence' ? null : c.mult ? L.factOf('groups', new Array(c.a).fill(c.b)) : L.factOf('sum', [c.a, c.b]);
  const newWay = fact ? memory.record(fact, q, Date.now()).newWay : false;
  const phase = stretch.phase;
  stretch.answered({ q, friction: relationAttempts });
  mathUI.complete(g);
  relationship = null;
  relationClearAt = pond.t + 1.7;
  // the next question is planned now (its water can gather during the pause) and asked after it
  askNotBefore = pond.t + 1.7 + L.PHASE_PAUSE[phase];
  nextTargetAt = pond.t + 0.6;
  sound.gathered();
  lantern = Math.min(1.5, lantern + (q >= 0.85 ? 0.45 : 0.3));
  pond.propel(190);
  story.gather();
  persistStory();
  totalSolves++;
  // the river notices: a flower opens; a product made the other way round from before, two
  if (chosen.length) openBeside(chosen[Math.floor(rand() * chosen.length)]);
  if (newWay && chosen.length > 1) openBeside(chosen[0]);
  save();
}
mathUI.onSkip = () => {
  if (!relationship || visit || pageOpen) return;
  curriculum.record(relationship, false, today());
  clearRelation();
  relationship = null;
  mathUI.hide();
  nextTargetAt = pond.t + 0.5;
  save();
};
/** A grown-up's choice of school system: the years and tables that follow from it. */
mathUI.onSyllabus = (id: SyllabusId) => {
  if (!profile) return;
  curriculum.setSyllabus(id);
  save();
};
/** A grown-up's choice of school year (the panel under a long press on the title). */
mathUI.onYear = (year) => {
  if (!profile) return;
  endVisit();
  clearSelection();
  clearRelation();
  target = null;
  ask = null;
  share = null;
  relationship = null;
  plan = null;
  carry = null;
  relationClearAt = 0;
  releaseAt = 0;
  lock = 0;
  chimes = [];
  ui.clearTarget();
  mathUI.hide();
  curriculum.setYear(year);
  stretch = new L.Stretch(null);
  nextTargetAt = pond.t + 0.3;
  save();
};

/**
 * Leaves with dew that a child can plainly see: the WHOLE leaf on screen,
 * below the number display and above the boat. A leaf half under the header
 * or half off the side is not an answer anyone can find (playtest: an ask
 * whose only answer lay there was maddening).
 */
/** A leaf a touch answers with: dew to gather, or a numeral to choose (INTERACTION.md). */
const answerable = (p: Pad) => liveCount(p) > 0 || (relationship?.mode === 'pick' && optionOf.has(p));

function visibleDewy(answering = false): Pad[] {
  const out: Pad[] = [];
  for (const p of pond.pads) {
    if (!(answering ? answerable(p) : liveCount(p))) continue;
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

// ─── planning: a question arrives with its leaves (PLANNING-REVIEW-2026-09-30.md) ───
//
// A question is shown only when it can be answered from water already settled in
// view, and while it is up no water that bears on its answer changes. So it is
// planned first: the question, then its bed (leaves in view if the boat rests,
// leaves ahead by the boat's coming glide if it moves), whose water is laid in one
// batch, the answer among spares — out of sight ahead, or in view before the
// question, never after it. It is asked once the bed is in view and settled. If
// the bed is lost while it is up, the question fades with it; it is never repaired.

interface Plan {
  c: Challenge;
  at: number;
  staged: boolean;
  tries: number;
}
let plan: Plan | null = null;
/** A question that faded unanswered comes back with the next water. */
let carry: Challenge | null = null;
let lostSince = 0;
/** After a solve, the next question may be planned at once but not asked before the pause is over. */
let askNotBefore = 0;
/** The carried question has faded once already. */
let carryFaded = false;

/** How far up the screen (CSS px) the view will have moved by the time the boat's way is spent. */
function glideAhead(): number {
  const b = pond.boat;
  const owed = Math.max(0, b.strokeTo - b.stroke);
  const travel = b.speed / 0.3 + owed * 150;
  return Math.min(cam.cssH * 0.8, travel * cam.zoom);
}

/** In clear view — wholly on screen, under the question, off the boat — with the view `shift` px ahead. */
function inBed(p: Pad, shift = 0): boolean {
  if (p.selected || p.flower || p.sink > 0.25 || p.r < 22) return false;
  const [x, y0] = toScreen(p.x, p.y);
  const y = y0 + shift;
  const inset = p.r * cam.zoom * 0.7;
  return x - inset > 8 && x + inset < cam.cssW - 8 && y - inset > Math.max(205, cam.cssH * 0.27) && y + inset < cam.cssH * 0.88 && !pond.onBoat(p.x, p.y) && !hitResident(x, y0) && hit(x, y0) === p;
}
/** Still in view (looser than the bed, so a question does not flicker at the edge). */
function stillSeen(p: Pad): boolean {
  if (p.sink > 0.25 || !pond.pads.includes(p)) return false;
  const [x, y] = toScreen(p.x, p.y);
  return x > 0 && x < cam.cssW && y > cam.cssH * 0.2 && y < cam.cssH * 0.95;
}
/** Leaves with (or without, `dry`) counting dew that could be a bed, the view `shift` ahead. */
function relationStock(dry = false, shift = 0): Pad[] {
  return pond.pads.filter((p) => (dry ? liveCount(p) === 0 : liveCount(p) > 0) && inBed(p, shift));
}

/** A leaf's water at rest in the state wanted (-1 drops, or a numeral). */
function settled(p: Pad, want: number): boolean {
  if (!glyphsReady) return want === -1 && p.drops.every((d) => d.to <= 0 || d.a >= 0.95);
  return p.glyph === want && (p.glyphT ?? 1) >= 1 && p.glyphQueue === undefined && p.drops.every((d) => d.to <= 0 || d.a >= 0.95);
}
/** Is any counting water in view still forming (drops or a numeral gathering)? Then nothing is asked yet. */
function formingInView(): boolean {
  return pond.pads.some((p) => {
    if (!stillSeen(p) || p.glyphRun) return false;
    if (p.drops.some((d) => d.to > 0 && d.a < 0.95)) return true;
    const toward = p.glyphQueue ?? p.glyph;
    return toward !== undefined && (toward === -1 || toward >= 0) && ((p.glyphT ?? 1) < 1 || p.glyphQueue !== undefined);
  });
}

/**
 * Lay a question's water on its bed, in one batch: for a choice, every candidate
 * numeral at once (or none); for gathering, drops until it can be answered, with
 * a spare that is not the answer — so no leaf stands out as the one that came for
 * it. Returns false if the bed cannot hold it (then nothing is laid).
 */
function stageRelationship(c: Challenge, shift: number): boolean {
  if (c.mode === 'pick') {
    // the candidates, closest to the middle of the bed first (so they sit together), and
    // leaves already holding fine dew before bare ones (they gather at once, a bare leaf beads first)
    const mid = cam.cssH * 0.55 - shift;
    const cost = (q: Pad) => Math.abs(toScreen(q.x, q.y)[1] - mid) + (q.glyph === -3 || keepsFineDew(q) ? 0 : cam.cssH * 0.3);
    const dry = relationStock(true, shift)
      .filter((q) => !q.drops.length && q.r >= 26)
      .sort((a, b) => cost(a) - cost(b));
    const all = c.choices ?? [];
    const least = c.answers.length + 2;
    if (dry.length < Math.min(all.length, least)) return false;
    // fewer leaves than choices: drop near misses, never an answer
    let choices = all;
    if (dry.length < all.length) {
      const need = [...c.answers];
      const keep: number[] = [];
      for (const v of all) {
        const i = need.indexOf(v);
        if (i >= 0) need.splice(i, 1);
        else if (keep.length >= dry.length - c.answers.length) continue;
        keep.push(v);
      }
      choices = keep;
    }
    optionOf.clear();
    choices.forEach((v, i) => {
      optionOf.set(dry[i], v);
      supplyLog.push([pond.t, v]);
    });
    numeralLeaves = [...optionOf.keys()];
    return true;
  }
  const stock = relationStock(false, shift);
  const dry = relationStock(true, shift).sort((a, b) => b.r - a.r);
  const laid: number[] = [];
  const lay = (p: Pad, n: number) => {
    p.drops = layDrops(n, p.r, rand, true);
    if (liveCount(p) !== n) return;
    stock.push(p);
    laid.push(n);
    supplyLog.push([pond.t, n]);
  };
  const free = () => dry.filter((p) => !stock.includes(p) && !p.drops.length);
  if (c.mode === 'sum') {
    const cycle = [3, 5, 2, 6, 4, 1, 6];
    for (const p of free()) {
      if (completable(c, [0], counts(stock)) && stock.length >= 3) break;
      lay(p, cycle[relationSupply++ % cycle.length]);
    }
    if (!completable(c, [0], counts(stock))) return false;
    // never a lone new leaf: a spare that is not the answer comes with it
    const spare = free()[0];
    if (laid.length && spare) lay(spare, [2, 3, 4, 5, 6].filter((n) => n !== c.answers[0])[relationSupply++ % 4]);
    return true;
  }
  const need = groupsNeed(c);
  const per = need.size;
  let decoys = stock.filter((q) => liveCount(q) !== per).length;
  for (const p of free()) {
    const have = stock.filter((q) => liveCount(q) === per).length;
    if (have >= need.count + 1 && decoys >= 2) break;
    if (have < need.count + 1) lay(p, per);
    else {
      lay(p, [1, 2, 3, 4, 5, 6].filter((x) => x !== per)[relationSupply++ % 5]);
      decoys++;
    }
  }
  return completable(c, [0, 0], counts(stock));
}

/** Can the question (as far as it has been answered) still be finished from what is in view? */
function answerableNow(c: Challenge): boolean {
  if (c.mode === 'pick') {
    const need = [...c.answers];
    for (const v of chosenValues) {
      const i = need.indexOf(v);
      if (i >= 0) need.splice(i, 1);
    }
    // two factors: once one is in, only its partner will do
    if (c.skill === 'pairs' && chosenValues.length === 1) need.splice(0, need.length, c.total / chosenValues[0]);
    const seen = [...optionOf].filter(([p]) => stillSeen(p) && !relationLeaves.includes(p)).map(([, v]) => v);
    return need.every((v) => seen.includes(v));
  }
  const seen = pond.pads.filter((p) => liveCount(p) > 0 && !p.selected && stillSeen(p));
  return completable(c, relationGathered(), counts(seen));
}

/** Plan the next question: choose it, lay its bed, and ask it once the bed is in view and settled. */
function stepPlan() {
  if (!plan) return;
  const c = plan.c;
  if (!plan.staged) {
    if (pond.t - plan.at > 0.2 && stageRelationship(c, glideAhead())) {
      plan.staged = true;
      plan.at = pond.t;
    } else if (pond.t - plan.at > 10) {
      // no bed for this one here: another question (unasked, so nothing is lost)
      carry = null;
      plan = null;
      nextTargetAt = pond.t + 0.5;
    }
    return;
  }
  const ready =
    c.mode === 'pick'
      ? [...optionOf].every(([p, v]) => stillSeen(p) && toScreen(p.x, p.y)[1] > Math.max(205, cam.cssH * 0.25) && settled(p, numeralCode(v)))
      : completable(c, [0], counts(pond.pads.filter((p) => liveCount(p) > 0 && inBed(p) && settled(p, -1))));
  if (ready && pond.t >= askNotBefore && !formingInView()) {
    askPlanned();
    return;
  }
  // rowed past it (a leaf of the bed already behind the view, or gone): lay the next bed ahead now
  const passed = (p: Pad) => !pond.pads.includes(p) || p.sink > 0.25 || toScreen(p.x, p.y)[1] > cam.cssH * 0.88;
  if (c.mode === 'pick' && [...optionOf.keys()].some(passed)) {
    optionOf.clear();
    numeralLeaves = [];
    plan.staged = false;
    plan.at = pond.t;
    return;
  }
  // the bed did not come (the boat stopped short, or turned): lay another, a few times
  if (pond.t - plan.at > 14) {
    optionOf.clear();
    numeralLeaves = [];
    plan.staged = false;
    plan.at = pond.t;
    if (++plan.tries >= 3) {
      carry = null;
      plan = null;
      nextTargetAt = pond.t + 0.5;
    }
  }
}

function askPlanned() {
  relationship = plan!.c;
  plan = null;
  relationLeaves = [];
  selection = relationLeaves;
  chosenValues = [];
  relationHelp = 0;
  relationAttempts = 0;
  relationShownAt = pond.t;
  relationRelease = null;
  revealAt = 0;
  lostSince = 0;
  mathUI.show(relationship);
}

/**
 * While a question is up its water is left alone. If what it needs leaves the
 * view (rowed on, a leaf sank), the question fades with its leaves — anything
 * chosen is let go — and comes back later with new water. Not a wrong answer.
 */
function keepAnswerable() {
  const c = relationship;
  if (!c || lock > 0 || overfull(c, relationGathered())) {
    lostSince = 0;
    return;
  }
  if (answerableNow(c)) {
    lostSince = 0;
    return;
  }
  if (!lostSince) lostSince = pond.t;
  if (pond.t - lostSince < 0.8) return;
  fadeRelation();
}

function fadeRelation() {
  if (!relationship) return;
  if (relationLeaves.length) sound.release();
  // it comes back once with new water; faded twice, the river moves on to another
  carry = carryFaded ? null : relationship;
  carryFaded = !!carry;
  revealAt = 0;
  clearRelation();
  relationship = null;
  lostSince = 0;
  mathUI.hide();
  nextTargetAt = pond.t + 0.8;
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
  if (!started || pageOpen) return;
  const phase = stretch.phase;
  if (phase === 'finale') {
    if (pond.t < askNotBefore) {
      nextTargetAt = askNotBefore;
      return;
    }
    startFinale();
    return;
  }
  // numeral questions (which numeral says how many; which comes next) are mixed in with the
  // counting once the child has gathered a first number; from Facts within 10 on, it is all questions
  const numeralTurn = curriculum.data.level === 0 && ((curriculum.data.counting >= 1 && rand() < 0.45) || !!params.get('ask'));
  if (!forcedStage && (curriculum.data.level > 0 || numeralTurn)) {
    // `?ask=identify` (or any skill) asks that type of question, for looking at it
    const askParam = (params.get('ask') ?? undefined) as Challenge['skill'] | undefined;
    // planned, not asked: it is shown once its leaves are in view and settled (stepPlan)
    // a fact that was shown comes back a few questions later, whatever the phase
    const again = againFacts.find((f) => f.at <= curriculum.data.serial);
    if (again) againFacts = againFacts.filter((f) => f !== again);
    const c = carry ?? curriculum.next(rand, { phase, due: again ?? (phase === 'reach' || phase === 'warm' ? dueFact() : null), skill: askParam });
    if (!carry) carryFaded = false;
    carry = null;
    numeralLeaves = [];
    optionOf.clear();
    supplyLog = [];
    plan = { c, at: pond.t, staged: false, tries: 0 };
    ui.clearTarget();
    ui.quiet();
    return;
  }
  // nothing is asked while dew in view is still forming: the ask comes with settled water
  if (formingInView()) {
    nextTargetAt = pond.t + 0.3;
    return;
  }
  const m = clamp01(mastery + L.PHASE_OFFSET[phase]);
  const safe = targetDewy();
  const seen = safe.length >= 2 ? safe : visibleDewy();
  let again = false;
  let dueAsk = false;
  let activity: { stage: N.Stage; target: N.Target } | null = null;
  if (forcedStage || curriculum.data.level === 0) {
    const introStage = forcedStage ?? N.STAGES[0];
    const t = N.chooseTarget(introStage, counts(seen), rand, lastSolved);
    activity = t ? { stage: introStage, target: t } : null;
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

  let st = activity?.stage ?? forcedStage ?? (curriculum.data.level === 0 ? N.STAGES[0] : N.pickStage(m, rand));
  let t = activity?.target ?? N.chooseTarget(st, counts(visibleDewy()), rand, lastSolved);

  if (!t) {
    const value = st.min + Math.floor(rand() * (st.max - st.min + 1));
    const broad = visibleDewy();
    const dry = visibleDry();
    const all = [...broad, ...dry];
    const fix = N.repair(st, counts(all), value);
    if (fix) {
      // dew condenses first, with a spare, and the ask comes once it has settled (next time round)
      fix.forEach((c, i) => condense(all[i], c));
      const spare = all.find((p, i) => !fix.has(i) && !p.drops.length);
      if (spare) condense(spare, 1 + Math.floor(rand() * Math.min(5, st.max)));
    }
    nextTargetAt = pond.t + (fix ? 0.4 : 1);
    return;
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
 * is redrawn from the new landscape; one the child is midway through lets go
 * gently. Dew is never condensed to finish it (PLANNING-REVIEW-2026-09-30.md).
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

  // midway, and it can no longer be finished: let go gently (never condense the missing piece)
  if (lostFor < 1.2) return;
  clearSelection();
  sound.release();
  target = null;
  ui.clearTarget();
  ui.quiet();
  nextTargetAt = pond.t + 0.8;
  unsolvableSince = 0;
}

function gathered() {
  return selection.reduce((s, p) => s + liveCount(p), 0);
}

function clearSelection() {
  if (relationship) {
    clearRelation();
    return;
  }
  for (const p of selection) p.selected = false;
  selection = [];
  ui.progress(0);
}

function choose(p: Pad) {
  if (relationship?.mode === 'pick') {
    // choose: one touch puts that leaf's numeral in the waiting blank (INTERACTION.md)
    if (visit || pageOpen || lock > 0) return;
    const v = optionOf.get(p);
    if (v === undefined) {
      // only a numeral answers; any other leaf just bobs
      p.bob = Math.min(1, p.bob + 0.5);
      return;
    }
    chosenValues = [...chosenValues, v];
    relationLeaves = [...relationLeaves, p];
    selection = relationLeaves;
    p.selected = true;
    const g = relationGathered();
    mathUI.progress(g);
    if (accepts(relationship, g)) solveRelation();
    else if (overfull(relationship, g)) {
      // not that one: a low note, the leaf bobs, and the numeral leaves its blank (no words)
      relationAttempts++;
      sound.note(0, panAt(p.x));
      p.bob = 1;
      mathUI.over();
      lock = 0.6;
      relationRelease = { pad: p, at: pond.t + 0.55 };
      if (relationAttempts >= TRIES) revealAt = pond.t + 0.75;
    } else sound.note(Math.min(6, chosenValues.length + 1), panAt(p.x));
    return;
  }
  if (relationship) {
    if (visit || pageOpen || lock > 0 || !liveCount(p)) return;
    const at = relationLeaves.indexOf(p);
    if (at >= 0) {
      // touching a chosen leaf lets it go
      relationLeaves.splice(at, 1);
      p.selected = false;
    } else {
      // equal groups: a leaf that does not match the first is not taken — it bobs, a low note
      if (relationship.mode === 'groups' && relationLeaves.length && liveCount(p) !== liveCount(relationLeaves[0])) {
        p.bob = 1;
        sound.note(0, panAt(p.x));
        return;
      }
      relationLeaves.push(p);
      p.selected = true;
      sound.note(Math.min(6, relationLeaves.length - 1), panAt(p.x));
    }
    selection = relationLeaves;
    const g = relationGathered();
    mathUI.progress(g);
    if (accepts(relationship, g)) solveRelation();
    else if (overfull(relationship, g)) {
      // too much: the blank shakes and the river lets this leaf go again (no words)
      relationAttempts++;
      mathUI.over();
      lock = 0.9;
      relationRelease = { pad: p, at: pond.t + 0.85 };
      if (relationAttempts >= TRIES) revealAt = pond.t + 1.05;
    }
    return;
  }
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
/** The leaves of the last answer, held on the thread a moment after the solve. */
let solvedThread: { pads: Pad[]; until: number } | null = null;
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
  solvedThread = { pads: done, until: pond.t + 0.9 };
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

  curriculum.counted(targetFriction === 0 && scaffolds === 0);
  story.gather();
  persistStory();
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
    if (!answerable(p)) continue;
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

// ─── telemetry to hand: three taps on the title copy a report ──────────────
function telemetry() {
  return {
    at: new Date().toISOString(),
    ua: navigator.userAgent,
    w: innerWidth, h: innerHeight, dpr, scale, zoom: Math.round(cam.zoom * 100) / 100,
    gl: renderer.info(),
    sim: renderer.simOn,
    audio: sound.path(),
    reduced,
    profile: profile?.name ?? null,
    t: Math.round(pond.t),
    boatY: Math.round(pond.boat.y + pond.origin),
    reach: pond.reachHere(pond.boat.y),
    learn: learnSummary(),
    notebook: notebook.pages,
    perf: perf.summary(),
  };
}
{
  const titleEl = document.getElementById('title');
  let taps: number[] = [];
  // press and hold the title: the grown-ups' panel (the school year)
  let hold = 0;
  const cancel = () => window.clearTimeout(hold);
  titleEl?.addEventListener('pointerup', cancel);
  titleEl?.addEventListener('pointerleave', cancel);
  titleEl?.addEventListener('pointercancel', cancel);
  titleEl?.addEventListener('pointerdown', () => {
    cancel();
    hold = window.setTimeout(() => {
      if (profile) mathUI.openGrownUps(curriculum.data.syllabus, curriculum.data.year, curriculum.describe());
    }, 900);
    const now = performance.now();
    taps = taps.filter((t) => now - t < 1500);
    taps.push(now);
    if (taps.length < 3) return;
    taps = [];
    const text = JSON.stringify(telemetry(), null, 1);
    report('telemetry', telemetry());
    navigator.clipboard?.writeText(text).then(() => ui.say('report copied', 3)).catch(() => ui.say('report sent', 3));
  });
}

// ─── sharing: the basket ───────────────────────────────────────────────────
/**
 * Tap the basket and a crumb goes over the stern; the big fish nearby come for
 * it, and they have manners: one that is ahead waits its turn. When two or
 * more fish are at the boat and no number is being asked, the crumbs become an
 * ask — SHARE, one glyph per fish — answered when every fish has had the same.
 * Fair sharing is the first shape of division; a fair share of two or more
 * each is remembered as the matching groups fact (3 fish × 2 = 6).
 */
interface Share {
  fish: number[]; // indexes into school.fish
  base: number[]; // what each had eaten when the ask began
  shownAt: number;
  lastEat: number;
  crumbs: number;
  hinted: boolean;
}
let share: Share | null = null;
let shareTested = false;
let plantTested = false;
let shareHintAt = -Infinity;
const bigFishAtBoat = () => {
  const out: number[] = [];
  school.fish.forEach((f, i) => {
    if (f.kind !== 3 && Math.hypot(f.x - pond.boat.x, f.y - pond.boat.y) < 190) out.push(i);
  });
  return out;
};
function basketTap() {
  pond.scatterCrumbs(1);
  sound.plop(0.35, panAt(pond.boat.x));
  pond.boat.sway += 0.02;
  if (share) share.crumbs += 1;
  else if (!relationship && !relationClearAt && !target && lock <= 0) {
    const fish = bigFishAtBoat().slice(0, 5);
    if (fish.length >= 2) {
      // everyone starts hungry; the fish at the boat now are the ones being shared between
      for (const f of school.fish) f.fed = 0;
      share = { fish, base: fish.map(() => 0), shownAt: pond.t, lastEat: pond.t, crumbs: 1, hinted: false };
      ui.setShare(fish.length);
      ui.shareProgress(fish.map(() => 0));
      nextTargetAt = Infinity;
    }
  }
}
/** Each frame: the fish glyphs fill, and a fair share is answered. */
function stepShare(dt: number) {
  void dt;
  if (!share) {
    // the fish have come and nothing is asked: say so, once in a while
    const visiting = school.fish.filter((f) => f.mood === 2 && f.kind !== 3).length;
    if (!relationship && !relationClearAt && !target && lock <= 0 && visiting >= 2 && pond.t - shareHintAt > 45 && pond.t - startedAt > 20) {
      shareHintAt = pond.t;
      ui.say('the fish have come — tap the basket', 5);
    }
    return;
  }
  // a fish that joins in and takes a crumb becomes one of those being shared between
  if (share.fish.length < 5) {
    school.fish.forEach((f, i) => {
      if (share!.fish.length < 5 && f.kind !== 3 && (f.fed ?? 0) > 0 && !share!.fish.includes(i)) {
        share!.fish.push(i);
        share!.base.push(0);
        ui.setShare(share!.fish.length);
      }
    });
  }
  const fed = share.fish.map((i, k) => Math.max(0, (school.fish[i].fed ?? 0) - share!.base[k]));
  const total = fed.reduce((a, b) => a + b, 0);
  if (total !== share.crumbs - pond.crumbs.filter((c) => !c.eaten).length) share.lastEat = pond.t;
  ui.shareProgress(fed);
  const floating = pond.crumbs.filter((c) => !c.eaten).length;
  const fair = fed.every((n) => n === fed[0]) && fed[0] > 0;
  const gone = share.fish.filter((i) => Math.hypot(school.fish[i].x - pond.boat.x, school.fish[i].y - pond.boat.y) < 320).length < 2;
  if (fair && floating === 0 && pond.t - share.lastEat > 1.4) {
    // fair: every fish has had the same
    const each = fed[0];
    const n = fed.length;
    sound.gathered();
    ui.solved();
    ui.say(each === 1 ? 'one each — fair' : `${each} each — fair`, 3);
    lantern = Math.min(1.5, lantern + 0.25);
    if (each >= 2) {
      const q = L.quality({ secs: pond.t - share.shownAt, leaves: n, value: n * each, friction: 0, scaffold: 0, counting: true });
      memory.record(L.factOf('groups', Array(n).fill(each)), q, Date.now());
    }
    totalSolves += 1;
    save();
    share = null;
    lock = 1.5;
    nextTargetAt = pond.t + 4;
    return;
  }
  if (!fair && floating === 0 && total > 0 && pond.t - share.lastEat > 2.5 && !share.hinted) {
    share.hinted = true;
    ui.say('not yet fair — a little more', 4);
  }
  if (gone || pond.t - share.shownAt > 75) {
    // the fish have moved on; the ask goes quietly with them
    ui.clearTarget();
    ui.say('the fish have gone on', 3);
    share = null;
    nextTargetAt = pond.t + 3;
  }
}

// ─── deliberate visits: noticing is ambient; speaking and sharing are tapped ──
const residentShift = Math.trunc(Number(params.get('resident')) || 0);
type Pier = Pond['landmarks'][number];
const residentKind = (m: Pier): ResidentKind => RESIDENTS[((Math.floor(m.seed * 997) + residentShift) % 3 + 3) % 3];
const residentKey = (m: Pier) => `${riverSeed}:${m.key}:${residentKind(m)}`;
const persistStory = () => { if (profile) writeJSON(pKey(profile.id, 'story.v1'), story.toJSON()); };
let visit: { key: string; until: number } | null = null;
let transfer: { key: string; t: number } | null = null;
let residentPress: { key: string; lamp: boolean; x: number; y: number; moved: boolean } | null = null;
const residentPose = new Map<string, { look: number; attention: number; hop: number; pad?: Pad }>();
function pierPoint(m: Pier, across: number, inset: number): [number, number] {
  const d = m.l - inset, c = Math.cos(m.ang), s = Math.sin(m.ang);
  return [m.x + across * c - d * s, m.y + across * s + d * c];
}
function pierTip(m: Pier): [number, number, number] { return [...pierPoint(m, 0, 16), -m.ang]; }
function lampPoint(m: Pier): [number, number] { return pierPoint(m, -m.w * 0.65, 53); }
function residentPoint(m: Pier): [number, number] {
  const kind = residentKind(m);
  return pierPoint(m, kind === 'heron' ? m.w * 0.65 : kind === 'frog' ? m.w * 0.3 : 0, kind === 'heron' ? 18 : kind === 'frog' ? 8 : 29);
}
function endVisit() {
  visit = null; transfer = null;
  if (started) mathUI.suspend(pageOpen);
  document.getElementById('target')!.style.visibility = '';
  ui.quiet();
}
function visitRiver(m: Pier) {
  return {
    seen: (id: string) => notebook.has(id),
    plantingNear: (Y: number, within: number) => {
      let best: number | null = null;
      for (const pl of pond.plantings) if (Math.abs(pl.Y - Y) < within) best = Math.max(best ?? 0, pond.ageDays(pl));
      return best;
    },
    lantern: story.carried, pierLight: story.resident(residentKey(m), residentKind(m)).light,
    dusk: skyAt(dayStart + pond.t / DAY).dusk,
  };
}
function engage(m: Pier, lamp: boolean) {
  if (!started || !profile || transfer) return;
  const key = residentKey(m), kind = residentKind(m), [x, y] = pierTip(m);
  if (Math.hypot(pond.boat.x - x, pond.boat.y - y) > 210) {
    ui.say(lamp ? 'bring the boat alongside to share light' : 'row a little closer', 3);
    return;
  }
  if (visit?.key === key && !lamp) { endVisit(); return; }
  endVisit();
  visit = { key, until: pond.t + 9 };
  document.getElementById('target')!.style.visibility = 'hidden';
  mathUI.suspend(true);
  if (lamp) {
    const state = story.resident(key, kind);
    if (state.light >= 0.95) { ui.say('a light you left burning', 3); visit.until = pond.t + 3; }
    else if (story.canLight(key, kind)) {
      transfer = { key, t: 0 };
      visit.until = pond.t + 7;
      ui.quiet();
    } else { ui.say('gather dew, then share its light here', 4); visit.until = pond.t + 4; }
  } else {
    const lines = story.visit(kind, visitRiver(m), m.y + pond.origin, key);
    // One short invitation now; no automatic pages of narration.
    const line = lines.find(l => l.done) ?? lines[Math.min(1, lines.length - 1)];
    ui.say(line.text, 6); ui.announce(line.text);
    visit.until = pond.t + 6;
  }
  persistStory();
}
function hitResident(sx: number, sy: number): { key: string; lamp: boolean } | null {
  // Choose the closest of the overlapping generous touch targets.
  let best: { key: string; lamp: boolean } | null = null, distance = Infinity;
  for (const m of pond.landmarks) {
    const key = residentKey(m), pose = residentPose.get(key);
    const base = residentPoint(m);
    const rp: [number, number] = pose?.pad && pose.hop >= 1 ? [pose.pad.x, pose.pad.y] : base;
    for (const lamp of [false, true]) {
      const [x, y] = toScreen(...(lamp ? lampPoint(m) : rp));
      const d = Math.hypot(x - sx, y - sy);
      const radius = Math.max(22, (lamp ? 14 : residentKind(m) === 'heron' ? 27 : 19) * cam.zoom);
      if (d < radius && d < distance) { distance = d; best = { key, lamp }; }
    }
  }
  return best;
}
function residentsNow() {
  const out: NonNullable<Parameters<typeof renderer.render>[0]['residents']> = [];
  for (const m of pond.landmarks) {
    const key = residentKey(m), kind = residentKind(m), pose = residentPose.get(key);
    let [x, y] = residentPoint(m);
    const hop = pose?.hop ?? 0;
    if (pose?.pad) {
      const k = smooth(0, 1, hop);
      x += (pose.pad.x - x) * k; y += (pose.pad.y - y) * k;
      y += Math.sin(k * Math.PI) * 15;
    }
    const ch = story.residents[key];
    out.push({ x, y, heading: -m.ang, size: kind === 'heron' ? 30 : kind === 'frog' ? 16 : 25,
      kind: RESIDENTS.indexOf(kind), mood: ch?.done ? 2 : pose?.attention ?? 0,
      look: pose?.look ?? 0, seed: m.seed, hop: Math.sin(hop * Math.PI) });
    const [lx, ly] = lampPoint(m);
    out.push({ x: lx, y: ly, heading: -m.ang, size: 15, kind: 3, mood: pierBrightness(m), look: 0, seed: m.seed, hop: 0 });
  }
  return out;
}
function pierBrightness(m: Pier) {
  const key = residentKey(m);
  return transfer?.key === key ? smooth(0.8, 2.8, transfer.t) : story.residents[key]?.light ?? 0;
}
function pierLights() {
  return pond.landmarks.map(m => { const [x, y] = lampPoint(m); return { x, y, strength: pierBrightness(m) }; })
    .filter(l => l.strength > 0 && Math.abs(l.y - cam.y) < cam.cssH / cam.zoom + 200)
    .sort((a,b) => Math.hypot(a.x-cam.x,a.y-cam.y)-Math.hypot(b.x-cam.x,b.y-cam.y)).slice(0,4);
}
function stepStory(dt: number) {
  if (!started || !profile) return;
  for (const m of pond.landmarks) {
    const key = residentKey(m), [x,y] = residentPoint(m), kind = residentKind(m);
    let pose = residentPose.get(key);
    if (!pose) { pose = {look:0, attention:0, hop:0}; residentPose.set(key,pose); }
    const d = Math.hypot(pond.boat.x-x,pond.boat.y-y), h = -m.ang;
    const want = d < 220 ? Math.max(-1,Math.min(1,((pond.boat.x-x)*Math.cos(h)-(pond.boat.y-y)*Math.sin(h))/Math.max(1,d))) : 0;
    pose.look += (want-pose.look)*(1-Math.exp(-2*dt));
    pose.attention += ((d < 220 ? 1 : 0)-pose.attention)*(1-Math.exp(-2*dt));
    if (kind === 'frog' && story.residents[key]?.done) {
      if (pose.pad && (!pond.pads.includes(pose.pad) || pose.pad.sink > 0.4)) { pose.pad=undefined; pose.hop=0; }
      if (!pose.pad) pose.pad=pond.pads.find(p => p.plantingSeed !== undefined && p.sink < 0.1 && !p.selected && Math.hypot(p.x-x,p.y-y)<95);
      if (pose.pad) { const was=pose.hop; pose.hop=Math.min(1,pose.hop+dt/0.8); if(was<1&&pose.hop===1) pose.pad.bob=0.5; }
    }
  }
  for (const key of residentPose.keys()) if (!pond.landmarks.some(m=>residentKey(m)===key)) residentPose.delete(key);
  if (!visit) return;
  const m = pond.landmarks.find(m=>residentKey(m)===visit!.key);
  if (!m || Math.hypot(pond.boat.x-pierTip(m)[0],pond.boat.y-pierTip(m)[1])>250 || pond.t>visit.until) {endVisit();return;}
  // Browsing/visiting supplies no evidence about mathematical hesitation.
  if (ask) { ask.shownAt+=dt; ask.lastTouchAt+=dt; }
  if (share) { share.shownAt+=dt; share.lastEat+=dt; }
  if (releaseAt) releaseAt+=dt;
  nextTargetAt+=dt;
  if (transfer) {
    transfer.t+=dt;
    if (transfer.t>=2.8) {
      if(story.light(transfer.key,residentKind(m))) {
        sound.note(2,panAt(lampPoint(m)[0]));
        story.visit(residentKind(m),visitRiver(m),m.y+pond.origin,residentKey(m));
        persistStory(); ui.announce('The pier lantern is alight.');
      }
      transfer=null;
    }
  }
}
function storyMotes(): Mote[] {
  const out:Mote[]=[];
  if(transfer) {
    const m=pond.landmarks.find(m=>residentKey(m)===transfer!.key);
    if(m) {
      const [bx,by]=pond.bow(),[lx,ly]=lampPoint(m);
      for(let i=0;i<7;i++) {
        const k=(transfer.t-i*0.16)/1.7;
        if(k<=0||k>=1)continue;
        const e=smooth(0,1,k);
        out.push({x:bx+(lx-bx)*e,y:by+(ly-by)*e+Math.sin(e*Math.PI)*22,size:7+Math.sin(k*Math.PI)*4,r:1,g:.83,b:.42,a:.85,core:.65,z:1});
      }
    }
  }
  for(const l of pierLights()) out.push({x:l.x,y:l.y,size:46,r:1,g:.73,b:.38,a:l.strength*.16,core:0,z:1});
  return out;
}

// ─── the notebook: noticing ─────────────────────────────────────────────────
/**
 * Is a creature or an open flower under this fingertip? If so it is *sighted*:
 * it reacts, its name is said, and the first time it gets a page. Above-water
 * things are looked for at their parallax-shifted screen position; a fingertip
 * is given a little slack. Returns true if something was noticed.
 */
function sight(sx: number, sy: number): boolean {
  if (!started) return false;
  const [wx, wy] = toWorld(sx, sy);
  const cx = cam.cssW / 2;
  const cy = cam.cssH / 2;
  const slackPx = 12;
  const screenOf = (x: number, y: number, par: number): [number, number] => {
    const [px, py] = toScreen(x, y);
    return [cx + (px - cx) * par, cy + (py - cy) * par];
  };
  let id: string | null = null;
  let at: [number, number] | null = null;
  // dragonflies and butterflies
  const near = critters.nearest(wx, wy);
  if (near) {
    const c = near.critter;
    const par = 1 / (1 - DEPTH_K * c.h * 0.8);
    const [px, py] = screenOf(c.x, c.y, par);
    if (Math.hypot(px - sx, py - sy) < c.size * cam.zoom * par * 1.5 + slackPx) {
      id = c.kind === 0 ? dragonflyId(c.seed) : butterflyId(c.kind);
      at = [c.x, c.y];
      critters.startle(near.index);
    }
  }
  // open flowers
  if (!id) {
    for (const b of pond.blooms) {
      if (b.open < 0.6) continue;
      if (Math.hypot(b.x - wx, b.y - wy) < b.size * 1.15 + slackPx / cam.zoom) {
        id = flowerId(b.variant);
        at = [b.x, b.y];
        b.vx += (rand() - 0.5) * 4;
        b.vy += (rand() - 0.5) * 4;
        pond.impulses.push({ x: b.x, y: b.y, r: 8, s: 0.3 });
        break;
      }
    }
  }
  // fireflies, after dusk
  if (!id) {
    const sky = skyAt(dayStart + pond.t / DAY);
    const fly = atmosphere.nearestFly(wx, wy, 26 / cam.zoom, sky.dusk);
    if (fly) {
      id = 'firefly';
      at = [fly.x, fly.y];
      atmosphere.wink(fly.index, pond.t);
    }
  }
  // fish, under the water (drawn smaller and nearer the centre the deeper they are)
  if (!id) {
    let best: (typeof school.fish)[number] | null = null;
    let bd = Infinity;
    for (const fsh of school.fish) {
      const par = 1 / (1 + DEPTH_K * (0.15 + fsh.z));
      const [px, py] = screenOf(fsh.x, fsh.y, par);
      const d = Math.hypot(px - sx, py - sy);
      if (d < fsh.size * cam.zoom * par * 0.9 + slackPx && d < bd) { bd = d; best = fsh; }
    }
    if (best) {
      id = fishId(best.kind);
      at = [best.x, best.y];
      school.scare(best.x, best.y, 40);
      pond.impulses.push({ x: best.x, y: best.y, r: 6, s: 0.25 });
    }
  }
  if (!id || !at) return false;
  const s = notebook.sight(id);
  if (!s) return false;
  if (profile) writeJSON(pKey(profile.id, 'notebook.v1'), notebook.toJSON());
  ui.say(s.isNew ? `${s.species.name} — a new page` : s.species.name, s.isNew ? 5 : 3);
  ui.announce(`${s.species.name}${s.isNew ? ', new in your notebook' : ''}.`);
  if (s.isNew) {
    notebookBtn.classList.add('new');
    window.setTimeout(() => notebookBtn.classList.remove('new'), 6000);
  }
  return true;
}

// the notebook's tab, and its page (paper drawn by the renderer; names laid over it)
const notebookBtn = document.getElementById('notebook') as HTMLButtonElement;
const pageEl = document.getElementById('page') as HTMLDivElement;
let pageOpen = false;
let pageK = 0;
let pageSide: 'creatures' | 'numbers' = 'creatures';
const PAGE_COLS = 3;
const PAGE_ROWS = 4;
const PER_PAGE = PAGE_COLS * PAGE_ROWS;
/** Which leaf of the creatures pages is open (there can be many more species than fit one). */
let pageLeaf = 0;
const leaves = () => Math.max(1, Math.ceil(SPECIES.length / PER_PAGE));
/** Each entry's place on the open leaf, in CSS px, laid out for this screen (a 3 × 4 grid). */
function pageLayout(): Array<{ id: string; x: number; y: number }> {
  const top = cam.cssH * 0.14;
  const bottom = cam.cssH * 0.88;
  const left = cam.cssW * 0.08;
  const right = cam.cssW * 0.92;
  return SPECIES.slice(pageLeaf * PER_PAGE, (pageLeaf + 1) * PER_PAGE).map((sp, i) => ({
    id: sp.id,
    x: left + ((i % PAGE_COLS) + 0.5) * ((right - left) / PAGE_COLS),
    y: top + (Math.floor(i / PAGE_COLS) + 0.5) * ((bottom - top) / PAGE_ROWS),
  }));
}
function buildPage() {
  if (pageSide === 'numbers') return buildNumbersPage();
  const seen = notebook.pages;
  pageEl.innerHTML = '';
  const h2 = document.createElement('h2');
  h2.textContent = seen ? `${profile?.name ?? ''}'S NOTEBOOK`.toUpperCase() : 'NOTEBOOK';
  pageEl.appendChild(h2);
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.textContent = 'close';
  close.addEventListener('click', () => togglePage(false));
  pageEl.appendChild(close);
  const cellH = (cam.cssH * 0.74) / PAGE_ROWS;
  for (const { id, x, y } of pageLayout()) {
    const sp = SPECIES.find((s) => s.id === id)!;
    const has = notebook.has(id);
    const label = document.createElement('div');
    label.className = 'label' + (has ? '' : ' unseen');
    label.style.left = `${x}px`;
    label.style.top = `${y + cellH * 0.22}px`;
    const count = notebook.seen[id]?.count ?? 0;
    label.innerHTML = has
      ? `<b>${sp.name}</b>${count >= 10 ? `<small>seen ${count} times</small>` : ''}`
      : `<small>${sp.where}</small>`;
    pageEl.appendChild(label);
  }
  // the turns: back a leaf, on a leaf, and after the last leaf the numbers page
  if (pageLeaf > 0) pageEl.appendChild(pageTurn('back'));
  pageEl.appendChild(pageTurn(pageLeaf < leaves() - 1 ? 'on' : 'numbers'));
  const folio = document.createElement('div');
  folio.className = 'folio';
  folio.textContent = `${pageLeaf + 1} / ${leaves()}`;
  pageEl.appendChild(folio);
  pageEl.addEventListener('click', (e) => { if (e.target === pageEl) togglePage(false); });
}
/** The corner of the page that turns to the other one. */
function pageTurn(to: 'creatures' | 'numbers' | 'back' | 'on') {
  const turn = document.createElement('button');
  turn.className = 'turn' + (to === 'back' ? ' back' : '');
  turn.type = 'button';
  turn.textContent = to === 'numbers' ? 'numbers ›' : to === 'on' ? 'more ›' : to === 'back' ? '‹ back' : '‹ creatures';
  turn.addEventListener('click', () => {
    if (to === 'back') pageLeaf -= 1;
    else if (to === 'on') pageLeaf += 1;
    else if (to === 'creatures') { pageSide = 'creatures'; pageLeaf = leaves() - 1; }
    else pageSide = 'numbers';
    buildPage();
  });
  return turn;
}
/**
 * The second page, "so far": one administrative page for the grown-up and the
 * child who wants one — where the rowing has got to, what is known by heart,
 * what is being worked on. Facts are written the way they were made.
 */
function buildNumbersPage() {
  pageEl.innerHTML = '';
  const h2 = document.createElement('h2');
  h2.textContent = 'SO FAR';
  pageEl.appendChild(h2);
  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.textContent = 'close';
  close.addEventListener('click', () => togglePage(false));
  pageEl.appendChild(close);
  const now = Date.now();
  const factText = (k: string) => {
    const f = parseKey(k);
    return f.rule === 'groups' ? `${f.parts[0]} × ${f.parts[1]} = ${f.value}` : `${f.parts.join(' + ')} = ${f.value}`;
  };
  const keys = Object.keys(memory.items);
  const byHeart = keys.filter((k) => memory.fluent(k, now)).map(factText);
  const working = keys.filter((k) => !memory.fluent(k, now)).sort((a, b) => recall(memory.items[a], now) - recall(memory.items[b], now)).slice(0, 8).map(factText);
  const stageNames: Record<string, string> = { gather: 'gathering', add: 'adding', more: 'adding further', groups: 'making groups', times: 'times' };
  const days = firstPlayed ? Math.max(1, Math.round((now - firstPlayed) / 86400_000)) : 0;
  const sec = (title: string, body: string, cls = '') => {
    const d = document.createElement('section');
    d.className = cls;
    d.innerHTML = `<h3>${title}</h3><p>${body}</p>`;
    pageEl.appendChild(d);
  };
  sec('on the river', `${days ? (days === 1 ? 'since today' : `since ${days} days ago`) : 'just begun'} · ${totalSolves} number${totalSolves === 1 ? '' : 's'} made · ${notebook.pages} of ${SPECIES.length} creatures seen`);
  sec('now', curriculum.data.level ? curriculum.level.name.toLowerCase() : stageNames[stage().id] ?? stage().id);
  if (story.told > 0 || Object.keys(story.residents).length || Object.keys(story.chapters).length) sec('the piers', `${Object.values(story.residents).filter(c => c.met).length} met · ${story.told} content`);
  if (pond.plantings.length) {
    const flowering = pond.plantings.filter((pl) => pond.ageDays(pl) >= 5).length;
    const leaves = pond.plantings.filter((pl) => pond.ageDays(pl) >= 0.5).length - flowering;
    sec('planted', `${pond.plantings.length} seed${pond.plantings.length === 1 ? '' : 's'} · ${leaves} in leaf · ${flowering} in flower`);
  }
  sec('by heart', byHeart.length ? byHeart.join(' · ') : 'nothing yet — it comes with rowing', 'facts');
  sec('working on', working.length ? working.join(' · ') : '—', 'facts');
  pageEl.appendChild(pageTurn('creatures'));
  pageEl.addEventListener('click', (e) => { if (e.target === pageEl) togglePage(false); });
}
function togglePage(open = !pageOpen) {
  pageOpen = open;
  mathUI.suspend(open || !!visit);
  if (open) { pageSide = 'creatures'; pageLeaf = 0; buildPage(); }
  pageEl.classList.toggle('open', open);
  document.body.classList.toggle('page', open);
  pageEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  notebookBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
  notebookBtn.textContent = open ? 'river' : 'notebook';
  if (open) ui.announce(`Notebook: ${notebook.pages} of ${SPECIES.length} pages.`);
}
notebookBtn.addEventListener('click', () => togglePage());
/** What the renderer draws on the open page this frame. */
function pageEntries(): PageEntry[] {
  const cellH = (cam.cssH * 0.74) / PAGE_ROWS;
  const scale = Math.min(1, cellH / 110);
  return pageLayout().map(({ id, x, y }) => {
    const sp = SPECIES.find((s) => s.id === id)!;
    const [wx, wy] = toWorld(x, y - cellH * 0.1);
    const size = (sp.group === 'dragonfly' ? 19 : sp.group === 'butterfly' ? 15 : sp.group === 'fish' ? (sp.kind === 3 ? 14 : 26) : sp.group === 'flower' ? 17 : 6) * scale / cam.zoom;
    return { group: sp.group, kind: sp.kind, seed: sp.seed, x: wx, y: wy, size, seen: notebook.has(id) };
  });
}

function begin() {
  if (started) return;
  started = true;
  ui.fadeTitle();
  notebookBtn.classList.remove('hidden');
}

/** A name was chosen at the start: load that child's river and let the asks begin. */
function startAs(name: string) {
  loadProfile(name);
  welcome = lastPlayed > 0 && Date.now() - lastPlayed > 6 * 3600_000;
  stretch = new L.Stretch(null, welcome);
  if (welcome) pond.bloomBoost = 2.2;
  ui.hideStart();
  startedAt = pond.t;
  if (profile && !startNames.includes(profile.name)) {
    startNames.push(profile.name);
    renderer.setNames(startNames);
  }
  // something planted has grown while they were away: say so
  if (pond.plantings.length && lastPlayed > 0) {
    const grownSince = pond.plantings.some((pl) => Math.floor(pond.ageDays(pl)) > Math.floor(Math.max(0, (lastPlayed - pl.t) / 86400_000) + pond.extraDays));
    if (grownSince) window.setTimeout(() => ui.say('something you planted has grown, down the river', 6), 2500);
  }
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
const startNames: string[] = profiles
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
  const out = a <= 0 ? [] : nameSlots
    .filter((s) => s.pad && s.a > 0.01)
    .map((s) => ({ i: startNames.indexOf(s.name), x: s.pad!.x, y: s.pad!.y, h: Math.max(13, Math.min(20, s.pad!.r * cam.zoom * 0.42)) / cam.zoom, a: a * s.a }));
  // a planted leaf carries its child's name, faintly, once it has grown into one
  for (const p of pond.pads) {
    if (!p.planted) continue;
    const i = startNames.indexOf(p.planted);
    if (i < 0 || out.length >= 8) continue;
    out.push({ i, x: p.x, y: p.y, h: Math.max(11, Math.min(16, p.r * cam.zoom * 0.36)) / cam.zoom, a: 0.55 * (1 - p.sink) });
  }
  return out;
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
/** A seed from a spent flower, carried on the fingertip until it is let go. */
let seed: { x: number; y: number; wx: number; wy: number; from: [number, number]; moved: boolean } | null = null;
let drag: { x: number; y: number; t: number; vx: number; vy: number; moved: boolean; wx: number; wy: number; last: number } | null = null;

let pointerAt = 0;
canvasEl.addEventListener('pointerdown', (e) => {
  // a second finger while one is down is ignored — unless the first was lost without an
  // up (it happens on phones); then the new touch takes over rather than every tap dying
  if (pointerId !== null) {
    if (performance.now() - pointerAt < 1500 || helm || drag?.moved) return;
    pointerId = null;
    residentPress = null;
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
  const residentHit = started ? hitResident(e.clientX, e.clientY) : null;
  if (residentHit && !pond.onBoat(bwx, bwy)) {
    residentPress = {...residentHit, x:e.clientX, y:e.clientY, moved:false};
    return;
  }
  if (visit) endVisit();
  const hitPad = hitOrNear(e.clientX, e.clientY);
  // the boat, or the water astern of it (unless that's a dewy leaf to gather): the helm
  if (pond.onBoat(bwx, bwy) || (pond.behindBoat(bwx, bwy) && !(hitPad && answerable(hitPad)))) {
    // where on the boat: across (a tap there leans on that oar) and fore or aft of the
    // centre (dragging the front half swings the bow, the back half swings the stern)
    const [lx, ly] = pond.boatLocal(bwx, bwy);
    // the basket: a pinch of crumbs over the stern (sharing, NARRATIVE-DESIGN.md §2)
    if (started && Math.hypot(lx - 6, ly + 28) < 13) {
      pointerId = null;
      basketTap();
      return;
    }
    helm = { t: performance.now(), x: e.clientX, y: e.clientY, moved: false, steer: pond.boat.heading, sign: ly > 0 ? 1 : -1, bias: Math.max(-1, Math.min(1, lx / 30)) };
    pond.boat.helm = { steer: pond.boat.heading };
    return;
  }
  // a leaf with dew is a choice; anywhere else — water or a dry leaf — the touch is wind
  const p = hitPad && answerable(hitPad) ? hitPad : null;
  lastHit = p;
  // …unless a creature or a flower is under the fingertip: then it is noticed (the notebook)
  // — and a spent flower's seed head gives up a seed to carry (planting, NARRATIVE-DESIGN.md §3)
  if (!p) {
    const spent = pond.blooms.find((b) => b.variant === 6 && b.open >= 0.6 && Math.hypot(b.x - bwx, b.y - bwy) < b.size * 1.15 + 12 / cam.zoom);
    if (spent && profile) seed = { x: e.clientX, y: e.clientY, wx: bwx, wy: bwy, from: [spent.x, spent.y], moved: false };
  }
  if (!p && sight(e.clientX, e.clientY)) {
    lastHit = null;
    return;
  }
  if (hitPad && !p) touchPad(hitPad);
  if (p) {
    touchPad(p);
    choose(p);
  } else {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    if (hitPad) {
      pond.splash(wx, wy, 6, 0.4, false, [hitPad]);
      pond.held = { pad: hitPad, ox: wx - hitPad.x, oy: wy - hitPad.y };
    } else if (!pond.splash(wx, wy, 6, 2.6, !!params.get('foamtap'))) {
      sound.plop(1, panAt(wx));
    }
    school.scare(wx, wy, 170);
    if (selection.length && lock <= 0) clearSelection();
    // a finger left on the water may then be drawn through it (see pointermove)
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: false, wx, wy, last: performance.now() };
  }
});

canvasEl.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pointerId) return;
  if (residentPress) { residentPress.moved ||= Math.hypot(e.clientX-residentPress.x,e.clientY-residentPress.y)>10; return; }
  if (seed) {
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    seed.x = e.clientX; seed.y = e.clientY; seed.wx = wx; seed.wy = wy;
    if (Math.hypot(wx - seed.from[0], wy - seed.from[1]) > 14) seed.moved = true;
    return;
  }
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
      pond.held = null;
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
        if (sp > 250) sound.plop(0.25 + strength * 0.5, panAt(wx));
        school.scare(wx, wy, 70);
      }
      drag.wx = wx;
      drag.wy = wy;
    }
    return;
  }
  const p = hit(e.clientX, e.clientY);
  // choosing is one touch a numeral; a finger drawn across leaves does not fill blanks
  if (!p || p === lastHit || relationship?.mode === 'pick') return;
  // tracing back onto the previous leaf lets the last one go
  if (selection.length > 1 && selection[selection.length - 2] === p) {
    const last = selection.pop()!;
    last.selected = false;
    if (relationship) mathUI.progress(relationGathered());
    else ui.progress(gathered());
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
  pond.held = null;
  if (residentPress) {
    const press=residentPress; residentPress=null;
    const m=pond.landmarks.find(m=>residentKey(m)===press.key);
    if(m && !press.moved && e.type !== 'pointercancel') engage(m,press.lamp);
    return;
  }
  if (seed) {
    const s = seed;
    seed = null;
    if (s.moved && profile) {
      // planted, if it was let go on open water
      const onLeaf = hit(s.x, s.y);
      if (!onLeaf && !pond.onBoat(s.wx, s.wy)) {
        pond.plant(s.wx, s.wy, profile.name);
        writeJSON(pKey(profile.id, 'plantings.v1'), pond.plantings);
        pond.sproutGrown(cam.y - cam.cssH / (2 * cam.zoom) - 600);
        sound.plop(0.4, panAt(s.wx));
        ui.say('planted — it grows while you are away', 5);
        ui.announce('Planted. It will grow while you are away.');
      } else {
        pond.impulses.push({ x: s.wx, y: s.wy, r: 3, s: 0.2 });
        ui.say('a seed wants open water', 3);
      }
    }
    return;
  }
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
  if(e.key.toLowerCase()==='r'||e.key.toLowerCase()==='l') {
    const m=[...pond.landmarks].sort((a,b)=>Math.hypot(a.x-pond.boat.x,a.y-pond.boat.y)-Math.hypot(b.x-pond.boat.x,b.y-pond.boat.y))[0];
    if(m) engage(m,e.key.toLowerCase()==='l');
    e.preventDefault();return;
  }
  if(e.key === 'Escape' && visit) { endVisit(); return; }
  if(visit)endVisit();
  const pads = visibleDewy(true).sort((a, b) => b.y - a.y || a.x - b.x);
  if (e.key === 'Escape') {
    if(visit) { endVisit(); return; }
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
    ui.announce(optionOf.has(pads[focusIx]) ? `Leaf with ${optionOf.get(pads[focusIx])}.` : `Leaf with ${liveCount(pads[focusIx])} drops${pads[focusIx].selected ? ', chosen' : ''}.`);
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

/** Crumbs on the water: small, pale, a little warm; sitting on the surface. */
function crumbMotes(): Mote[] {
  const out: Mote[] = pond.crumbs.filter((c) => !c.eaten).map((c) => ({ x: c.x, y: c.y, size: 3.4, r: 0.95, g: 0.86, b: 0.62, a: 0.9, core: 0.75, z: 1 }));
  // a carried seed: a small dark thing held above the water, with its shadow beneath
  if (seed?.moved) {
    out.push({ x: seed.wx + 6, y: seed.wy - 6, size: 7, r: 0.05, g: 0.06, b: 0.04, a: 0.28, core: 0.3, z: 1 });
    out.push({ x: seed.wx, y: seed.wy, size: 5.5, r: 0.32, g: 0.22, b: 0.12, a: 1, core: 0.9, z: 1.12 });
  }
  return out;
}

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
  const glow = lantern + story.carried * 0.2 + dusk * 0.8;
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
const perf = new Perf();
let perfReportAt = 90;
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
  perf.begin(now);

  const hh = cam.cssH / (2 * cam.zoom);
  pond.ensure(cam.y + hh + 500);
  pond.cull(cam.y - hh - 600);

  // physics at a fixed step
  // at most two world substeps a frame: a slow frame must not double the world's work
  // and make the next one slower still (the feedback the telemetry showed)
  const steps = dt > 1 / 40 ? 2 : 1;
  for (let i = 0; i < steps; i++) pond.step(dt / steps, { y0: cam.y - hh - 200, y1: cam.y + hh + 300 }, reduced);
  perf.mark('world');
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
  perf.mark('prep');
  school.step(dt, pond.boat, { x: cam.x, y: cam.y, hw, hh }, shift, (x, y) => pond.flow(x, y), interest, pond.crumbs);
  perf.mark('fish');
  if (!visit) stepShare(dt);
  stepStory(dt);
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
    // 'gurgle' (the release) is not voiced: it was the sound that jarred (Round 54)
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
  lock = Math.max(0, lock - (visit ? 0 : dt));
  if (releaseAt && pond.t >= releaseAt) {
    releaseAt = 0;
    clearSelection();
    sound.release();
  }
  if (relationClearAt && pond.t >= relationClearAt) { mathUI.hide(); relationClearAt = 0; }
  if (relationRelease && pond.t >= relationRelease.at) {
    const { pad } = relationRelease;
    relationRelease = null;
    const i = relationLeaves.lastIndexOf(pad);
    if (i >= 0) {
      relationLeaves.splice(i, 1);
      if (relationship?.mode === 'pick') chosenValues = chosenValues.slice(0, i);
      pad.selected = relationLeaves.includes(pad);
      pad.bob = Math.min(1, pad.bob + 0.5);
      if (relationship) mathUI.progress(relationGathered());
    }
  }
  if (revealAt && pond.t >= revealAt) {
    if (relationship) {
      lock = Math.max(lock, 1.2);
      revealRelation();
    }
    revealAt = 0;
  }
  if (!visit && !relationship && !plan && !target && !share && pond.t >= nextTargetAt) setTarget();
  if (!started) placeNames(dt);
  stepChimes();
  stepOpenings(dt);
  // No automatic answer-revealing hints: looking around is not evidence of difficulty.
  if (pond.bloomBoost > 1 && pond.t > 90) pond.bloomBoost = 1;
  if (pond.t >= checkAt) {
    checkAt = pond.t + 0.35;
    if (!visit) { if (relationship) keepAnswerable(); else if (plan) stepPlan(); else keepSolvable(); }
    // a dewy leaf drifting under another sheds the hidden drops rather than hiding them
    shedHidden();
  }

  // `?sinktest=1`: hold the dewy leaf nearest the centre pushed under at one edge (to look at the flooding)
  // `?plant=1` (with `&days=N`): a seed planted ahead of the boat as soon as the river starts, to look at growth
  if (params.get('plant') && started && profile && !plantTested) {
    plantTested = true;
    const [px, py] = pond.boatWorld(24, 170);
    pond.plant(px, py, profile.name);
    pond.sproutGrown(cam.y - cam.cssH / (2 * cam.zoom) - 600);
  }
  // `?sharetest=1`: three big fish brought to the boat, to look at the sharing ask
  if (params.get('sharetest') && started && !shareTested) {
    shareTested = true;
    const big = school.fish.filter((f) => f.kind !== 3).slice(0, 3);
    big.forEach((f, k) => { f.x = pond.boat.x + (k - 1) * 40; f.y = pond.boat.y - 90; f.mood = 2; f.until = 30; f.cool = 0; });
  }
  if (params.get('sinktest')) {
    // the same leaf throughout (once chosen), so what happens to its dew can be watched
    const numeralShown = numeralLeaves.find((q) => q.glyph !== undefined && q.glyph >= 0 && (q.glyphT ?? 0) >= 1);
    if (numeralShown && sinkLeaf !== numeralShown && !sinkWashed && !(sinkLeaf && sinkLeaf.glyph !== undefined && sinkLeaf.glyph >= 0)) sinkLeaf = numeralShown;
    if (!sinkLeaf || !pond.pads.includes(sinkLeaf)) sinkLeaf = visibleDewy().sort((a, b) => Math.hypot(a.x - cam.x, a.y - cam.y) - Math.hypot(b.x - cam.x, b.y - cam.y))[0] ?? null;
    const v = sinkLeaf;
    if (v) {
      v.caught = true;
      v.sink = params.get('wash') ? 0.42 : 0.75;
      v.dx = 0.15;
      v.dy = 0.02;
      // with `&wash=S` too: after S seconds (once its dew has settled), its dew runs off (to look at the emptying)
      if (params.get('wash') && pond.t > (Number(params.get('wash')) || 2) && !sinkWashed && (v.glyph === undefined || (v.glyphT ?? 1) >= 1)) {
        sinkWashed = true;
        for (const d of v.drops) d.to = 0;
      }
      // with `&foamtap=1` too: churn white water over its flooded side, to see it ride the film
      if (params.get('foamtap') && Math.random() < dt * 12) pond.impulses.push({ x: v.x + v.r * 0.55, y: v.y + v.r * 0.1, r: 12, s: 0.5, foam: true });
    }
  }
  waterGlyphs(dt);
  const order = drawOrder(pond.pads);
  const thread: Array<[number, number]> = [];
  if (solvedThread && (selection.length || pond.t > solvedThread.until)) solvedThread = null;
  const threaded = selection.length ? selection : solvedThread?.pads ?? [];
  if (threaded.length > 1) {
    for (let i = 0; i < threaded.length - 1; i++) {
      const a = threaded[i];
      const c = threaded[i + 1];
      for (let k = 0; k < 12; k++) {
        const u = k / 12;
        const sag = Math.sin(u * Math.PI) * 10;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const l = Math.hypot(dx, dy) || 1;
        thread.push([a.x + dx * u - (dy / l) * sag, a.y + dy * u + (dx / l) * sag]);
      }
    }
    const z = threaded[threaded.length - 1];
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
  perf.mark('learn');
  const air = atmosphere.step(dt, pond.t, field, sky);
  const bugs = started
    ? critters.step(dt, pond.t, field, { pads: order, blooms: pond.blooms, boatAt: (lx, ly) => pond.boatWorld(lx, ly), boatHeading: pond.boat.heading }, sky)
    : [];
  lastBugs = bugs;
  pageK += ((pageOpen ? 1 : 0) - pageK) * Math.min(1, dt * 6);
  perf.mark('air');
  const moteList = [...air.above, ...gathers(dt, sky.dusk), ...drips(sky), ...crumbMotes()];
  renderer.render(
    {
      cam,
      light: sky,
      time: pond.t,
      pond,
      pads: bare ? [] : order,
      fish: school.fish,
      critters: bugs,
      residents: residentsNow(),
      pierLights: pierLights(),
      motes: [...moteList, ...storyMotes()],
      under: air.below,
      thread,
      lantern: 0.15 + lantern * 0.6 + story.carried * 0.2 + sky.dusk * 1.1,
      names: nameSprites(),
      page: pageK > 0.01 ? { open: pageK, entries: pageSide === 'creatures' ? pageEntries() : [] } : undefined,
    },
    dt,
  );
  perf.mark('render');
  perf.end(ms, {
    worldSteps: steps, simSteps: renderer.lastSimSteps, pads: pond.pads.length, deep: pond.deep.length, floaters: pond.floaters.length,
    blooms: pond.blooms.length, fish: school.fish.length, bugs: bugs.length, motes: moteList.length, under: air.below.length,
    eddies: pond.eddies.length, puddles: pond.puddles.length, crumbs: pond.crumbs.length, impulses: pond.impulses.length, lifts: lifts.length,
    scale: Math.round(scale * 10) / 10, page: pageOpen ? 1 : 0,
  }, pond.t);
  if (pond.t > perfReportAt) {
    perfReportAt = pond.t + 120;
    report('perf', { scale, dpr, ...perf.summary() });
  }
  requestAnimationFrame(frame);
}

/** `?sinktest=1`: the leaf held under, and whether `&wash=1` has run its dew off yet. */
let sinkLeaf: Pad | null = null;
let sinkWashed = false;

// ─── numerals drawn in water on the leaves (glyphs.ts) ─────────────────────
// In play: a numeral question's leaves, and the leaves of any question whose skill the child
// has proved with dew (challenges.ts NUMERALS_AFTER). Debug views below.
// `?glyphs=1`: a dewy leaf's drops flow together into the numeral of how many it holds
// (1–9; more stay as drops), and when that number changes the water flows into the new
// one; `?glyphs=half` only on every other leaf, to see the two side by side;
// `?glyphs=morph`: each dewy leaf's water flows from its drops to its numeral and back,
// every few seconds. `?glyphs=sheet`: the sixteen glyphs (0–9 + − × ÷ = ?) on the sixteen
// leaves nearest the middle of the view, in reading order; `?glyphs=repeat&chars=37` those
// leaves repeating a few characters, to see the hand vary; add `&cycle=1` to either and
// each leaf's glyph flows into the next every few seconds.
const glyphMode = params.get('glyphs');
const glyphCycle = !!params.get('cycle');
/** How long water takes to flow from one state to the next (s). */
const MORPH = 1.8;
let glyphsReady = false;
let sheet: Map<Pad, number> | null = null;

/**
 * Move a leaf's water toward a state (an atlas cell, -1 its own drops, -2 nothing): a
 * change starts a flow from what is there now (if a flow is barely begun, from where it
 * began), and a flow that ends back in the drops hands the leaf back to its dew.
 */
/**
 * A leaf's water is always one of: nothing (-2), fine dew (-3: a sprinkle of tiny beads, too
 * small to count), drops (-1: the dew that counts), or a numeral (0…). It moves between them
 * only by flowing:
 *   nothing → fine dew          a bare leaf beads up (BEAD)
 *   fine dew → drops / numeral  the beads drift together and grow into it (GATHER)
 *   anything else               one water into the next (MORPH)
 * Nothing goes straight to drops or a numeral: it beads first, then gathers (a queued flow).
 * Water leaving drops or a numeral goes back to fine dew on a leaf that keeps some, and to
 * nothing on one that does not.
 */
const BEAD = 3.2;
const GATHER = 2.8;
/** About half the leaves keep a sprinkle of fine dew (by their seed), so dew is never far. */
const keepsFineDew = (p: Pad) => ((p.seed * 7.31) % 1) < 0.55 && !p.flower;

function flowToward(p: Pad, to: number, dt: number) {
  const now = p.glyph ?? -2;
  if (to !== now && to !== p.glyphQueue) {
    // a new flow starts from what shows (or, if the last one has barely begun, from where it began)
    if (p.glyph === undefined) p.glyphFrom = -2;
    else if ((p.glyphT ?? 1) > 0.35) p.glyphFrom = now;
    p.glyphQueue = undefined;
    // nothing never jumps to drops or a numeral: it beads first, then gathers
    if (p.glyphFrom === -2 && to !== -3 && to !== -2 && !glyphMode) {
      p.glyphQueue = to;
      to = -3;
    }
    p.glyph = to;
    p.glyphT = 0;
  }
  const dur = p.glyphFrom === -2 && p.glyph === -3 ? BEAD : p.glyphFrom === -3 ? GATHER : MORPH;
  p.glyphT = Math.min(1, (p.glyphT ?? 1) + dt / dur);
  p.glyphA = 1;
  p.glyphSize = 1.05;
  if (p.glyphT < 1) return;
  if (p.glyphQueue !== undefined) {
    // beaded: now gather into what was wanted
    p.glyphFrom = p.glyph;
    p.glyph = p.glyphQueue;
    p.glyphQueue = undefined;
    p.glyphT = 0;
  } else if (p.glyph === -2 || (p.glyph === -1 && glyphMode)) p.glyph = undefined;
}

/** Bake the atlas a glyph at a time between frames, then hand it to the renderer. */
let baking = false;
function bakeGlyphs() {
  if (baking || glyphsReady || !renderer) return;
  baking = true;
  const steps = glyphAtlasSteps();
  const step = () => {
    const r = steps.next();
    if (r.done) {
      renderer.enableGlyphs(r.value);
      glyphsReady = true;
      return;
    }
    window.setTimeout(step, 16);
  };
  step();
}

/**
 * A numeral on a leaf going under keeps being that numeral: when the leaf's dew is washed off,
 * the numeral's water runs off into the river as it stands (PAD_FS, `gRun`) rather than turning
 * back into drops. Returns whether this leaf is running off (and handled).
 */
function runningOff(p: Pad, dt: number): boolean {
  if (p.glyph === undefined || p.glyph < 0) return false;
  if (!p.glyphRun) {
    if (p.sink <= 0.15) return false;
    // under water, a numeral holds as it is (no turning back into drops) until its dew is washed;
    // one still forming finishes forming
    if (p.drops.some((d) => d.to > 0)) {
      p.glyphT = Math.min(1, (p.glyphT ?? 1) + dt / (p.glyphFrom === -3 ? GATHER : p.glyphFrom === -2 ? BEAD : MORPH));
      return true;
    }
  }
  p.glyphRun = Math.min(1, (p.glyphRun ?? 0) + dt / 1.6);
  if (p.glyphRun >= 1) {
    // the river has it; the leaf is bare (fine dew beads up again in time)
    p.glyph = undefined;
    p.glyphRun = 0;
    numeralLeaves = numeralLeaves.filter((q) => q !== p);
  }
  return true;
}

function waterGlyphs(dt: number) {
  if (!renderer) return;
  if (!glyphMode) {
    // in play: numerals only for a numeral question's leaves (once the atlas is baked);
    // all other dew is drawn as water at rest, and flows when it changes
    if (!glyphsReady && (numeralLeaves.length || profile)) bakeGlyphs();
    for (const p of numeralLeaves) {
      if (!glyphsReady) break;
      if (runningOff(p, dt)) continue;
      const v = optionOf.get(p);
      flowToward(p, v !== undefined ? numeralCode(v) : keepsFineDew(p) ? -3 : -2, dt);
    }
    // while a question is chosen, other dew on the river settles to fine dew, so the numerals
    // are the only numbers in view (its drops are kept, and gather again after)
    const choosing = (relationship ?? plan?.c)?.mode === 'pick';
    for (const p of pond.pads) {
      if (glyphsReady && numeralLeaves.includes(p)) continue;
      // a numeral no longer in the question (a sinking leaf leaves it) still runs off as a numeral
      if (runningOff(p, dt)) continue;
      const wet = p.drops.some((d) => d.to > 0 || d.a > 0.01);
      const rest = wet ? (choosing ? -3 : -1) : keepsFineDew(p) ? -3 : -2;
      if (p.glyph === undefined) {
        if (rest === -2) continue;
        // water already on the leaf (grown with the river, off screen): simply there, at rest
        p.glyph = rest;
        p.glyphFrom = rest;
        p.glyphT = 1;
        p.glyphA = 1;
        p.glyphSize = 1.05;
        continue;
      }
      flowToward(p, rest, dt);
    }
    return;
  }
  if (!glyphsReady) {
    renderer.enableGlyphs(glyphAtlas());
    glyphsReady = true;
  }
  if (glyphMode === 'sheet' || glyphMode === 'repeat') {
    const chars = [...(params.get('chars') || '2357')].map(glyphIndex).filter((g) => g >= 0);
    if (!sheet) {
      const near = pond.pads
        .filter((p) => p.r > 26 && Math.abs(p.x - cam.x) < cam.cssW / (2 * cam.zoom) - p.r && Math.abs(p.y - cam.y) < cam.cssH / (2 * cam.zoom) - p.r)
        .sort((a, b) => Math.hypot(a.x - cam.x, a.y - cam.y) - Math.hypot(b.x - cam.x, b.y - cam.y))
        .slice(0, GLYPHS.length);
      if (near.length < GLYPHS.length) return;
      near.sort((a, b) => (Math.abs(a.y - b.y) > 45 ? b.y - a.y : a.x - b.x));
      sheet = new Map(near.map((p, i) => [p, i]));
    }
    const step = glyphCycle ? Math.floor(pond.t / 2.6) : 0;
    for (const [p, i] of sheet) {
      const g = glyphMode === 'repeat' ? chars[(i + step) % chars.length] : (i + step) % GLYPHS.length;
      flowToward(p, g, dt);
    }
    return;
  }
  for (const p of pond.pads) {
    if (!p.drops.length || (glyphMode === 'half' && p.id % 2)) {
      if (p.glyph !== undefined) flowToward(p, -1, dt);
      continue;
    }
    const n = liveCount(p);
    let to = n >= 1 && n <= 9 ? n : n > 9 ? -1 : -2;
    // `morph`: drops and numeral in turn, each leaf on its own beat
    if (glyphMode === 'morph' && to >= 0 && Math.floor(pond.t / 3.2 + (p.id % 7) / 7) % 2 === 0) to = -1;
    if (to === -2 && p.glyph === undefined) continue;
    flowToward(p, to, dt);
  }
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
    challenge: relationship ? { equation: equation(relationship), answers: relationship.answers, choices: relationship.choices, supplied: supplyLog.map(([t, v]) => [Math.round((t - relationShownAt) * 10) / 10, v]), shownFor: Math.round((pond.t - relationShownAt) * 10) / 10, dots: relationship.dots, seq: relationship.seq, numerals: numeralLeaves.map((p) => p.id), options: [...optionOf].map(([p, v]) => { const [x, y] = toScreen(p.x, p.y); return { id: p.id, v, x: Math.round(x), y: Math.round(y), glyph: p.glyph, t: p.glyphT }; }), chosen: chosenValues, skill: relationship.skill, level: relationship.level, mode: relationship.mode, form: relationship.form, support: relationship.support, attempts: relationAttempts, help: relationHelp, gathered: relationGathered(), padIds: relationLeaves.map((p) => p.id) } : null,
    planned: plan ? { equation: equation(plan.c), staged: plan.staged, tries: plan.tries, for: Math.round((pond.t - plan.at) * 10) / 10 } : null,
    curriculum: curriculum.data,
    gathered: gathered(),
    selected: selection.map((p) => p.id),
    dewy: pond.pads.filter((p) => liveCount(p) > 0).map((p) => {
      const [x, y] = toScreen(p.x, p.y);
      return { id: p.id, x: Math.round(x), y: Math.round(y), r: Math.round(p.r * cam.zoom), n: liveCount(p), run: p.glyphRun, glyph: p.glyph, from: p.glyphFrom, t: p.glyphT === undefined ? undefined : Math.round(p.glyphT * 100) / 100, sink: Math.round(p.sink * 100) / 100 };
    }),
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
    audio: sound.path(),
    perf: perf.summary(),
    notebook: Object.keys(notebook.seen),
    crumbs: pond.crumbs.filter((c) => !c.eaten).length,
    plantings: pond.plantings.map((pl) => ({ Y: Math.round(pl.Y), days: Math.round(pond.ageDays(pl) * 10) / 10 })),
    planted: pond.pads.filter((p) => p.planted).length,
    seed: seed ? { moved: seed.moved } : null,
    share: share ? { fish: share.fish.length, fed: share.fish.map((i, k) => (school.fish[i].fed ?? 0) - share!.base[k]) } : null,
    fishAtBoat: bigFishAtBoat().length,
    story: story.toJSON(),
    visit: visit?.key ?? null,
    carriedLight: story.carried,
    piers: pond.landmarks.map(m=>{const [x,y]=toScreen(...lampPoint(m)); return {key:residentKey(m),kind:residentKind(m),lamp:{x,y,light:pierBrightness(m)}, distance:Math.hypot(pond.boat.x-pierTip(m)[0],pond.boat.y-pierTip(m)[1])};}),
    residents: residentsNow().map((r) => { const [x, y] = toScreen(r.x, r.y); return { kind: r.kind===3 ? 'lantern' : RESIDENTS[r.kind], x: Math.round(x), y: Math.round(y), mood: r.mood }; }),
    muted: [...sound.muted],
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


