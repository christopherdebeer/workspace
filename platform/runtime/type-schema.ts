/**
 * Type schemas — the shape contract a type declares (docs/type-vocabulary.md).
 *
 * A type can say which fields its facts carry and which are recommended. This is
 * **advisory**: validation never blocks a write. It produces *hints* that nudge a
 * fact (missing a recommended field) or a type (no schema yet, but its facts have
 * structure) toward improvement — the substrate suggests, it does not enforce.
 *
 * Two declaration shapes are understood, so existing prose schemas keep working:
 *  - structured: `{ fields: [{ name, type?, required?, description? }] }`
 *  - legacy map: `{ schema: { <name>: "type? — prose" } }`, where a `?` on the
 *    leading type token (or the word "optional"/"DEPRECATED") marks it optional;
 *    every other field is treated as recommended.
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'markdown' | 'ref';

/**
 * Resolve a type's declaration (ADR-0001 type-kind resolve / breathe Wave 5): the
 * canonical (cell-declared) decl with the slice `_types/<type>` override merged
 * **per facet** — the flat decl's top-level keys (icon/label/manager/handlers/
 * schema/render/…) ARE its facets, so a shallow merge is the per-facet merge, and
 * the slice wins. One resolver for every consumer (gateway `$types`, `remember`,
 * the backbone), replacing the two divergent merges (gateway wholesale-replaced;
 * `remember` shallow-merged — this unifies them on the per-facet form).
 */
export function mergeTypeDecl(canonical: unknown, slice: unknown): Record<string, unknown> {
  const c = canonical && typeof canonical === 'object' && !Array.isArray(canonical) ? (canonical as Record<string, unknown>) : {};
  const s = slice && typeof slice === 'object' && !Array.isArray(slice) ? (slice as Record<string, unknown>) : {};
  return { ...c, ...s };
}

export interface FieldSpec {
  name: string;
  /** Best-effort primitive expectation. */
  type?: FieldType;
  /** A recommended field — its absence is hinted, never rejected. */
  required?: boolean;
  /** Human note (the legacy prose becomes this). */
  description?: string;
  /** `ref` fields: the value(s) are fact keys → an embedded Reference rule (ADR-0003). */
  list?: boolean;
  /** `ref` fields: the edge relation to emit (default: the field name). */
  rel?: string;
}

const TYPE_TOKENS = new Set<FieldType>(['string', 'number', 'boolean', 'object', 'array', 'markdown', 'ref']);

/** Pull the human clause out of a legacy prose field (`"string — the X"` → `the X`). */
function prose(s: string): string {
  const after = s.split(/[—–-]/).slice(1).join('-').trim();
  return after || s.trim();
}

/** Parse a type declaration into field specs, or `null` when it declares no schema. */
export function parseTypeSchema(decl: unknown): FieldSpec[] | null {
  if (!decl || typeof decl !== 'object') return null;
  const d = decl as Record<string, unknown>;

  if (Array.isArray(d.fields)) {
    const fields = d.fields
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as { name?: unknown }).name === 'string')
      .map((f): FieldSpec => ({
        name: f.name as string,
        type: typeof f.type === 'string' && TYPE_TOKENS.has(f.type as FieldType) ? (f.type as FieldType) : undefined,
        required: f.required === true,
        description: typeof f.description === 'string' ? f.description : undefined,
        ...(f.list === true ? { list: true } : {}),
        ...(typeof f.rel === 'string' ? { rel: f.rel } : {}),
      }));
    return fields.length ? fields : null;
  }

  const schema = d.schema;
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    const fields: FieldSpec[] = [];
    for (const [name, v] of Object.entries(schema as Record<string, unknown>)) {
      if (typeof v !== 'string') {
        fields.push({ name, required: false });
        continue;
      }
      const token = v.trim().split(/[\s—–-]/)[0].toLowerCase();
      const optional = token.includes('?') || /\b(optional|deprecated)\b/i.test(v);
      const base = token.replace('?', '') as FieldType;
      fields.push({
        name,
        type: TYPE_TOKENS.has(base) ? base : undefined,
        required: !optional,
        description: prose(v),
      });
    }
    return fields.length ? fields : null;
  }
  return null;
}

