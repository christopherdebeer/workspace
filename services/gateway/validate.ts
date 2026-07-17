/**
 * Membrane input validation (wave-5, the W3f principle enforced centrally):
 * "a silently-ignored input is worse than an error." Every capability already
 * DECLARES its contract (`inputSchema` on the descriptor / cell tool); until
 * now nothing enforced it server-side — the MCP client validates only the
 * outer `{target, input}` envelope, so a mistyped or misnamed argument sailed
 * through and silently defaulted (live instance: `changes({since})` — the
 * real key is `sinceSeq` — returned the default page as if the filter had
 * applied). Two tiers, applied at the gateway dispatch choke point:
 *
 *  - VIOLATIONS (missing required key, wrong type, enum miss) → fail fast,
 *    with schema feedback in the error so the caller can self-correct.
 *  - UNRECOGNISED keys → the call proceeds (stale-schema clients and
 *    undocumented aliases must not break — the W3g lesson), but the result
 *    carries a warning so the caller KNOWS the key had no effect.
 *
 * The checker is a deliberately TOLERANT JSON-Schema subset: it only flags
 * what it is sure about (declared primitive types, enum, required, oneOf
 * where no branch fits) and passes anything it does not understand — a
 * false "invalid" would be worse than the silence it replaces.
 */

interface SchemaNode {
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  required?: string[];
  enum?: unknown[];
  oneOf?: SchemaNode[];
  items?: SchemaNode;
  additionalProperties?: unknown;
  description?: string;
}

export interface InputValidation {
  /** Hard contract violations — the dispatch should fail fast with these. */
  errors: string[];
  /** Keys the capability's contract does not know — warn, never block. */
  ignored: string[];
}

function jsonType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // string | number | boolean | object | undefined
}

/** One-line human description of what a subschema accepts. */
function expected(s: SchemaNode): string {
  if (s.enum) return s.enum.map((e) => JSON.stringify(e)).join(' | ');
  if (s.oneOf) return s.oneOf.map(expected).join(' | ');
  if (Array.isArray(s.type)) return s.type.join(' | ');
  return s.type ?? 'any';
}

/** Tolerant match: true unless the schema names a constraint the value clearly breaks. */
function matches(v: unknown, s: SchemaNode): boolean {
  if (s.enum) return s.enum.some((e) => e === v);
  if (s.oneOf) return s.oneOf.some((branch) => matches(v, branch));
  const t = s.type;
  if (!t) return true; // unconstrained (or a construct we don't model) — pass
  const got = jsonType(v);
  const one = (want: string): boolean =>
    want === got || (want === 'integer' && got === 'number') || (want === 'object' && got === 'object');
  if (Array.isArray(t)) return t.some(one);
  return one(t);
}

/**
 * Validate a capability input against its declared schema. `input` may be
 * undefined (a bare call) — required keys are still enforced, so a write verb
 * called with no input fails fast with its contract instead of deep in the
 * handler. Unknown-key detection only runs when the schema enumerates
 * `properties` (an open schema can't define "unrecognised").
 */
export function validateInput(input: unknown, schema: Record<string, unknown> | undefined): InputValidation {
  const out: InputValidation = { errors: [], ignored: [] };
  const s = schema as SchemaNode | undefined;
  if (!s || (s.type && s.type !== 'object')) return out; // only object contracts are modelled
  const props = s.properties;
  const obj = input === undefined || input === null ? {} : input;
  if (jsonType(obj) !== 'object') {
    out.errors.push(`input must be an object, got ${jsonType(obj)}`);
    return out;
  }
  const rec = obj as Record<string, unknown>;
  for (const k of s.required ?? []) {
    if (rec[k] === undefined) {
      const p = props?.[k];
      out.errors.push(`missing required \`${k}\`${p ? ` (${expected(p)})` : ''}`);
    }
  }
  if (!props) return out;
  for (const [k, v] of Object.entries(rec)) {
    if (v === undefined) continue;
    const p = props[k];
    if (!p) {
      out.ignored.push(k);
      continue;
    }
    if (!matches(v, p)) {
      out.errors.push(`\`${k}\` expects ${expected(p)}, got ${jsonType(v)}`);
    }
  }
  return out;
}

/** The accepted-keys list for schema feedback in errors/warnings. */
export function acceptedKeys(schema: Record<string, unknown> | undefined): string[] {
  const props = (schema as SchemaNode | undefined)?.properties;
  return props ? Object.keys(props) : [];
}

/**
 * Attach an unrecognised-key warning to an object result so the caller learns
 * the key had NO effect (the whole point — a silently-dropped filter reads as
 * "the filter applied and this is the answer"). Non-object results pass
 * through untouched — they have nowhere to carry a warning.
 */
export function withInputWarnings(result: unknown, ignored: string[], target: string, schema: Record<string, unknown> | undefined): unknown {
  if (!ignored.length) return result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const accepted = acceptedKeys(schema);
  const keys = ignored.map((k) => `\`${k}\``).join(', ');
  const warning =
    `input ${ignored.length === 1 ? 'key' : 'keys'} ${keys} ${ignored.length === 1 ? 'is' : 'are'} not part of "${target}"'s contract and had NO effect` +
    (accepted.length ? ` — accepted keys: ${accepted.join(', ')}` : '');
  return { ...(result as Record<string, unknown>), _inputWarnings: [warning] };
}
