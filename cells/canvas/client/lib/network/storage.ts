/* ---------------------------------------------------------------------------
 *  storage.ts — substrate-backed persistence (canvas-substrate-design.md).
 *
 *  item = fact × renderer × placement:
 *    - domain fields → fact `el:<id>` (semantic type/tags PRESERVED on rewrite)
 *    - geometry      → placement `_canvas/<cid>/el:<id>` — written only when a
 *                      human pinned/moved it (synthesized positions never persist)
 *    - edges         → PROJECTED FROM SUBSTRATE LINKS (the truth); decoration
 *                      facts carry style only; deleting an edge unlinks
 *
 *  View-backed boards (?view=<id>): membership = the view's QUERY, placements
 *  from render.board, camera from render.viewport (pinned, shareable truth);
 *  ?embed=1 strips chrome; render.interactive:false makes it a picture.
 * ------------------------------------------------------------------------- */
import '../../main.css';
import { act, read } from './substrate.ts';
import { ensureAuth, accessToken, isAuthed } from './auth.ts';
import { startSalience } from './salience.ts';
import { registerSubstrateTypes, loadRendererFacts } from '../elements/substrateTypes.ts';
import { loadTypes, titleOf, hrefOf } from 'https://parc.land/@c15r/kernel/app.js';
import { installImagePaste } from './imagePaste.ts';

let saveTimeout: ReturnType<typeof setTimeout> | undefined;
const DEBOUNCE_SAVE_DELAY = 800;
const FLUSH_DELAY = 400;

/** fact key → JSON last written, so repeat saves only touch what changed. */
const lastWritten = new Map<string, string>();
const pending = new Map<string, { value: unknown; type?: string; tags?: string[] }>();
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let flushing = false;

/** Stored substrate meta per fact key — preserves semantic type/tags on rewrite. */
const factMeta = new Map<string, { type: string | null; tags: string[] }>();
/** Known edges (link-derived and decorated) so removals can unlink. */
const lastEdges = new Map<string, { source: string; target: string; rel: string; decorated: boolean }>();
/** Synthesized (unpinned) positions — never persisted until the human moves them. */
const synthOrigin = new Map<string, { x: number; y: number }>();
/** Read-time salience per fact key, for the presentation channel. */
export const salienceByKey = new Map<string, number>();

const FACT_ICONS: Record<string, string> = {
  cell: '🔋', doc: '📄', capture: '📥', audit: '🔎', 'type-decl': '🏷️', view: '📊', action: '⚡', log: '🗓️',
};

/** `_types/<type>` declarations, loaded once per board (kernel-cached). */
let factTypeDecls: Record<string, { icon?: string }> = {};

/** A fact with no renderable type becomes a 'fact' CARD — presentation only
 *  (_fact* transients + a type the persister strips), value untouched.
 *  Title/href come from the kernel: _types declarations first, conventions
 *  as fallback — a new type's routing is one fact, no deploys. */
function decorateFactCard(el: any, meta: { type?: string | null; tags?: string[] } | undefined): void {
  if (el.type) return;
  el.type = 'fact';
  el._factCard = true;
  const metaType = meta?.type ?? null;
  const entry = { key: String(el._factKey ?? el.id), value: el, _meta: { type: metaType, tags: meta?.tags ?? [] } };
  el._factTitle = titleOf(entry);
  el._factHref = hrefOf(entry);
  el._factIcon = factTypeDecls[metaType ?? '']?.icon ?? FACT_ICONS[metaType ?? ''] ?? '•';
  el._factMeta = [metaType ?? 'fact', entry.key].join(' · ');
  if (typeof el.items === 'number') el._factMeta += ` · ${el.items} item${el.items === 1 ? '' : 's'}`;
  if (el.width === 240 && el.height === 120) { el.width = 270; el.height = 92; }
}

/** A board item's substrate key: el:<id> by convention, but ANY fact can sit
 *  on a board — its original key rides along as a transient. */
const factKeyOf = (el: any): string => (typeof el._factKey === 'string' ? el._factKey : `el:${el.id}`);

/** Board element id for a substrate key (el:* strips the prefix). */
const idOfKey = (k: string): string => (k.startsWith('el:') ? k.slice(3) : k);

