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

export interface FieldSpec {
  name: string;
  /** Best-effort primitive expectation. */
  type?: FieldType;
  /** A recommended field — its absence is hinted, never rejected. */
  required?: boolean;
  /** Human note (the legacy prose becomes this). */
  description?: string;
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
export function schemaHints(opts: { type?: string | null; value: unknown; decl?: unknown }): string[] {
  const { type, value, decl } = opts;
  if (!type) return [];
  const fields = parseTypeSchema(decl);
  if (fields) {
    return missingRequired(value, fields).map(
      (f) => `Fact of type "${type}" is missing recommended field "${f.name}"${f.description ? ` — ${f.description}` : ''}.`,
    );
  }
  const structured = !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length > 0;
  if (structured) {
    const declared = !!decl && typeof decl === 'object';
    return [
      `Type "${type}" has no schema${declared ? '' : ' (and is undeclared)'} — declaring its fields (and which are required) would let remember validate facts like this.`,
    ];
  }
  return [];
}
