/**
 * RegWatch dashboard — the val's server-rendered inbox, reborn as a kernel
 * surface. Session and substrate access come from the kernel (reference, not
 * copy); every data call is a gateway tool call on @c15r/regwatch.*, so the
 * reviewer's identity rides along and the cell never sees a password.
 */
import { ensureAuth, read, act, bootStatus, bootFail, moduleAlive } from 'https://parc.land/@c15r/kernel/app.js';
import { marked } from 'marked';

moduleAlive();

const CELL = '@c15r/regwatch';
const app = document.getElementById('app') as HTMLElement;

/* ── helpers ────────────────────────────────────────────────────── */

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const md = (s: string): string => marked.parse(s ?? '', { breaks: true }) as string;

const CATEGORY_COLORS: Record<string, string> = {
  policy_statement: '#1a73e8',
  consultation: '#e8710a',
  enforcement: '#d93025',
  guidance: '#188038',
  press_release: '#5f6368',
  market_report: '#7b1fa2',
  final_notice: '#c5221f',
  speech: '#795548',
  discussion_paper: '#00897b',
  other: '#9e9e9e',
};

interface ItemRow {
  id: string;
  source_id?: string;
  title: string;
  url?: string;
  published_at?: string;
  collected_at?: string;
  category?: string;
  summary?: string;
  status: string;
  relevance_signals?: Record<string, unknown>;
  body_md?: string;
  meta?: Record<string, unknown>;
}

interface NoteRow {
  id: string;
  content: string;
  status: string;
  resolution: string;
  created_at: string;
  resolved_at: string | null;
}

function toast(msg: string): void {
  const t = document.createElement('div');
  t.className = 'err-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

function header(active: string, openNotes: number): string {
  const link = (href: string, label: string, key: string) =>
    `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  return `<header>
    <div class="brand"><h1><a href="#/">RegWatch</a></h1><div class="subtitle">FCA &amp; IA regulatory monitor</div></div>
    <nav>
      ${link('#/', 'Inbox', 'inbox')}
      ${link('#/notes', `Notes${openNotes ? ` (${openNotes})` : ''}`, 'notes')}
      ${link('#/settings', 'Settings', 'settings')}
    </nav>
  </header>`;
}

/* ── inbox ──────────────────────────────────────────────────────── */

let statsCache: Record<string, unknown> | null = null;

function itemCard(item: ItemRow): string {
  const signals = item.relevance_signals ?? {};
  const areas = Object.entries(signals)
    .filter(([k, v]) => v === true && k !== 'action_deadline')
    .map(([k]) => k.replace(/_relevant|_/g, ' ').trim());
  const deadline = typeof signals.action_deadline === 'string' ? signals.action_deadline : null;
  const triage = item.status === 'unreviewed' || item.status === 'flagged'
    ? `<div class="triage-actions">
        <button data-triage="high" title="High relevance" class="btn-high">H</button>
        <button data-triage="medium" title="Medium" class="btn-med">M</button>
        <button data-triage="low" title="Low" class="btn-low">L</button>
        <button data-triage="not_relevant" title="Not relevant" class="btn-nr">✕</button>
        <button data-flag="1" title="Flag for action" class="btn-flag">⚑</button>
      </div>`
    : '';
  return `<article class="item-card ${esc(item.status)}" data-id="${esc(item.id)}">
    <div class="item-header">
      <span class="category-badge" style="background:${CATEGORY_COLORS[item.category ?? 'other'] ?? '#9e9e9e'}">${esc((item.category ?? 'other').replace(/_/g, ' '))}</span>
      <time>${esc(item.published_at || item.collected_at?.slice(0, 10) || '—')}</time>
    </div>
    <h3><a href="#/item/${esc(item.id)}">${esc(item.title)}</a></h3>
    <p class="summary">${esc(item.summary || 'No summary yet')}</p>
    ${areas.length ? `<div class="signals">${areas.map((a) => `<span class="signal">${esc(a)}</span>`).join('')}</div>` : ''}
    ${deadline ? `<div class="deadline">⏰ ${esc(deadline)}</div>` : ''}
    ${triage}
  </article>`;
}

async function renderInbox(tab: string): Promise<void> {
  bootStatus('loading inbox…');
  statsCache = statsCache ?? (await read<Record<string, unknown>>(`${CELL}.stats`));
  const byStatus = (statsCache.by_status as Record<string, number>) ?? {};
  const status = tab === 'reviewed' ? 'reviewed' : tab === 'flagged' ? 'flagged' : 'unreviewed';
  const items = await read<ItemRow[]>(`${CELL}.list_items`, { status, limit: 100 });

  const tabBtn = (key: string, label: string, count: number) =>
    `<button class="tab ${tab === key ? 'active' : ''}" data-tab="${key}">${label}<span class="count">${count}</span></button>`;

  app.innerHTML = `
    ${header('inbox', (statsCache.open_notes as number) ?? 0)}
    <div class="stats-bar">
      <div class="stat"><div class="stat-num">${byStatus.unreviewed ?? 0}</div><div class="stat-label">Unreviewed</div></div>
      <div class="stat"><div class="stat-num">${byStatus.flagged ?? 0}</div><div class="stat-label">Flagged</div></div>
      <div class="stat"><div class="stat-num">${statsCache.total ?? 0}</div><div class="stat-label">Total</div></div>
      <div class="stat"><div class="stat-num">${statsCache.reviews_last_7d ?? 0}</div><div class="stat-label">Reviews 7d</div></div>
    </div>
    <div class="tab-bar">
      ${tabBtn('inbox', 'Inbox', byStatus.unreviewed ?? 0)}
      ${tabBtn('flagged', 'Flagged', byStatus.flagged ?? 0)}
      ${tabBtn('reviewed', 'Reviewed', byStatus.reviewed ?? 0)}
    </div>
    <div class="feed">
      ${items.length ? items.map(itemCard).join('') : '<p class="empty">Nothing here. ✨</p>'}
    </div>`;

  app.querySelectorAll('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      location.hash = (b as HTMLElement).dataset.tab === 'inbox' ? '#/' : `#/tab/${(b as HTMLElement).dataset.tab}`;
    }),
  );
  app.querySelectorAll('.item-card button').forEach((b) =>
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const btn = b as HTMLElement;
      const card = btn.closest('.item-card') as HTMLElement;
      const id = card.dataset.id as string;
      btn.setAttribute('disabled', '1');
      try {
        if (btn.dataset.flag) await act(`${CELL}.flag`, { item_id: id });
        else await act(`${CELL}.review`, { item_id: id, relevance: btn.dataset.triage });
        statsCache = null;
        card.style.opacity = '0.4';
        setTimeout(() => route(), 250);
      } catch (err) {
        btn.removeAttribute('disabled');
        toast((err as Error).message);
      }
    }),
  );
}

