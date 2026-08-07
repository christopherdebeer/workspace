/**
 * The schema-form FLOOR (ADR-0041 Inc 2) — the input twin of `render-hints.ts`.
 * Where `render-hints` turns a fact's value into a body by its declared render
 * hint, `SchemaForm` turns a capability's `inputSchema` (JSON Schema) into
 * editable fields — so a human fills a capability's arguments the way an agent
 * does (typed JSON), without hand-writing JSON. Pure presentation: the caller
 * owns the value (a plain `Record<string, unknown>`) and is handed back a new
 * one on every change — no internal state, so it composes with any surface's
 * own state management (the field computer, a future fact create/edit form).
 *
 * Scope: flat-ish shapes (scalars, enums, booleans, arrays of scalars, nested
 * objects one level deep). A field whose schema this doesn't recognise (a
 * `oneOf`/`anyOf`/`$ref`, an array of objects, …) degrades to a small per-field
 * raw-JSON box — never blocks the form, never silently drops the field. This is
 * deliberately NOT a full JSON-Schema implementation; it covers the shapes
 * `read`/`act` targets actually use (confirmed against the live catalog) and
 * degrades gracefully past that, the same floor/ceiling shape as the hint
 * vocabulary (a few built-in kinds + an escape hatch).
 *
 * A React module (unlike the dependency-free `render-hints.ts`/`vocab.ts`) —
 * forms are inherently stateful/interactive, so this sits beside `index.tsx`
 * (platform/ui's other React half) rather than the string-only modules. No
 * untrusted code ever runs here (it only interprets a JSON-Schema *value*, an
 * inert data structure) — unlike a `ui://` renderer, a schema form needs no
 * sandbox (ADR-0041 Inc 1's security note doesn't apply to this file).
 */
import * as React from 'react';

export interface FormFieldSchema {
  type?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: FormFieldSchema;
  properties?: Record<string, FormFieldSchema>;
  required?: string[];
}

export interface FormPalette {
  text: string;
  dim: string;
  border: string;
  inputBg: string;
  accent: string;
  danger: string;
  mono: string;
  sans: string;
}

/** The home/card "park" palette — the default if a caller doesn't supply its own. */
export const DEFAULT_FORM_PALETTE: FormPalette = {
  text: '#332e23',
  dim: '#85795f',
  border: '#ddd2b8',
  inputBg: '#fffef9',
  accent: '#2e5e43',
  danger: '#b5523c',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
};

/** A scalar/enum/boolean/simple-array field — rendered as a real control. */
function fieldFormable(s: FormFieldSchema | undefined): boolean {
  if (!s || !s.type) return false;
  if (s.type === 'string' || s.type === 'number' || s.type === 'integer' || s.type === 'boolean') return true;
  if (s.type === 'array') return !s.items?.type || ['string', 'number', 'integer'].includes(s.items.type);
  return false;
}

/** Does this top-level schema have a shape `SchemaForm` can walk at all? */
export function isFormable(schema: FormFieldSchema | undefined): boolean {
  return !!schema && schema.type === 'object' && !!schema.properties;
}

/** A surface-supplied renderer for LONG string fields (content/text/body/…).
 *  The upgrade seam for a real editor (@parc/ui CodeEditor) over the 3-row
 *  textarea floor — injected so plain forms stay dependency-light. */
export type LongTextRenderer = (props: { name: string; value: string; onChange: (v: string | undefined) => void }) => React.ReactNode;

export interface SchemaFormProps {
  schema: FormFieldSchema | undefined;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  palette?: Partial<FormPalette>;
  /** Optional long-text field upgrade (see `LongTextRenderer`). */
  longText?: LongTextRenderer;
}

/** Render every property of an object schema as a field; unrenderable shapes
 *  degrade per-field (see `FieldRow`). Returns `null` if the top-level schema
 *  itself isn't a formable object — the caller's own raw-JSON view is the
 *  fallback for that case (e.g. a target with no `properties` at all). */