const PLACEMENT_KEYS = new Set([
  'x', 'y', 'width', 'height', 'rotation', 'scale', 'zIndex',
  'blendMode', 'color', 'static', 'group', 'fixedTop', 'fixedLeft',
]);

function splitElement(el: Record<string, unknown>): { domain: Record<string, unknown>; placement: Record<string, unknown> } {
  const domain: Record<string, unknown> = {};
  const placement: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(el)) {
    if (v === undefined || k.startsWith('_')) continue; // client-only flags never persist
    if (PLACEMENT_KEYS.has(k)) placement[k] = v;
    else domain[k] = v;
  }
  return { domain, placement };
}

function queueFact(key: string, value: unknown, extra?: { type?: string; tags?: string[] }): void {
  if (readonlyBoard) return; // a non-interactive view never writes
  if (lastWritten.get(key) === JSON.stringify(value)) return;
  pending.set(key, { value, ...extra });
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = undefined; void flush(); }, FLUSH_DELAY);
}

async function flush(): Promise<void> {
  if (flushing) {
    if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = undefined; void flush(); }, FLUSH_DELAY);
    return;
  }
  flushing = true;
  try {
    for (const [key, p] of [...pending]) {
      pending.delete(key);
      try {
        await act('workspace.remember', {
          key,
          value: p.value,
          via: 'canvas',
          ...(p.type ? { type: p.type } : {}),
          ...(p.tags ? { tags: p.tags } : {}),
        });
        lastWritten.set(key, JSON.stringify(p.value));
      } catch (err) {
        console.warn('[substrate] write failed', key, err);
      }
    }
  } finally {
    flushing = false;
  }
}

/** Per-element write (the CrdtAdapter seam funnels here too). */
export function queueElementWrite(canvasId: string, el: Record<string, unknown>): void {
  if (!el || typeof el.id !== 'string') return;
  // Editor UI is ephemera, not facts (the dotlit lesson): label editors and
  // their meta edges live only in the session, never in the substrate.
  if (el.type === 'edit-prompt') return;
  const key = factKeyOf(el);
  const canvasTag = `canvas:${canvasId}`;
  // Chip-display dims are transient; persist the TRUE geometry.
  const persisted: Record<string, unknown> = { ...el };
  if ((el as any)._factCard) delete persisted.type; // presentation, not the fact's
  if (typeof el._origW === 'number') {
    persisted.width = el._origW;
    persisted.height = el._origH;
  }
  const { domain, placement } = splitElement(persisted);

  // Semantic type/tags survive board edits: omit type when one is stored
  // (the substrate preserves omitted attributes); only brand-new facts get
  // stamped canvas-element. Tags only written when the canvas tag is missing.
  const known = factMeta.get(key);
  const extra: { type?: string; tags?: string[] } = {};
  if (!known || !known.type) extra.type = 'canvas-element';
  if (!known || !known.tags.includes(canvasTag)) {
    extra.tags = Array.from(new Set([...(known?.tags ?? []), canvasTag]));
  }
  queueFact(key, domain, extra);
  factMeta.set(key, {
    type: known?.type ?? 'canvas-element',
    tags: extra.tags ?? known?.tags ?? [canvasTag],
  });

  // Synthesized positions are the board's proposal, not the human's pin —
  // persist the placement only once the element has actually been moved.
  const so = synthOrigin.get(el.id as string);
  if (so && el.x === so.x && el.y === so.y) return;
  if (so) synthOrigin.delete(el.id as string);
  queueFact(`_canvas/${canvasId}/${key}`, placement);
}

const linkedEdges = new Set<string>();

export function queueEdgeWrite(canvasId: string, edge: Record<string, unknown>): void {
  if (!edge || typeof edge.id !== 'string' || readonlyBoard) return;
  if ((edge.data as Record<string, unknown> | undefined)?.meta) return; // meta edges are editor ephemera
  const src = edge.source as string | undefined;
  const tgt = edge.target as string | undefined;
  const rel = (typeof edge.label === 'string' && edge.label.trim() ? edge.label : 'relates').replace(/\|/g, '/');
  // Link-derived edges need no decoration fact unless they carry style/label edits.
  if (!(edge.id as string).startsWith('lnk:')) {
    queueFact(`_canvas/${canvasId}/edge:${edge.id}`, edge);
  }
  if (!src || !tgt) return;
  lastEdges.set(edge.id as string, { source: src, target: tgt, rel, decorated: !(edge.id as string).startsWith('lnk:') });
  const sig = `${src}|${rel}|${tgt}`;
  if (linkedEdges.has(sig)) return;
  linkedEdges.add(sig);
  act('workspace.link', { from: `el:${src}`, rel, to: `el:${tgt}` }).catch((err) =>
    console.warn('[substrate] link failed', sig, err),
  );
}