const isEmpty = (x: unknown): boolean => x == null || x === '' || (Array.isArray(x) && x.length === 0);

/** Recommended fields absent (or empty) in `value`. */
export function missingRequired(value: unknown, fields: FieldSpec[]): FieldSpec[] {
  const o = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return fields.filter((f) => f.required && isEmpty(o[f.name]));
}

/**
 * Advisory hints for remembering a fact of `type` with `value`, given the type's
 * declaration (or `undefined` when the type isn't declared). Never blocks; an
 * empty array means "nothing to suggest".
 *
 *  - schema present → one hint per missing recommended field;
 *  - no schema but a structured value → a single nudge that the type could
 *    declare a schema (so future facts can be validated).
 */
export function schemaHints(opts: { type?: string | null; value: unknown; fields: FieldSpec[] | null; declared?: boolean }): string[] {
  const { type, value, fields, declared } = opts;
  if (!type) return [];
  if (fields) {
    return missingRequired(value, fields).map(
      (f) => `Fact of type "${type}" is missing recommended field "${f.name}"${f.description ? ` — ${f.description}` : ''}.`,
    );
  }
  const structured = !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length > 0;
  if (structured) {
    return [
      `Type "${type}" has no schema${declared ? '' : ' (and is undeclared)'} — declaring its fields (and which are required) would let remember validate facts like this.`,
    ];
  }
  return [];
}

/**
 * The Type object (ADR-0002): one Declaration resolved into its **facets**. A flat
 * decl's top-level keys *are* its facets, so this is a typed view over the merged
 * decl (`mergeTypeDecl`), not a second source. Consumers read a facet (a form reads
 * `shape.fields`; `remember` validates against it; the backbone reads `manager`;
 * a surface reads `present`/`handlers`) instead of re-deriving from the raw decl.
 */
export interface Type {
  /** The type name, when known. */
  kind?: string;
  /** Owning cell address (→ backbone `managedBy`). */
  manager?: string;
  /** What its facts contain (validation · form · Reference inputs). */
  shape: { fields: FieldSpec[] | null; keyPattern?: string; keyEdges?: KeyEdge[] };
  /** How a fact of this kind looks. */
  present: { icon?: string; label?: string; render?: unknown };
  /** The affordance table (open/edit/create/render/embed → surface|act|renderer|hint). */
  handlers?: Record<string, unknown>;
  /** Whether any declaration backed this resolve (vs a bare/undeclared type). */
  declared: boolean;
}

/** A key-encoded Reference rule (ADR-0003): from a `keyPattern` match, emit an edge.
 *  Endpoints/rel are `{group}` captures or literals. */
export interface KeyEdge {
  from: string;
  rel: string;
  to: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function keyEdgesOf(v: unknown): KeyEdge[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter(
    (e): e is KeyEdge => !!e && typeof e === 'object' && typeof (e as KeyEdge).from === 'string' && typeof (e as KeyEdge).rel === 'string' && typeof (e as KeyEdge).to === 'string',
  );
  return out.length ? out : undefined;
}

/** Resolve a (merged) declaration into the typed `Type` facets. Pure. */
export function resolveType(decl: unknown, kind?: string): Type {
  const d = decl && typeof decl === 'object' && !Array.isArray(decl) ? (decl as Record<string, unknown>) : {};
  return {
    kind,
    manager: str(d.manager),
    shape: { fields: parseTypeSchema(d), keyPattern: str(d.keyPattern), keyEdges: keyEdgesOf(d.keyEdges) },
    present: {
      icon: str(d.icon),
      label: str(d.label) ?? str(d.titlePath),
      render: d.render ?? (str(d.viewer) ? { viewer: d.viewer } : undefined),
    },
    handlers: d.handlers && typeof d.handlers === 'object' ? (d.handlers as Record<string, unknown>) : undefined,
    declared: Object.keys(d).length > 0,
  };
}
