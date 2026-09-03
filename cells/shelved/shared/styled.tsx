import * as React from 'react';

type Base = keyof React.JSX.IntrinsicElements | React.ComponentType<any>;
type StyledComponent = React.ComponentType<any> & { __styledClass?: string; toString(): string };

let sequence = 0;
const injected = new Set<string>();

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
    const id = `sv-${(++sequence).toString(36)}`;
    const css = cssText(strings, values);
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