/* ------------------------------------------------------------------ */
/*  Public API — callers stay unchanged                               */
/* ------------------------------------------------------------------ */

export function saveCanvas(canvasState: any): void {
  if (readonlyBoard) return;
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => void _saveCanvas(canvasState), DEBOUNCE_SAVE_DELAY);
}

async function _saveCanvas(canvasState: any): Promise<void> {
  saveCanvasLocalOnly(canvasState);
  const cid = canvasState.canvasId;
  const live = new Set<string>();
  const liveEdgeIds = new Set<string>();
  for (const el of canvasState.elements ?? []) {
    live.add(factKeyOf(el));
    live.add(`_canvas/${cid}/${factKeyOf(el)}`);
    queueElementWrite(cid, el);
  }
  for (const edge of canvasState.edges ?? []) {
    liveEdgeIds.add(edge.id);
    if (!String(edge.id).startsWith('lnk:')) live.add(`_canvas/${cid}/edge:${edge.id}`);
    queueEdgeWrite(cid, edge);
  }
  // A removed edge unlinks the substrate truth (and retires its decoration).
  for (const [id, e] of [...lastEdges]) {
    if (liveEdgeIds.has(id)) continue;
    lastEdges.delete(id);
    linkedEdges.delete(`${e.source}|${e.rel}|${e.target}`);
    act('workspace.unlink', { from: `el:${e.source}`, rel: e.rel, to: `el:${e.target}` }).catch((err) =>
      console.warn('[substrate] unlink failed', id, err),
    );
    if (e.decorated) {
      const dk = `_canvas/${cid}/edge:${id}`;
      lastWritten.delete(dk);
      act('workspace.supersede', { key: dk }).catch(() => undefined);
    }
  }
  // Retire facts/placements that disappeared — supersede, never delete.
  for (const key of [...lastWritten.keys()]) {
    if (key.includes('/edge:')) continue; // handled above
    const mine = key.startsWith(`_canvas/${cid}/`) || key.startsWith('el:');
    if (!mine || live.has(key)) continue;
    lastWritten.delete(key);
    factMeta.delete(key);
    act('workspace.supersede', { key }).catch((err) => console.warn('[substrate] supersede failed', key, err));
  }
}

export function saveCanvasLocalOnly(state: any): void {
  if (readonlyBoard) return;
  const key = 'myCanvasData_' + state.canvasId;
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (err) {
    console.warn('localStorage quota?', err);
  }
}

export function getAuthToken(): string {
  return accessToken() ?? 'TBC';
}

export async function setBackpackItem(key: string, val: string): Promise<void> {
  try {
    await act('workspace.remember', { key: `bkpk:${key}`, value: val, via: 'canvas' });
  } catch (err) {
    console.warn('[substrate] setBackpackItem failed', key, err);
  }
}

interface QueryEntry {
  key: string;
  value: unknown;
  _meta?: { type?: string | null; tags?: string[]; score?: number };
}

interface LinkEdge {
  from: string;
  rel: string;
  to: string;
}

interface ViewRenderHint {
  type?: string;
  board?: string;
  viewport?: { x: number; y: number; scale: number } | 'fit';
  interactive?: boolean;
}

let readonlyBoard = false;

