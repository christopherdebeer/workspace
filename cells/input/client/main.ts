/* ---------------------------------------------------------------------------
 * input — the capture organ (dotlit's Input Buffer reborn over the substrate).
 *
 * Anything shared here — PWA share_target, iOS shortcut / bookmarklet hitting
 * ?url=&title=&text=, or the quick form — lands as a capture FACT:
 *   inbox/<ts>  { content, title?, url? }  type:capture  tags:[inbox, log:<date>]
 * The daily log is a view over the day tag (lit renders ?doc=log:<date>),
 * never a file — every capture has identity, provenance, and a place in the
 * graph from the moment it arrives. Unlinked captures surface in the canvas
 * tray; tend counts them; salience cools what is never touched.
 * ------------------------------------------------------------------------- */

/* — session + substrate: the kernel's (reference, not copy) — */

import {
  ensureAuth,
  read as kread,
  act as kact,
  bootStatus,
} from 'https://parc.land/@c15r/kernel/app.js';

(window as any).__lit_module = true; // watchdog marker (kernel sets it too)

function mcp<T>(verb: 'read' | 'act', target: string, input?: unknown): Promise<T> {
  return verb === 'read' ? kread<T>(target, input) : kact<T>(target, input);
}

/* — capture — */

interface Pending { title?: string; text?: string; url?: string; input?: string }

const today = (): string => new Date().toISOString().split('T')[0];

const isoWeekOf = (d: string): string => {
  const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)));
  const wd = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - wd + 3);
  const y = dt.getUTCFullYear();
  const jan4 = new Date(Date.UTC(y, 0, 4));
  return `${y}-w${String(1 + Math.round(((+dt - +jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
};

function composeContent(p: Pending): { content: string; title?: string; url?: string } {
  const title = p.title?.trim() || undefined;
  const url = (p.url?.trim() || (p.text && /^https?:\/\/\S+$/.test(p.text.trim()) ? p.text.trim() : undefined)) || undefined;
  const text = p.input ?? (p.text && p.text !== url ? p.text : undefined);
  let content: string;
  if (url) {
    content = `- [ ] [${title ?? url}](${url})`;
    if (text?.trim()) content += `\n\n    > ${text.trim().replace(/\n/g, '\n    > ')}`;
  } else {
    content = text?.trim() || title || '';
    if (title && text?.trim() && title !== text.trim()) content = `**${title}**\n\n${content}`;
  }
  return { content, title, url };
}

/** Human-readable capture slug (ADR-0040): keys are link targets — title → URL last
 *  segment/host → opening words → base36 ts. `inbox/<date>/<slug>`, day a prefix. */
const slugify = (s: unknown): string =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/g, '');
function captureSlug(parts: { title?: string; url?: string; content?: string }): string {
  const fromTitle = slugify(parts.title);
  if (fromTitle) return fromTitle;
  if (parts.url) {
    try { const u = new URL(parts.url); const s = slugify(u.pathname.split('/').filter(Boolean).pop()) || slugify(u.hostname); if (s) return s; } catch { /* not a URL */ }
  }
  return slugify(parts.content) || Date.now().toString(36);
}

async function capture(p: Pending): Promise<{ key: string; content: string }> {
  const { content, title, url } = composeContent(p);
  if (!content) throw new Error('nothing to capture');
  const day = today();
  const key = `inbox/${day}/${captureSlug({ title, url, content })}`;
  await mcp('act', 'workspace.remember', {
    key,
    value: { content, ...(title ? { title } : {}), ...(url ? { url } : {}), captured: day },
    via: 'input',
    type: 'capture',
    tags: ['inbox', `log:${day}`],
  });
  // The day is a fact; the capture hangs off it (boards render the edge).
  void mcp('act', 'workspace.remember', {
    key: `log:${day}`,
    value: { date: day, week: isoWeekOf(day), month: day.slice(0, 7), year: day.slice(0, 4), title: day },
    ifAbsent: true, type: 'log', tags: ['log'], via: 'input',
  }).catch(() => undefined); // already exists — fine
  void mcp('act', 'workspace.link', { from: key, rel: 'on', to: `log:${day}` }).catch(() => undefined);
  return { key, content };
}

/* — UI — */

const app = document.getElementById('app')!;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function injectStyles(): void {
  const css = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #fbfbf8; color: #1c1c1a; font: 16px/1.55 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  #app { max-width: 560px; margin: 0 auto; padding: 1rem 1.1rem 3rem; }
  .boot { color: #8a8a82; }
  h1 { font-size: 1.25rem; margin: 0.4rem 0 0.2rem; } h1 a { color: inherit; text-decoration: none; }
  .sub { color: #8a8a82; font-size: 0.82rem; margin: 0 0 1rem; }
  .captured { background: #e3efe7; border: 1px solid #bcd9c6; border-radius: 12px; padding: 0.7rem 0.9rem; margin: 0.8rem 0; white-space: pre-wrap; font-size: 0.9rem; }
  .captured b { color: #2f6f4f; display: block; margin-bottom: 0.3rem; }
  textarea { width: 100%; min-height: 5.5rem; font: 0.9rem/1.5 inherit; border: 1px solid #e4e4dc; border-radius: 10px; padding: 0.7rem; background: #fff; }
  .btn { border: 1px solid #2f6f4f; background: #2f6f4f; color: #fff; border-radius: 10px; padding: 9px 18px; font-size: 0.9rem; margin-top: 0.5rem; }
  .meta { color: #8a8a82; font-size: 0.8rem; margin: 1.2rem 0 0.4rem; display: flex; gap: 1rem; flex-wrap: wrap; }
  .meta a { color: #2f6f4f; text-decoration: none; }
  ul.feed { list-style: none; padding: 0; margin: 0.4rem 0; }
  ul.feed li { border-top: 1px solid #e4e4dc; padding: 0.55rem 0.1rem; font-size: 0.88rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  ul.feed li a { color: #2f6f4f; }
  details.setup { margin-top: 1.6rem; border-top: 1px solid #e4e4dc; padding-top: 0.8rem; font-size: 0.85rem; }
  details.setup summary { color: #8a8a82; cursor: pointer; }
  details.setup h3 { font-size: 0.9rem; margin: 0.9rem 0 0.2rem; }
  details.setup ol { padding-left: 1.2rem; margin: 0.3rem 0; }
  details.setup code, details.setup textarea.bm { font: 0.78rem/1.45 ui-monospace, Menlo, monospace; }
  details.setup textarea.bm { width: 100%; min-height: 4.6rem; border: 1px solid #e4e4dc; border-radius: 8px; padding: 0.5rem; background: #fff; color: #555; }
  details.setup a.bml { display: inline-block; background: #e3efe7; border: 1px solid #bcd9c6; border-radius: 8px; padding: 5px 12px; color: #2f6f4f; text-decoration: none; margin: 0.3rem 0; }
  `;
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

