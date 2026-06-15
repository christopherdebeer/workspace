/**
 * Shared, composable UI primitives for cell front-ends.
 *
 * Mobile-first React components with inline styles (no external CSS/build
 * coupling) so any cell can bundle them into its `client/` entry via esbuild.
 * Keep these presentational and dependency-free (React only) so they stay
 * reusable across cells.
 *
 * The visual language is "the park" (docs/home-cell.md): warm field-guide
 * paper by day, the dusk palette for scenery and the night variant. The one
 * deliberately dark surface is `CodeBlock` — the machine's voice stays a
 * little terminal, an object in the warm room.
 */
import * as React from 'react';

export const theme = {
  // Day paper (the default surface).
  bg: '#f3edde',
  panel: '#fdf9ef',
  border: '#ddd2b8',
  text: '#332e23',
  dim: '#85795f',
  accent: '#2e5e43', // pine
  danger: '#b5523c', // terracotta
  radius: 12,
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  serif: 'Iowan Old Style, Palatino, Georgia, "Times New Roman", serif',
  // The dusk palette (scenery, night variant, the icon's colours).
  dusk: '#0d2b33',
  duskDeep: '#081d24',
  pine: '#1e3b2c',
  gold: '#e8b04b',
  horizon: '#f3d27e',
  cream: '#fdf6d8',
  // Soft elevation for paper panels.
  shadow: '0 1px 2px rgba(67,56,33,0.08), 0 4px 16px rgba(67,56,33,0.07)',
} as const;

/** Full-bleed page background + centered, mobile-first column. */
export function Page({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: theme.bg,
        color: theme.text,
        fontFamily: theme.sans,
        padding: '1.25rem',
        boxSizing: 'border-box',
      }}
    >
      {/* `minmax(0, 1fr)` is load-bearing: a grid item's default min-width is
          `auto`, so a section with wide unbreakable content (a long URL, an
          inline pill) would otherwise stretch the column past the viewport and
          break mobile layout. Pinning the column to the available width forces
          such content to wrap or scroll within its own card. */}
      <main style={{ width: '100%', maxWidth: 760, margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1rem' }}>
        {children}
      </main>
    </div>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}): React.JSX.Element {
  return (
    <section
      style={{
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: theme.radius,
        boxShadow: theme.shadow,
        padding: '1.25rem',
        ...style,
      }}
    >
      {children}
    </section>
  );
}

export function Heading({
  children,
  sub,
}: {
  children: React.ReactNode;
  sub?: React.ReactNode;
}): React.JSX.Element {
  return (
    <header style={{ marginBottom: sub ? '0.75rem' : 0 }}>
      <h1 style={{ margin: 0, fontSize: '1.35rem', fontFamily: theme.serif, fontWeight: 600, letterSpacing: '0.01em' }}>
        {children}
      </h1>
      {sub ? <p style={{ margin: '0.3rem 0 0', color: theme.dim, fontSize: '0.9rem' }}>{sub}</p> : null}
    </header>
  );
}

export function Badge({
  children,
  tone = 'accent',
}: {
  children: React.ReactNode;
  tone?: 'accent' | 'danger' | 'dim';
}): React.JSX.Element {
  const color = tone === 'danger' ? theme.danger : tone === 'dim' ? theme.dim : theme.accent;
  return (
    <span
      style={{
        display: 'inline-block',
        fontSize: '0.72rem',
        fontFamily: theme.mono,
        color,
        border: `1px solid ${color}`,
        borderRadius: 999,
        padding: '0.1rem 0.5rem',
        whiteSpace: 'nowrap',
        background: 'rgba(255,253,246,0.5)',
      }}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  kind = 'primary',
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  kind?: 'primary' | 'secondary';
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '0.7rem',
        border: kind === 'primary' ? 'none' : `1px solid ${theme.border}`,
        borderRadius: 8,
        fontSize: '0.9rem',
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        background: kind === 'primary' ? theme.accent : theme.panel,
        color: kind === 'primary' ? theme.cream : theme.text,
        boxShadow: kind === 'primary' ? theme.shadow : 'none',
      }}
    >
      {children}
    </button>
  );
}

export function Anchor({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a href={href} style={{ color: theme.accent, textDecoration: 'none', fontWeight: 600 }}>
      {children}
    </a>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  onEnter?: () => void;
}): React.JSX.Element {
  return (
    <input
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onEnter) onEnter();
      }}
      style={{
        width: '100%',
        padding: '0.6rem',
        background: '#fffef9',
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        color: theme.text,
        fontSize: '0.95rem',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      }}
    />
  );
}

/** A labelled checkbox row with optional hint — used for scope selection. */
export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  hint?: React.ReactNode;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        gap: '0.6rem',
        alignItems: 'flex-start',
        padding: '0.6rem 0.7rem',
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        background: checked ? 'rgba(46,94,67,0.08)' : 'transparent',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: '0.15rem', accentColor: theme.accent }}
      />
      <span style={{ display: 'grid', gap: '0.15rem' }}>
        <span style={{ fontFamily: theme.mono, fontSize: '0.85rem' }}>{label}</span>
        {hint ? <span style={{ color: theme.dim, fontSize: '0.78rem' }}>{hint}</span> : null}
      </span>
    </label>
  );
}

/** The machine's voice: outputs keep a small dark terminal, deliberately. */
export function CodeBlock({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <pre
      style={{
        background: theme.duskDeep,
        border: `1px solid ${theme.pine}`,
        borderRadius: 8,
        padding: '0.75rem',
        margin: 0,
        overflowX: 'auto',
        fontFamily: theme.mono,
        fontSize: '0.8rem',
        color: '#cfe8cf',
      }}
    >
      <code>{children}</code>
    </pre>
  );
}
