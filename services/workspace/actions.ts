/**
 * Declarative actions — the runtime, no-code vocabulary tier (v1).
 *
 * sync's proof, brought to the substrate (see
 * `docs/declarative-actions-vs-code-cells.md`): an action is **data, not
 * code** — `{ if, enabled, writes[], params }` stored as a fact in the
 * caller's slice (key `_actions/<id>`) and applied by this small, fixed
 * interpreter. Because the write footprint is *declared*, it is bounded,
 * auditable before execution, and contested-target detection is a registry
 * scan — none of which opaque code can offer.
 *
 * v1 deliberately used a **structured condition DSL** instead of CEL — total,
 * decidable, no dependency — with the same shape everywhere (`if`, `enabled`).
 * The CEL upgrade (this version) keeps that stored model and adds `cel`: a
 * condition may carry a CEL expression instead of an `op`, evaluated over
 * `{ params, self, now, key, exists, value }` — the fact fetch stays declared
 * (`key`), only the predicate over it gets a real expression language. Parse
 * errors surface at registration; a non-boolean result fails the condition.
 *
 * Template substitution (`${params.x}`, `${self}`, `${now}`) is single-pass
 * (no re-expansion of substituted content) in keys and string values.
 * Combined with per-write `ifAbsent` + `timer`, this expresses sync's
 * canonical task-queue claim: an atomic, lease-bound, crash-safe hand-off.
 */
import { evaluate as celEvaluate, parse as celParse } from '@marcbachmann/cel-js';
import type { Identity } from '../../platform/runtime';
import type { ObservedState, Entry, FactTimer } from '../../platform/runtime';

/** Reserved key prefix where a slice's declared vocabulary lives. */
export const ACTIONS_PREFIX = '_actions/';

// ── the declared model ─────────────────────────────────────────────

/**
 * A decidable predicate. Two forms share the shape:
 *   - structured: `{ key, op, path?, value? }` (v1 — still supported)
 *   - CEL:        `{ cel, key? }` — `cel` evaluates over
 *     `{ params, self, now, key?, exists?, value? }`; when `key` is given the
 *     fact is fetched (live view) and bound as `exists`/`value`.
 */
export interface DeclaredCondition {
  /** Fact key to test (supports `${params.*}`/`${self}` substitution). */
  key?: string;
  /** Optional dot-path into the fact's value (e.g. "status" or "meta.owner"). */
  path?: string;
  op?: 'exists' | 'absent' | 'eq' | 'ne' | 'gt' | 'lt';
  /** Comparison operand for eq/ne/gt/lt. */
  value?: unknown;
  /** CEL expression — must evaluate to a boolean. */
  cel?: string;
}

export interface DeclaredWrite {
  /** Target fact key (supports substitution). */
  key: string;
  /** Value to write (strings/objects support substitution). */
  value?: unknown;
  /** CAS: only write if the key does not (live-)exist — the atomic claim. */
  ifAbsent?: boolean;
  /** Lease/reveal timer on the written fact. */
  timer?: FactTimer;
  type?: string;
  tags?: string[];
}

export interface ParamSpec {
  type?: 'string' | 'number' | 'boolean' | 'object' | 'any';
  description?: string;
  enum?: unknown[];
  required?: boolean;
}

export interface ActionDefinition {
  id: string;
  description?: string;
  /** Preconditions (AND'd). A failed `if` is a precondition_failed error. */
  if?: DeclaredCondition[];
  /** Availability (AND'd). A disabled action cannot be invoked. */
  enabled?: DeclaredCondition[];
  writes: DeclaredWrite[];
  params?: Record<string, ParamSpec>;
}

export interface RegisterResult {
  action: ActionDefinition;
  /** Other registered actions declaring the same write-target template. */
  contested: Array<{ target: string; actions: string[] }>;
}

export interface InvokeResult {
  invoked: true;
  action: string;
  params: Record<string, unknown>;
  writes: Array<{ key: string } & Entry>;
}

// ── substitution (single-pass, injection-safe) ─────────────────────

const SUBST = /\$\{(params\.([A-Za-z0-9_]+)|self|now)\}/g;

function substituteString(s: string, params: Record<string, unknown>, self: string, now: string): string {
  return s.replace(SUBST, (match, full: string, paramName: string | undefined) => {
    if (paramName !== undefined) {
      const v = params[paramName];
      return v === undefined || v === null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
    }
    if (full === 'self') return self;
    if (full === 'now') return now;
    return match;
  });
}

function substituteDeep(v: unknown, params: Record<string, unknown>, self: string, now: string): unknown {
  if (typeof v === 'string') {
    // A string that is exactly one placeholder keeps the param's JSON type.
    const exact = /^\$\{params\.([A-Za-z0-9_]+)\}$/.exec(v);
    if (exact) return params[exact[1]] ?? null;
    return substituteString(v, params, self, now);
  }
  if (Array.isArray(v)) return v.map((x) => substituteDeep(x, params, self, now));
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = substituteDeep(x, params, self, now);
    return out;
  }
  return v;
}

