/* ---------------------------------------------------------------------------
 * home — the platform face as a tier-2 cell (client half).
 *
 * Two faces: signed-out landing (sign in), signed-in workspace. The workspace
 * view is the substrate made EXPLORABLE — salience-shaped via the kernel
 * (workspace.query), switchable by lens (salient / recent / connected /
 * durable), each fact TYPE-RENDERED (kernel titleOf/hrefOf via _types) with its
 * content shown (marked) and live fences handed to the shared @c15r/viewers
 * renderer. The fix for "can't see content / no type viewers / not explorable".
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { marked } from 'marked';
import { Surface, type ViewModel } from '../shared';
import { Card, Button, Badge, theme } from '../shared/ui';
// The shared client kernel (auth + substrate + type presentation), origin-aware.
import { ensureAuth, isAuthed, login, read, loadTypes, titleOf, hrefOf } from 'https://parc.land/@c15r/kernel/app.js';

const { useState, useEffect, useRef } = React;
const appRoot = document.getElementById('app')!;
marked.setOptions({ gfm: true, breaks: false });

interface Entry { key: string; value: unknown; _meta?: { type?: string | null; score?: number } }

function initialVm(): ViewModel {
  const tag = document.getElementById('home-state');
  try {
    return tag?.textContent ? (JSON.parse(tag.textContent) as ViewModel) : { authed: false };
  } catch {
    return { authed: false };
  }
}

const textOf = (v: unknown): string => {
  if (typeof v === 'string') return v;
  const o = v as { content?: string; text?: string } | null;
  if (o?.content) return o.content;
  if (o?.text) return o.text;
  return '```json\n' + JSON.stringify(v, null, 2) + '\n```';
};

/** The renderer tier: fenced code in a fact body → the shared viewers (json/csv/
 *  mermaid/style), exactly as lit does. Type viewers, for any fact. */
async function enhanceFences(root: HTMLElement): Promise<void> {
  const codes = Array.from(root.querySelectorAll('pre > code'));
  if (!codes.length) return;
  const m = await import(/* @vite-ignore */ 'https://parc.land/@c15r/viewers/app.js').catch(() => null);
  const rf = (m as { renderFence?: (h: HTMLElement, v: string, c: string, k: string) => boolean } | null)?.renderFence;
  if (!rf) return;
  for (const code of codes) {
    const lang = (code.className.match(/language-(\w+)/) || [])[1];
    if (!lang) continue;
    const pre = code.parentElement;
    if (!pre) continue;
    const host = document.createElement('div');
    if (rf(host, lang, code.textContent ?? '', 'home')) pre.replaceWith(host);
  }
}

function FactRow({ e }: { e: Entry }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const title = (titleOf as (x: any) => string)(e) || e.key;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const href = (hrefOf as (x: any) => string | null)(e);
  const type = e._meta?.type ?? 'fact';
  const score = e._meta?.score;
  const md = textOf(e.value).slice(0, 1200);
  useEffect(() => {
    if (ref.current) void enhanceFences(ref.current);
  }, [md]);
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline', marginBottom: '0.4rem' }}>
        <strong style={{ fontFamily: theme.serif, fontSize: '1rem' }}>
          {href ? <a href={href} style={{ color: theme.text, textDecoration: 'none' }}>{title}</a> : title}
        </strong>
        <span style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
          <Badge tone="dim">{type}</Badge>
          {typeof score === 'number' ? <Badge>{score.toFixed(2)}</Badge> : null}
        </span>
      </div>
      <div ref={ref} className="fact-body" style={{ fontSize: '0.9rem', lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: marked.parse(md, { async: false }) }} />
      <div style={{ marginTop: '0.35rem', fontFamily: theme.mono, fontSize: '0.72rem', color: theme.dim }}>{e.key}</div>
    </Card>
  );
}

const LENSES = ['salience', 'recent', 'connected', 'durable'] as const;
type Lens = (typeof LENSES)[number];

function Workspace(): React.JSX.Element {
  const [lens, setLens] = useState<Lens>('salience');
  const [res, setRes] = useState<{ entries: Entry[]; total?: number } | null>(null);
  useEffect(() => {
    let live = true;
    setRes(null);
    void (async () => {
      await loadTypes().catch(() => undefined);
      const r = await read<{ entries: Entry[]; total?: number }>('workspace.query', {
        ...(lens === 'salience' ? {} : { lens }),
        rankBy: 'salience',
        limit: 40,
      });
      if (live) setRes(r);
    })();
    return () => {
      live = false;
    };
  }, [lens]);
  return (
    <div style={{ width: '100%', maxWidth: 760, margin: '0 auto 2rem', padding: '0 1.25rem', boxSizing: 'border-box', display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        {LENSES.map((l) => (
          <button
            key={l}
            onClick={() => setLens(l)}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: 999,
              border: `1px solid ${theme.border}`,
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontFamily: theme.mono,
              background: lens === l ? theme.accent : theme.panel,
              color: lens === l ? theme.cream : theme.text,
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {!res ? (
        <Card><p style={{ margin: 0, color: theme.dim }}>loading…</p></Card>
      ) : res.entries.length === 0 ? (
        <Card><p style={{ margin: 0, color: theme.dim }}>nothing here yet — capture a fact via any cell, or an agent.</p></Card>
      ) : (
        <>
          <p style={{ margin: 0, color: theme.dim, fontSize: '0.78rem' }}>
            {res.entries.length}
            {res.total ? ` of ${res.total}` : ''} facts · lens: {lens}
          </p>
          {res.entries.map((e) => (
            <FactRow key={e.key} e={e} />
          ))}
        </>
      )}
    </div>
  );
}

function App(): React.JSX.Element {
  const seed = initialVm();
  const [vm, setVm] = useState<ViewModel>(seed);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      // Complete an OAuth return if present, else respect existing session —
      // but DON'T force login (anon gets the landing, not a redirect).
      const returning = new URLSearchParams(location.search).has('code');
      if (returning || isAuthed()) {
        await ensureAuth();
        setVm({ authed: isAuthed() });
      }
      setReady(true);
    })();
  }, []);

  if (!ready) return <Surface vm={seed} />;
  if (!vm.authed) {
    return (
      <>
        <Surface vm={vm} />
        <div style={{ width: '100%', maxWidth: 760, margin: '0 auto', padding: '0 1.25rem', boxSizing: 'border-box' }}>
          <Button onClick={() => void login()}>sign in</Button>
        </div>
      </>
    );
  }
  return (
    <>
      <Surface vm={vm} />
      <Workspace />
    </>
  );
}

if (appRoot.dataset.ssr === '1') hydrateRoot(appRoot, <App />);
else {
  appRoot.textContent = '';
  createRoot(appRoot).render(<App />);
}
