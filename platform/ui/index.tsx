/**
 * Shared, composable UI primitives for cell front-ends.
 *
 * Mobile-first React components with inline styles (no external CSS/build
 * coupling) so any cell can bundle them into its `client/` entry via esbuild.
 * Keep these presentational and dependency-free (React only) so they stay
 * reusable across cells.
 */
import * as React from 'react';

export const theme = {
  bg: '#0a0a0a',
  panel: '#161616',
  border: '#222',
  text: '#e0e0e0',
  dim: '#888',
  accent: '#3fb950',
  danger: '#f85149',
  radius: 12,
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  sans: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
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
      <main style={{ width: '100%', maxWidth: 760, margin: '0 auto', display: 'grid', gap: '1rem' }}>
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
      <h1 style={{ margin: 0, fontSize: '1.3rem' }}>{children}</h1>
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
        border: 'none',
        borderRadius: 6,
        fontSize: '0.9rem',
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        background: kind === 'primary' ? theme.accent : theme.border,
        color: kind === 'primary' ? '#04210c' : theme.text,
      }}
    >
      {children}
    </button>
  );
}

export function Anchor({ href, children }: { href: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <a href={href} style={{ color: theme.accent, textDecoration: 'none' }}>
      {children}
    </a>
  );
}

export function CodeBlock({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <pre
      style={{
        background: '#0d0d0d',
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        padding: '0.75rem',
        margin: 0,
        overflowX: 'auto',
        fontFamily: theme.mono,
        fontSize: '0.8rem',
        color: theme.text,
      }}
    >
      <code>{children}</code>
    </pre>
  );
}