/** Pin the camera once the controller exists (a *named* viewpoint, not device state). */
function applyViewport(
  vp: { x: number; y: number; scale: number } | 'fit',
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null,
): void {
  const started = Date.now();
  const tick = (): void => {
    const cc = (window as { CC?: any }).CC;
    if (!cc) {
      if (Date.now() - started < 10000) setTimeout(tick, 120);
      return;
    }
    let scale: number, cx: number, cy: number;
    if (vp === 'fit') {
      if (!bbox) return;
      const bw = Math.max(bbox.maxX - bbox.minX, 200);
      const bh = Math.max(bbox.maxY - bbox.minY, 200);
      scale = Math.min((window.innerWidth * 0.85) / bw, (window.innerHeight * 0.85) / bh, 2);
      cx = (bbox.minX + bbox.maxX) / 2;
      cy = (bbox.minY + bbox.maxY) / 2;
    } else {
      scale = vp.scale ?? 1;
      cx = vp.x;
      cy = vp.y;
    }
    cc.viewState.scale = scale;
    cc.viewState.translateX = window.innerWidth / 2 - scale * cx;
    cc.viewState.translateY = window.innerHeight / 2 - scale * cy;
    cc.updateCanvasTransform();
    cc.requestRender();
  };
  setTimeout(tick, 150);
}

