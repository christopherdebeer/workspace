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
import { elementRegistry } from '../elements/elementRegistry.ts';
import { loadTypes, titleOf, hrefOf, createOutbox, createProjection, stableStringify } from 'https://parc.land/@c15r/kernel/app.js';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
import { installImagePaste } from './imagePaste.ts';
import { sanitizeElementGeometry } from '../geometry.ts';
import { regionBBox, fitRegion, type Region, type Placed, type BBox } from '../../../shared/frame.ts';

let saveTimeout: ReturnType<typeof setTimeout> | undefined;
const DEBOUNCE_SAVE_DELAY = 800;

/* ── ADR-0053 Inc 1: the write half lives in the kernel's Outbox ──────────
 * Canonical-JSON dedupe, debounced concurrent flush, retry with backoff,
 * echo windows, and the priming buffer were all hand-rolled here in
 * module-level maps — and every seam was one of this cycle's data bugs.
 * The kernel now owns those semantics; this file keeps only what is
 * CANVAS-shaped: what to write (payload splits), when (save sweeps), and
 * the board-scope bookkeeping (edges, meta, placements). */
const outbox = createOutbox(act as (t: string, i: Record<string, unknown>) => Promise<unknown>, {
  via: 'canvas',
  onState: (state) => {
    try { window.dispatchEvent(new CustomEvent('parc:save-state', { detail: { state } })); } catch { /* non-DOM */ }
  },
});

/* ── ADR-0053 Inc 2: the read half lives in the kernel's Projection ───────
 * The change-feed cursor loop, the ADR-0055 scope, echo suppression, and the
 * adaptive cadence were the inline tail of this file; the kernel owns them
 * now. This file keeps what is CANVAS-shaped: the element-vs-placement-vs-
 * edge dispatch, the live-revision refetch, and the in-place merges. */
type ChangeEvent = { op: string; key: string | null; rel?: string; to?: string };
let lastActivity = Date.now();
const projection = createProjection(read as (t: string, i?: unknown) => Promise<unknown>, outbox, {
  // One loop per page, but boards change under it (drill navigation) — the
  // scope is re-read every pump, keyed to the CURRENT board.
  scope: () => {
    const cc = typeof window !== 'undefined' ? (window as { CC?: any }).CC : undefined;
    const cid = cc?.canvasState?.canvasId ?? '';
    if (!cc || !cid) return null;
    // ADR-0055 Inc 3: the server ships only this board's slice — element
    // facts + board-space keys, state-changing ops only — instead of the
    // whole workspace firehose filtered client-side. An idle board's tick
    // is an empty page (seq still advances).
    return {
      prefixes: ['el:', `_canvas/${cid}/`],
      ops: SHOW_LINK_EDGES ? ['write', 'supersede', 'link', 'unlink'] : ['write', 'supersede'],
    };
  },
  apply: (events) => applyBoardEvents(events),
  // Adaptive cadence: 6s while the human is here, 30s once they've been idle
  // a couple of minutes — an untouched board must not poll at edit speed.
  intervalMs: () => (Date.now() - lastActivity < 120_000 ? 6000 : 30_000),
});
projection.subscribe(() => {
  const cc = typeof window !== 'undefined' ? (window as { CC?: any }).CC : undefined;
  if (cc) {
    cc.requestRender();
    cc.requestEdgeUpdate();
  }
});

/** Hydrate boot calls this BEFORE constructing the controller: the first
 *  render funnels every element through the write queue before the dedupe is
 *  seeded — priming buffers those writes and REPLAYS them once seeds exist. */
export function beginBoardPriming(): void { outbox.beginPriming(); }
function endBoardPriming(): void { outbox.endPriming(); }

/** One board per page lifetime is over (drill-in/up swap controllers):
 *  every per-board map must reset on load, or the save sweep treats the
 *  PREVIOUS board's keys as "mine, removed" and supersedes its facts —
 *  cross-board data loss. The outbox keeps its pending writes: in-flight
 *  edits still belong to their keys. */
function resetBoardScope(): void {
  outbox.reset();
  factMeta.clear();
  lastEdges.clear();
  linkedEdges.clear();
  synthOrigin.clear();
  lastPos.clear();
  salienceByKey.clear();
  readonlyBoard = false;
}

/** Stored substrate meta per fact key — preserves semantic type/tags on rewrite. */
const factMeta = new Map<string, { type: string | null; tags: string[] }>();
/** Known edges (link-derived and decorated) so removals can unlink. */
const lastEdges = new Map<string, { source: string; target: string; rel: string; decorated: boolean }>();
/** Synthesized (unpinned) positions — never persisted until the human moves them. */
const synthOrigin = new Map<string, { x: number; y: number }>();
/** Read-time salience per fact key, for the presentation channel. */
export const salienceByKey = new Map<string, number>();

