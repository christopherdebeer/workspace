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
import { loadTypes, titleOf, hrefOf } from 'https://parc.land/@c15r/kernel/app.js';
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
import { installImagePaste } from './imagePaste.ts';
import { regionBBox, fitRegion, type Region, type Placed, type BBox } from '../../../shared/frame.ts';

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

/** The type vocabulary (`$types`), loaded once per board (kernel-cached). Carries
 *  the gateway-resolved Present facet (ADR-0012) — `present.icon` is the canonical
 *  type glyph, served from the type declaration, so a new type ships its icon as
 *  data (no canvas recompile). The legacy flat `icon` is the fallback. */
let factTypeDecls: Record<string, { icon?: string; present?: { icon?: string } }> = {};

/** A fact with no renderable type becomes a 'fact' CARD — presentation only
 *  (_fact* transients + a type the persister strips), value untouched.
 *  Title/href come from the kernel: _types declarations first, conventions
 *  as fallback — a new type's routing is one fact, no deploys. */
function decorateFactCard(el: any, meta: { type?: string | null; tags?: string[] } | undefined): void {
  if (el.type) return;
  const metaType = meta?.type ?? null;
  // A fact whose _meta.type has a registered renderer routes to that renderer
  // (the renderer ladder), instead of collapsing to the floor 'fact' card. The
  // fact's semantic type lives in _meta.type, not value.type, so without this
  // bridge every imported fact floors. Renderers register at board boot
  // (loadRendererFacts) before any element is decorated, so viewFor() is ready.
  if (metaType && elementRegistry.viewFor(metaType)) { el.type = metaType; return; }
  el.type = 'fact';
  el._factCard = true;
  const entry = { key: String(el._factKey ?? el.id), value: el, _meta: { type: metaType, tags: meta?.tags ?? [] } };
  el._factTitle = titleOf(entry);
  el._factHref = hrefOf(entry);
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
  // parcland's client-side history — the substrate's revision chain IS the
  // history; persisting versions would double-store every prior value.
  delete persisted.versions;
  delete persisted.childCanvasState; // dead pre-refCanvasId nesting vestige
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
  queueFact(`_canvas/${canvasId}/${key}`, placement);
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

// The board's own machinery + ephemera — never offer these as "add to canvas".
const RESERVED_FACT = /^(_canvas\/|_views\/|_actions\/|_subscriptions\/|_groups\/|bkpk:|tending\/|machine-run\/|run\/)/;

/** Search the slice for facts NOT already on this board, for the command palette
 *  (substring `contains` scan, salience-ranked). Excludes reserved/system keys
 *  and items already present. */
export async function searchFacts(q: string, controller: any, limit = 8): Promise<FactHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const onBoard = new Set<string>(
    (controller?.canvasState?.elements ?? []).map((el: any) => el._factKey ?? `el:${el.id}`),
  );
  let entries: QueryEntry[] = [];
  try {
    const r = await read<{ entries?: QueryEntry[] }>('workspace.query', { contains: query, limit: limit + 16 });
    entries = r.entries ?? [];
  } catch (e) { console.warn('[canvas] fact search failed', e); return []; }
  const hits: FactHit[] = [];
  for (const e of entries) {
    const key = e.key;
    if (!key || onBoard.has(key) || RESERVED_FACT.test(key) || key.startsWith('_canvas/')) continue;
    const type = e._meta?.type ?? null;
    const td = factTypeDecls[type ?? ''];
    let title = key;
    try { title = titleOf({ key, value: e.value, _meta: e._meta }) || key; } catch { /* fall back to key */ }
    hits.push({ key, title, type, icon: td?.present?.icon ?? td?.icon ?? '•' });
    if (hits.length >= limit) break;
  }
  return hits;
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

  const newTags = Array.from(new Set([...tags, `canvas:${cid}`]));
  const pt = controller.screenToCanvas(window.innerWidth / 2, window.innerHeight / 2);
  const el: any = { width: 240, height: 120, rotation: 0, ...value, id: idOfKey(key), x: Math.round(pt.x), y: Math.round(pt.y) };
  el._factKey = key;
  // Pre-seed meta so the element-write path never stamps `canvas-element` over
  // the fact's real type; decorate to the card/renderer it deserves.
  factMeta.set(key, { type, tags: newTags });
  decorateFactCard(el, { type, tags: newTags });
  controller.canvasState.elements.push(el);
  controller.requestRender();

  // Persist: membership (clean value + preserved type + the canvas tag) and a
  // pinned placement at the viewport centre. queueFact dedupes on value, so the
  // value isn't rewritten — only the tag/placement land.
  queueFact(key, value, { ...(type ? { type } : {}), tags: newTags });
  queueFact(`_canvas/${cid}/${key}`, { x: el.x, y: el.y, width: el.width, height: el.height });
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
        // Migration: a decoration authored before the rel/label split has only
        // `label` (which WAS the rel). Seed `rel` from it once, so it keeps its
        // relation while a future label edit can diverge without rewriting it.
        if (edge && edge.rel == null && typeof edge.label === 'string') edge.rel = edgeRel(edge);
        edges.push(edge);
        if (edge && typeof edge.id === 'string' && edge.source && edge.target) {
          const rel = edgeRel(edge);
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
    const decorated = new Set(edges.map((e) => `${e.source}|${edgeRel(e)}|${e.target}`));
    for (const l of links) {
      if (!presentIds.has(l.from) || !presentIds.has(l.to)) continue;
      const source = idOfKey(l.from);
      const target = idOfKey(l.to);
      if (decorated.has(`${source}|${l.rel}|${target}`)) continue;
      const id = `lnk:${l.from}|${l.rel}|${l.to}`;
      // A bare reference: `rel` IS the type; `label` defaults to showing it (so
      // display is unchanged) until a human gives it a distinct annotation.
      edges.push({ id, source, target, rel: l.rel, label: l.rel });
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
    const sims = unplaced.filter((el: any) => linkedIds.has(el.id)).sort((a: any, b: any) => String(a._factKey ?? a.id).localeCompare(String(b._factKey ?? b.id)));
    const loose = unplaced.filter((el: any) => !linkedIds.has(el.id));

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
    return { ...defaultState, canvasId: cid, elements, edges: validEdges };
  } catch (err) {
    // Make the swallowed failure visible (it was a silent console.error before),
    // naming the stage. The fallback to a local copy / empty state stays, but a
    // resulting blank board now has an on-screen reason instead of none.
    reportLoadFailure(stage, cid, err);
    startSalience(cid);
    const fallback = localCopy ? JSON.parse(localCopy) : defaultState;
    console.warn(`[canvas] falling back to ${localCopy ? 'local cached copy' : 'EMPTY state'} after [${stage}] failure`);
    return fallback;
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
    const nu: any = { width: 240, height: 120, rotation: 0, ...entry.value };
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
    if (edge.rel == null && typeof edge.label === 'string') edge.rel = edgeRel(edge); // migrate
    edges.push(edge);
    const rel = edgeRel(edge);
    lastEdges.set(edge.id, { source: edge.source, target: edge.target, rel, decorated: true });
    linkedEdges.add(`${edge.source}|${rel}|${edge.target}`);
  }
  const decorated = new Set(edges.map((e: any) => `${e.source}|${edgeRel(e)}|${e.target}`));
  for (const l of links) {
    if (!presentIds.has(l.from) || !presentIds.has(l.to)) continue;
    const s = idOfKey(l.from);
    const t = idOfKey(l.to);
    if (decorated.has(`${s}|${l.rel}|${t}`)) continue;
    const id = `lnk:${l.from}|${l.rel}|${l.to}`;
    edges.push({ id, source: s, target: t, rel: l.rel, label: l.rel });
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
    lastWritten.delete(placementKey);
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
    decorateFactCard(el, entry._meta);
    const a = (i / Math.max(newKeys.length, 1)) * 2 * Math.PI - Math.PI / 2;
    const r = 260 + 26 * Math.floor(i / 12);
    el.x = Math.round(anchor.x + r * Math.cos(a));
    el.y = Math.round(anchor.y + r * Math.sin(a));
    el._synthesized = true;
    synthOrigin.set(el.id, { x: el.x, y: el.y });
    lastWritten.set(k, JSON.stringify(entry.value));
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
function startFlightRecorder(): void {
  if (typeof window === 'undefined') return;
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
        warm: warmRaf !== 0,
        // Every module-level map — any monotonic climber here is a real leak.
        maps: { lw: lastWritten.size, place: lastPos.size, synth: synthOrigin.size, fmeta: factMeta.size, sal: salienceByKey.size, edge: lastEdges.size, linked: linkedEdges.size, pend: pending.size },
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

export function startLiveSync(cid: string): void {
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
  const tick = async (): Promise<void> => {
    const cc = (window as { CC?: any }).CC;
    if (cc && !document.hidden) {
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