/* ── item detail ────────────────────────────────────────────────── */

async function renderItem(id: string): Promise<void> {
  bootStatus('loading item…');
  const { item, review } = await read<{ item: ItemRow; review: Record<string, unknown> | null }>(`${CELL}.get_item`, { id });
  const signals = item.relevance_signals ?? {};
  app.innerHTML = `
    ${header('item', 0)}
    <div class="detail-view">
      <a href="#/" class="back">← Back to inbox</a>
      <h2>${esc(item.title)}</h2>
      <div class="detail-meta">
        <span>${esc((item.category ?? 'other').replace(/_/g, ' '))}</span>
        <span>${esc(item.published_at || '—')}</span>
        <span>${esc(item.source_id || '—')}</span>
        <span>${esc(item.status)}</span>
      </div>
      <div class="signals">
        ${Object.entries(signals)
          .filter(([, v]) => v === true)
          .map(([k]) => `<span class="signal">${esc(k.replace(/_relevant|_/g, ' ').trim())}</span>`)
          .join('')}
      </div>
      <div class="detail-body">${item.body_md ? md(item.body_md) : '<p>No detailed content captured yet.</p>'}</div>
      ${item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener" class="source-link">View source document →</a>` : ''}
      <div class="review-form">
        <h4>Review &amp; Notes</h4>
        ${review ? `<div class="reviewed-stamp">Reviewed ${esc(review.relevance)} by ${esc(review.reviewer)} at ${esc(review.reviewed_at)}</div>` : ''}
        <textarea id="rw-notes" placeholder="Notes on applicability, client impact, action items...">${esc((review?.notes as string) || '')}</textarea>
        <div class="btns">
          <button data-rel="high" class="primary">High relevance</button>
          <button data-rel="medium">Medium</button>
          <button data-rel="low">Low</button>
          <button data-rel="not_relevant">Not relevant</button>
        </div>
      </div>
    </div>`;

  app.querySelectorAll('.review-form button').forEach((b) =>
    b.addEventListener('click', async () => {
      const notes = (document.getElementById('rw-notes') as HTMLTextAreaElement).value;
      try {
        await act(`${CELL}.review`, { item_id: id, relevance: (b as HTMLElement).dataset.rel, notes });
        statsCache = null;
        location.hash = '#/';
      } catch (err) {
        toast((err as Error).message);
      }
    }),
  );
}

/* ── collector notes ────────────────────────────────────────────── */

function noteCard(n: NoteRow): string {
  const open = n.status === 'open';
  return `<div class="note-card ${esc(n.status)}" data-id="${esc(n.id)}">
    <div class="note-meta"><span>${esc(n.status)}</span><span>${esc(n.created_at)}</span></div>
    <div class="note-body">${md(n.content)}</div>
    ${open
      ? `<textarea placeholder="Reply (guidance for future runs) — or dismiss without one"></textarea>
         <div><button data-resolve="1">Reply &amp; resolve</button> <button data-dismiss="1">Dismiss</button></div>`
      : n.resolution
        ? `<div class="resolution"><strong>Response:</strong> ${esc(n.resolution)}</div>`
        : ''}
  </div>`;
}

async function renderNotes(): Promise<void> {
  bootStatus('loading notes…');
  const notes = await read<NoteRow[]>(`${CELL}.list_notes`, { status: 'all' });
  const open = notes.filter((n) => n.status === 'open');
  const closed = notes.filter((n) => n.status !== 'open');
  app.innerHTML = `
    ${header('notes', open.length)}
    <div class="feed">
      <p class="empty" style="padding:12px 0">${open.length} open note${open.length === 1 ? '' : 's'} from the collector — replies become guidance in its next run; dismissals tell it to stop raising similar ones.</p>
      ${open.map(noteCard).join('')}
      ${closed.length ? `<p class="empty" style="padding:12px 0">Closed</p>${closed.map(noteCard).join('')}` : ''}
    </div>`;

  app.querySelectorAll('.note-card button').forEach((b) =>
    b.addEventListener('click', async () => {
      const card = (b as HTMLElement).closest('.note-card') as HTMLElement;
      const id = card.dataset.id as string;
      const resolution = (b as HTMLElement).dataset.dismiss ? '' : (card.querySelector('textarea') as HTMLTextAreaElement).value;
      try {
        await act(`${CELL}.resolve_note`, { id, resolution });
        statsCache = null;
        renderNotes();
      } catch (err) {
        toast((err as Error).message);
      }
    }),
  );
}

/* ── settings ───────────────────────────────────────────────────── */

async function renderSettings(): Promise<void> {
  bootStatus('loading settings…');
  const [sources, prompt, feedback] = await Promise.all([
    read<Record<string, unknown>[]>(`${CELL}.list_sources`),
    read<{ active: Record<string, unknown> | null; history: Record<string, unknown>[] }>(`${CELL}.get_prompt`, { name: 'collector' }),
    read<Record<string, unknown>>(`${CELL}.feedback`),
  ]);
  sources.sort((a, b) => `${a.category}${a.name}`.localeCompare(`${b.category}${b.name}`));
  app.innerHTML = `
    ${header('settings', 0)}
    <div class="feed">
      <div class="settings-section">
        <h3>Sources (${sources.length})</h3>
        <table>
          <tr><th>Source</th><th>Cadence</th><th>Category</th></tr>
          ${sources
            .map(
              (s) => `<tr class="${s.active === false ? 'inactive' : ''}">
                <td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a><br><span style="color:var(--text-secondary)">${esc(s.id)}</span></td>
                <td>${esc(s.frequency)}</td><td>${esc(s.category)}</td></tr>`,
            )
            .join('')}
        </table>
      </div>
      <div class="settings-section">
        <h3>Collector prompt</h3>
        <p style="font-size:13px;margin-bottom:8px">Active: v${esc(prompt.active?.version)} — ${esc(prompt.active?.notes)}</p>
        <table>
          <tr><th>v</th><th>Notes</th><th>Created</th></tr>
          ${prompt.history.map((h) => `<tr class="${h.active ? '' : 'inactive'}"><td>${esc(h.version)}</td><td>${esc(h.notes)}</td><td>${esc(h.created_at)}</td></tr>`).join('')}
        </table>
      </div>
      <div class="settings-section">
        <h3>Reviewer feedback → collector calibration</h3>
        <p style="font-size:13px">${feedback.total_reviews} reviews to date.</p>
        ${((feedback.guidance as string[]) ?? []).map((g) => `<p style="font-size:13px">• ${esc(g)}</p>`).join('') || '<p style="font-size:13px;color:var(--text-secondary)">No calibration guidance yet — it appears as reviews accumulate.</p>'}
      </div>
    </div>`;
}

/* ── router + boot ──────────────────────────────────────────────── */

async function route(): Promise<void> {
  const hash = location.hash.replace(/^#\/?/, '');
  try {
    if (hash.startsWith('item/')) await renderItem(hash.slice(5));
    else if (hash === 'notes') await renderNotes();
    else if (hash === 'settings') await renderSettings();
    else if (hash.startsWith('tab/')) await renderInbox(hash.slice(4));
    else await renderInbox('inbox');
  } catch (err) {
    toast((err as Error).message);
    app.innerHTML = `${header('inbox', 0)}<p class="boot">failed: ${esc((err as Error).message)}</p>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => void route());

(async () => {
  try {
    bootStatus('signing in…');
    await ensureAuth();
    await route();
  } catch (err) {
    bootFail(err as Error);
  }
})();