// ── condition evaluation ───────────────────────────────────────────

function resolvePath(value: unknown, path?: string): unknown {
  if (!path) return value;
  let cur: unknown = value;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const VALID_OPS = new Set(['exists', 'absent', 'eq', 'ne', 'gt', 'lt']);

function validateConditions(field: string, conds: DeclaredCondition[] | undefined): void {
  if (conds === undefined) return;
  if (!Array.isArray(conds)) throw new Error(`\`${field}\` must be an array of conditions`);
  for (const c of conds) {
    if (typeof c?.cel === 'string') {
      // CEL form: parse now so a broken expression can never be registered.
      try {
        celParse(c.cel);
      } catch (err) {
        throw new Error(`\`${field}\` condition has invalid CEL: ${(err as Error).message}`);
      }
      if (c.key !== undefined && typeof c.key !== 'string') {
        throw new Error(`\`${field}\` condition \`key\` must be a string`);
      }
      continue;
    }
    if (!c?.key || typeof c.key !== 'string') throw new Error(`\`${field}\` condition requires a string \`key\``);
    if (!c.op || !VALID_OPS.has(c.op)) throw new Error(`\`${field}\` condition op must be one of ${[...VALID_OPS].join('/')}`);
    if ((c.op === 'eq' || c.op === 'ne' || c.op === 'gt' || c.op === 'lt') && c.value === undefined) {
      throw new Error(`\`${field}\` condition op "${c.op}" requires a \`value\``);
    }
  }
}

async function evaluateCondition(
  state: ObservedState,
  scope: string,
  c: DeclaredCondition,
  params: Record<string, unknown>,
  self: string,
  now: string,
): Promise<{ holds: boolean; detail: string }> {
  if (typeof c.cel === 'string') {
    // CEL form: the fact fetch stays declared; the predicate is an expression.
    const bindings: Record<string, unknown> = { params, self, now };
    let at = c.cel;
    if (c.key) {
      const key = substituteString(c.key, params, self, now);
      const entry = await state.get(scope, key);
      const present = entry !== null && !entry._meta.superseded;
      bindings.key = key;
      bindings.exists = present;
      bindings.value = present ? entry!.value : null;
      at = `"${key}": ${c.cel}`;
    }
    try {
      const out = celEvaluate(c.cel, bindings);
      // String(), not JSON.stringify — CEL ints are BigInt, which JSON rejects.
      return { holds: out === true, detail: `${at} → ${String(out)}` };
    } catch (err) {
      return { holds: false, detail: `${at} → error: ${(err as Error).message}` };
    }
  }
  const key = substituteString(c.key!, params, self, now);
  const entry = await state.get(scope, key); // live view: timers/supersession respected
  const present = entry !== null && !entry._meta.superseded;
  if (c.op === 'exists') return { holds: present, detail: `"${key}" ${present ? 'exists' : 'is absent'}` };
  if (c.op === 'absent') return { holds: !present, detail: `"${key}" ${present ? 'exists' : 'is absent'}` };
  const actual = present ? resolvePath(entry.value, c.path) : undefined;
  const expected = substituteDeep(c.value, params, self, now);
  const at = c.path ? `"${key}".${c.path}` : `"${key}"`;
  switch (c.op) {
    case 'eq':
      return { holds: JSON.stringify(actual) === JSON.stringify(expected), detail: `${at} = ${JSON.stringify(actual)}` };
    case 'ne':
      return { holds: JSON.stringify(actual) !== JSON.stringify(expected), detail: `${at} = ${JSON.stringify(actual)}` };
    case 'gt':
      return { holds: typeof actual === 'number' && typeof expected === 'number' && actual > expected, detail: `${at} = ${JSON.stringify(actual)}` };
    case 'lt':
      return { holds: typeof actual === 'number' && typeof expected === 'number' && actual < expected, detail: `${at} = ${JSON.stringify(actual)}` };
    default:
      // Unreachable for registered actions (validateConditions enforces a form).
      return { holds: false, detail: `${at} has no evaluable predicate` };
  }
}

// ── the interpreter ────────────────────────────────────────────────

export class ActionInvokeError extends Error {
  constructor(
    readonly code: 'precondition_failed' | 'action_disabled' | 'invalid_param' | 'not_found',
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'ActionInvokeError';
  }
}

function validateDefinition(def: ActionDefinition): void {
  if (!def?.id || typeof def.id !== 'string') throw new Error('action requires a string `id`');
  if (def.id.includes('/')) throw new Error('action `id` must not contain "/"');
  if (!Array.isArray(def.writes) || def.writes.length === 0) throw new Error('action requires a non-empty `writes` array');
  for (const w of def.writes) {
    if (!w?.key || typeof w.key !== 'string') throw new Error('every write requires a string `key`');
    if (w.key.startsWith(ACTIONS_PREFIX)) throw new Error('a declared action may not write the `_actions/` vocabulary');
  }
  validateConditions('if', def.if);
  validateConditions('enabled', def.enabled);
}

/**
 * Provenance options for a registration. Caller registration uses the
 * defaults (`via: 'registerAction'`, untagged); an **organ** registering its
 * own cell-required vocabulary passes its address as `via` and tags the fact
 * `cell-required`, so it reads as part of the cell's program (refreshed on
 * redeploy) rather than organic, caller-authored vocabulary.
 */
export interface RegisterOptions {
  via?: string;
  tags?: string[];
}

export interface DeclarativeActions {
  register(scope: string, def: ActionDefinition, identity?: Identity, opts?: RegisterOptions): Promise<RegisterResult>;
  list(scope: string): Promise<ActionDefinition[]>;
  remove(scope: string, id: string, identity?: Identity): Promise<{ ok: true }>;
  invoke(scope: string, id: string, params: Record<string, unknown>, identity?: Identity): Promise<InvokeResult>;
}

export function createDeclarativeActions(state: ObservedState): DeclarativeActions {
  async function loadAll(scope: string): Promise<ActionDefinition[]> {
    const res = await state.query(scope, { prefix: ACTIONS_PREFIX, rankBy: 'recency' });
    return res.entries.map((e) => e.value as ActionDefinition).filter((d): d is ActionDefinition => !!d?.id);
  }

  return {
    async register(scope, def, identity, opts): Promise<RegisterResult> {
      validateDefinition(def);
      // Contested-target detection: declared writes make conflict a registry
      // scan — surfaced, not blocked (sync's stance: hold the tension visibly).
      const existing = (await loadAll(scope)).filter((d) => d.id !== def.id);
      const targets: Record<string, string[]> = {};
      for (const other of existing) {
        for (const w of other.writes) (targets[w.key] ??= []).push(other.id);
      }
      const contested: RegisterResult['contested'] = [];
      for (const w of def.writes) {
        if (targets[w.key]?.length) contested.push({ target: w.key, actions: [...targets[w.key], def.id] });
      }
      await state.put(
        { scope, key: `${ACTIONS_PREFIX}${def.id}`, value: def, via: opts?.via ?? 'registerAction', type: 'action', tags: opts?.tags },
        identity,
      );
      return { action: def, contested };
    },

    list(scope): Promise<ActionDefinition[]> {
      return loadAll(scope);
    },

    async remove(scope, id, identity): Promise<{ ok: true }> {
      const entry = await state.get(scope, `${ACTIONS_PREFIX}${id}`);
      if (!entry || entry._meta.superseded) throw new ActionInvokeError('not_found', `action "${id}" not found`);
      await state.supersede(scope, `${ACTIONS_PREFIX}${id}`, null, identity);
      return { ok: true };
    },

    async invoke(scope, id, params, identity): Promise<InvokeResult> {
      const entry = await state.get(scope, `${ACTIONS_PREFIX}${id}`);
      if (!entry || entry._meta.superseded) throw new ActionInvokeError('not_found', `action "${id}" not found`);
      const def = entry.value as ActionDefinition;
      const self = identity?.user ?? '';
      const now = new Date().toISOString();
      const args = params ?? {};

      // Validate params against the declared schema.
      for (const [name, spec] of Object.entries(def.params ?? {})) {
        const v = args[name];
        if (v === undefined) {
          if (spec.required) throw new ActionInvokeError('invalid_param', `param "${name}" is required`);
          continue;
        }
        if (spec.type && spec.type !== 'any' && typeof v !== spec.type) {
          throw new ActionInvokeError('invalid_param', `param "${name}" must be a ${spec.type}`);
        }
        if (spec.enum && !spec.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) {
          throw new ActionInvokeError('invalid_param', `param "${name}" must be one of ${JSON.stringify(spec.enum)}`);
        }
      }

      // Availability, then precondition — both decidable, both explained.
      for (const c of def.enabled ?? []) {
        const r = await evaluateCondition(state, scope, c, args, self, now);
        if (!r.holds) throw new ActionInvokeError('action_disabled', `enabled condition failed: ${r.detail}`);
      }
      for (const c of def.if ?? []) {
        const r = await evaluateCondition(state, scope, c, args, self, now);
        if (!r.holds) throw new ActionInvokeError('precondition_failed', `if condition failed: ${r.detail}`);
      }

      // Apply the declared writes in order. Writes are not atomic as a batch
      // (sync's own caveat); per-write `ifAbsent` is the atomic claim.
      const written: InvokeResult['writes'] = [];
      for (const w of def.writes) {
        const key = substituteString(w.key, args, self, now);
        const value = substituteDeep(w.value, args, self, now);
        const result = await state.put(
          {
            scope,
            key,
            value,
            via: `action:${id}`,
            type: w.type,
            tags: w.tags,
            ifAbsent: w.ifAbsent,
            timer: w.timer,
          },
          identity,
        );
        written.push({ key, ...result });
      }
      return { invoked: true, action: id, params: args, writes: written };
    },
  };
}
