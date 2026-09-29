/* ---------------------------------------------------------------------------
 * The public, read-only view (GET /api/*) behind the landing page. Anyone may
 * read it: game definitions, eval scores, climb rounds, the mechanics catalogue
 * and the change log. Never: the Jev token, or anything about a held-out
 * (test) run beyond its score — the same rule the MCP tools keep.
 * ------------------------------------------------------------------------- */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { writeFileSync, resetPrefix } from '../engine/shims/fs';
import { parseRules, loadMechanicsIndex } from '../engine/core/rules';
import { mechanicRegistry } from '../engine/mechanics/index';
import { CONSUMED_KEYS } from '../engine/consumed-keys';
import { SEED_FILES } from '../engine/shims/data';
import { PRESETS } from '../engine/presets';
import VENDOR from '../engine/vendor-info';
import { engineFingerprint, changedMechanics } from './fingerprint';
import { publicEval, type EvalRecord } from './evaluate';
import { SCORE_VERSION } from './score';
import { HANDLED_EFFECTS, newSlot } from './runner';
import * as db from './store';

const OWNER = process.env.CELL_OWNER ?? 'c15r';
const CELL_ID = process.env.CELL_ID ?? '';
const SUBSTRATE = process.env.SUBSTRATE_TABLE ?? '';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const strip = <T extends db.Item>({ pk: _p, sk: _s, ...rest }: T) => rest;

/* ── what a definition declares ─────────────────────────────────────── */

export interface Declared {
  mechanics: string[];
  effects: string[];
  unhandledEffects: string[];
  name: string;
  error?: string;
}

const declaredCache = new Map<string, Declared>();
export function declared(rules: string): Declared {
  const key = db.hash(rules);
  const hit = declaredCache.get(key);
  if (hit) return hit;
  const slot = newSlot();
  let out: Declared;
  try {
    writeFileSync(`/pt/games/${slot}/RULES.md`, rules);
    const { config } = parseRules(`/pt/games/${slot}/RULES.md`);
    const cfg = config as unknown as { mechanics?: string[]; engine_mechanics?: Record<string, { deck?: Array<{ effect?: { type?: string } }> }>; deck?: Array<{ effect?: { type?: string } }>; name?: string };
    const mechanics = [...new Set([...(cfg.mechanics ?? []).map(String), ...Object.keys(cfg.engine_mechanics ?? {}).map((k) => k.replace(/_/g, '-'))])].sort();
    const deck = cfg.deck ?? cfg.engine_mechanics?.cards?.deck ?? [];
    const effects = [...new Set(deck.map((c) => c.effect?.type).filter((t): t is string => !!t))].sort();
    out = { mechanics, effects, unhandledEffects: effects.filter((e) => !HANDLED_EFFECTS.has(e)), name: String(cfg.name ?? '') };
  } catch (e) {
    out = { mechanics: [], effects: [], unhandledEffects: [], name: '', error: (e as Error).message };
  } finally {
    resetPrefix(`/pt/games/${slot}/`);
  }
  declaredCache.set(key, out);
  return out;
}

/* ── games ──────────────────────────────────────────────────────────── */

async function evalSeries(slug: string) {
  return (await db.query(`GAME#${slug}`, 'EVAL#')).map(strip);
}

export async function games() {
  const list = await db.listGames();
  return Promise.all(
    list.map(async (g) => {
      const evals = await evalSeries(g.slug);
      const latest = evals.at(-1);
      const best = evals.reduce<Record<string, any> | null>((b, e) => (!b || Number(e.train) > Number(b.train) ? e : b), null);
      const rounds = (await db.query(`GAME#${g.slug}`, 'ROUND#')).map(strip);
      const { pk: _p, sk: _s, ...base } = g;
      return {
        ...base,
        evals: evals.length,
        latest: latest ? { train: latest.train, test: latest.test, version: latest.version, engine: latest.engine, at: latest.createdAt } : null,
        bestTrain: best ? { train: best.train, test: best.test, version: best.version } : null,
        kept: rounds.filter((r) => r.decision === 'kept').length,
        reverted: rounds.filter((r) => r.decision === 'reverted').length,
      };
    }),
  );
}