export async function loadInitialCanvas(defaultState: any, _paramToken?: string | null): Promise<any> {
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const viewId = params.get('view');
  const embed = params.get('embed') === '1';
  if (embed) document.body.classList.add('embed');

  // An embed never *redirects* to sign-in (it may be an iframe) — it asks.
  if (embed && !isAuthed()) {
    document.body.classList.add('embed-unauthed');
    readonlyBoard = true;
    return defaultState;
  }
  await ensureAuth();

  // The renderer ladder: built-in substrate types, then renderer FACTS —
  // both registered before the first element mounts.
  registerSubstrateTypes();
  await loadRendererFacts();
  factTypeDecls = (await loadTypes().catch(() => ({}))) as Record<string, { icon?: string }>;
  installImagePaste();

  // View-backed board: membership from the view's query; placements from its
  // board; camera from its declaration (shareable, pinned truth).
  let cid = defaultState.canvasId;
  let membership: Record<string, unknown> = { tag: `canvas:${cid}` };
  let viewport: ViewRenderHint['viewport'] | null = null;
  if (viewId) {
    try {
      const entry = await read<{ value?: { query?: Record<string, unknown>; render?: ViewRenderHint } } | null>(
        'workspace.peek',
        { key: `_views/${viewId}` },
      );
      const def = entry?.value;
      if (def?.query) membership = def.query;
      cid = def?.render?.board ?? (viewId.startsWith('canvas:') ? viewId.slice('canvas:'.length) : cid);
      viewport = def?.render?.viewport ?? 'fit';
      if (def?.render?.interactive === false || embed) readonlyBoard = true;
    } catch (err) {
      console.warn('[substrate] view load failed; falling back to board', viewId, err);
    }
  } else if (embed) {
    readonlyBoard = true;
    viewport = 'fit';
  }
  if (readonlyBoard) document.body.classList.add('readonly');

  const localKey = 'myCanvasData_' + cid;
  const localCopy = localStorage.getItem(localKey);
  try {
    const els = await read<{ entries: QueryEntry[]; count: number }>('workspace.query', membership);
    const deco = await read<{ entries: QueryEntry[]; count: number }>('workspace.query', { prefix: `_canvas/${cid}/` });
    let links: LinkEdge[] = [];
    try {
      links = (await read<{ edges: LinkEdge[] }>('workspace.links', {})).edges ?? [];
    } catch (err) {
      console.warn('[substrate] links unavailable; decoration edges only', err);
    }

    if ((els.count ?? 0) === 0 && (deco.count ?? 0) === 0 && localCopy && !viewId) {
      const seeded = JSON.parse(localCopy);
      console.log('[substrate] seeding empty canvas from local copy');
      saveCanvas(seeded);
      startSalience(cid);
      return seeded;
    }

    const prefix = `_canvas/${cid}/`;
    const placements = new Map<string, Record<string, unknown>>();
    const edges: any[] = [];
    for (const e of deco.entries ?? []) {
      lastWritten.set(e.key, JSON.stringify(e.value));
      const sub = e.key.slice(prefix.length);
      if (sub.startsWith('edge:')) {
        const edge = e.value as Record<string, unknown>;
        edges.push(edge);
        if (edge && typeof edge.id === 'string' && edge.source && edge.target) {
          const rel = (typeof edge.label === 'string' && edge.label.trim() ? edge.label : 'relates').replace(/\|/g, '/');
          lastEdges.set(edge.id, { source: edge.source as string, target: edge.target as string, rel, decorated: true });
          linkedEdges.add(`${edge.source}|${rel}|${edge.target}`);
        }
      } else placements.set(sub, (e.value ?? {}) as Record<string, unknown>);
    }

    // Reserved prefixes are the board's OWN data (placements, vocabulary,
    // type decls) — never board members, whatever the membership query says.
    els.entries = (els.entries ?? []).filter((e) => !e.key.startsWith('_'));
    const presentIds = new Set(els.entries.map((e) => e.key));

    // Edges are PROJECTED from substrate links among this board's elements;
    // decoration edges (style/label edits, edge-to-edge) merge by signature.
    const decorated = new Set(edges.map((e) => `${e.source}|${(e.label && String(e.label).trim()) || 'relates'}|${e.target}`));
    for (const l of links) {
      if (!presentIds.has(l.from) || !presentIds.has(l.to)) continue;
      const source = idOfKey(l.from);
      const target = idOfKey(l.to);
      if (decorated.has(`${source}|${l.rel}|${target}`)) continue;
      const id = `lnk:${l.from}|${l.rel}|${l.to}`;
      edges.push({ id, source, target, label: l.rel });
      lastEdges.set(id, { source, target, rel: l.rel, decorated: false });
      linkedEdges.add(`${source}|${l.rel}|${target}`);
    }

    // Edge hygiene: an edge whose endpoint is gone breaks the renderer (and
    // lies about the graph). Keep edges whose endpoints are present elements
    // or other surviving edges (edge-to-edge), to a fixpoint; self-heal stale
    // decorations by retiring them so they never return.
    const elIds = new Set([...presentIds].map((k) => (k.startsWith('el:') ? k.slice(3) : k)));
    let validEdges: any[] = edges.filter((e: any) => e && typeof e.id === 'string');
    const droppedEdges: any[] = [];
    let pruned = true;
    while (pruned) {
      pruned = false;
      // An endpoint may be an element, or another edge — but only a LABELED
      // edge renders an anchor node; an unlabeled target crashes the renderer
      // and means nothing visually.
      const labeled = new Map(validEdges.map((e: any) => [e.id, !!(e.label && String(e.label).trim())]));
      validEdges = validEdges.filter((e: any) => {
        const ok = (x: unknown): boolean => typeof x === 'string' && (elIds.has(x) || labeled.get(x) === true);
        const keep = ok(e.source) && ok(e.target);
        if (!keep) {
          droppedEdges.push(e);
          pruned = true;
        }
        return keep;
      });
    }
    for (const e of droppedEdges) {
      lastEdges.delete(e.id);
      if (!String(e.id).startsWith('lnk:')) {
        const dk = `_canvas/${cid}/edge:${e.id}`;
        lastWritten.delete(dk);
        if (!readonlyBoard) act('workspace.supersede', { key: dk }).catch(() => undefined);
      }
    }
    if (droppedEdges.length) console.warn('[substrate] retired stale edges', droppedEdges.map((e: any) => e.id));

    // Assemble elements; record stored meta + salience for the seams.
    const placed: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    const unplaced: any[] = [];
    const elements = (els.entries ?? []).map((e) => {
      lastWritten.set(e.key, JSON.stringify(e.value));
      factMeta.set(e.key, { type: e._meta?.type ?? null, tags: e._meta?.tags ?? [] });
      if (typeof e._meta?.score === 'number') salienceByKey.set(e.key, e._meta.score);
      const value = e.value as Record<string, unknown>;
      const pl = placements.get(e.key);
      const el: any = { width: 240, height: 120, rotation: 0, ...value, ...(pl ?? {}) };
      if (!el.id) el.id = e.key.startsWith('el:') ? e.key.slice(3) : e.key;
      el._factKey = e.key;
      decorateFactCard(el, e._meta);
      if (pl && typeof pl.x === 'number')
        placed.push({
          id: el.id,
          x: pl.x as number,
          y: pl.y as number,
          w: typeof pl.width === 'number' ? (pl.width as number) : 240,
          h: typeof pl.height === 'number' ? (pl.height as number) : 120,
        });
      else unplaced.push(el);
      return el;
    });

    // Synthesized placement — three tiers, never persisted until moved:
    //   1. gravity toward PLACED neighbours (the human's pins anchor the graph)
    //   2. linked clusters among the unplaced: hubs (degree ≥ 2 — days, docs)
    //      wrap in rows with their leaves stacked beneath — EDGES BECOME LAYOUT
    //   3. the link-less tray grid, salience-ordered
    const placedById = new Map(placed.map((p) => [p.id, p]));
    const placedNeighborsOf = (id: string): Array<{ x: number; y: number; w: number; h: number }> => {
      const out: Array<{ x: number; y: number; w: number; h: number }> = [];
      for (const e of lastEdges.values()) {
        if (e.source === id && placedById.has(e.target)) out.push(placedById.get(e.target)!);
        if (e.target === id && placedById.has(e.source)) out.push(placedById.get(e.source)!);
      }
      return out;
    };
    unplaced.sort(
      (a, b) =>
        (salienceByKey.get(b._factKey ?? `el:${b.id}`) ?? 0) - (salienceByKey.get(a._factKey ?? `el:${a.id}`) ?? 0),
    );
    const pin = (el: any, x: number, y: number): void => {
      el.x = x;
      el.y = y;
      el._synthesized = true;
      synthOrigin.set(el.id, { x, y });
    };

    // Tier 1: pinned-neighbour gravity.
    const rest: any[] = [];
    let gravIdx = 0;
    for (const el of unplaced) {
      const near = placedNeighborsOf(el.id);
      if (!near.length) {
        rest.push(el);
        continue;
      }
      const cx = near.reduce((acc, p) => acc + p.x, 0) / near.length;
      const cy = near.reduce((acc, p) => acc + p.y, 0) / near.length;
      const widest = Math.max(...near.map((p) => p.w));
      const ownW = typeof el.width === 'number' ? el.width : 240;
      const ownH = typeof el.height === 'number' ? el.height : 120;
      pin(el, cx + widest / 2 + ownW / 2 + 160, cy + gravIdx * (ownH + 70));
      gravIdx++;
    }

    // Tier 2: clusters among the unplaced themselves.
    const restIds = new Set(rest.map((e: any) => e.id));
    const adj = new Map<string, string[]>();
    const addAdj = (a: string, b: string): void => {
      if (!adj.has(a)) adj.set(a, []);
      adj.get(a)!.push(b);
    };
    for (const e of lastEdges.values()) {
      if (restIds.has(e.source) && restIds.has(e.target)) {
        addAdj(e.source, e.target);
        addAdj(e.target, e.source);
      }
    }
    const deg = (id: string): number => adj.get(id)?.length ?? 0;
    const hubs = rest
      .filter((el: any) => deg(el.id) >= 2)
      .sort((a: any, b: any) => String(a._factKey ?? a.id).localeCompare(String(b._factKey ?? b.id)));
    const hubSet = new Set(hubs.map((h: any) => h.id));
    const leavesOf = new Map<string, any[]>();
    const leafSet = new Set<string>();
    for (const el of rest) {
      if (hubSet.has(el.id) || deg(el.id) === 0) continue;
      const anchor = (adj.get(el.id) ?? []).find((n) => hubSet.has(n));
      if (anchor) {
        if (!leavesOf.has(anchor)) leavesOf.set(anchor, []);
        leavesOf.get(anchor)!.push(el);
        leafSet.add(el.id);
      }
    }
    const COLS = 8;
    let y0 = 60;
    for (let r = 0; r * COLS < hubs.length; r++) {
      const row = hubs.slice(r * COLS, r * COLS + COLS);
      let maxStack = 0;
      row.forEach((h: any, c: number) => {
        pin(h, 160 + c * 330, y0);
        const ls = leavesOf.get(h.id) ?? [];
        ls.forEach((leaf: any, i: number) => pin(leaf, 160 + c * 330 + (i % 2 ? 26 : -26), y0 + 140 + i * 112));
        maxStack = Math.max(maxStack, ls.length);
      });
      y0 += 200 + maxStack * 112;
    }

    // Tier 3: the tray, below the clusters.
    let trayIdx = 0;
    for (const el of rest) {
      if (hubSet.has(el.id) || leafSet.has(el.id)) continue;
      pin(el, 160 + (trayIdx % 10) * 300, y0 + 60 + Math.floor(trayIdx / 10) * 180);
      trayIdx++;
    }

    // Camera: pinned by the view declaration (or fit) — device free-roam wins otherwise.
    if (viewport) {
      const xs = elements.map((e: any) => e.x).filter((n: unknown) => typeof n === 'number');
      const ys = elements.map((e: any) => e.y).filter((n: unknown) => typeof n === 'number');
      const bbox = xs.length
        ? { minX: Math.min(...xs) - 180, minY: Math.min(...ys) - 120, maxX: Math.max(...xs) + 180, maxY: Math.max(...ys) + 120 }
        : null;
      applyViewport(viewport, bbox);
    }

    startSalience(cid);
    startLiveSync(cid);
    return { ...defaultState, canvasId: cid, elements, edges: validEdges };
  } catch (err) {
    console.error('[substrate] load failed — falling back to local copy', err);
    startSalience(cid);
    return localCopy ? JSON.parse(localCopy) : defaultState;
  }
}

