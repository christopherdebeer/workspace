/* ---------------------------------------------------------------------------
 * Playtest runner (@c15r/playtest) — a game definition in, a played and judged
 * session out. Server-side sibling of the jev · lab demo runner, made safe for
 * CONCURRENT games in one Lambda: each game owns a slot directory in the
 * in-memory fs and its own seeded RNG, swapped in around every synchronous
 * engine call (sync sections never interleave, so seeds stay reproducible
 * while Jev calls from many games overlap).
 *
 *   classify(rules)  what the definition asks for vs what the engine has:
 *                    declared mechanics (implemented / partial / missing),
 *                    Jev reading the prose against all 209 catalogue mechanics
 *                    (described-but-not-configured, described-but-missing),
 *                    card effects no handler will apply, schema problems.
 *   play(rules)      the SAME vendored engine the playtest CLI runs, driven
 *                    in-process: each turn code enumerates concrete actions,
 *                    the engine's own validateAction masks them, and Jev picks
 *                    one (a choice over ≤255 labels). Forced moves skip Jev.
 *   judge(session)   computed metrics + Jev judgments over them.
 *
 * Jev never writes and never counts: every number it sees is computed here.
 * Pure over an injected `decide` so the node devtools and the page share it.
 * ------------------------------------------------------------------------- */
import { writeFileSync, resetPrefix, filesUnder, unlinkSync } from '../engine/shims/fs';
import {
  initGame,
  startGame,
  loadState,
  getAvailableActions,
  validateAction,
  executeAction,
} from '../engine/core/game';
import { EVENT_EFFECTS } from '../engine/mechanics/event-effects';
import { parseRules, getPlayerCount, getMechanicImplementationStatus, loadMechanicsIndex } from '../engine/core/rules';
import { validateRules } from '../engine/core/validate';
import { mechanicRegistry } from '../engine/mechanics/index';
import { CONSUMED_KEYS } from '../engine/consumed-keys';
import type { Questions, Answers } from './types';

export type Decide = (state: unknown, questions: Questions, label: string) => Promise<{ answers: Answers; tokens: number; ms: number }>;

let slotSeq = 0;
/** A fresh game directory name; games in flight never share one. */
export const newSlot = () => `s${Date.now().toString(36)}${(slotSeq++).toString(36)}`;
const rulesPath = (slot: string) => `/pt/games/${slot}/RULES.md`;