function renderItem(value: { content?: string; url?: string; title?: string }): HTMLElement {
  const li = el('li');
  if (value.url) {
    const a = el('a', '', value.title || value.url) as HTMLAnchorElement;
    a.href = value.url;
    a.target = '_blank';
    li.appendChild(a);
    const rest = (value.content ?? '').split('\n').slice(1).join('\n').trim();
    if (rest) li.appendChild(el('div', '', rest.replace(/^\s*> ?/gm, '')));
  } else li.textContent = value.content ?? '';
  return li;
}

/** The surface documents itself (the dotlit way): how to feed the buffer. */
function renderSetup(): HTMLElement {
  const base = `${location.origin}${location.pathname.replace(/\/+$/, '')}`;
  const bm = `javascript:location.href='${base}?url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title)+((window.getSelection&&String(getSelection()))?'&text='+encodeURIComponent(String(getSelection()).slice(0,2000)):'')`;

  const d = document.createElement('details');
  d.className = 'setup';
  const s = el('summary', '', 'setup — share from anywhere');
  d.appendChild(s);

  d.appendChild(el('h3', '', '🔖 bookmarklet (desktop)'));
  const bml = el('a', 'bml', '📥 capture to parc.land') as HTMLAnchorElement;
  bml.href = bm;
  bml.onclick = (e) => e.preventDefault(); // drag it, don't fire it here
  d.appendChild(bml);
  d.appendChild(el('p', 'sub', 'drag the button to your bookmarks bar — or copy the code:'));
  const ta = document.createElement('textarea');
  ta.className = 'bm';
  ta.readOnly = true;
  ta.value = bm;
  ta.onclick = () => { ta.select(); try { navigator.clipboard?.writeText(bm); } catch { /* manual copy */ } };
  d.appendChild(ta);

  d.appendChild(el('h3', '', '📱 iOS share sheet (Shortcuts)'));
  const ol = el('ol');
  for (const step of [
    'Shortcuts app → + → name it “📥 parc input”',
    'Shortcut settings → enable “Show in Share Sheet” (accept Text, URLs, Safari pages)',
    'Add action: Open URLs — with the URL below, inserting the magic variable “Shortcut Input” (URL-encoded) after input=',
  ]) ol.appendChild(el('li', '', step));
  d.appendChild(ol);
  const ta2 = document.createElement('textarea');
  ta2.className = 'bm';
  ta2.readOnly = true;
  ta2.value = `${base}?input=[Shortcut Input]`;
  ta2.onclick = () => ta2.select();
  d.appendChild(ta2);
  d.appendChild(el('p', 'sub', 'sharing opens this page once, captures, and shows today’s feed — first run will ask you to sign in with your passkey'));

  d.appendChild(el('h3', '', '🤖 Android'));
  d.appendChild(el('p', 'sub', 'install this page (browser menu → Add to Home screen) and it registers as a native share target'));

  d.appendChild(el('h3', '', '⚙️ anything else'));
  d.appendChild(el('p', 'sub', `GET ${base}?url=&title=&text= (or ?input=) — every capture lands as an inbox/<ts> fact, day-tagged; agents use workspace.remember/ingest directly`));
  return d;
}

