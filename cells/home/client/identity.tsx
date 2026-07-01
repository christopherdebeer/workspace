/**
 * ADR-0044 Inc 5: identity & grants, split from app.tsx (moved verbatim) —
 * credentials (tokens), shared/receiving grants, and the grant-request inbox.
 */
import * as React from 'react';
import { Card, Heading, Badge, theme } from '@parc/ui';
import { mcpCall } from './lib';

const { useState, useEffect } = React;

// ─── identity & grants shell (phase 2a; docs/scope-grants.md §6) ───

interface TokenRow {
  id: string;
  scope: string;
  label: string | null;
  clientId: string | null;
  revoked: boolean;
  expiresAt: string | null;
  createdAt: string;
}

interface GrantRow {
  owner: string;
  grantee: string;
  key: string;
  mode?: 'read' | 'write';
  createdAt: string;
}

interface RequestRow {
  key: string;
  requester: string;
  resource: string;
  note?: string;
  requestedAt: string;
}

interface AnswerRow {
  key: string;
  resource: string;
  status: 'approved' | 'denied';
  by: string;
  at: string;
  reason?: string;
}

export interface IdentityData {
  tokens: TokenRow[];
  shared: GrantRow[];
  receiving: GrantRow[];
  incoming: RequestRow[];
  answers: AnswerRow[];
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  flexWrap: 'wrap',
  fontSize: '0.85rem',
};

/** Long mono identifiers (OAuth client ids, fact keys, resources) must wrap, not
 *  stretch the page. `minWidth:0` lets them shrink inside a flex row. */
const monoKey: React.CSSProperties = {
  fontSize: '0.78rem',
  fontFamily: theme.mono,
  overflowWrap: 'anywhere',
  wordBreak: 'break-word',
  minWidth: 0,
};

/** Scopes as individual wrapping chips: a token's `scope` is a space-joined
 *  string ("workspace:read workspace:write platform/cells:create") that, as one
 *  nowrap badge, runs wider than a phone. Split it so each scope is its own chip. */
function ScopeBadges({ scope }: { scope?: string | null }): React.JSX.Element | null {
  const parts = (scope ?? '').split(/[\s,]+/).filter(Boolean);
  if (!parts.length) return null;
  return (
    <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', minWidth: 0 }}>
      {parts.map((p) => (
        <Badge key={p} tone="dim">{p}</Badge>
      ))}
    </div>
  );
}

export function InlineButton({ onClick, danger, children }: { onClick: () => void; danger?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      style={{
        background: theme.panel,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        color: danger ? theme.danger : theme.accent,
        cursor: 'pointer',
        fontSize: '0.75rem',
        padding: '0.15rem 0.5rem',
      }}
    >
      {children}
    </button>
  );
}

/**
 * The identity & grants shell: the human projection of the grants vocabulary —
 * who am I, what credentials exist (revoke), what I've shared and what's
 * shared with me (revoke), and the grant-request inbox (approve/deny). Every
 * row is the same `mcpCall` an agent makes; this surface is a rendering, not
 * new plumbing.
 */
