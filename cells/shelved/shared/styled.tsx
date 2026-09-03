import * as React from 'react';

type Base = keyof React.JSX.IntrinsicElements | React.ComponentType<any>;
type StyledComponent = React.ComponentType<any> & { __styledClass?: string; toString(): string };

const injected = new Set<string>();

/**
 * Class names are derived from the RULE TEXT, not from a counter.
 *
 * They used to be `sv-${++sequence}`, i.e. module evaluation order — and the
 * server and client bundles do not share an import graph (the server renders
 * the first-paint tree; the browser loads the whole app). So `.sv-1` was
 * BrandNav's nav in one bundle and something else entirely in the other, which
 * meant the server's stylesheet painted the wrong elements and hydration saw a
 * className mismatch on every node. Content-derived ids are identical wherever
 * the module is evaluated, in any order, which is the property SSR needs.
 *
 * Two components with byte-identical CSS now share a class. That is fine —
 * they are the same rule — and it is why the collision guard below only kicks
 * in for a genuine hash clash between DIFFERENT text.
 */
function hashCss(css: string): string {
  let h = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < css.length; i++) {
    h ^= css.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const byId = new Map<string, string>();
function classFor(css: string): string {
  const base = `sv-${hashCss(css)}`;
  let id = base;
  let n = 1;
  while (byId.has(id) && byId.get(id) !== css) id = `${base}-${++n}`;
  byId.set(id, css);
  return id;
}

/**
 * Every rule this module has defined, in definition order.
 *
 * Recorded when the styled component is CREATED, not when it first renders.
 * Ids are content-derived (see `classFor`), so this sheet is identical in the
 * server and client bundles even though they evaluate different module graphs.
 * Render-time collection would only ever capture the branches one request
 * happened to take, so a conditional section would arrive unstyled; and on a
 * warm Lambda it would carry over whatever the previous request rendered,
 * making the CSS depend on traffic. Definition order is deterministic and
 * complete — the whole sheet is a few KB, so there is nothing to gain by
 * trimming it and a flash of unstyled content to lose.
 */
const rules: Array<{ id: string; css: string }> = [];

/** The sheet, for server rendering. `install` still does the DOM half client-side. */
export function collectStyles(): string {
  return rules.map((r) => `.${r.id}{${r.css}}`).join('\n');
}

function cssText(strings: TemplateStringsArray, values: unknown[]): string {
  return strings.reduce((out, part, index) => {
    const value = values[index];
    const rendered = value && typeof value === 'object' && '__styledClass' in (value as object)
      ? `.${(value as StyledComponent).__styledClass}`
      : typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : typeof value === 'function' && (value as StyledComponent).__styledClass
          ? `.${(value as StyledComponent).__styledClass}`
          : '';
    return out + part + rendered;
  }, '');
}

function install(id: string, css: string): void {
  if (typeof document === 'undefined' || injected.has(id)) return;
  injected.add(id);
  const style = document.createElement('style');
  style.dataset.shelvedStyle = id;
  style.textContent = `.${id}{${css}}`;
  document.head.appendChild(style);
}

function template(base: Base) {
  return (strings: TemplateStringsArray, ...values: unknown[]): StyledComponent => {
    const css = cssText(strings, values);
    const id = classFor(css);
    if (!rules.some((r) => r.id === id)) rules.push({ id, css });
    const Component = React.forwardRef<any, Record<string, unknown>>((props, ref) => {
      install(id, css);
      const forwarded: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) if (!key.startsWith('$') && key !== 'className') forwarded[key] = value;
      forwarded.ref = ref;
      forwarded.className = [id, props.className].filter(Boolean).join(' ');
      return React.createElement(base, forwarded);
    }) as StyledComponent;
    Component.__styledClass = id;
    Component.toString = () => `.${id}`;
    return Component;
  };
}

const factory = ((base: Base) => template(base)) as ((base: Base) => ReturnType<typeof template>) & Record<string, ReturnType<typeof template>>;
export const styled = new Proxy(factory, { get: (_target, tag: string) => template(tag as keyof React.JSX.IntrinsicElements) });
export default styled;

export function createGlobalStyle(strings: TemplateStringsArray, ...values: unknown[]) {
  const css = cssText(strings, values);
  return function GlobalStyle(): React.JSX.Element { return <style data-shelved-global="true">{css}</style>; };
}

export function ThemeProvider({ children }: { theme?: unknown; children: React.ReactNode }): React.JSX.Element {
  return <>{children}</>;
}