/* ------------------------------------------------------------------ */
/*  Live sync — the open board tails the change feed                   */
/*  (canvas horizon A: remote facts/placements/links merge in-place;   */
/*   self-echoes dedup against lastWritten; reads go through `query`   */
/*   so syncing never inflates salience.)                              */
/* ------------------------------------------------------------------ */

let liveSyncStarted = false;
let liveCursor = 0;

async function fetchFact(key: string): Promise<{ key: string; value: any; _meta: any } | null> {
  const res = await read<{ entries: Array<{ key: string; value: any; _meta: any }> }>('workspace.query', {
    prefix: key,
    includeSuperseded: true,
    limit: 5,
  });
  return (res.entries ?? []).find((e) => e.key === key) ?? null;
}

function applyRemoteElement(cc: any, key: string, entry: { value: any; _meta: any } | null): boolean {
  if (!entry) return false;
  const json = JSON.stringify(entry.value);
  if (lastWritten.get(key) === json && !entry._meta?.superseded) return false; // self-echo
  const id = (entry.value && entry.value.id) || key.slice(3);
  if (entry._meta?.superseded) {
    if (!cc.canvasState.elements.some((e: any) => e.id === id)) return false;
    cc.canvasState.elements = cc.canvasState.elements.filter((e: any) => e.id !== id);
    lastWritten.delete(key);
    factMeta.delete(key);
    return true;
  }
  lastWritten.set(key, json);
  factMeta.set(key, { type: entry._meta?.type ?? null, tags: entry._meta?.tags ?? [] });
  if (typeof entry._meta?.score === 'number') salienceByKey.set(key, entry._meta.score);
  const el = cc.canvasState.elements.find((e: any) => e.id === id);
  if (el) {
    Object.assign(el, entry.value);
  } else {
    cc.canvasState.elements.push({ width: 240, height: 120, rotation: 0, x: 160, y: 60, _synthesized: true, ...entry.value });
    synthOrigin.set(id, { x: 160, y: 60 });
  }
  return true;
}

