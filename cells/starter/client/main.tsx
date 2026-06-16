/* ---------------------------------------------------------------------------
 * starter — the canonical cell template (client half).
 *
 * Hydrate the server-rendered platform/ui tree (same shared modules → identical
 * markup, no flash), then go interactive through the KERNEL: sign in once
 * (origin-wide), read/act on the substrate, and hand a fact to the shared
 * VIEWERS renderer. Demonstrates the full stack a cell composes — kernel +
 * platform/ui + types + viewers + isomorphic SSR — broadly, not exhaustively.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { hydrateRoot, createRoot } from 'react-dom/client';
import { Surface, type ViewModel, type Note } from '../shared';
import { Card, Heading, Button, TextInput, theme } from '../shared/ui';
import { ensureAuth, isAuthed } from './lib/auth';
import { read, act } from './lib/substrate';

const { useState, useEffect, useRef } = React;
const appRoot = document.getElementById('app')!;

function initialVm(): ViewModel {
  const tag = document.getElementById('starter-state');
  try {
    return tag?.textContent ? (JSON.parse(tag.textContent) as ViewModel) : { authed: false, notes: [] };
  } catch {
    return { authed: false, notes: [] };
  }
}

interface Entry { key: string; value: unknown }
const textOf = (v: unknown): string => (typeof v === 'string' ? v : ((v as { text?: string })?.text ?? ''));

/** Read the `note` facts from the viewer's own slice — the same query an agent runs. */
async function loadNotes(): Promise<Note[]> {
  const res = await read<{ entries: Entry[] }>('workspace.query', { type: 'note', rankBy: 'recency', limit: 50 });
  return (res.entries ?? []).map((e) => ({ key: e.key, text: textOf(e.value) }));
}

/** The renderer tier: a fact's content handed to the shared `@c15r/viewers` cell.
 *  One demo — a `json` view of a note fact — to show the ladder, not the spread. */
function ViewerDemo({ sample }: { sample: unknown }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    import(/* @vite-ignore */ 'https://parc.land/@c15r/viewers/app.js')
      .then((m: { renderFence?: (h: HTMLElement, v: string, c: string, k: string) => boolean }) => {
        el.textContent = '';
        const ok = m.renderFence?.(el, 'json', JSON.stringify(sample, null, 2), 'starter:viewer');
        if (!ok) el.textContent = JSON.stringify(sample, null, 2);
      })
      .catch(() => {
        el.textContent = JSON.stringify(sample, null, 2);
      });
  }, [sample]);
  return (
    <Card>
      <Heading sub="the same fact, handed to the shared @c15r/viewers renderer (json)">viewer</Heading>
      <div ref={host} style={{ fontFamily: theme.mono, fontSize: '0.8rem' }} />
    </Card>
  );
}

function App(): React.JSX.Element {
  const seed = initialVm();
  const [vm, setVm] = useState<ViewModel>(seed);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      await ensureAuth();
      let notes = await loadNotes();
      if (notes.length === 0) {
        // Seed a sample `note` fact so the surface (and the declared type) have
        // content — the same fact an agent would see and act on.
        await act('workspace.remember', {
          key: 'note:welcome',
          value: { text: '# welcome\nThis is a `note` fact, rendered by **marked** (isomorphic). An agent reads the same fact via `workspace.query`.' },
          type: 'note',
          tags: ['note', 'starter'],
        });
        notes = await loadNotes();
      }
      setVm({ authed: isAuthed(), notes });
      setReady(true);
    })();
  }, []);

  const add = async (): Promise<void> => {
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await act('workspace.remember', { key: `note:${Date.now().toString(36)}`, value: { text: t }, type: 'note', tags: ['note', 'starter'] });
      setDraft('');
      setVm({ authed: true, notes: await loadNotes() });
    } finally {
      setBusy(false);
    }
  };

  // Pre-hydration: render the SSR tree verbatim so hydrateRoot attaches cleanly.
  if (!ready) return <Surface vm={seed} />;
  const sample = vm.notes[0]
    ? { key: vm.notes[0].key, type: 'note', value: { text: vm.notes[0].text } }
    : { note: 'none yet' };
  return (
    <>
      <Surface vm={vm} />
      <div style={{ width: '100%', maxWidth: 760, margin: '0 auto 2rem', padding: '0 1.25rem', boxSizing: 'border-box', display: 'grid', gap: '0.75rem' }}>
        {vm.authed ? (
          <Card>
            <Heading sub="writes a `note` fact via workspace.remember — visible to agents too">add a note</Heading>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              <TextInput value={draft} onChange={setDraft} placeholder="markdown…" onEnter={() => void add()} />
              <Button onClick={() => void add()} disabled={busy}>{busy ? 'saving…' : 'add note'}</Button>
            </div>
          </Card>
        ) : null}
        <ViewerDemo sample={sample} />
      </div>
    </>
  );
}

if (appRoot.dataset.ssr === '1') hydrateRoot(appRoot, <App />);
else {
  appRoot.textContent = '';
  createRoot(appRoot).render(<App />);
}