export async function game(slug: string) {
  const g = await db.getGame(slug);
  if (!g) return null;
  const [defs, evals, rounds, suite] = await Promise.all([db.query(`GAME#${slug}`, 'DEF#'), evalSeries(slug), db.query(`GAME#${slug}`, 'ROUND#'), db.getSuite(slug)]);
  const head = defs.find((d) => d.version === g.head);
  return {
    game: strip(g),
    head: head ? { version: head.version, rules: head.rules, rationale: head.rationale, status: head.status, hash: head.hash, createdAt: head.createdAt, declared: declared(String(head.rules)) } : null,
    versions: defs.map((d) => ({ version: d.version, parent: d.parent, status: d.status, rationale: d.rationale, author: d.author, hash: d.hash, createdAt: d.createdAt })),
    evals,
    rounds: rounds.map(strip),
    suite: { ...suite, hash: db.suiteHash(suite) },
    engine: engineFingerprint().version,
  };
}

export async function definition(slug: string, version: number) {
  const d = await db.get(`GAME#${slug}`, `DEF#${db.pad(version)}`);
  return d ? { ...strip(d), declared: declared(String(d.rules)) } : null;
}

export async function evalView(id: string) {
  const e = (await db.get(`EVAL#${id}`, 'meta')) as EvalRecord | undefined;
  return e ? publicEval(e) : null;
}

export async function runView(id: string, view: string, from = 0) {
  const meta = (await db.get(`RUN#${id}`, 'meta')) as (db.Item & { split?: string; chunks?: number; score?: number }) | undefined;
  if (!meta) return null;
  if (meta.split === 'test') return { id, split: 'test', score: meta.score, heldOut: true };
  const { chunks, ...summary } = strip(meta);
  if (view === 'summary') return summary;
  const blob = await db.getBlob<{ session: { turns: Array<Record<string, any>>; log: unknown[] }; findings: unknown; judgement: unknown }>(`RUN#${id}`, Number(chunks ?? 0));
  if (!blob) return summary;
  return {
    ...summary,
    findings: blob.findings,
    turns: blob.session.turns.slice(from, from + 300).map((t) => ({ step: t.step, round: t.round, turn: t.turn, player: t.player, valid: t.valid, forced: t.forced, move: t.label, confidence: t.confidence, runnerUp: t.top?.[1] ?? null, ahead: t.ahead, fallback: t.fallback })),
    totalTurns: blob.session.turns.length,
  };
}

/* ── mechanics ──────────────────────────────────────────────────────── */

/** Engine versions (by index) where every shared mechanic's hash changed at once: the
 *  fingerprint method or the bundling changed, not the mechanics (no real edit touches all). */
function rehashed(engines: db.Item[]): Set<number> {
  const out = new Set<number>();
  for (let i = 1; i < engines.length; i++) {
    const a = (engines[i - 1].mechanics as Record<string, string>) ?? {};
    const b = (engines[i].mechanics as Record<string, string>) ?? {};
    const shared = Object.keys(a).filter((k) => k in b);
    if (shared.length > 20 && shared.every((k) => a[k] !== b[k])) out.add(i);
  }
  return out;
}

interface RegisteredData {
  mechanics: Record<string, { config_key?: string; description?: string; since?: string; requires?: string[] }>;
  partial?: Record<string, { notes?: string }>;
}
const REGISTERED = JSON.parse(SEED_FILES['/pt/shared/registered-mechanics.json']) as RegisteredData;