function applyRemotePlacement(cc: any, key: string, entry: { value: any; _meta: any } | null): boolean {
  if (!entry || entry._meta?.superseded) return false;
  const json = JSON.stringify(entry.value);
  if (lastWritten.get(key) === json) return false; // self-echo
  const id = key.slice(key.lastIndexOf('/el:') + 4);
  if (cc.selectedElementIds?.has?.(id)) return false; // never fight a live drag
  const el = cc.canvasState.elements.find((e: any) => e.id === id);
  if (!el) return false;
  lastWritten.set(key, json);
  const pl = { ...(entry.value as Record<string, unknown>) };
  // While elided, true geometry lives in _origW/_origH — update those, not the chip box.
  if (el._origW !== undefined) {
    if (typeof pl.width === 'number') el._origW = pl.width;
    if (typeof pl.height === 'number') el._origH = pl.height;
    delete pl.width;
    delete pl.height;
  }
  Object.assign(el, pl);
  delete el._synthesized;
  synthOrigin.delete(id);
  return true;
}

async function rebuildEdgesLive(cc: any, cid: string): Promise<void> {
  const presentIds = new Set(cc.canvasState.elements.map((e: any) => factKeyOf(e)));
  const deco = await read<{ entries: Array<{ key: string; value: any }> }>('workspace.query', { prefix: `_canvas/${cid}/edge:` });
  let links: LinkEdge[] = [];
  try {
    links = (await read<{ edges: LinkEdge[] }>('workspace.links', {})).edges ?? [];
  } catch { /* links unavailable */ }
  lastEdges.clear();
  linkedEdges.clear();
  const edges: any[] = [];
  for (const e of deco.entries ?? []) {
    const edge = e.value;
    lastWritten.set(e.key, JSON.stringify(e.value));
    if (!edge || typeof edge.id !== 'string') continue;
    edges.push(edge);
    const rel = ((edge.label && String(edge.label).trim()) || 'relates').replace(/\|/g, '/');
    lastEdges.set(edge.id, { source: edge.source, target: edge.target, rel, decorated: true });
    linkedEdges.add(`${edge.source}|${rel}|${edge.target}`);
  }
  const decorated = new Set(edges.map((e: any) => `${e.source}|${(e.label && String(e.label).trim()) || 'relates'}|${e.target}`));
  for (const l of links) {
    if (!presentIds.has(l.from) || !presentIds.has(l.to)) continue;
    const s = idOfKey(l.from);
    const t = idOfKey(l.to);
    if (decorated.has(`${s}|${l.rel}|${t}`)) continue;
    const id = `lnk:${l.from}|${l.rel}|${l.to}`;
    edges.push({ id, source: s, target: t, label: l.rel });
    lastEdges.set(id, { source: s, target: t, rel: l.rel, decorated: false });
    linkedEdges.add(`${s}|${l.rel}|${t}`);
  }
  const elIds = new Set(cc.canvasState.elements.map((e: any) => e.id));
  let valid = edges;
  let pruned = true;
  while (pruned) {
    pruned = false;
    const labeled = new Map(valid.map((e: any) => [e.id, !!(e.label && String(e.label).trim())]));
    valid = valid.filter((e: any) => {
      const ok = (x: unknown): boolean => typeof x === 'string' && (elIds.has(x) || labeled.get(x) === true);
      const keep = ok(e.source) && ok(e.target);
      if (!keep) pruned = true;
      return keep;
    });
  }
  cc.canvasState.edges = valid;
}