export function SchemaForm({ schema, value, onChange, palette, longText }: SchemaFormProps): React.JSX.Element | null {
  if (!isFormable(schema)) return null;
  const p: FormPalette = { ...DEFAULT_FORM_PALETTE, ...palette };
  const props = schema!.properties!;
  const required = new Set(schema!.required ?? []);
  const set = (k: string, v: unknown): void => {
    const next = { ...value };
    if (v === undefined) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  return (
    <div style={{ display: 'grid', gap: '0.7rem' }}>
      {Object.entries(props).map(([key, fs]) => (
        <FieldRow key={key} name={key} schema={fs} required={required.has(key)} value={value[key]} onChange={(v) => set(key, v)} palette={p} longText={longText} />
      ))}
    </div>
  );
}

function FieldRow({
  name,
  schema,
  required,
  value,
  onChange,
  palette: p,
  longText,
}: {
  name: string;
  schema: FormFieldSchema;
  required: boolean;
  value: unknown;
  onChange: (v: unknown) => void;
  palette: FormPalette;
  longText?: LongTextRenderer;
}): React.JSX.Element {
  const label = (
    <label style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', flexWrap: 'wrap', fontFamily: p.mono, fontSize: '0.78rem', color: p.dim }}>
      <span>
        {name}
        {required ? <span style={{ color: p.danger }}>*</span> : null}
      </span>
      {schema.description ? <span style={{ fontFamily: p.sans, fontSize: '0.72rem', color: p.dim, fontWeight: 400 }}>{schema.description}</span> : null}
    </label>
  );
  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.5rem 0.6rem',
    background: p.inputBg,
    border: `1px solid ${p.border}`,
    borderRadius: 6,
    color: p.text,
    fontSize: '0.88rem',
    fontFamily: p.sans,
  };

  if (schema.enum && schema.enum.length) {
    return (
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        {label}
        <select value={value == null ? '' : String(value)} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          <option value="" disabled>
            select…
          </option>
          {schema.enum.map((opt) => (
            <option key={String(opt)} value={String(opt)}>
              {String(opt)}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (!fieldFormable(schema)) {
    // Unsupported shape (nested object / oneOf / anyOf / $ref / array-of-objects)
    // — a per-field raw-JSON box. Never blocks the rest of the form.
    const text = value === undefined ? '' : JSON.stringify(value);
    return (
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        {label}
        <textarea
          defaultValue={text}
          rows={2}
          spellCheck={false}
          placeholder="raw JSON"
          onBlur={(e) => {
            const t = e.target.value.trim();
            try {
              onChange(t ? (JSON.parse(t) as unknown) : undefined);
            } catch {
              /* leave the field's typed-but-invalid text; user is still editing */
            }
          }}
          style={{ ...inputStyle, fontFamily: p.mono, fontSize: '0.78rem' }}
        />
      </div>
    );
  }
  if (schema.type === 'boolean') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: p.accent }} />
        <span style={{ fontFamily: p.mono, fontSize: '0.82rem', color: p.text }}>
          {name}
          {required ? <span style={{ color: p.danger }}>*</span> : null}
        </span>
        {schema.description ? <span style={{ fontSize: '0.72rem', color: p.dim }}>— {schema.description}</span> : null}
      </label>
    );
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        {label}
        <input
          type="number"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          style={inputStyle}
        />
      </div>
    );
  }
  if (schema.type === 'array') {
    const arr = Array.isArray(value) ? value : [];
    const isNum = schema.items?.type === 'number' || schema.items?.type === 'integer';
    return (
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        {label}
        <input
          type="text"
          defaultValue={arr.join(', ')}
          placeholder="comma-separated"
          onBlur={(e) => {
            const parts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
            onChange(parts.length ? (isNum ? parts.map(Number) : parts) : undefined);
          }}
          style={inputStyle}
        />
      </div>
    );
  }
  // string (default) — a longer-looking field (a description, content, prompt)
  // gets the surface's long-text editor when injected, else the textarea floor.
  const long = name === 'content' || name === 'text' || name === 'prompt' || name === 'body' || name === 'description' || (schema.description?.length ?? 0) > 100;
  return (
    <div style={{ display: 'grid', gap: '0.25rem' }}>
      {label}
      {long && longText ? (
        <div style={{ ...inputStyle, padding: 0 }}>{longText({ name, value: typeof value === 'string' ? value : '', onChange: (v) => onChange(v || undefined) })}</div>
      ) : long ? (
        <textarea value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} rows={3} style={inputStyle} />
      ) : (
        <input type="text" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)} style={inputStyle} />
      )}
    </div>
  );
}