/** Run a synchronous engine section with this game's RNG as Math.random. */
function withRng<T>(rng: () => number, fn: () => T): T {
  const real = Math.random;
  Math.random = rng;
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

/* ── one-ply consequences ────────────────────────────────────────────────
 * Jev picks a move from its label alone, so without help it plays blind: it can't
 * tell that entering a tile completes its objective, or that a move wins outright.
 * For each valid candidate the runner plays it on a throwaway copy of the state
 * and appends what visibly changes FOR THIS PLAYER: objective progress, score, a
 * win. Nothing is annotated when the simulated move touched hidden information —
 * the deck, another player's hand, or what the player gets to learn — so a label
 * never reveals the next card or someone's items. Simulations use their own RNG
 * stream, and the game's files are restored after each one. */
const SIM_MAX = 160;

/** What the runner shows Jev and how it drives play. Part of an eval's identity: a harness
 *  change moves scores without touching engine code, so baselines must match it too.
 *  h1: labels only · h2: one-ply consequence facts on options, off-turn replies. */
export const HARNESS_VERSION = 'h2';

function progressOf(state: Record<string, any>, pid: string): string[] {
  try {
    const v = mechanicRegistry.getPlayerView(state as never, pid) as Record<string, unknown>;
    return Array.isArray(v?.objectiveProgress) ? (v.objectiveProgress as string[]) : [];
  } catch {
    return [];
  }
}

function hiddenFingerprint(state: Record<string, any>, pid: string): string {
  const others = Object.entries(state.players as Record<string, any>).filter(([p]) => p !== pid).map(([p, pl]) => `${p}:${(pl.hand ?? []).map((c: { name: string }) => c.name).sort().join(',')}`);
  const me = state.players[pid] ?? {};
  return JSON.stringify([(state.shared?.deck ?? []).length, (state.shared?.deck ?? [])[0]?.name ?? null, others, Object.keys(me.knowledge?.revealed ?? {})]);
}

function consequences(s: Record<string, any>, pid: string, cands: Action[], slot: string, rng: () => number): Map<Action, string> {
  const out = new Map<Action, string>();
  if (cands.length > SIM_MAX) return out;
  const prefix = `/pt/games/${slot}/`;
  const snap = filesUnder(prefix);
  const beforeProgress = progressOf(s, pid);
  const beforeHidden = hiddenFingerprint(s, pid);
  const beforeScore = Number(s.players[pid]?.score ?? 0);
  for (const c of cands) {
    const clone = structuredClone(s);
    try {
      withRng(rng, () => executeAction(clone as never, pid, c as never));
    } catch {
      continue;
    } finally {
      const now = filesUnder(prefix);
      for (const k of Object.keys(now)) if (!(k in snap)) unlinkSync(k);
      for (const [k, v] of Object.entries(snap)) if (now[k] !== v) writeFileSync(k, v);
    }
    const facts: string[] = [];
    const ended = clone.status !== 'in_progress';
    const winner = clone.shared?.winner ?? clone.winner;
    if (ended && winner === pid) facts.push('YOU WIN');
    else if (ended && winner) facts.push(`${winner} wins`);
    if (hiddenFingerprint(clone, pid) === beforeHidden) {
      const after = progressOf(clone, pid);
      const changed = after.filter((line) => !beforeProgress.includes(line));
      facts.push(...changed.map((l) => `→ ${l}`));
      const dScore = Number(clone.players[pid]?.score ?? 0) - beforeScore;
      if (dScore) facts.push(`score ${dScore > 0 ? '+' : ''}${dScore}`);
    }
    if (facts.length) out.set(c, facts.join('; '));
  }
  return out;
}

/* Effect types some mechanic applies (effect-dispatcher direct types, the
 * three applyEffect implementers, take-that / lose-a-turn blocking). Read from
 * the vendored source; anything else on a card is stored inert or dropped. */
export const HANDLED_EFFECTS = new Set([
  'none', 'draw', 'score', 'reverse', 'bonus_worker',
  'probability_boost', 'probability_penalty', 'force_discard',
  'draw_on_enter', 'heal_on_enter', 'damage_on_enter',
  'move_forward', 'move_backward',
  'block_turn', 'block', 'skip', 'lose_turn', 'wild',
  // event-effects mechanic (targeted events, reactions, collectibles, movement bonus)
  ...Object.keys(EVENT_EFFECTS), 'counter', 'collectible', 'movement_bonus',
  // tile effects on the tile map (grid-movement / action-points)
  'safe', 'trade_bonus', 'hide', 'reveal', 'enemy_only',
]);
/** Item effects that do nothing by themselves: handled only if a card's `requires` or an
 *  objective's `holds` check names the item (otherwise they are dead weight in the deck). */
const PASSIVE_IF_REFERENCED = new Set(['utility', 'currency', 'enemy_item']);

/* Rule facts Jev reads off the prose, later checked against the played record. */
export const RULE_CHECKS: Record<string, string> = {
  oneActionPerTurn: 'Do these rules limit a player to exactly one action (or one main action) per turn?',
  hasTurnLimit: 'Do these rules end the game after a fixed number of turns or rounds?',
  scoreDecidesWinner: 'Do these rules decide the winner by comparing points or score?',
};

/* Argument names that need words or amounts Jev cannot produce. */
const FREE_TEXT = new Set(['story', 'description', 'guess', 'question', 'answer', 'rule', 'example', 'terms', 'clueValue', 'message', 'reason', 'victoryReason']);
const NUMERIC = new Set(['amount', 'quantity', 'bid', 'count', 'value']);

export interface Finding {
  kind: 'missing-implementation' | 'partial-implementation' | 'described-not-configured' | 'described-not-implemented' | 'configured-not-described' | 'unhandled-effect' | 'schema' | 'unsuitable-action' | 'engine' | 'balance';
  severity: 'info' | 'warn' | 'error';
  subject: string;
  detail: string;
}

export interface Classification {
  name: string;
  players: { min: number; max: number };
  winCondition: string;
  declared: Array<{ slug: string; status: 'implemented' | 'partial' | 'not_implemented' }>;
  enabled: string[];
  prose: Array<{ slug: string; name: string; p: number; implemented: boolean; configured: boolean }>;
  /** Rule facts read from the prose (P(yes)), checked against what the engine does in play. */
  ruleChecks: Record<string, number>;
  multiActionEngine: boolean;
  /** The prose rules (markdown body), for the judge to critique play against. */
  rulesText: string;
  effects: Array<{ type: string; cards: string[]; handled: boolean }>;
  schema: { errors: string[]; warnings: string[] };
  findings: Finding[];
  tokens: number;
}

/** A player range from `3`, `"2-4"` or `{min, max}`. */
export function playerRange(v: unknown): { min: number; max: number } {
  if (typeof v === 'number') return { min: v, max: v };
  if (typeof v === 'string') {
    const m = /^\s*(\d+)\s*(?:-|–|to)\s*(\d+)\s*$/.exec(v) ?? /^\s*(\d+)\s*$/.exec(v);
    if (m) return { min: Number(m[1]), max: Number(m[2] ?? m[1]) };
  }
  if (v && typeof v === 'object' && 'min' in v && 'max' in v) return { min: Number((v as { min: number }).min), max: Number((v as { max: number }).max) };
  return { min: 2, max: 4 };
}

/* ── classify ─────────────────────────────────────────────────────────── */

function load(rules: string, slot: string) {
  resetPrefix(`/pt/games/${slot}/`);
  writeFileSync(rulesPath(slot), rules);
  return parseRules(rulesPath(slot));
}

export async function classify(rules: string, decide: Decide | null): Promise<Classification> {
  const slot = newSlot();
  const { config, markdown } = load(rules, slot);
  const cfg = config as unknown as Record<string, unknown> & { mechanics?: string[]; players?: unknown; win_condition?: string; name?: string; deck?: Array<Record<string, unknown>>; engine_mechanics?: Record<string, unknown> };
  const findings: Finding[] = [];

  // The engine's getPlayerCount returns the raw YAML value, and `players: 2-4`
  // parses as the STRING "2-4" — so the engine never range-checks it. Parse it here.
  const players = playerRange(getPlayerCount(config) as unknown);
  if (typeof cfg.players === 'string') findings.push({ kind: 'engine', severity: 'info', subject: 'players range unparsed', detail: `players: "${cfg.players}" reaches the engine as a string; its player-count check never fires` });
  // Declared = the frontmatter's mechanic keys. A key configures something only
  // if a registered mechanic owns it or the engine reads engine_mechanics.<key>.
  const engineKeys = Object.keys(cfg.engine_mechanics ?? {});
  const declaredSlugs = [...new Set([...(cfg.mechanics ?? []).map(String), ...engineKeys.map((k) => k.replace(/_/g, '-'))])];
  const registered = new Set(mechanicRegistry.getRegisteredSlugs());
  const declared = declaredSlugs.map((slug) => {
    const key = slug.replace(/-/g, '_');
    const reg = getMechanicImplementationStatus(slug).status;
    const s = registered.has(slug) || CONSUMED_KEYS.has(key) ? 'implemented' : reg === 'partial' ? 'partial' : 'not_implemented';
    return { slug, status: s as 'implemented' | 'partial' | 'not_implemented' };
  });
  for (const d of declared) {
    if (d.status === 'not_implemented') findings.push({ kind: 'missing-implementation', severity: 'error', subject: d.slug, detail: 'declared in the frontmatter but nothing in the engine reads it — its rules exist only in prose' });
    if (d.status === 'partial') findings.push({ kind: 'partial-implementation', severity: 'warn', subject: d.slug, detail: 'only partly implemented; the rest falls to a gamemaster' });
  }
  const enabled = mechanicRegistry.getEnabledMechanics(config).map((m) => m.slug);

  // Card effects: which will actually do something?
  const byType = new Map<string, string[]>();
  const em = (cfg.engine_mechanics ?? {}) as Record<string, { deck?: Array<Record<string, unknown>> }>;
  for (const c of cfg.deck ?? em.cards?.deck ?? []) {
    const eff = c.effect as { type?: string } | undefined;
    if (eff?.type) byType.set(eff.type, [...(byType.get(eff.type) ?? []), String(c.name ?? '?')]);
  }
  const deckCards = (cfg.deck ?? em.cards?.deck ?? []) as Array<Record<string, unknown>>;
  const referenced = new Set<string>([
    ...deckCards.flatMap((c) => (Array.isArray(c.requires) ? (c.requires as string[]) : [])),
    ...((cfg as { objectives?: Array<{ check?: unknown }> }).objectives ?? []).flatMap((o) => JSON.stringify(o.check ?? {}).match(/"[^"]+"/g) ?? []).map((q) => q.slice(1, -1)),
  ]);
  const effects = [...byType].map(([type, cards]) => ({ type, cards, handled: HANDLED_EFFECTS.has(type) || (PASSIVE_IF_REFERENCED.has(type) && cards.some((c) => referenced.has(c))) }));
  for (const e of effects) if (!e.handled) findings.push({ kind: 'unhandled-effect', severity: 'error', subject: e.type, detail: PASSIVE_IF_REFERENCED.has(e.type) ? `"${e.type}" items (${e.cards.slice(0, 4).join(', ')}) do nothing unless a card's requires or an objective's check names them — none does` : `no mechanic applies "${e.type}" — cards ${e.cards.slice(0, 4).join(', ')} will be played for nothing` });

  // The engine's own schema validation.
  let schema = { errors: [] as string[], warnings: [] as string[] };
  try {
    const v = validateRules(rulesPath(slot)) as unknown as { errors?: Array<{ message?: string } | string>; warnings?: Array<{ message?: string } | string> };
    const msg = (x: { message?: string } | string) => (typeof x === 'string' ? x : x.message ?? JSON.stringify(x));
    schema = { errors: (v.errors ?? []).map(msg), warnings: (v.warnings ?? []).map(msg) };
  } catch (e) {
    schema.errors.push((e as Error).message);
  }
  for (const e of schema.errors) findings.push({ kind: 'schema', severity: 'error', subject: 'RULES.md', detail: e });

  // Jev reads the prose against the whole mechanic catalogue — one call, one
  // noul per mechanic (width is free; the rules text is billed once).
  let prose: Classification['prose'] = [];
  const ruleChecks: Record<string, number> = {};
  let tokens = 0;
  if (decide && markdown.trim()) {
    const index = loadMechanicsIndex() as unknown as { mechanics: Array<{ slug: string; name: string; category: string }> };
    const questions: Questions = {};
    for (const m of index.mechanics) {
      questions[m.slug] = { type: 'noul', instructions: `Do these game rules describe the board-game mechanic "${m.name}" (${m.category})?` };
    }
    for (const [k, q] of Object.entries(RULE_CHECKS)) questions[`rule:${k}`] = { type: 'noul', instructions: q };
    const r = await decide(markdown.slice(0, 24_000), questions, 'classify: prose → mechanics');
    for (const k of Object.keys(RULE_CHECKS)) ruleChecks[k] = r.answers[`rule:${k}`]?.noul ?? 0;
    tokens += r.tokens;
    const configured = new Set([...declaredSlugs, ...enabled]);
    prose = index.mechanics
      .map((m) => ({ slug: m.slug, name: m.name, p: r.answers[m.slug]?.noul ?? 0, implemented: registered.has(m.slug), configured: configured.has(m.slug) }))
      .sort((a, b) => b.p - a.p);
    // Literal nouls over 209 overlapping catalogue entries are generous
    // (track vs point-to-point movement…): report only confident, top matches.
    const strong = prose.filter((m) => m.p >= 0.9).slice(0, 8);
    for (const m of strong) {
      if (!m.configured && m.implemented) findings.push({ kind: 'described-not-configured', severity: 'info', subject: m.slug, detail: `the prose describes ${m.name} (p ${m.p.toFixed(2)}) and the engine implements it, but the frontmatter doesn't enable it — the engine won't enforce it` });
      if (!m.implemented) findings.push({ kind: 'described-not-implemented', severity: 'warn', subject: m.slug, detail: `the prose describes ${m.name} (p ${m.p.toFixed(2)}) but no engine mechanic implements it` });
    }
    for (const slug of declaredSlugs) {
      const m = prose.find((x) => x.slug === slug);
      if (m && m.p < 0.3) findings.push({ kind: 'configured-not-described', severity: 'info', subject: slug, detail: `enabled in the frontmatter, but the prose doesn't seem to describe it (p ${m.p.toFixed(2)})` });
    }
  }

  const multiActionEngine = !!(cfg.engine_mechanics && 'action_points' in cfg.engine_mechanics);
  resetPrefix(`/pt/games/${slot}/`);
  return { name: String(cfg.name ?? 'untitled'), players, winCondition: String(cfg.win_condition ?? ''), declared, enabled, prose, ruleChecks, multiActionEngine, rulesText: String(markdown ?? '').slice(0, 8000), effects, schema, findings, tokens };
}

/* ── play ─────────────────────────────────────────────────────────────── */

type Action = Record<string, unknown> & { type: string };

export interface TurnRecord {
  step: number;
  round: number;
  turn: number;
  player: string;
  offered: number;
  valid: number;
  forced: boolean;
  label: string;
  action: Action;
  confidence: number | null;
  top: Array<[string, number]>;
  ahead: number | null;
  fallback?: string;
  ms: number;
  tokens: number;
  scores: Record<string, number>;
}

export interface Session {
  seed: number;
  players: number;
  status: string;
  winner: string | null;
  endReason: string | null;
  turns: TurnRecord[];
  log: Array<Record<string, unknown>>;
  unsuitable: Array<{ type: string; fields: string[]; why: 'free-text' | 'numeric' | 'no-valid-candidate'; times: number }>;
  stopped: 'finished' | 'max-steps' | 'deadline' | 'stuck' | 'error';
  error?: string;
  tokens: number;
  ms: number;
}

export interface PlayOptions {
  players: number;
  seed?: number;
  maxSteps?: number;
  persona?: string;
  onTurn?: (t: TurnRecord) => void;
  signal?: AbortSignal;
}

function mulberry32(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A short human label for an action: its type plus its arguments. */
export function labelOf(a: Action): string {
  const args = Object.entries(a)
    .filter(([k, v]) => k !== 'type' && v !== undefined && v !== null && v !== '' && k !== 'reasoning')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  return [a.type.replace(/_/g, ' '), ...args].join(' · ').slice(0, 120);
}

/** Expand an advertised action into concrete candidates (examples × cards × targets). */
function expand(a: { type: string; examples?: Action[]; cards?: string[]; targets?: string[] }): Action[] {
  const base: Action[] = a.examples?.length ? a.examples.map((e) => ({ ...e, type: e.type ?? a.type })) : [{ type: a.type }];
  let out = [...base];
  if (a.cards?.length) {
    const tpl = base[0];
    const key = Object.keys(tpl).find((k) => /card/i.test(k) && typeof tpl[k] === 'string') ?? 'card';
    out.push(...a.cards.map((c) => ({ ...tpl, [key]: c })));
  }
  if (a.targets?.length) {
    const withTargets: Action[] = [];
    for (const c of out.slice(0, 40)) {
      const key = Object.keys(c).find((k) => a.targets!.includes(String(c[k]))) ?? (Object.keys(c).find((k) => /target/i.test(k)) ?? 'target');
      for (const t of a.targets) withTargets.push({ ...c, [key]: t });
    }
    out.push(...withTargets);
  }
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = JSON.stringify(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fieldsNeedingWords(a: Action): string[] {
  return Object.entries(a)
    .filter(([k, v]) => (FREE_TEXT.has(k) && (v === '' || v === undefined)) || (NUMERIC.has(k) && (v === 0 || v === '' || v === undefined)))
    .map(([k]) => k);
}

/** Action types a player may take when it isn't their turn (replies), served before the current player. */
const OFF_TURN = /(^|_)respond$/;

function scoresOf(state: { players: Record<string, { score?: number }> }): Record<string, number> {
  return Object.fromEntries(Object.entries(state.players).map(([p, s]) => [p, Number(s.score ?? 0)]));
}

/** What Jev sees on a turn: the player's own view with hidden things removed,
 *  and every number already computed. */
function turnState(state: Record<string, any>, pid: string, av: Record<string, any>, rulesDigest: string, recent: string[], maxTurns: number | null) {
  const me = state.players[pid] ?? {};
  const opponents = (state.turnOrder as string[])
    .filter((p) => p !== pid)
    .map((p) => {
      const o = state.players[p] ?? {};
      return { player: p, position: o.state, score: o.score ?? 0, cards_in_hand: (o.hand ?? []).length, eliminated: !!o.eliminated };
    });
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(av)) {
    if (['actions', 'playerId', 'isYourTurn', 'hand', 'currentState', 'placedCards', 'activeEffects'].includes(k)) continue;
    const s = JSON.stringify(v);
    if (s && s.length < 2500) extras[k] = v;
  }
  return {
    you: pid,
    round: state.round,
    turn: state.turnNumber,
    turns_left: maxTurns ? Math.max(maxTurns - state.turnNumber, 0) : undefined,
    your_position: av.currentState ?? me.state,
    your_score: me.score ?? 0,
    your_hand: (av.hand as string[] | undefined)?.slice(0, 20),
    cards_in_your_hand: (av.hand as string[] | undefined)?.length ?? 0,
    your_effects: (av.activeEffects as unknown[] | undefined)?.length ? av.activeEffects : undefined,
    ...extras,
    opponents,
    recent_moves: recent.slice(-6),
    rules: rulesDigest,
  };
}

/** The winning/gameplay parts of the prose, capped — accuracy falls with irrelevant state. */
function digest(markdown: string, winCondition: string): string {
  const sections = markdown.split(/\n(?=#{1,3} )/);
  const pick = sections.filter((s) => /win|victory|goal|objective|gameplay|turn|actions?/i.test(s.split('\n')[0] ?? ''));
  const text = (pick.length ? pick : sections).join('\n').replace(/\n{3,}/g, '\n\n');
  return `Win condition: ${winCondition}\n${text}`.slice(0, 2400);
}

export async function play(rules: string, decide: Decide | null, opts: PlayOptions): Promise<Session> {
  const t0 = Date.now();
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const maxSteps = opts.maxSteps ?? 300;
  const slot = newSlot();
  const { config, markdown } = load(rules, slot);
  const cfg = config as unknown as { win_condition?: string; max_turns?: number };
  const rulesDigest = digest(markdown, String(cfg.win_condition ?? ''));
  const rng = mulberry32(seed);
  const simRng = mulberry32(seed ^ 0x5bd1e995); // simulations never touch the game's own stream
  const E = <T,>(fn: () => T): T => withRng(rng, fn);
  const session: Session = { seed, players: opts.players, status: 'init', winner: null, endReason: null, turns: [], log: [], unsuitable: [], stopped: 'finished', tokens: 0, ms: 0 };
  const unsuitable = new Map<string, Session['unsuitable'][number]>();
  const note = (type: string, fields: string[], why: Session['unsuitable'][number]['why']) => {
    const k = `${type}:${why}`;
    const u = unsuitable.get(k) ?? { type, fields, why, times: 0 };
    u.times++;
    unsuitable.set(k, u);
  };
  const recent: string[] = [];
  let gameId = '';
  try {
    let s = E(() => initGame(slot, opts.players)) as unknown as Record<string, any>;
    gameId = s.gameId;
    E(() => startGame(gameId));
    s = E(() => loadState(gameId)) as unknown as Record<string, any>;
    for (let step = 1; s.status === 'in_progress' && step <= maxSteps; step++) {
      if (opts.signal?.aborted) throw Object.assign(new Error('stopped'), { name: 'AbortError' });
      // A player who must answer something off-turn (a trade offered to them) goes first.
      const responder = (s.turnOrder as string[]).find((p) => p !== s.currentPlayer && (E(() => getAvailableActions(s as never, p)) as unknown as { actions: Array<{ type: string; enabled: boolean }> }).actions.some((a) => a.enabled && OFF_TURN.test(a.type)));
      const pid = responder ?? (s.currentPlayer as string);
      const av = E(() => getAvailableActions(s as never, pid)) as unknown as Record<string, any>;
      const offered = (av.actions as Array<Record<string, any>>).filter((a) => a.enabled && a.type !== 'resign' && (!responder || OFF_TURN.test(a.type)));

      // code enumerates, the engine's validator masks, Jev chooses
      const valid: Action[] = [];
      for (const a of offered) {
        const cands = expand(a as never).filter((c) => !c.declareVictory);
        let ok = 0;
        for (const c of cands.slice(0, 300)) {
          const words = fieldsNeedingWords(c);
          if (words.length) {
            note(c.type, words, words.some((w) => FREE_TEXT.has(w)) ? 'free-text' : 'numeric');
            continue;
          }
          if ((E(() => validateAction(s as never, pid, c as never)) as { valid: boolean }).valid) {
            valid.push(c);
            ok++;
          }
        }
        if (!ok && a.type !== 'pass' && cands.length) note(a.type, Object.keys(a.required ?? {}), 'no-valid-candidate');
      }
      const facts = decide && valid.length > 1 ? consequences(s, pid, valid, slot, simRng) : new Map<Action, string>();
      const picks = dedupeLabels(valid)
        .slice(0, 255)
        .map((p) => (facts.has(p.action) ? { ...p, label: `${p.label} [${facts.get(p.action)}]`.slice(0, 200) } : p));

      let chosen: { action: Action; label: string };
      let rec: Pick<TurnRecord, 'confidence' | 'top' | 'ahead' | 'ms' | 'tokens' | 'fallback'> = { confidence: null, top: [], ahead: null, ms: 0, tokens: 0 };
      if (!picks.length) {
        session.stopped = 'stuck';
        session.error = `${pid} had no valid move at step ${step}`;
        break;
      } else if (picks.length === 1 || !decide) {
        chosen = picks.length === 1 ? picks[0] : picks[Math.floor(rng() * picks.length)];
        if (!decide && picks.length > 1) rec.fallback = 'random (no Jev)';
      } else {
        const persona = opts.persona ? ` Play as a ${opts.persona} player.` : '';
        const q: Questions = {
          move: { type: 'choice', instructions: responder ? `You are ${pid}, answering off-turn. Which reply gives you the best chance of winning this game?${persona}` : `You are ${pid}. Which move gives you the best chance of winning this game?${persona}`, criteria: Object.fromEntries(picks.map((p) => [p.label, null])) },
          ahead: { type: 'noul', instructions: `Is ${pid} currently ahead of every opponent?` },
        };
        try {
          const r = await decide(turnState(s, pid, av, rulesDigest, recent, cfg.max_turns ?? null), q, `turn ${step} · ${pid}`);
          const m = r.answers.move;
          chosen = picks.find((p) => p.label === m?.choice) ?? picks[0];
          if (!m?.choice || !picks.some((p) => p.label === m.choice)) rec.fallback = 'Jev gave no usable choice';
          rec = {
            ...rec,
            confidence: m?.confidence ?? null,
            top: Object.entries(m?.probabilities ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3),
            ahead: r.answers.ahead?.noul ?? null,
            ms: r.ms,
            tokens: r.tokens,
          };
          session.tokens += r.tokens;
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
          chosen = picks[Math.floor(rng() * picks.length)];
          rec.fallback = `Jev error: ${(e as Error).message}`;
        }
      }

      const at = { round: s.round, turn: s.turnNumber }; // before the action can end the turn
      E(() => executeAction(s as never, pid, chosen.action as never));
      recent.push(`${pid}: ${chosen.label}`);
      const next = E(() => loadState(gameId)) as unknown as Record<string, any>;
      const t: TurnRecord = {
        step,
        round: at.round,
        turn: at.turn,
        player: pid,
        offered: offered.length,
        valid: picks.length,
        forced: picks.length === 1,
        label: chosen.label,
        action: chosen.action,
        ...rec,
        scores: scoresOf(next as never),
      };
      session.turns.push(t);
      opts.onTurn?.(t);
      s = next;
      if (step === maxSteps && s.status === 'in_progress') session.stopped = 'max-steps';
    }
    session.status = s.status;
    session.winner = (s.winner as string) ?? (s.shared?.winner as string) ?? null;
    session.endReason = (s.endReason as string) ?? (s.shared?.endReason as string) ?? null;
  } catch (e) {
    session.stopped = (e as Error).name === 'AbortError' ? 'deadline' : 'error';
    session.error = (e as Error).message;
  }
  const logs = filesUnder(`/pt/games/${slot}/logs/`);
  session.log = Object.values(logs)
    .flatMap((txt) => txt.split('\n').filter(Boolean))
    .map((l) => {
      try {
        return JSON.parse(l) as Record<string, unknown>;
      } catch {
        return { raw: l };
      }
    });
  const end = [...session.log].reverse().find((e) => /game_end|pending_analysis|game_over|win/i.test(String(e.event)));
  if (!session.endReason && end) session.endReason = String((end.data as Record<string, unknown> | undefined)?.reason ?? end.event);
  session.unsuitable = [...unsuitable.values()];
  resetPrefix(`/pt/games/${slot}/`);
  session.ms = Date.now() - t0;
  return session;
}

function dedupeLabels(actions: Action[]): Array<{ action: Action; label: string }> {
  const used = new Map<string, number>();
  return actions.map((action) => {
    let label = labelOf(action);
    const n = used.get(label) ?? 0;
    used.set(label, n + 1);
    if (n) label = `${label} (${n + 1})`;
    return { action, label };
  });
}

/* ── judge ────────────────────────────────────────────────────────────── */

export interface Metrics {
  steps: number;
  finished: boolean;
  stopped: Session['stopped'];
  winner: string | null;
  endReason: string | null;
  rounds: number;
  forcedShare: number;
  meanValid: number;
  meanConfidence: number | null;
  fallbackShare: number;
  actionMix: Record<string, number>;
  dominantAction: [string, number] | null;
  leadChanges: number;
  finalScores: Record<string, number>;
  tokens: number;
  usd: number;
}

export function metrics(s: Session): Metrics {
  const n = s.turns.length || 1;
  const mix: Record<string, number> = {};
  for (const t of s.turns) mix[t.action.type] = (mix[t.action.type] ?? 0) + 1;
  const dom = Object.entries(mix).sort((a, b) => b[1] - a[1])[0];
  let leader = '';
  let leadChanges = 0;
  for (const t of s.turns) {
    const top = Object.entries(t.scores).sort((a, b) => b[1] - a[1]);
    if (top.length > 1 && top[0][1] > top[1][1] && top[0][0] !== leader) {
      if (leader) leadChanges++;
      leader = top[0][0];
    }
  }
  const confs = s.turns.map((t) => t.confidence).filter((c): c is number => c != null);
  return {
    steps: s.turns.length,
    finished: s.status === 'pending_analysis' || s.status === 'completed',
    stopped: s.stopped,
    winner: s.winner,
    endReason: s.endReason,
    rounds: s.turns.at(-1)?.round ?? 0,
    forcedShare: s.turns.filter((t) => t.forced).length / n,
    meanValid: s.turns.reduce((a, t) => a + t.valid, 0) / n,
    meanConfidence: confs.length ? confs.reduce((a, c) => a + c, 0) / confs.length : null,
    fallbackShare: s.turns.filter((t) => t.fallback).length / n,
    actionMix: mix,
    dominantAction: dom ? [dom[0], dom[1] / n] : null,
    leadChanges,
    finalScores: s.turns.at(-1)?.scores ?? {},
    tokens: s.tokens,
    usd: +(s.tokens * 0.042e-6).toFixed(4),
  };
}

export interface Judgement {
  health: { verdict: string | null; confidence: number | null; probabilities: Record<string, number> };
  decisive: number | null;
  agency: number | null;
  pacing: number | null;
  endedByRule: number | null;
  runaway: number | null;
  /** Qualitative critique: each dimension 0–4 (higher is better), plus what most hurts,
   *  what works, and which kind of change would most improve it (top 3, with probability). */
  critique?: Critique;
  tokens: number;
}

export interface Critique {
  dims: Record<string, number | null>;
  /** mean of dims / 4: the critique's 0–1 index */
  index: number | null;
  weakest: Array<[string, number]>;
  strongest: Array<[string, number]>;
  fixes: Array<[string, number]>;
}

/** Five ordered levels per dimension, worst → best (Jev's score type: expected level 0–4). */
export const CRITIQUE: Array<{ key: string; name: string; ask: string; levels: [string, string, string, string, string] }> = [
  { key: 'fun', name: 'fun', ask: 'How much fun would this session have been for the people playing it?', levels: ['a chore', 'dull', 'mildly fun', 'fun', 'a blast'] },
  { key: 'engagement', name: 'engagement', ask: 'How engaged would players stay from start to finish — invested in every turn, including other players\' turns?', levels: ['checked out', 'mostly idle', 'on and off', 'engaged', 'gripped throughout'] },
  { key: 'dynamism', name: 'dynamism', ask: 'How dynamic was the game — did the situation, board and standings keep changing, or was it static?', levels: ['static', 'sluggish', 'some movement', 'lively', 'constantly shifting'] },
  { key: 'tension', name: 'tension', ask: 'How much tension and uncertainty about the outcome was there until the end?', levels: ['foregone', 'little doubt', 'some suspense', 'tense', 'nail-biting'] },
  { key: 'decisions', name: 'meaningful decisions', ask: 'How meaningful and interesting were the decisions — real trade-offs with visible consequences?', levels: ['no real decisions', 'obvious choices', 'some trade-offs', 'interesting', 'agonising, rich choices'] },
  { key: 'depth', name: 'strategic depth', ask: 'How much strategic depth was there — planning ahead, combining actions, reading opponents?', levels: ['none', 'shallow', 'moderate', 'deep', 'very deep'] },
  { key: 'diversity', name: 'diversity', ask: 'How diverse was the play — different actions, paths to victory and ways each player played?', levels: ['one-note', 'repetitive', 'somewhat varied', 'varied', 'richly varied'] },
  { key: 'interaction', name: 'player interaction', ask: 'How much did players meaningfully affect each other (trading, blocking, competing, cooperating)?', levels: ['multiplayer solitaire', 'slight', 'some', 'a lot', 'constant, meaningful'] },
  { key: 'pace', name: 'pace', ask: 'How well paced was it — momentum, build-up and a climax, without stretches of nothing happening?', levels: ['stalled', 'dragging or rushed', 'uneven', 'well paced', 'excellent arc'] },
  { key: 'balance', name: 'balance & fairness', ask: 'How fair and balanced did it look — roles, seats and powers giving everyone a real chance?', levels: ['badly lopsided', 'unfair', 'somewhat fair', 'fair', 'finely balanced'] },
  { key: 'theme', name: 'theme', ask: 'How well did what happened in play express the game\'s theme and story?', levels: ['theme absent', 'pasted on', 'partly felt', 'thematic', 'immersive'] },
  { key: 'coherence', name: 'rules coherence', ask: 'How coherently did the rules work in play — every mechanic doing its job, nothing broken, ignored or pointless?', levels: ['broken', 'many gaps', 'some gaps', 'mostly coherent', 'fully coherent'] },
  { key: 'goals', name: 'goal clarity', ask: 'How clear and reachable were the players\' goals, and did play visibly move toward them?', levels: ['no visible progress', 'unclear', 'partly', 'clear', 'clear and compelling'] },
  { key: 'comeback', name: 'comeback potential', ask: 'Could a player who fell behind still recover and win?', levels: ['never', 'rarely', 'sometimes', 'often', 'always in reach'] },
  { key: 'replay', name: 'replayability', ask: 'How much would players want to play again — would another game play out differently?', levels: ['never again', 'unlikely', 'maybe', 'likely', 'eagerly'] },
  { key: 'elegance', name: 'elegance', ask: 'How elegant was it — much interesting play from few, clear rules, no fiddly overhead?', levels: ['clunky', 'fiddly', 'acceptable', 'clean', 'elegant'] },
];

export const CRITIQUE_FIXES = [
  'fix broken or missing mechanics',
  'make the goals reachable within the game',
  'shorten the game',
  'lengthen the game',
  'add more player interaction',
  'curb a dominant move or strategy',
  'give more meaningful choices each turn',
  'add catch-up or comeback',
  'add hidden information or uncertainty',
  'rebalance roles or powers',
  'strengthen the theme',
  'simplify the rules',
];

const top3 = (p: Record<string, number> | undefined): Array<[string, number]> =>
  Object.entries(p ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => [k, +v.toFixed(3)]);

/** The whole game, one line per round: what each player did (runs of the same move collapsed). */
function playByRound(s: Session, maxChars = 24000): string[] {
  const rounds = new Map<number, Map<string, string[]>>();
  for (const t of s.turns) {
    const r = rounds.get(t.round) ?? (rounds.set(t.round, new Map()), rounds.get(t.round)!);
    const moves = r.get(t.player) ?? (r.set(t.player, []), r.get(t.player)!);
    moves.push(t.label.replace(/ \(\d+\)$/, '').slice(0, 70));
  }
  const lines = [...rounds].map(([n, per]) => `R${n}: ` + [...per].map(([p, ms]) => `${p}: ${collapse(ms).join('; ')}`).join(' | '));
  let total = lines.reduce((a, l) => a + l.length, 0);
  if (total <= maxChars) return lines;
  // Too long: keep the opening and the ending, which carry the arc.
  const head: string[] = [];
  const tail: string[] = [];
  total = 0;
  for (let i = 0, j = lines.length - 1; i <= j; i++, j--) {
    if (total + lines[i].length > maxChars / 2 + maxChars / 2) break;
    head.push(lines[i]);
    total += lines[i].length;
    if (i !== j && total + lines[j].length <= maxChars) {
      tail.unshift(lines[j]);
      total += lines[j].length;
    }
  }
  return [...head, `… ${lines.length - head.length - tail.length} rounds omitted …`, ...tail];
}
function collapse(ms: string[]): string[] {
  const out: string[] = [];
  for (const m of ms) {
    const last = out.at(-1);
    const hit = last && /^(.*) ×(\d+)$/.exec(last);
    if (last === m) out[out.length - 1] = `${m} ×2`;
    else if (hit && hit[1] === m) out[out.length - 1] = `${m} ×${Number(hit[2]) + 1}`;
    else out.push(m);
  }
  return out;
}

const HEALTH = ['plays as designed', 'ends too early', 'never reaches an end', 'broken: moves missing or stuck', 'degenerate: one move dominates'];

/** How many turns saw the same player act more than once (engine turn number). */
export function multiActionTurns(s: Session): { turns: number; worst: number } {
  const per = new Map<string, number>();
  for (const t of s.turns) per.set(`${t.turn}:${t.player}`, (per.get(`${t.turn}:${t.player}`) ?? 0) + 1);
  const multi = [...per.values()].filter((n) => n > 1);
  return { turns: multi.length, worst: multi.length ? Math.max(...multi) : 1 };
}

export async function judge(c: Classification, s: Session, decide: Decide): Promise<{ judgement: Judgement; findings: Finding[] }> {
  const m = metrics(s);
  const state = {
    game: c.name,
    stated_win_condition: c.winCondition,
    players: s.players,
    finished: m.finished,
    how_it_stopped: m.stopped,
    end_reason: m.endReason,
    winner: m.winner,
    moves_played: m.steps,
    rounds: m.rounds,
    share_of_turns_with_only_one_legal_move: +m.forcedShare.toFixed(2),
    average_legal_moves_per_turn: +m.meanValid.toFixed(1),
    move_type_mix: Object.fromEntries(Object.entries(m.actionMix).map(([k, v]) => [k, `${Math.round((v / (m.steps || 1)) * 100)}%`])),
    lead_changes: m.leadChanges,
    final_scores: m.finalScores,
    moves_the_engine_could_not_offer: s.unsuitable.map((u) => `${u.type} (${u.why})`),
    last_moves: s.turns.slice(-8).map((t) => `${t.player}: ${t.label}`),
    engine_events: Object.entries(s.log.reduce<Record<string, number>>((c, e) => ((c[String(e.event ?? e.type ?? 'other')] = (c[String(e.event ?? e.type ?? 'other')] ?? 0) + 1), c), {}))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([k, v]) => `${k} ×${v}`),
    rules: (c.rulesText ?? '').slice(0, 8000),
    // What the classifier already knows the engine lacks for these rules (so the judge can
    // tell rules that were played from rules that silently did nothing).
    known_engine_gaps: c.findings.filter((f) => f.severity !== 'info').slice(0, 30).map((f) => `${f.kind}: ${f.subject} — ${f.detail.slice(0, 140)}`),
    play_by_round: playByRound(s),
  };
  const critiqueQs = Object.fromEntries(
    CRITIQUE.map((d) => [`c_${d.key}`, { type: 'score' as const, instructions: `${d.ask} Judge the game as it actually played in this record.`, criteria: d.levels }]),
  );
  const r = await decide(
    state,
    {
      health: { type: 'choice', instructions: 'Judging from this playtest record, which best describes the game?', criteria: Object.fromEntries(HEALTH.map((h) => [h, null])) },
      decisive: { type: 'score', instructions: 'How decisive was the result?', criteria: ['no clear result', 'narrow', 'clear', 'crushing'] },
      agency: { type: 'score', instructions: 'How much real choice did players have on a typical turn?', criteria: ['almost none', 'a little', 'some', 'a lot'] },
      pacing: { type: 'score', instructions: 'How was the length of the game for what happened in it?', criteria: ['far too short', 'short', 'about right', 'long', 'far too long'] },
      endedByRule: { type: 'noul', instructions: 'Did the game end because a player met the stated win condition (not a turn limit, a stall or an error)?' },
      runaway: { type: 'noul', instructions: 'Did one player take the lead early and keep it to the end?' },
      ...critiqueQs,
      c_weakest: { type: 'choice', instructions: 'As a game designer reviewing this playtest, which is the game\'s biggest weakness?', criteria: Object.fromEntries(CRITIQUE.map((d) => [d.name, null])) },
      c_strongest: { type: 'choice', instructions: 'As a game designer reviewing this playtest, which is the game\'s greatest strength?', criteria: Object.fromEntries(CRITIQUE.map((d) => [d.name, null])) },
      c_fix: { type: 'choice', instructions: 'As a game designer, which single kind of change would most improve this game?', criteria: Object.fromEntries(CRITIQUE_FIXES.map((f) => [f, null])) },
    },
    'judge: session',
  );
  const a = r.answers;
  const judgement: Judgement = {
    health: { verdict: a.health?.choice ?? null, confidence: a.health?.confidence ?? null, probabilities: a.health?.probabilities ?? {} },
    decisive: a.decisive?.score ?? null,
    agency: a.agency?.score ?? null,
    pacing: a.pacing?.score ?? null,
    endedByRule: a.endedByRule?.noul ?? null,
    runaway: a.runaway?.noul ?? null,
    critique: critiqueOf(a),
    tokens: r.tokens,
  };
  return { judgement, findings: sessionFindings(s, m, c) };
}

function critiqueOf(a: Record<string, { score?: number; probabilities?: Record<string, number> } | undefined>): Critique {
  const dims = Object.fromEntries(CRITIQUE.map((d) => [d.key, typeof a[`c_${d.key}`]?.score === 'number' ? +(a[`c_${d.key}`]!.score as number).toFixed(3) : null]));
  const vals = Object.values(dims).filter((v): v is number => v !== null);
  return {
    dims,
    index: vals.length ? +(vals.reduce((x, y) => x + y, 0) / vals.length / 4).toFixed(4) : null,
    weakest: top3(a.c_weakest?.probabilities),
    strongest: top3(a.c_strongest?.probabilities),
    fixes: top3(a.c_fix?.probabilities),
  };
}

/** Engine- and balance-level findings from the computed record alone. */
export function sessionFindings(s: Session, m = metrics(s), c?: Classification): Finding[] {
  const out: Finding[] = [];
  const multi = multiActionTurns(s);
  if (multi.turns && c && !c.multiActionEngine && (c.ruleChecks.oneActionPerTurn ?? 0) >= 0.6) {
    out.push({ kind: 'engine', severity: 'error', subject: 'more than one action per turn', detail: `the prose limits a turn to one action (p ${c.ruleChecks.oneActionPerTurn.toFixed(2)}), but ${multi.turns} turn(s) saw a player act more than once (up to ${multi.worst}×) — the engine didn't end the turn` });
  } else if (multi.turns && c && !c.multiActionEngine) {
    out.push({ kind: 'engine', severity: 'info', subject: 'several actions per turn', detail: `${multi.turns} turn(s) had a player act more than once (up to ${multi.worst}×) with no action-point mechanic` });
  }
  if (s.stopped === 'error') out.push({ kind: 'engine', severity: 'error', subject: 'engine error', detail: s.error ?? 'unknown' });
  if (s.stopped === 'stuck') out.push({ kind: 'engine', severity: 'error', subject: 'no legal move', detail: s.error ?? 'a player had no valid move' });
  if (s.stopped === 'max-steps') out.push({ kind: 'balance', severity: 'warn', subject: 'never ended', detail: `still in progress after ${m.steps} moves (round ${m.rounds})` });
  if (m.finished && m.rounds <= 1) out.push({ kind: 'engine', severity: 'error', subject: 'instant end', detail: `ended in round ${m.rounds} after ${m.steps} move(s): ${m.endReason ?? 'no reason logged'} — a win check is firing too early` });
  if (m.dominantAction && m.dominantAction[1] > 0.7 && m.steps > 10) out.push({ kind: 'balance', severity: 'warn', subject: `${m.dominantAction[0]} dominates`, detail: `${Math.round(m.dominantAction[1] * 100)}% of all moves` });
  if (m.forcedShare > 0.6 && m.steps > 10) out.push({ kind: 'balance', severity: 'info', subject: 'few real choices', detail: `${Math.round(m.forcedShare * 100)}% of turns had exactly one legal move` });
  for (const u of s.unsuitable) {
    out.push({
      kind: 'unsuitable-action',
      severity: u.why === 'no-valid-candidate' ? 'warn' : 'info',
      subject: u.type,
      detail:
        u.why === 'free-text'
          ? `needs words (${u.fields.join(', ')}) — Jev can judge text but not write it; not yet playable by System One`
          : u.why === 'numeric'
            ? `needs an amount (${u.fields.join(', ')}) — offer bucketed amounts to make it playable`
            : `advertised ${u.times}× but none of its examples validated — the engine's action advert doesn't match what it accepts`,
    });
  }
  return out;
}