export function IdentityShell({ authed, user, scopes, seed }: { authed: boolean; user: string | null; scopes: string[]; seed?: IdentityData }): React.JSX.Element | null {
  const [data, setData] = useState<IdentityData | null>(seed ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    try {
      const [tokens, shared, requests] = await Promise.all([
        mcpCall('read', 'auth.tokens'),
        mcpCall('read', 'workspace.shared'),
        mcpCall('read', 'workspace.grantRequests'),
      ]);
      const t = tokens.ok ? ((tokens.value as { tokens?: TokenRow[] }).tokens ?? []) : [];
      const s = shared.ok ? (shared.value as { shared?: GrantRow[]; receiving?: GrantRow[] }) : {};
      const r = requests.ok ? (requests.value as { incoming?: RequestRow[]; answers?: AnswerRow[] }) : {};
      setData({
        tokens: t.filter((x) => !x.revoked),
        shared: s.shared ?? [],
        receiving: s.receiving ?? [],
        incoming: r.incoming ?? [],
        answers: r.answers ?? [],
      });
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    if (!authed || seed) return; // SSR-seeded → trust it (action handlers still reload)
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  if (!authed) return null;

  const act = async (label: string, verb: string, target: string, input: unknown): Promise<void> => {
    setBusy(label);
    try {
      const r = await mcpCall(verb, target, input);
      if (!r.ok) setErr(typeof r.value === 'string' ? r.value : 'error');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const section: React.CSSProperties = { display: 'grid', gap: '0.4rem' };

  return (
    <Card>
      <Heading sub="Day passes & permits — credentials, grants, and the request inbox, over the same auth.* / workspace.* targets agents use.">
        Identity &amp; grants
      </Heading>
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginBottom: scopes.length ? '0.45rem' : '0.6rem' }}>
        <Badge>{user}</Badge>
      </div>
      {scopes.length ? (
        // One scope per line: legible, and a long scope (e.g. a resource-qualified
        // grant) wraps within the line instead of forcing the page wider than the
        // viewport (the old inline nowrap pills broke mobile layout).
        <ul style={{ listStyle: 'none', margin: '0 0 0.6rem', padding: 0, display: 'grid', gap: '0.2rem' }}>
          {scopes.map((s) => (
            <li key={s} style={{ display: 'flex', gap: '0.4rem', alignItems: 'baseline', minWidth: 0 }}>
              <span style={{ color: theme.accent, fontSize: '0.7rem', flexShrink: 0 }}>▸</span>
              <code style={{ fontFamily: theme.mono, fontSize: '0.76rem', color: theme.dim, wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0 }}>
                {s}
              </code>
            </li>
          ))}
        </ul>
      ) : null}
      {err ? <Badge tone="danger">{err}</Badge> : null}
      {!data ? (
        <p style={{ color: theme.dim }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {data.incoming.length ? (
            <div style={section}>
              <strong style={{ fontFamily: theme.serif }}>Grant requests</strong>
              {data.incoming.map((r) => (
                <div key={r.key} style={rowStyle}>
                  <Badge tone="accent">{r.requester}</Badge>
                  <code style={monoKey}>{r.resource}</code>
                  {r.note ? <span style={{ color: theme.dim }}>“{r.note}”</span> : null}
                  <InlineButton onClick={() => void act(r.key, 'act', 'workspace.approveGrant', { key: r.key })}>
                    {busy === r.key ? '…' : 'Approve'}
                  </InlineButton>
                  <InlineButton danger onClick={() => void act(r.key, 'act', 'workspace.denyGrant', { key: r.key })}>
                    Deny
                  </InlineButton>
                </div>
              ))}
            </div>
          ) : null}

          <div style={section}>
            <strong style={{ fontFamily: theme.serif }}>Credentials</strong>
            {data.tokens.length === 0 ? (
              <span style={{ color: theme.dim, fontSize: '0.85rem' }}>No active tokens.</span>
            ) : (
              data.tokens.map((t, i) => (
                <div
                  key={t.id}
                  style={{
                    display: 'grid',
                    gap: '0.35rem',
                    ...(i < data.tokens.length - 1 ? { paddingBottom: '0.5rem', borderBottom: `1px solid ${theme.border}` } : {}),
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <code style={{ ...monoKey, flex: '1 1 12rem' }}>{t.label ?? t.clientId ?? t.id.slice(0, 8)}</code>
                    <InlineButton danger onClick={() => void act(t.id, 'act', 'auth.revokeToken', { tokenId: t.id })}>
                      {busy === t.id ? '…' : 'Revoke'}
                    </InlineButton>
                  </div>
                  <ScopeBadges scope={t.scope} />
                  <span style={{ color: theme.dim, fontSize: '0.75rem' }}>
                    {t.expiresAt ? `expires ${t.expiresAt.slice(0, 10)}` : 'non-expiring'}
                  </span>
                  {/* Steward this credential as a principal (auth.updateToken): rename,
                      re-scope (upgrade/downgrade, clamped to your standing), re-horizon. */}
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <InlineButton onClick={() => {
                      const label = typeof window !== 'undefined' ? window.prompt('Rename this credential', t.label ?? '') : null;
                      if (label != null) void act(t.id, 'act', 'auth.updateToken', { tokenId: t.id, label });
                    }}>Rename</InlineButton>
                    <InlineButton onClick={() => {
                      const scope = typeof window !== 'undefined' ? window.prompt('Scope (space-separated; clamped to your own standing)', t.scope ?? '') : null;
                      if (scope != null && scope.trim()) void act(t.id, 'act', 'auth.updateToken', { tokenId: t.id, scope: scope.trim() });
                    }}>Edit scope</InlineButton>
                    <InlineButton onClick={() => void act(t.id, 'act', 'auth.updateToken', { tokenId: t.id, expiresInSec: 30 * 24 * 3600 })}>Extend 30d</InlineButton>
                    <InlineButton onClick={() => void act(t.id, 'act', 'auth.updateToken', { tokenId: t.id, expiresInSec: 0 })}>Never expires</InlineButton>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={section}>
            <strong style={{ fontFamily: theme.serif }}>Shared by you</strong>
            {data.shared.length === 0 ? (
              <span style={{ color: theme.dim, fontSize: '0.85rem' }}>Nothing shared.</span>
            ) : (
              data.shared.map((g) => (
                <div key={`${g.grantee}|${g.key}`} style={rowStyle}>
                  <Badge tone="dim">{g.grantee}</Badge>
                  <code style={monoKey}>{g.key}</code>
                  <Badge tone={g.mode === 'write' ? 'accent' : 'dim'}>{g.mode ?? 'read'}</Badge>
                  <InlineButton
                    danger
                    onClick={() => void act(`${g.grantee}|${g.key}`, 'act', 'workspace.unshare', { to: g.grantee, key: g.key })}
                  >
                    {busy === `${g.grantee}|${g.key}` ? '…' : 'Revoke'}
                  </InlineButton>
                </div>
              ))
            )}
          </div>

          {data.receiving.length ? (
            <div style={section}>
              <strong style={{ fontFamily: theme.serif }}>Shared with you</strong>
              {data.receiving.map((g) => (
                <div key={`${g.owner}|${g.key}`} style={rowStyle}>
                  <Badge tone="dim">{g.owner}</Badge>
                  <code style={monoKey}>{g.key}</code>
                  <Badge tone={g.mode === 'write' ? 'accent' : 'dim'}>{g.mode ?? 'read'}</Badge>
                </div>
              ))}
            </div>
          ) : null}

          {data.answers.length ? (
            <div style={section}>
              <strong style={{ fontFamily: theme.serif }}>Your requests</strong>
              {data.answers.map((a) => (
                <div key={a.key} style={rowStyle}>
                  <Badge tone={a.status === 'approved' ? 'accent' : 'danger'}>{a.status}</Badge>
                  <code style={monoKey}>{a.resource}</code>
                  <span style={{ color: theme.dim, fontSize: '0.75rem' }}>
                    by {a.by === user ? 'you' : a.by}
                    {a.reason ? ` — “${a.reason}”` : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