/** The declared type vocabulary, for palette `type:` autocomplete. */
export function knownTypes(): Array<{ name: string; icon: string }> {
  return Object.entries(factTypeDecls)
    .map(([name, td]) => ({ name, icon: td?.present?.icon ?? td?.icon ?? '•' }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** The type vocabulary (`$types`), loaded once per board (kernel-cached). Carries
 *  the gateway-resolved Present facet (ADR-0012) — `present.icon` is the canonical
 *  type glyph, served from the type declaration, so a new type ships its icon as
 *  data (no canvas recompile). The legacy flat `icon` is the fallback. */
let factTypeDecls: Record<string, { icon?: string; present?: { icon?: string } }> = {};

/** Board-native types the legacy renderer handles without a registry view. */
const LEGACY_TYPES = new Set(['text', 'markdown', 'html', 'img', 'edit-prompt', 'canvas-container']);

/** A fact with no renderable type becomes a 'fact' CARD — presentation only
 *  (_fact* transients + a type the persister strips), value untouched.
 *  Title/href come from the kernel: _types declarations first, conventions
 *  as fallback — a new type's routing is one fact, no deploys. */
function decorateFactCard(el: any, meta: { type?: string | null; tags?: string[] } | undefined): void {
  // A VALUE-borne `type` (e.g. machine facts carry type:"machine" as a domain
  // field) only routes when something can actually draw it — a board-native
  // type or a registered view. Bailing on any truthy el.type sent such facts
  // to the unknown-type fallback, which renders NOTHING: invisible elements.
  if (el.type && (LEGACY_TYPES.has(el.type) || elementRegistry.viewFor(el.type))) return;
  const metaType = meta?.type ?? null;
  // A fact whose _meta.type has a registered renderer routes to that renderer
  // (the renderer ladder), instead of collapsing to the floor 'fact' card. The
  // fact's semantic type lives in _meta.type, not value.type, so without this
  // bridge every imported fact floors. Renderers register at board boot
  // (loadRendererFacts) before any element is decorated, so viewFor() is ready.
  if (metaType && elementRegistry.viewFor(metaType)) { el.type = metaType; return; }
  // Remember a value-borne type so the persister can KEEP it in the fact —
  // the _factCard type-strip below is for the presentation type only.
  if (el.type) el._valueType = el.type;
  el.type = 'fact';
  el._factCard = true;
  const entry = { key: String(el._factKey ?? el.id), value: el, _meta: { type: metaType, tags: meta?.tags ?? [] } };
  el._factTitle = titleOf(entry);
  // The kernel's convention fallback routes a canvas-tagged fact to its
  // board — but membership IS that tag, so for anything ON this board the
  // href was a self-link that just reloaded in place (long-press showed
  // ?canvas=<this board>). No link beats a dead link; real routes (a
  // type's open handler, docs in lit, OTHER boards) pass through.
  const href = hrefOf(entry);
  const self = !!href && !!currentBoardId
    && (href.includes(`canvas=${encodeURIComponent(currentBoardId)}`) || href.includes(`canvas=${currentBoardId}`));
  el._factHref = self ? undefined : href;
  const td = factTypeDecls[metaType ?? ''];
  el._factIcon = td?.present?.icon ?? td?.icon ?? '•';
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
  outbox.stage(key, value, extra); // dedupe/priming/retry/echo: kernel semantics (ADR-0053)
}

/** The EXACT payloads a save would write for this element — domain fact +
 *  placement decoration. One implementation, used by the write path AND by
 *  the loader to seed the dedup maps: seeding with the raw stored value
 *  instead used to make every legacy fact (placement fields still inside its
 *  value) look "changed" on every open — a full-board rewrite per load, which
 *  is what ran the DynamoDB table into throughput throttling. */
function elementPayloads(el: Record<string, unknown>): { domain: Record<string, unknown>; placement: Record<string, unknown> } {
  // Chip-display dims are transient; persist the TRUE geometry.
  const persisted: Record<string, unknown> = { ...el };
  if ((el as any)._factCard) {
    // The card's `type:'fact'` is presentation. If the VALUE had its own type
    // field (machine facts do), restore it — deleting outright would strip a
    // domain field from the fact on the next save.
    if ((el as any)._valueType) persisted.type = (el as any)._valueType;
    else delete persisted.type;
  }
  // parcland's client-side history — the substrate's revision chain IS the
  // history; persisting versions would double-store every prior value.
  delete persisted.versions;
  delete persisted.childCanvasState; // dead pre-refCanvasId nesting vestige
  if (typeof (el as any)._origW === 'number') {
    persisted.width = (el as any)._origW;
    persisted.height = (el as any)._origH;
  }
  return splitElement(persisted);
}

/** Per-element write (the CrdtAdapter seam funnels here too). */
export function queueElementWrite(canvasId: string, el: Record<string, unknown>): void {
  if (!el || typeof el.id !== 'string') return;
  // Editor UI is ephemera, not facts (the dotlit lesson): label editors and
  // their meta edges live only in the session, never in the substrate.
  if (el.type === 'edit-prompt') return;
  const key = factKeyOf(el);
  const { domain, placement } = elementPayloads(el);

  // Semantic type survives board edits: omit type when one is stored (the
  // substrate preserves omitted attributes); only brand-new facts get
  // stamped canvas-element. ADR-0054: membership is the PLACEMENT, never a
  // tag on the member fact — placing/viewing must not mutate the specimen.
  // Legacy canvas:* tags are still READ for membership (the load union) but
  // are never written again.
  const known = factMeta.get(key);
  const extra: { type?: string } = {};
  if (!known || !known.type) extra.type = 'canvas-element';
  queueFact(key, domain, extra);
  factMeta.set(key, {
    type: known?.type ?? 'canvas-element',
    tags: known?.tags ?? [],
  });

  // Synthesized positions are the board's proposal, not the human's pin —
  // persist the placement only once the element has actually been moved.
  // Movement (of anything — pinned or proposal) warms the field; the first
  // sighting of an element just registers it (load sweeps must not warm).
  const posKey = `${el.x},${el.y}`;
  const seen = lastPos.get(el.id as string);
  lastPos.set(el.id as string, posKey);
  if (seen !== undefined && seen !== posKey) warmField();

  const so = synthOrigin.get(el.id as string);
  if (so && el.x === so.x && el.y === so.y) return;
  if (so) {
    // The human moved it: the proposal became a pin.
    synthOrigin.delete(el.id as string);
    delete (el as any)._synthesized;
  }
  // ADR-0046: the placement is the board-membership edge-with-properties — its
  // declared type is what makes the key-encoded rule project `<fact> onBoard
  // canvas:<board>` into the Reference graph (type:null projects nothing).
  queueFact(`_canvas/${canvasId}/${key}`, placement, { type: 'canvas-placement' });
  ensureBoardFact(canvasId);
}

/** ADR-0046: membership edges need a node to point at — mint the board's
 *  identity fact (`canvas:<board>`, type canvas) once per session. Idempotent
 *  in effect (same value each time; at most one revision bump per session). */
const ensuredBoards = new Set<string>();
function ensureBoardFact(canvasId: string): void {
  if (!canvasId || ensuredBoards.has(canvasId)) return;
  ensuredBoards.add(canvasId);
  queueFact(`canvas:${canvasId}`, { board: canvasId }, { type: 'canvas' });
}

const linkedEdges = new Set<string>();

/** The substrate relation (TYPE) of an edge: explicit `rel`, else the legacy
 *  `label` (back-compat for edges authored before the split), else 'relates'.
 *  Editing the display `label` no longer rewrites the rel (ADR-0016). `|` is the
 *  reserved edge-id separator, so it's swapped out. */
function edgeRel(edge: { rel?: unknown; label?: unknown }): string {
  const r =
    typeof edge.rel === 'string' && edge.rel.trim() ? edge.rel
    : typeof edge.label === 'string' && edge.label.trim() ? edge.label
    : 'relates';
  return r.replace(/\|/g, '/');
}

export function queueEdgeWrite(canvasId: string, edge: Record<string, unknown>): void {
  if (!edge || typeof edge.id !== 'string' || readonlyBoard) return;
  if ((edge.data as Record<string, unknown> | undefined)?.meta) return; // meta edges are editor ephemera
  const src = edge.source as string | undefined;
  const tgt = edge.target as string | undefined;
  const rel = edgeRel(edge);
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
  if (outbox.priming()) return; // never diff against unseeded maps
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
      outbox.forget(dk);
      act('workspace.supersede', { key: dk }).catch(() => undefined);
    }
  }
  // Retire facts/placements that disappeared — supersede, never delete.
  for (const key of [...outbox.keys()]) {
    if (key.includes('/edge:')) continue; // handled above
    const mine = key.startsWith(`_canvas/${cid}/`) || key.startsWith('el:');
    if (!mine || live.has(key)) continue;
    outbox.forget(key);
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
/** The board currently loaded — used to suppress self-link "open" hrefs. */
let currentBoardId = '';

/* ── board composition flags ──────────────────────────────────────────────
 * The board shows what a human AUTHORED: decorated edges and pinned
 * placements. Substrate links (including inferred similarTo) stay in the
 * graph — queryable, expandable via "Expand links" — but are NOT projected
 * onto the canvas by default: at live scale (hundreds of links) they read
 * as noise, not structure. Likewise unplaced facts park in the salience
 * tray instead of a force-simulated field: positions on the board are
 * explicit, not physics. Debug escapes: ?links=1 re-projects link edges,
 * ?sim=1 restores the force field + warm episodes. */
const boardFlags = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const SHOW_LINK_EDGES = boardFlags.get('links') === '1';
const FIELD_SIM = boardFlags.get('sim') === '1';

/** Pin the camera once the controller exists (a *named* viewpoint, not device state).
 *  The `'fit'` case routes through the shared `fitRegion` resolver (ADR-0015) so SSR,
 *  the client, and embeds all frame a region identically. */
let vpTimer: ReturnType<typeof setTimeout> | null = null;
function applyViewport(
  vp: { x: number; y: number; scale: number } | 'fit',
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null,
): void {
  // Cancel any pending apply — rapid frame navigation used to queue several
  // delayed sets that replayed in sequence (wrong viewport "until it snaps").
  if (vpTimer) { clearTimeout(vpTimer); vpTimer = null; }
  const started = Date.now();
  const tick = (): void => {
    const cc = (window as { CC?: any }).CC;
    if (!cc) {
      vpTimer = Date.now() - started < 10000 ? setTimeout(tick, 120) : null;
      return;
    }
    vpTimer = null;
    if (vp === 'fit') {
      if (!bbox) return;
      const cam = fitRegion(bbox, window.innerWidth, window.innerHeight);
      cc.viewState.scale = cam.scale;
      cc.viewState.translateX = cam.tx;
      cc.viewState.translateY = cam.ty;
    } else {
      cc.viewState.scale = vp.scale ?? 1;
      cc.viewState.translateX = window.innerWidth / 2 - (vp.scale ?? 1) * vp.x;
      cc.viewState.translateY = window.innerHeight / 2 - (vp.scale ?? 1) * vp.y;
    }
    cc.updateCanvasTransform();
    cc.requestRender();
  };
  // Apply immediately — the frame fact + elements are already resolved by the
  // time we get here, so the old 150ms delay just left the wrong viewport on
  // screen before it snapped. tick() self-reschedules only if CC isn't up yet.
  tick();
}

/** Reduce the assembled board elements to the `Placed` shape the frame resolver
 *  needs (centre x,y + extents + type/tags for query regions). */
export function placedOf(elements: any[]): Placed[] {
  return elements.map((e) => ({
    key: e._factKey ?? `el:${e.id}`,
    type: factMeta.get(e._factKey ?? `el:${e.id}`)?.type ?? undefined,
    tags: factMeta.get(e._factKey ?? `el:${e.id}`)?.tags ?? undefined,
    x: e.x, y: e.y, width: e.width ?? 240, height: e.height ?? 120, scale: e.scale,
  }));
}

/** Focus the camera on a frame fact (`frame:<id>`): resolve its region to a bbox
 *  over the live elements, then fit. Returns true if it focused. (ADR-0015.) */
export async function focusFrame(frameId: string, elements: any[]): Promise<boolean> {
  try {
    const entry = await read<{ value?: { region?: Region } } | null>('workspace.peek', { key: `frame:${frameId}` });
    const region = entry?.value?.region;
    if (!region) return false;
    const bbox: BBox | null = regionBBox(region, placedOf(elements));
    if (!bbox) { console.warn('[canvas] frame', frameId, 'resolved no region (empty) — fit-all'); return false; }
    applyViewport('fit', bbox);
    console.info('[canvas] focused frame', { frameId, region: region.kind });
    return true;
  } catch (e) {
    console.warn('[canvas] focusFrame failed', frameId, e);
    return false;
  }
}

/* ── substrate search → add to board (item = fact × renderer × placement) ──── */

export interface FactHit { key: string; title: string; icon: string; type: string | null }
export interface FactSearchPage { hits: FactHit[]; nextCursor: string | null; total: number }

// The board's own machinery + ephemera — never offer these as "add to canvas".
const RESERVED_FACT = /^(_canvas\/|_views\/|_actions\/|_subscriptions\/|_groups\/|bkpk:|tending\/|machine-run\/|run\/|_caps\/)/;
// A cell's managed SUB-facts (machine rails, run claims, …): searching for
// "tending machine" must surface machine/tending, not drown it under nine of
// its own rails and run-claims — which is exactly what happened.
const INTERNAL_FACT = /\/(run|rail|claim)\//;

/** Search the slice for facts NOT already on this board, for the command
 *  palette. SEMANTIC + salience ranking (`query({text})`, ADR-0051 — not the
 *  old substring scan), with a `type:<name>` token for structural filtering
 *  ("type:machine tending") and a cursor so the palette can page. */
export async function searchFacts(q: string, controller: any, limit = 8, cursor?: string | null): Promise<FactSearchPage> {
  let query = q.trim();
  let type: string | undefined;
  query = query.replace(/\btype:([A-Za-z0-9_-]+)/g, (_m, t: string) => { type = t; return ''; }).trim();
  if (!type && query.length < 2) return { hits: [], nextCursor: null, total: 0 };
  const onBoard = new Set<string>(
    (controller?.canvasState?.elements ?? []).map((el: any) => el._factKey ?? `el:${el.id}`),
  );
  const input: Record<string, unknown> = { limit: limit + 12, shape: 'card' };
  if (type) input.type = type;
  if (query) input.text = query; // semantic, salience-blended ranking
  if (cursor) input.cursor = cursor;
  let r: { entries?: QueryEntry[]; nextCursor?: string; total?: number; types?: Record<string, { icon?: string; present?: { icon?: string } }> };
  try {
    r = await read('workspace.query', input);
  } catch (e) { console.warn('[canvas] fact search failed', e); return { hits: [], nextCursor: null, total: 0 }; }
  const hits: FactHit[] = [];
  for (const e of r.entries ?? []) {
    const key = e.key;
    if (!key || onBoard.has(key) || RESERVED_FACT.test(key) || INTERNAL_FACT.test(key) || key.startsWith('_canvas/')) continue;
    const t = e._meta?.type ?? null;
    const td = r.types?.[t ?? ''] ?? factTypeDecls[t ?? ''];
    let title = key;
    try { title = titleOf({ key, value: e.value, _meta: e._meta }) || key; } catch { /* fall back to key */ }
    hits.push({ key, title, type: t, icon: td?.present?.icon ?? td?.icon ?? '•' });
    if (hits.length >= limit) break;
  }
  return { hits, nextCursor: r.nextCursor ?? null, total: r.total ?? hits.length };
}

/** Add an existing substrate fact to THIS board: membership tag (clobber-safe —
 *  the fact's value + type are preserved, we only add `canvas:<cid>`), a pinned
 *  placement at the viewport centre, and an in-memory fact card so it appears at
 *  once (no reload). */
export async function addFactToCanvas(controller: any, key: string): Promise<void> {
  const cid = controller?.canvasState?.canvasId;
  if (!cid || !key) return;
  const present = controller.canvasState.elements.find((el: any) => (el._factKey ?? `el:${el.id}`) === key);
  if (present) { controller.recenterOnElement?.(present.id); return; } // already here — just go to it

  let value: Record<string, unknown> = {}, type: string | null = null, tags: string[] = [];
  try {
    const entry = await read<{ value?: any; _meta?: { type?: string | null; tags?: string[] } } | null>('workspace.peek', { key });
    value = (entry?.value ?? {}) as Record<string, unknown>;
    type = entry?._meta?.type ?? null;
    tags = entry?._meta?.tags ?? [];
  } catch (e) { console.warn('[canvas] addFact peek failed', key, e); return; }

  const pt = controller.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const el: any = { width: 240, height: 120, rotation: 0, ...value, id: idOfKey(key), x: Math.round(pt.x), y: Math.round(pt.y) };
  el._factKey = key;
  // Pre-seed meta so the element-write path never stamps `canvas-element` over
  // the fact's real type.
  factMeta.set(key, { type, tags });
  decorateFactCard(el, { type, tags });
  controller.canvasState.elements.push(el);
  controller.requestRender();

  // ADR-0054: the PLACEMENT is the membership record — board-space, board-
  // owned, durable through the same outbox as everything else. The member
  // fact itself is untouched: placing a fact on a board must not mutate it
  // (no revision churn, no tag writes, no write-permission requirement).
  queueFact(`_canvas/${cid}/${key}`, { x: el.x, y: el.y, width: el.width, height: el.height }, { type: 'canvas-placement' });
  ensureBoardFact(cid);
  console.info('[canvas] added fact to board', { key, cid, type });
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** A read with network timing + payload size, so a slow load shows WHICH call
 *  cost what (the substrate round-trips, not the local assembly). Logged under
 *  `[canvas] net` — visible with ?debug=1. */
async function timedRead<T>(label: string, target: string, input: unknown): Promise<{ value: T; ms: number; bytes: number }> {
  const t = nowMs();
  const value = await read<T>(target, input);
  const ms = Math.round(nowMs() - t);
  let bytes = -1;
  try { bytes = JSON.stringify(value).length; } catch { /* circular */ }
  console.info(`[canvas] net ${label}`, { ms, kb: bytes >= 0 ? Math.round(bytes / 1024) : '?', target });
  return { value, ms, bytes };
}

/** Surface a load-stage failure on the shell's err-banner. A caught error here
 *  is otherwise invisible — the board just blanks with the reason hidden in a
 *  `console.error` no one has open. Pairs with `?debug=1` (eruda) for the stack. */
function reportLoadFailure(stage: string, cid: string, err: unknown): void {
  const msg = `canvas "${cid}" load failed at [${stage}]: ${(err as Error)?.message ?? err}`;
  console.error('[canvas] load-failed', msg, err);
  const report = (window as unknown as { __canvasReport?: (m: string) => void }).__canvasReport;
  if (typeof report === 'function') report(msg);
}

/** ONE edge assembly for the load path AND the live-sync rebuild — the two
 *  inline copies drifted twice (decoration-retire behavior; the authored-only
 *  gate had to be written in both). Decorations parse/migrate and register in
 *  the write bookkeeping; substrate links seed the dedupe set (and project as
 *  bare edges only under ?links=1); the fixpoint prune drops edges whose
 *  endpoints (a present element, or a LABELED surviving edge) are gone, and
 *  retires dropped decorations so they never return. */
function assembleBoardEdges(
  cid: string,
  decoEntries: Array<{ key: string; value: any }>,
  links: LinkEdge[],
  presentKeys: Set<string>,
  elIds: Set<string>,
): any[] {
  const edges: any[] = [];
  for (const e of decoEntries) {
    const edge = e.value as Record<string, unknown> | null;
    if (!edge || typeof edge.id !== 'string') { outbox.seed(e.key, e.value); continue; }
    // Migration: a decoration authored before the rel/label split has only
    // `label` (which WAS the rel). Seed `rel` from it once.
    if (edge.rel == null && typeof edge.label === 'string') edge.rel = edgeRel(edge);
    // Seed AFTER the migration mutates the edge — seeding the pre-migration
    // shape made every legacy edge rewrite itself once per load.
    outbox.seed(e.key, edge);
    edges.push(edge);
    if (edge.source && edge.target) {
      const rel = edgeRel(edge);
      lastEdges.set(edge.id, { source: edge.source as string, target: edge.target as string, rel, decorated: true });
      linkedEdges.add(`${edge.source}|${rel}|${edge.target}`);
    }
  }
  // Substrate links among present elements: dedupe-set always; projection
  // only under ?links=1. Hidden links must NOT enter lastEdges — a lastEdges
  // entry with no live edge makes the next save sweep UNLINK it.
  const decorated = new Set(edges.map((e: any) => `${e.source}|${edgeRel(e)}|${e.target}`));
  for (const l of links) {
    if (!presentKeys.has(l.from) || !presentKeys.has(l.to)) continue;
    const s = idOfKey(l.from);
    const t = idOfKey(l.to);
    if (decorated.has(`${s}|${l.rel}|${t}`)) continue;
    linkedEdges.add(`${s}|${l.rel}|${t}`);
    if (!SHOW_LINK_EDGES) continue;
    const id = `lnk:${l.from}|${l.rel}|${l.to}`;
    edges.push({ id, source: s, target: t, rel: l.rel, label: l.rel });
    lastEdges.set(id, { source: s, target: t, rel: l.rel, decorated: false });
  }
  // Edge hygiene to a fixpoint: an endpoint may be an element, or another
  // edge — but only a LABELED edge renders an anchor node.
  let valid: any[] = edges;
  const dropped: any[] = [];
  let pruned = true;
  while (pruned) {
    pruned = false;
    const labeled = new Map(valid.map((e: any) => [e.id, !!(e.label && String(e.label).trim())]));
    valid = valid.filter((e: any) => {
      const ok = (x: unknown): boolean => typeof x === 'string' && (elIds.has(x) || labeled.get(x) === true);
      const keep = ok(e.source) && ok(e.target);
      if (!keep) {
        dropped.push(e);
        pruned = true;
      }
      return keep;
    });
  }
  for (const e of dropped) {
    lastEdges.delete(e.id);
    if (!String(e.id).startsWith('lnk:')) {
      const dk = `_canvas/${cid}/edge:${e.id}`;
      outbox.forget(dk);
      if (!readonlyBoard) act('workspace.supersede', { key: dk }).catch(() => undefined);
    }
  }
  if (dropped.length) console.warn('[substrate] retired stale edges', dropped.map((e: any) => e.id));
  return valid;
}

export async function loadInitialCanvas(defaultState: any, _paramToken?: string | null): Promise<any> {
  // Fresh board scope: whatever board this page was on before (hydrate boot,
  // drill navigation), its dedup/write bookkeeping must not leak into this one.
  outbox.beginPriming();
  resetBoardScope();
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const viewId = params.get('view');
  const embed = params.get('embed') === '1';
  if (embed) document.body.classList.add('embed');

  // An embed never *redirects* to sign-in (it may be an iframe) — it asks.
  if (embed && !isAuthed()) {
    document.body.classList.add('embed-unauthed');
    readonlyBoard = true;
    endBoardPriming();
    return defaultState;
  }
  // The board lives in the URL PATH (see lib/url.ts), and the kernel's OAuth
  // redirect_uri is `origin + pathname`, so the board survives the sign-in
  // round-trip natively — no crumb/restore dance needed.
  await ensureAuth();

  // The renderer ladder: built-in substrate types, then renderer FACTS —
  // both registered before the first element mounts.
  registerSubstrateTypes();
  // Bridges for dynamically-imported renderer facts (e.g. the repl viewer):
  // they can't import the canvas substrate client, so reach it via window.
  (window as any).__parcAct = act;
  (window as any).__parcRead = read;
  await loadRendererFacts();
  factTypeDecls = (await loadTypes().catch(() => ({}))) as Record<string, { icon?: string; present?: { icon?: string } }>;
  installImagePaste();

  // View-backed board: membership from the view's query; placements from its
  // board; camera from its declaration (shareable, pinned truth).
  let cid = defaultState.canvasId;
  currentBoardId = cid;
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
      currentBoardId = cid;
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
  // Breadcrumb of the load phase, so a thrown error names *where* it died
  // (read vs assembly vs layout) instead of blanking the board anonymously.
  // `tRead`/`tAsm` time the network vs local-compute split — the substrate
  // round-trips are the part we want to elide once SSR can hydrate the client.
  const tStart = nowMs();
  let stage = 'reads';
  try {
    // The three reads are independent — fire them concurrently so the slow
    // gateway queries (membership + placements were ~4s EACH, serial) overlap
    // instead of summing. Links is optional: a failure degrades to decoration
    // edges, it must not fail the whole load.
    const [elsR, decoR, linksR] = await Promise.all([
      timedRead<{ entries: QueryEntry[]; count: number }>('membership', 'workspace.query', membership),
      timedRead<{ entries: QueryEntry[]; count: number }>('placements', 'workspace.query', { prefix: `_canvas/${cid}/` }),
      timedRead<{ edges: LinkEdge[] }>('links', 'workspace.links', {}).catch((err) => {
        console.warn('[substrate] links unavailable; decoration edges only', err);
        return { value: { edges: [] as LinkEdge[] }, ms: 0, bytes: 0 };
      }),
    ]);
    const els = elsR.value, deco = decoR.value;
    const msMembers = elsR.ms, msPlace = decoR.ms, msLinks = linksR.ms;
    const links: LinkEdge[] = linksR.value.edges ?? [];
    stage = 'assemble';
    const tAsm = nowMs();
    console.info('[canvas] net total', {
      canvasId: cid,
      members: els.count ?? els.entries?.length ?? 0,
      placements: deco.count ?? deco.entries?.length ?? 0,
      links: links.length,
      readMs: Math.round(tAsm - tStart),
      breakdown: { membership: msMembers, placements: msPlace, links: msLinks },
    });

    if ((els.count ?? 0) === 0 && (deco.count ?? 0) === 0 && localCopy && !viewId) {
      const seeded = JSON.parse(localCopy);
      console.log('[substrate] seeding empty canvas from local copy');
      endBoardPriming(); // seeding IS the write — lift the gate (replaying buffered user writes)
      saveCanvas(seeded);
      startSalience(cid);
      return seeded;
    }

    const prefix = `_canvas/${cid}/`;
    const placements = new Map<string, Record<string, unknown>>();
    const edgeEntries: Array<{ key: string; value: any }> = [];
    const placementSeeds: Array<{ key: string; value: unknown }> = [];
    for (const e of deco.entries ?? []) {
      const sub = e.key.slice(prefix.length);
      if (sub.startsWith('edge:')) edgeEntries.push(e);
      else {
        placementSeeds.push({ key: e.key, value: e.value });
        placements.set(sub, (e.value ?? {}) as Record<string, unknown>);
      }
    }
    projection.seedInitial(placementSeeds); // the initial load seeds the outbox (ADR-0053 Inc 2)

    // Reserved prefixes are the board's OWN data (placements, vocabulary,
    // type decls) — never board members, whatever the membership query says.
    els.entries = (els.entries ?? []).filter((e) => !e.key.startsWith('_'));

    // ADR-0054 Inc 1: membership = placements ∪ tags. The placement fact is
    // the membership record (board-space, board-owned); the add path no
    // longer tags the member fact. A placement whose fact the tag query
    // didn't return is a placement-only member — fetch it. Legacy tag-only
    // members (e.g. tray items that were never pinned) keep riding the tag
    // query until retired (ADR-0054 Inc 3).
    {
      const tagged = new Set(els.entries.map((e) => e.key));
      const placementOnly = [...placements.keys()].filter((k) => !k.startsWith('edge:') && !tagged.has(k));
      if (placementOnly.length) {
        const fetched = await Promise.allSettled(placementOnly.slice(0, 80).map(async (k) => {
          const r = await read<{ entries: QueryEntry[] }>('workspace.query', { prefix: k, limit: 3 });
          return (r.entries ?? []).find((x) => x.key === k) ?? null;
        }));
        for (const f of fetched) {
          if (f.status === 'fulfilled' && f.value) els.entries.push(f.value);
        }
        console.info('[canvas] placement-only members joined', { placements: placementOnly.length });
      }
    }
    const presentIds = new Set(els.entries.map((e) => e.key));
    const elIds = new Set([...presentIds].map(idOfKey));
    const validEdges = assembleBoardEdges(cid, edgeEntries, links, presentIds, elIds);

    // Assemble elements; record stored meta + salience for the seams.
    const placed: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
    const unplaced: any[] = [];
    const elementSeeds: Array<{ key: string; value: unknown }> = [];
    const elements = (els.entries ?? []).map((e) => {
      factMeta.set(e.key, { type: e._meta?.type ?? null, tags: e._meta?.tags ?? [] });
      if (typeof e._meta?.score === 'number') salienceByKey.set(e.key, e._meta.score);
      const value = e.value as Record<string, unknown>;
      const pl = placements.get(e.key);
      const el: any = { width: 240, height: 120, rotation: 0, ...value, ...(pl ?? {}) };
      if (!el.id) el.id = e.key.startsWith('el:') ? e.key.slice(3) : e.key;
      el._factKey = e.key;
      // Heal poisoned geometry (a past runaway pinch persisted scale in the
      // hundreds) BEFORE it renders — at face value it's the iOS tab-kill.
      if (sanitizeElementGeometry(el)) console.warn('[canvas] healed out-of-bounds geometry', e.key);
      decorateFactCard(el, e._meta);
      // Seed the dedup maps with what a save WOULD write for this element —
      // not the raw stored value. A legacy fact still carrying x/width inside
      // its value otherwise diffs forever (domain strips placement fields),
      // so every open rewrote the whole board (the throttling storm).
      const seed = elementPayloads(el);
      elementSeeds.push({ key: e.key, value: seed.domain });
      if (pl) elementSeeds.push({ key: `${prefix}${e.key}`, value: seed.placement });
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
    projection.seedInitial(elementSeeds); // seeds → outbox: the change feed's own echoes no-op against these

    // Synthesized placement: a DETERMINISTIC force layout (d3-force).
    //   - pinned items join as FIXED nodes — gravity toward the human's pins
    //     emerges from the physics instead of being a special case
    //   - unplaced linked items seed from a key-sorted phyllotaxis (same
    //     facts → same layout, every load) and settle in a fixed tick count
    //   - the link-less keep the salience-ordered tray below the field
    const pin = (el: any, x: number, y: number): void => {
      el.x = Math.round(x);
      el.y = Math.round(y);
      el._synthesized = true;
      synthOrigin.set(el.id, { x: el.x, y: el.y });
    };
    stage = 'layout';
    const placedById = new Map(placed.map((p) => [p.id, p]));
    const linkedIds = new Set<string>();
    for (const e of lastEdges.values()) {
      linkedIds.add(e.source);
      linkedIds.add(e.target);
    }
    // Explicit positioning by default: EVERY unplaced item parks in the
    // salience tray. The force field (?sim=1) is a debug/spelunking view.
    const sims = FIELD_SIM
      ? unplaced.filter((el: any) => linkedIds.has(el.id)).sort((a: any, b: any) => String(a._factKey ?? a.id).localeCompare(String(b._factKey ?? b.id)))
      : [];
    const loose = FIELD_SIM ? unplaced.filter((el: any) => !linkedIds.has(el.id)) : unplaced;

    if (sims.length) {
      const cx0 = placed.length ? placed.reduce((a, p) => a + p.x, 0) / placed.length : 800;
      const cy0 = placed.length ? placed.reduce((a, p) => a + p.y, 0) / placed.length : 600;
      type SimNode = { id: string; x?: number; y?: number; fx?: number; fy?: number; el?: any };
      const nodes: SimNode[] = [
        ...placed.map((p) => ({ id: p.id, fx: p.x, fy: p.y })),
        ...sims.map((el: any, i: number) => {
          // Deterministic phyllotaxis seed around the field centre.
          const r = 140 * Math.sqrt(i + 1);
          const a = (i + 1) * 2.39996; // golden angle
          return { id: el.id, x: cx0 + r * Math.cos(a), y: cy0 + r * Math.sin(a), el };
        }),
      ];
      const present = new Set(nodes.map((n) => n.id));
      const simLinks = [...lastEdges.values()]
        .filter((e) => present.has(e.source) && present.has(e.target))
        .map((e) => ({ source: e.source, target: e.target }));
      const radiusOf = (n: SimNode): number => {
        const w = typeof n.el?.width === 'number' ? n.el.width : 250;
        const h = typeof n.el?.height === 'number' ? n.el.height : 100;
        return Math.hypot(w, h) / 2 + 24;
      };
      const sim = forceSimulation(nodes as any)
        .force('link', forceLink(simLinks as any).id((d: any) => d.id).distance(190).strength(0.55))
        .force('charge', forceManyBody().strength(-420))
        .force('collide', forceCollide().radius((d: any) => radiusOf(d)).iterations(2))
        .force('x', forceX(cx0).strength(0.03))
        .force('y', forceY(cy0).strength(0.03))
        .stop();
      sim.tick(180); // fixed count: deterministic settle, no animation
      for (const n of nodes as any[]) if (n.el) pin(n.el, n.x, n.y);
    }

    // The tray: link-less items, salience-ordered, parked under the field.
    loose.sort(
      (a: any, b: any) =>
        (salienceByKey.get(b._factKey ?? `el:${b.id}`) ?? 0) - (salienceByKey.get(a._factKey ?? `el:${a.id}`) ?? 0),
    );
    const fieldBottom = Math.max(
      120,
      ...placed.map((p) => p.y + p.h),
      ...sims.map((el: any) => (typeof el.y === 'number' ? el.y + (el.height ?? 100) : 0)),
    );
    let trayIdx = 0;
    for (const el of loose) {
      pin(el, 160 + (trayIdx % 10) * 300, fieldBottom + 140 + Math.floor(trayIdx / 10) * 180);
      trayIdx++;
    }

    // Camera: a view declaration pins it; an embed fits. For a bare board we fit
    // to content whenever the device camera (saved pan/zoom, or the origin
    // default) doesn't actually frame ANY element — otherwise the client reset to
    // the origin and the elements (at their real coordinates) fell off-screen, so
    // the SSR board "flashed" then went blank. A saved camera that DOES show
    // content is respected (free-roam persists).
    const xs = elements.map((e: any) => e.x).filter((n: unknown) => typeof n === 'number') as number[];
    const ys = elements.map((e: any) => e.y).filter((n: unknown) => typeof n === 'number') as number[];
    const bbox = xs.length
      ? { minX: Math.min(...xs) - 180, minY: Math.min(...ys) - 120, maxX: Math.max(...xs) + 180, maxY: Math.max(...ys) + 120 }
      : null;
    // Precedence (ADR-0015): explicit ?frame ▸ device saved camera (if it frames
    // content) ▸ fit-all. An explicit frame focus wins over everything.
    const frameId = params.get('frame');
    if (frameId) {
      void focusFrame(frameId, elements);
    } else {
      let cam: ViewRenderHint['viewport'] | null = viewport;
      if (!cam && !embed && bbox) {
        let saved: { scale?: number; translateX?: number; translateY?: number } | null = null;
        try { const s = localStorage.getItem('canvasViewState_' + cid); if (s) saved = JSON.parse(s); } catch { /* storage blocked */ }
        const W = window.innerWidth, H = window.innerHeight;
        const framesContent = !!saved && typeof saved.scale === 'number' && saved.scale > 0 && (() => {
          const s = saved!.scale as number;
          const vMinX = -(saved!.translateX ?? 0) / s, vMinY = -(saved!.translateY ?? 0) / s;
          const vMaxX = vMinX + W / s, vMaxY = vMinY + H / s;
          return vMaxX > bbox.minX && vMinX < bbox.maxX && vMaxY > bbox.minY && vMinY < bbox.maxY;
        })();
        if (!framesContent) {
          cam = 'fit';
          console.info('[canvas] camera does not frame content — fitting to board', { canvasId: cid, hadSavedView: !!saved });
        }
      }
      if (cam) applyViewport(cam, bbox);
    }

    // An embed is a still picture: render once, start nothing. The background
    // services (salience polling, the change-feed live-sync, the flight
    // recorder) are what make an idle board cost CPU + substrate reads forever
    // — N embeds = N copies, which is what crashed pages full of boards. The
    // core renderer is already on-demand (coalesced requestRender), so an inert
    // embed truly settles after first paint.
    if (!embed) {
      startSalience(cid);
      startLiveSync(cid);
      startFlightRecorder();
    }
    document.addEventListener('parc:expand', (ev) => {
      const cc = (window as { CC?: any }).CC;
      const d = (ev as CustomEvent).detail as { key: string; id: string };
      if (cc && !readonlyBoard && d?.key) void expandFact(cc, d.key, d.id);
    });
    console.info('[canvas] assembled', { canvasId: cid, elements: elements.length, placed: placed.length, synthesized: elements.length - placed.length, edges: validEdges.length, assembleMs: Math.round(nowMs() - tAsm) });
    endBoardPriming(); // dedup maps seeded — writes flow, buffered user writes replay
    return { ...defaultState, canvasId: cid, elements, edges: validEdges };
  } catch (err) {
    // Make the swallowed failure visible (it was a silent console.error before),
    // naming the stage. The fallback to a local copy / empty state stays, but a
    // resulting blank board now has an on-screen reason instead of none.
    reportLoadFailure(stage, cid, err);
    startSalience(cid);
    const fallback = localCopy ? JSON.parse(localCopy) : defaultState;
    console.warn(`[canvas] falling back to ${localCopy ? 'local cached copy' : 'EMPTY state'} after [${stage}] failure`);
    endBoardPriming();
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/*  Live sync — the kernel Projection tails the change feed            */
/*  (canvas horizon A: remote facts/placements/links merge in-place;   */
/*   self-echoes dedup against the outbox seeds; reads go via `query`   */
/*   so syncing never inflates salience.)                              */
/* ------------------------------------------------------------------ */

let liveSyncStarted = false;

async function fetchFact(key: string): Promise<{ key: string; value: any; _meta: any } | null> {
  const res = await read<{ entries: Array<{ key: string; value: any; _meta: any }> }>('workspace.query', {
    prefix: key,
    includeSuperseded: true,
    limit: 5,
  });
  // Revision order isn't asserted by the query: prefer the LIVE revision, and
  // only report superseded when no live one exists (else live-sync could act
  // on a stale copy — even deleting a live element).
  const hits = (res.entries ?? []).filter((e) => e.key === key);
  return hits.find((e) => !e._meta?.superseded) ?? hits[0] ?? null;
}

function applyRemoteElement(cc: any, key: string, entry: { value: any; _meta: any } | null): boolean {
  if (!entry) return false;
  const json = stableStringify(entry.value);
  if (outbox.seededJson(key) === json && !entry._meta?.superseded) return false; // self-echo
  const id = (entry.value && entry.value.id) || key.slice(3);
  if (entry._meta?.superseded) {
    if (!cc.canvasState.elements.some((e: any) => e.id === id)) return false;
    cc.canvasState.elements = cc.canvasState.elements.filter((e: any) => e.id !== id);
    outbox.forget(key);
    factMeta.delete(key);
    return true;
  }
  outbox.seed(key, entry.value);
  factMeta.set(key, { type: entry._meta?.type ?? null, tags: entry._meta?.tags ?? [] });
  if (typeof entry._meta?.score === 'number') salienceByKey.set(key, entry._meta.score);
  const el = cc.canvasState.elements.find((e: any) => e.id === id);
  if (el) {
    Object.assign(el, entry.value);
    sanitizeElementGeometry(el);
  } else {
    const nu: any = { width: 240, height: 120, rotation: 0, ...entry.value };
    sanitizeElementGeometry(nu);
    if (!nu.id) nu.id = id;
    nu._factKey = key;
    decorateFactCard(nu, entry._meta);
    // Arrivals land near a present linked neighbour, else cascade — never
    // a single hardcoded spot (the clump failure mode).
    let ax: number | undefined;
    let ay: number | undefined;
    for (const e of lastEdges.values()) {
      const other = e.source === nu.id ? e.target : e.target === nu.id ? e.source : null;
      if (!other) continue;
      const n = cc.canvasState.elements.find((x: any) => x.id === other);
      if (n) {
        ax = n.x + 300;
        ay = n.y + ((arrivalIdx % 5) - 2) * 64;
        break;
      }
    }
    arrivalIdx++;
    nu.x = ax ?? 160 + (arrivalIdx % 8) * 64;
    nu.y = ay ?? 60 + (arrivalIdx % 8) * 48 + Math.floor(arrivalIdx / 8) * 44;
    nu._synthesized = true;
    synthOrigin.set(nu.id, { x: nu.x, y: nu.y });
    cc.canvasState.elements.push(nu);
    warmField();
  }
  return true;
}

function applyRemotePlacement(cc: any, key: string, entry: { value: any; _meta: any } | null): boolean {
  if (!entry || entry._meta?.superseded) return false;
  const json = stableStringify(entry.value);
  if (outbox.seededJson(key) === json) return false; // self-echo
  const id = key.slice(key.lastIndexOf('/el:') + 4);
  if (cc.selectedElementIds?.has?.(id)) return false; // never fight a live drag
  const el = cc.canvasState.elements.find((e: any) => e.id === id);
  if (!el) return false;
  outbox.seed(key, entry.value);
  const pl = { ...(entry.value as Record<string, unknown>) };
  // While elided, true geometry lives in _origW/_origH — update those, not the chip box.
  if (el._origW !== undefined) {
    if (typeof pl.width === 'number') el._origW = pl.width;
    if (typeof pl.height === 'number') el._origH = pl.height;
    delete pl.width;
    delete pl.height;
  }
  Object.assign(el, pl);
  sanitizeElementGeometry(el);
  delete el._synthesized;
  synthOrigin.delete(id);
  return true;
}

async function rebuildEdgesLive(cc: any, cid: string): Promise<void> {
  const presentIds = new Set<string>(cc.canvasState.elements.map((e: any) => factKeyOf(e)));
  const deco = await read<{ entries: Array<{ key: string; value: any }> }>('workspace.query', { prefix: `_canvas/${cid}/edge:` });
  let links: LinkEdge[] = [];
  try {
    links = (await read<{ edges: LinkEdge[] }>('workspace.links', {})).edges ?? [];
  } catch { /* links unavailable */ }
  lastEdges.clear();
  linkedEdges.clear();
  const elIds = new Set<string>(cc.canvasState.elements.map((e: any) => e.id));
  const rebuilt = assembleBoardEdges(cid, deco.entries ?? [], links, presentIds, elIds);
  // Session-local edges (expandFact's neighbourhood projection) aren't
  // substrate decorations — a remote link event must not silently drop them.
  // Only when projection is OFF: under ?links=1 the rebuild already carries
  // every live link, and preserving extras would defeat remote unlinks.
  const rebuiltIds = new Set(rebuilt.map((e: any) => e.id));
  const sessionEdges: any[] = SHOW_LINK_EDGES ? [] : (cc.canvasState.edges ?? []);
  for (const e of sessionEdges) {
    if (String(e.id).startsWith('lnk:') && !rebuiltIds.has(e.id)) {
      const ok = (x: unknown): boolean => typeof x === 'string' && elIds.has(x);
      if (ok(e.source) && ok(e.target)) {
        rebuilt.push(e);
        lastEdges.set(e.id, { source: e.source, target: e.target, rel: edgeRel(e), decorated: false });
      }
    }
  }
  cc.canvasState.edges = rebuilt;
}

let warmUntil = 0;
let warmRaf = 0;
let arrivalIdx = 0;
/** Last seen position per element — movement (not save sweeps) warms the field. */
const lastPos = new Map<string, string>();

/**
 * The continuous warmer: while movement keeps arriving (a drag, an
 * expansion, a live arrival), the synthesized field flows around the
 * fixed items — including the one being dragged, whose fixed position
 * is re-read every frame. A few ticks per frame: animation, not a snap.
 * 700ms after the last movement the field cools and settles.
 */
function warmField(): void {
  // No physics on an explicitly-positioned board (?sim=1 restores it) — the
  // field animation moved items the human never asked to move.
  if (!FIELD_SIM) return;
  if (readonlyBoard || typeof window === 'undefined') return;
  warmUntil = performance.now() + 700;
  if (warmRaf) return; // loop already running
  const cc = (window as { CC?: any }).CC;
  if (!cc) return;

  type N = { id: string; x?: number; y?: number; fx?: number; fy?: number; el?: any; fixedEl?: any };
  const els = cc.canvasState.elements as any[];
  // Link-less items sit OUT of the simulation entirely: with no link force
  // to hold them, charge alone shoves them further out every episode (the
  // drift failure mode). The tray is a shelf, not a participant.
  const linkedIds = new Set<string>();
  for (const e of lastEdges.values()) {
    linkedIds.add(e.source);
    linkedIds.add(e.target);
  }
  const nodes: N[] = els
    .filter((e) => linkedIds.has(e.id))
    .map((e) =>
      e._synthesized ? { id: e.id, x: e.x, y: e.y, el: e } : { id: e.id, fx: e.x, fy: e.y, fixedEl: e },
    );
  if (!nodes.some((n) => n.el)) return; // nothing synthesized to arrange
  const present = new Set(nodes.map((n) => n.id));
  const links = [...lastEdges.values()]
    .filter((e) => present.has(e.source) && present.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));
  const sim = forceSimulation(nodes as any)
    .force('link', forceLink(links as any).id((d: any) => d.id).distance(190).strength(0.5))
    .force('charge', forceManyBody().strength(-380))
    .force(
      'collide',
      forceCollide()
        .radius((d: any) => {
          const e = d.el ?? d.fixedEl;
          const w = typeof e?.width === 'number' ? e.width : 250;
          const h = typeof e?.height === 'number' ? e.height : 100;
          return Math.hypot(w, h) / 2 + 22;
        })
        .iterations(2),
    )
    .stop();

  const episodeEnd = performance.now() + 8000; // hard cap: no eternal episodes
  const frame = (): void => {
    if (document.hidden) {
      warmRaf = 0; // a hidden tab does no physics
      return;
    }
    const now = performance.now();
    // The dragged (fixed) items move under the simulation's feet — track them.
    for (const n of nodes as any[]) {
      if (n.fixedEl) {
        n.fx = n.fixedEl.x;
        n.fy = n.fixedEl.y;
      }
    }
    sim.alpha(0.3);
    sim.tick(3);
    for (const n of nodes as any[]) {
      if (!n.el) continue;
      n.el.x = Math.round(n.x);
      n.el.y = Math.round(n.y);
      synthOrigin.set(n.el.id, { x: n.el.x, y: n.el.y }); // still the board's proposal
      // Self-feed guard: our own movement is not "movement" — pre-register it
      // so the save/CRDT sweep doesn't re-warm the field with our writes.
      lastPos.set(n.el.id, `${n.el.x},${n.el.y}`);
    }
    cc.requestRender();
    cc.requestEdgeUpdate();
    if (now < warmUntil && now < episodeEnd) {
      warmRaf = requestAnimationFrame(frame);
    } else {
      warmRaf = 0; // cooled — next movement builds a fresh episode
    }
  };
  warmRaf = requestAnimationFrame(frame);
}

/**
 * Un-pin: the inverse of drag-to-pin. The placement decoration retires
 * (supersede — provenance survives), the element returns to the board's
 * proposal layer (synthesized), and the field re-arranges it. Un-sticks
 * stuck items too (static/fixed flags clear).
 */
export function unpinElements(cc: any, ids: string[]): void {
  if (readonlyBoard) return;
  const cid = cc.canvasState.canvasId;
  for (const id of ids) {
    const el = cc.canvasState.elements.find((e: any) => e.id === id);
    if (!el) continue;
    const placementKey = `_canvas/${cid}/${factKeyOf(el)}`;
    outbox.forget(placementKey);
    act('workspace.supersede', { key: placementKey }).catch((err) =>
      console.warn('[substrate] unpin supersede failed', placementKey, err),
    );
    el._synthesized = true;
    el.static = false;
    delete el.fixedTop;
    delete el.fixedLeft;
    synthOrigin.set(el.id, { x: el.x, y: el.y }); // proposal starts where it stood
    lastPos.set(el.id, `${el.x},${el.y}`);
  }
  cc.clearSelection?.();
  warmField(); // the field takes them back
  cc.requestRender();
  cc.requestEdgeUpdate();
}

/**
 * Expand a fact's neighbourhood onto the board (a deliberate attention act,
 * like tapping a chip): fetch one hop, materialise absent neighbours as
 * synthesized cards ringed around the anchor, project the edges, and peek
 * the fact so real salience follows attention. Day cards bring their
 * elided captures back this way.
 */
async function expandFact(cc: any, key: string, anchorId: string): Promise<void> {
  const nb = await read<{
    outbound: Array<{ from: string; rel: string; to: string }>;
    inbound: Array<{ from: string; rel: string; to: string }>;
    entries: Record<string, { value: any; _meta?: any }>;
  }>('workspace.neighbors', { key });
  const anchor = cc.canvasState.elements.find((e: any) => e.id === anchorId);
  if (!anchor) return;
  const have = new Set(cc.canvasState.elements.map((e: any) => factKeyOf(e)));
  const edges = [...(nb.inbound ?? []), ...(nb.outbound ?? [])];
  const newKeys = edges
    .map((e) => (e.to === key ? e.from : e.to))
    .filter((k, i, a) => a.indexOf(k) === i && !have.has(k) && !k.startsWith('_'));

  newKeys.sort();
  newKeys.forEach((k, i) => {
    const entry = nb.entries?.[k];
    if (!entry) return;
    const value = entry.value ?? {};
    const el: any = { width: 240, height: 120, rotation: 0, ...(typeof value === 'object' ? value : { content: String(value) }) };
    if (!el.id) el.id = idOfKey(k);
    el._factKey = k;
    sanitizeElementGeometry(el);
    decorateFactCard(el, entry._meta);
    const a = (i / Math.max(newKeys.length, 1)) * 2 * Math.PI - Math.PI / 2;
    const r = 260 + 26 * Math.floor(i / 12);
    el.x = Math.round(anchor.x + r * Math.cos(a));
    el.y = Math.round(anchor.y + r * Math.sin(a));
    el._synthesized = true;
    synthOrigin.set(el.id, { x: el.x, y: el.y });
    outbox.seed(k, entry.value);
    factMeta.set(k, { type: entry._meta?.type ?? null, tags: entry._meta?.tags ?? [] });
    if (typeof entry._meta?.score === 'number') salienceByKey.set(k, entry._meta.score);
    cc.canvasState.elements.push(el);
  });

  const present = new Map(cc.canvasState.elements.map((e: any) => [factKeyOf(e), e.id]));
  for (const e of edges) {
    const sId = present.get(e.from);
    const tId = present.get(e.to);
    if (!sId || !tId) continue;
    const id = `lnk:${e.from}|${e.rel}|${e.to}`;
    if (cc.canvasState.edges.some((x: any) => x.id === id)) continue;
    cc.canvasState.edges.push({ id, source: sId, target: tId, label: e.rel });
    lastEdges.set(id, { source: sId, target: tId, rel: e.rel, decorated: false });
    linkedEdges.add(`${sId}|${e.rel}|${tId}`);
  }
  cc.requestRender();
  cc.requestEdgeUpdate();
  warmField(); // fold the new ring into the field
  read('workspace.peek', { key }).catch(() => undefined); // attention raises salience
}

/**
 * Flight recorder: a 1s heartbeat of vital signs into localStorage. If the
 * page dies without a clean pagehide (the iOS tab-kill case — no error
 * event, no banner), the NEXT boot surfaces the final record, so a crash
 * that leaves no trace still tells us what was growing.
 */
let flightStarted = false;
function startFlightRecorder(): void {
  if (flightStarted || typeof window === 'undefined') return;
  flightStarted = true; // one recorder per page — drills must not stack them
  const KEY = 'parc.canvas.flight';
  try {
    const prev = localStorage.getItem(KEY);
    if (prev) {
      const p = JSON.parse(prev);
      if (!p.clean) {
        // Route through the new copyable/persisted banner (window.__canvasReport)
        // — the old code poked banner.textContent/onclick, which the restructured
        // banner broke, so these crash vitals were no longer reaching anyone.
        const report = (window as unknown as { __canvasReport?: (m: string) => void }).__canvasReport;
        const msg = `💥 previous session died uncleanly — last vitals before the crash:\n${JSON.stringify(p, null, 2)}`;
        if (typeof report === 'function') report(msg);
        console.warn('[flight] unclean exit, last vitals', p);
      }
    }
  } catch { /* storage unavailable */ }
  const record = (clean: boolean): void => {
    try {
      const cc = (window as { CC?: any }).CC;
      const mem = (performance as any).memory;
      localStorage.setItem(KEY, JSON.stringify({
        t: new Date().toISOString().slice(11, 19),
        els: cc?.canvasState?.elements?.length ?? 0,
        edges: cc?.canvasState?.edges?.length ?? 0,
        dom: document.querySelectorAll('.canvas-element').length,
        // `dom` only counts .canvas-element; allNodes catches detached/foreign
        // growth (e.g. an element script that clones the board into itself).
        allNodes: document.getElementsByTagName('*').length,
        svg: document.querySelectorAll('#edges-layer *').length,
        // SMIL/CSS animations + media that keep the compositor busy on iOS.
        anim: document.querySelectorAll('animate,animateTransform,animateMotion,[style*="animation"]').length,
        // The largest painted side (width×scale) on the board — the runaway-
        // pinch signature: a crash record with maxSide in the tens of
        // thousands says compositor OOM, not a JS leak.
        maxSide: Math.round((cc?.canvasState?.elements ?? []).reduce(
          (m: number, e: any) => Math.max(m, Math.max(e.width || 0, e.height || 0) * (e.scale || 1)), 0)),
        warm: warmRaf !== 0,
        // Every module-level map — any monotonic climber here is a real leak.
        maps: { lw: [...outbox.keys()].length, place: lastPos.size, synth: synthOrigin.size, fmeta: factMeta.size, sal: salienceByKey.size, edge: lastEdges.size, linked: linkedEdges.size },
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : undefined,
        clean,
      }));
    } catch { /* storage unavailable */ }
  };
  // Live vitals on demand — watch what grows WHILE panning (heapMB/dom/svg/lw)
  // instead of waiting for the crash: call window.__canvasVitals() in the console.
  (window as unknown as { __canvasVitals?: () => unknown }).__canvasVitals = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
  };
  setInterval(() => record(false), 1000);
  window.addEventListener('pagehide', () => record(true));
}

/** The canvas-shaped half of a pump: events arrive echo-suppressed and
 *  ADR-0055-scoped from the kernel projection; this dispatches by key prefix,
 *  refetches the live revision, and merges in place. Render scheduling lives
 *  in the projection subscription. */
async function applyBoardEvents(events: ChangeEvent[]): Promise<boolean> {
  const cc = (window as { CC?: any }).CC;
  const cid = cc?.canvasState?.canvasId ?? '';
  if (!cc || !cid) return false;
  const elKeys = new Set<string>();
  const placeKeys = new Set<string>();
  let edgesDirty = false;
  for (const ev of events) {
    if (ev.op === 'link' || ev.op === 'unlink') {
      // Link events carry endpoints and arrive pre-scoped to this slice
      // (key OR `to` matches) — with projection on, that means our edge
      // set may be stale; with it off they don't render.
      if (SHOW_LINK_EDGES) edgesDirty = true;
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
  return dirty;
}

export function startLiveSync(_cid: string): void {
  if (liveSyncStarted || typeof window === 'undefined') return;
  // Diagnostic kill-switch: ?nosync=1 disables the change-feed poller so a crash
  // can be bisected (is the live merge implicated, or purely local render?).
  try {
    if (new URLSearchParams(location.search).get('nosync') === '1') {
      console.warn('[canvas] live-sync OFF (?nosync=1) — change-feed poller disabled');
      return;
    }
  } catch { /* no URL */ }
  liveSyncStarted = true;
  const bump = (): void => { lastActivity = Date.now(); };
  window.addEventListener('pointerdown', bump, { passive: true });
  window.addEventListener('keydown', bump, { passive: true });
  projection.start();
}