export async function mechanics() {
  const index = loadMechanicsIndex() as unknown as { mechanics: Array<{ slug: string; name: string; category: string; id?: string }> };
  const meta = new Map(mechanicRegistry.getAllMechanicsMetadata().map((m) => [m.slug, m]));
  const fp = engineFingerprint();
  const engines = (await db.query('ENGINE')).sort((a, b) => String(a.firstSeen).localeCompare(String(b.firstSeen)));
  const rehash = rehashed(engines);
  const backlog = (await db.query('BACKLOG')).map((b) => ({ ...strip(b), games: b.games instanceof Set ? [...b.games] : b.games })) as Array<Record<string, any>>;

  // Usage: which stored games (head definitions) and catalogue presets declare each mechanic.
  const usage = new Map<string, { games: string[]; presets: string[] }>();
  const use = (slug: string) => usage.get(slug) ?? (usage.set(slug, { games: [], presets: [] }), usage.get(slug)!);
  for (const g of await db.listGames()) {
    const d = await db.getDefinition(g.slug);
    if (d) for (const m of declared(d.rules).mechanics) use(m).games.push(g.slug);
  }
  for (const [p, rules] of Object.entries(PRESETS)) for (const m of declared(rules).mechanics) use(m).presets.push(p);

  const slugs = new Set<string>([...index.mechanics.map((m) => m.slug), ...meta.keys(), ...usage.keys()]);
  const byDoc = new Map(index.mechanics.map((m) => [m.slug, m]));
  const rows = [...slugs].sort().map((slug) => {
    const doc = byDoc.get(slug);
    const impl = meta.get(slug);
    const reg = REGISTERED.mechanics[slug];
    const partial = REGISTERED.partial?.[slug];
    const key = slug.replace(/-/g, '_');
    const status = partial ? 'partial' : impl ? 'implemented' : CONSUMED_KEYS.has(key) ? 'engine-flag' : 'not-implemented';
    // Engine versions in which this mechanic's code changed.
    const changedIn: Array<{ engine: string; at: string }> = [];
    for (let i = 1; i < engines.length; i++) {
      if (rehash.has(i)) continue;
      const a = (engines[i - 1].mechanics as Record<string, string>) ?? {};
      const b = (engines[i].mechanics as Record<string, string>) ?? {};
      if (a[slug] !== b[slug]) changedIn.push({ engine: String(engines[i].version), at: String(engines[i].firstSeen) });
    }
    const u = usage.get(slug) ?? { games: [], presets: [] };
    return {
      slug,
      name: impl?.name ?? doc?.name ?? slug,
      category: doc?.category ?? 'engine',
      source: doc ? (doc.id && /^\d+$/.test(String(doc.id)) ? 'boardgamegeek' : 'engine') : 'engine',
      status,
      description: reg?.description ?? impl?.description ?? partial?.notes ?? null,
      requires: impl?.requires ?? reg?.requires ?? [],
      hooks: impl?.hooks ?? [],
      configKey: impl?.configKey ?? (CONSUMED_KEYS.has(key) ? key : null),
      hash: fp.mechanics[slug] ?? null,
      changedIn,
      games: u.games,
      presets: u.presets,
      backlog: backlog.filter((b) => b.subject === slug).map((b) => ({ kind: b.kind, hits: b.hits, severity: b.severity, detail: b.detail })),
    };
  });
  const effects = new Map<string, { presets: string[]; handled: boolean }>();
  for (const [p, rules] of Object.entries(PRESETS)) for (const e of declared(rules).effects) (effects.get(e) ?? (effects.set(e, { presets: [], handled: HANDLED_EFFECTS.has(e) }), effects.get(e)!)).presets.push(p);
  const counts = rows.reduce<Record<string, number>>((c, r) => ((c[r.status] = (c[r.status] ?? 0) + 1), c), {});
  return {
    engine: { version: fp.version, core: fp.core, vendoredFrom: VENDOR },
    counts,
    categories: [...new Set(rows.map((r) => r.category))].sort(),
    mechanics: rows,
    effects: [...effects].map(([type, v]) => ({ type, ...v })).sort((a, b) => Number(a.handled) - Number(b.handled) || b.presets.length - a.presets.length),
    backlog: backlog.sort((a, b) => (Number(b.hits) || 0) * (b.games?.length ?? 1) - (Number(a.hits) || 0) * (a.games?.length ?? 1)).slice(0, 60),
  };
}

/* ── change log ─────────────────────────────────────────────────────── */

export interface Change {
  at: string;
  kind: 'deploy' | 'engine' | 'definition' | 'round' | 'eval';
  title: string;
  detail?: string;
  game?: string;
  ref?: string;
  outcome?: string;
}

/** This cell's deploy facts (the platform writes one per deploy, with the commit subject). */
async function deploys(): Promise<Change[]> {
  if (!SUBSTRATE || !CELL_ID) return [];
  try {
    const r = await ddb.send(new QueryCommand({ TableName: SUBSTRATE, KeyConditionExpression: 'pk = :pk AND begins_with(sk, :p)', ExpressionAttributeValues: { ':pk': `STATE#${OWNER}`, ':p': `KEY#cells/${CELL_ID}/deploy/` }, ScanIndexForward: false, Limit: 60 }));
    return (r.Items ?? [])
      .filter((i) => !i.superseded)
      .map((i) => {
        const v = (i.value ?? {}) as { summary?: string; description?: string; deployedAt?: string; version?: string; changes?: { counts?: { added?: number; modified?: number; removed?: number } }; source?: string };
        const c = v.changes?.counts;
        return { at: String(v.deployedAt ?? ''), kind: 'deploy' as const, title: String(v.summary ?? v.description ?? 'deploy'), detail: c ? `${c.added ?? 0} added · ${c.modified ?? 0} modified · ${c.removed ?? 0} removed` : undefined, ref: v.version };
      });
  } catch {
    return [];
  }
}