async function render(capturedNow: { key: string; content: string } | null): Promise<void> {
  app.textContent = '';
  const h = el('h1');
  const home = el('a', '', '📥 input') as HTMLAnchorElement;
  home.href = location.pathname;
  h.appendChild(home);
  app.appendChild(h);
  app.appendChild(el('p', 'sub', 'anything shared here becomes a fact'));

  if (capturedNow) {
    const box = el('div', 'captured');
    box.appendChild(el('b', '', `captured ✓ ${capturedNow.key}`));
    box.appendChild(document.createTextNode(capturedNow.content));
    app.appendChild(box);
  }

  const ta = document.createElement('textarea');
  ta.placeholder = 'capture a thought, a link, anything…';
  app.appendChild(ta);
  const save = el('button', 'btn', 'capture');
  save.onclick = async () => {
    if (!ta.value.trim()) return;
    save.textContent = '…';
    try {
      const got = await capture({ input: ta.value });
      await render(got);
    } catch (err) {
      save.textContent = 'capture';
      alert((err as Error).message);
    }
  };
  app.appendChild(save);

  const meta = el('div', 'meta');
  const day = el('a', '', `today's log →`) as HTMLAnchorElement;
  day.href = `/@c15r/lit?doc=log:${today()}`;
  meta.appendChild(day);
  const buffer = el('a', '', 'open in lit') as HTMLAnchorElement;
  buffer.href = '/@c15r/lit';
  meta.appendChild(buffer);
  app.appendChild(meta);

  try {
    const res = await mcp<{ entries: Array<{ key: string; value: { content?: string; url?: string; title?: string } }> }>(
      'read', 'workspace.query', { tag: `log:${today()}`, limit: 50 },
    );
    const items = (res.entries ?? []).filter((e) => e.key.startsWith('inbox/'));
    if (items.length) {
      app.appendChild(el('p', 'sub', `${items.length} captured today`));
      const ul = el('ul', 'feed');
      for (const e of items) ul.appendChild(renderItem(e.value ?? {}));
      app.appendChild(ul);
    }
  } catch { /* feed is best-effort */ }

  app.appendChild(renderSetup());
}

/* — boot — */

async function boot(): Promise<void> {
  injectStyles();
  bootStatus('signing in…');
  // Kernel auth: one origin-wide session; on the OAuth return it restores the
  // ORIGINAL url — share params (?url=&title=&text=/?input=) included.
  await ensureAuth();

  const q = new URLSearchParams(location.search);
  let pending: Pending | null = null;
  if (q.get('input') || q.get('text') || q.get('url') || q.get('title')) {
    pending = {
      input: q.get('input') ?? undefined,
      text: q.get('text') ?? undefined,
      url: q.get('url') ?? undefined,
      title: q.get('title') ?? undefined,
    };
    history.replaceState({}, '', location.pathname);
  }

  let captured: { key: string; content: string } | null = null;
  if (pending) {
    bootStatus('capturing…');
    try {
      captured = await capture(pending);
    } catch (err) {
      console.warn('[input] capture failed', err);
      alert(`capture failed: ${(err as Error).message}`);
    }
  }
  await render(captured);
}

void boot();