export function startLiveSync(cid: string): void {
  if (liveSyncStarted || typeof window === 'undefined') return;
  liveSyncStarted = true;
  const tick = async (): Promise<void> => {
    const cc = (window as { CC?: any }).CC;
    if (cc) {
      try {
        if (liveCursor === 0) {
          liveCursor = (await read<{ seq: number }>('workspace.changes', { sinceSeq: 0, limit: 0 })).seq;
        } else {
          const res = await read<{ events: Array<{ op: string; key: string | null }>; seq: number }>(
            'workspace.changes',
            { sinceSeq: liveCursor },
          );
          liveCursor = res.seq;
          const elKeys = new Set<string>();
          const placeKeys = new Set<string>();
          let edgesDirty = false;
          for (const ev of res.events ?? []) {
            if (ev.op === 'link' || ev.op === 'unlink') {
              edgesDirty = true;
              continue;
            }
            if (!ev.key) continue;
            if (ev.key.startsWith(`_canvas/${cid}/edge:`)) edgesDirty = true;
            else if (ev.key.startsWith(`_canvas/${cid}/el:`)) placeKeys.add(ev.key);
            else if (ev.key.startsWith('el:')) elKeys.add(ev.key);
          }
          let dirty = false;
          for (const key of elKeys) {
            if (applyRemoteElement(cc, key, await fetchFact(key))) dirty = true;
          }
          for (const key of placeKeys) {
            if (applyRemotePlacement(cc, key, await fetchFact(key))) dirty = true;
          }
          if (edgesDirty) {
            await rebuildEdgesLive(cc, cid);
            dirty = true;
          }
          if (dirty) {
            cc.requestRender();
            cc.requestEdgeUpdate();
          }
        }
      } catch { /* offline — retry next tick */ }
    }
    setTimeout(() => void tick(), 6000);
  };
  setTimeout(() => void tick(), 6000);
}