export async function changelog(limit = 150): Promise<Change[]> {
  const out: Change[] = [...(await deploys())];
  const engines = (await db.query('ENGINE')).sort((a, b) => String(a.firstSeen).localeCompare(String(b.firstSeen)));
  const rehash = rehashed(engines);
  engines.forEach((e, i) => {
    const changed = i ? changedMechanics((engines[i - 1].mechanics as Record<string, string>) ?? {}, (e.mechanics as Record<string, string>) ?? {}) : [];
    out.push({ at: String(e.firstSeen), kind: 'engine', title: i ? `engine ${e.version}` : `engine ${e.version} (first seen)`, detail: rehash.has(i) ? 're-fingerprinted: every mechanic hash changed at once (fingerprint method or bundling), not the mechanics — earlier baselines no longer match' : i ? (changed.length ? `mechanics changed: ${changed.slice(0, 12).join(', ')}${changed.length > 12 ? ` +${changed.length - 12}` : ''}` : 'core changed (no mechanic code changed)') : `${Object.keys((e.mechanics as object) ?? {}).length} mechanics`, ref: String(e.version) });
  });
  for (const g of await db.listGames()) {
    for (const d of await db.query(`GAME#${g.slug}`, 'DEF#')) {
      if (d.status === 'candidate' || d.status === 'reverted') continue; // rounds already say it
      out.push({ at: String(d.createdAt), kind: 'definition', game: g.slug, title: `${g.name} v${d.version}`, detail: String(d.rationale ?? ''), ref: `${g.slug}@${d.version}` });
    }
    for (const r of await db.query(`GAME#${g.slug}`, 'ROUND#')) {
      const dl = r.delta as { train: number; test: number };
      out.push({ at: String(r.createdAt), kind: 'round', game: g.slug, title: `${g.name} round ${r.round}: v${r.from} → v${r.to}`, detail: String(r.rationale ?? ''), outcome: `${r.decision} · train ${dl.train >= 0 ? '+' : ''}${dl.train} · test ${dl.test >= 0 ? '+' : ''}${dl.test}`, ref: `${g.slug}@${r.to}` });
    }
    for (const e of await db.query(`GAME#${g.slug}`, 'EVAL#')) {
      if (e.tag === 'propose') continue;
      out.push({ at: String(e.createdAt), kind: 'eval', game: g.slug, title: `${g.name} v${e.version} ${e.tag}`, outcome: `train ${e.train} · test ${e.test}`, ref: String(e.id) });
    }
  }
  return out.filter((c) => c.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

/* ── overview ───────────────────────────────────────────────────────── */

export async function overview() {
  const gs = await games();
  let tokens = 0;
  let runs = 0;
  let evals = 0;
  for (const g of gs) {
    for (const e of await db.query(`GAME#${g.slug}`, 'EVAL#')) {
      evals++;
      const full = (await db.get(`EVAL#${e.id}`, 'meta')) as EvalRecord | undefined;
      if (full) {
        tokens += full.tokens ?? 0;
        runs += (full.train?.runs?.length ?? 0) + (full.test?.n ?? 0);
      }
    }
  }
  const fp = engineFingerprint();
  return {
    cell: '@c15r/playtest',
    engine: { version: fp.version, mechanics: Object.keys(fp.mechanics).length, vendoredFrom: VENDOR },
    scoreVersion: SCORE_VERSION,
    totals: { games: gs.length, evals, runs, rounds: gs.reduce((a, g) => a + (g.climb?.rounds ?? 0), 0), kept: gs.reduce((a, g) => a + g.kept, 0), reverted: gs.reduce((a, g) => a + g.reverted, 0), jevTokens: tokens, usd: +(tokens * 0.042e-6).toFixed(3) },
    games: gs,
    presets: Object.keys(PRESETS),
    recent: (await changelog(12)),
  };
}
