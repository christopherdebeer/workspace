/**
 * dispatch — userland routing (tier-2 HTTP ingress).
 *
 * Owns a single CloudFront behaviour, `/d/*`, so every dynamic cell is reachable
 * by path without each one needing its own (build-time) behaviour. For
 * `/d/<cellId>/<rest>` it resolves the cell and proxies the call to `forge`
 * (Mode 1 command), which holds the invoke permission and the registry — so
 * dispatch never reads another cell's data directly. See `docs/dynamic-cells.md`.
 */
import {
  defineService,
  ServiceContext,
  ServiceHttpRequest,
  ServiceHttpResponse,
  hasScope,
} from '../../platform/runtime';

const JSON_HEADERS = { 'content-type': 'application/json' };

interface CallCellResult {
  statusCode: number;
  body: unknown;
  /** The cell's own response headers (content-type etc.). */
  headers?: Record<string, string>;
  isBase64Encoded?: boolean;
}

/** Split `/@<owner>/<name>/<rest>` into owner, name, and the cell-relative path. */
function parsePath(rawPath: string): { owner: string; name: string; subPath: string } | null {
  const m = rawPath.match(/^\/@([^/]+)\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  return {
    owner: decodeURIComponent(m[1]),
    name: decodeURIComponent(m[2]),
    subPath: m[3] && m[3].length > 0 ? m[3] : '/',
  };
}

interface SsrRead {
  as: string;
  target: string;
  input?: Record<string, unknown>;
}

/**
 * The ONLY targets the SSR-proxy will run. This is a security boundary: a cell's
 * `ssr.json` is authored by the cell OWNER but executes as the navigating CALLER,
 * so a write target (e.g. workspace.remember) would be a CSRF-style write into the
 * victim's slice. Gate to read-only commands explicitly (not by service), so the
 * proxy can never mutate. Maps onto the substrate's `observe` (read) verb.
 */
const SSR_READ_TARGETS = new Set<string>([
  'workspace.query', 'workspace.changes', 'workspace.peek', 'workspace.recall',
  'workspace.views', 'workspace.links', 'workspace.attention', 'workspace.neighbors',
  'workspace.shared', 'workspace.grantRequests',
  'cells.list', 'cells.describeTypes', 'cells.describeTools', 'cells.get',
  'auth.tokens',
]);

/**
 * Run a cell's declared SSR reads AS THE CALLER. dispatch's service client carries
 * the validated identity (cookie → token on a top-level navigation), so each read
 * is scoped and shaped exactly as it would be for that user over MCP. Only the
 * read-only targets in `SSR_READ_TARGETS` are proxied (a write target is refused);
 * failures degrade (the section just loads client-side). `workspace.changes
 * { recent: N }` resolves to the head→window two-step the browser client does. The
 * shaped results are handed to `cells.call` → injected as `event.ssrData`, so the
 * cell server-renders real content while never receiving a token. (forge can't do
 * this itself — forge↔workspace is a CDK dependency cycle; dispatch has no back-edge.)
 */
async function runSsrReads(reads: SsrRead[], ctx: ServiceContext): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await Promise.all(
    reads.map(async (r) => {
      try {
        if (!SSR_READ_TARGETS.has(r.target)) {
          ctx.logger.warn('ssr read refused (not a read-only target)', { target: r.target });
          return;
        }
        const dot = r.target.indexOf('.');
        const svc = r.target.slice(0, dot);
        const cmd = r.target.slice(dot + 1);
        let input: Record<string, unknown> = r.input ?? {};
        if (svc === 'workspace' && cmd === 'changes' && typeof input.recent === 'number') {
          const n = input.recent;
          const head = await ctx.serviceClient('workspace').command<{ seq?: number }>('changes', { sinceSeq: 'head' });
          const seq = head?.seq ?? 0;
          input = { sinceSeq: Math.max(0, seq - n), limit: n };
        }
        out[r.as] = await ctx.serviceClient(svc).command(cmd, input);
      } catch (err) {
        ctx.logger.warn('ssr read failed', { target: r.target, error: (err as Error).message });
      }
    }),
  );
  return out;
}

/**
 * Phase 4 — caller-write delegation (the write twin of the SSR read-proxy).
 *
 * A cell can ASK dispatch to persist facts into the *caller's* slice (or, with
 * `owner` + a declared `crossSlice` intent, into another slice the caller holds a
 * write-grant on) by setting an `x-parc-writes` response header (a JSON array of
 * `{ key, value, type?, tags?, via?, owner? }`). dispatch applies them AS THE
 * CALLER, never handing the cell a token. The cell stays declarative: it expresses
 * write intent; the platform decides whether the caller is allowed.
 *
 * Three guards, all enforced here (not in the cell, not at the gateway — Mode-1
 * `serviceClient` bypasses the gateway PEP, so this IS the `scope(caller, write)`
 * act boundary):
 *   1. The caller must hold write authority (`write:workspace`, satisfied by the
 *      coarse `workspace:write`/`admin` too). A read-only caller writes nothing.
 *   2. Each write must fall under a prefix the cell DECLARED (`ssr.json` `writes`)
 *      and match its optional `types` bound — consented surface, not arbitrary.
 *   3. Reserved namespaces are always refused (a cell may not register the
 *      caller's vocabulary or rewrite its authority), and the batch is capped.
 */
const RESERVED_WRITE_PREFIXES = ['_actions/', '_views/', '_grants/', '_groups/', '_public/'];
const MAX_CALLER_WRITES = 16;
const WRITES_HEADER = 'x-parc-writes';

interface CallerWriteIntent {
  keyPrefix: string;
  types?: string[];
  /** Phase 4 v2: the cell may target ANOTHER owner's slice under this prefix —
   *  bounded at the act by the caller's own write-grant (`requireWriteThrough`).
   *  Absent/false ⇒ caller's own slice only. */
  crossSlice?: boolean;
}
interface RequestedWrite {
  key: string;
  value: unknown;
  type?: string;
  tags?: string[];
  via?: string;
  /** Target slice. Absent or === caller ⇒ own slice; otherwise a cross-slice
   *  write-through (requires `crossSlice` in the manifest AND a caller grant). */
  owner?: string;
}

/** Parse + shape-validate the `x-parc-writes` header payload. Throws on malformed. */
function parseRequestedWrites(raw: string): RequestedWrite[] {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('x-parc-writes must be a JSON array');
  return parsed
    .filter((w): w is RequestedWrite => !!w && typeof w === 'object' && typeof (w as RequestedWrite).key === 'string' && (w as RequestedWrite).key.length > 0 && 'value' in (w as object))
    .map((w) => ({
      key: w.key,
      value: w.value,
      ...(typeof w.type === 'string' ? { type: w.type } : {}),
      ...(Array.isArray(w.tags) && w.tags.every((t) => typeof t === 'string') ? { tags: w.tags } : {}),
      ...(typeof w.via === 'string' ? { via: w.via } : {}),
      ...(typeof w.owner === 'string' && w.owner.length > 0 ? { owner: w.owner } : {}),
    }));
}

interface WriteOutcome {
  applied: number;
  refused: number;
  /** Caller lacked write authority — the whole batch was denied. */
  denied?: boolean;
}

/** Apply a cell's requested caller-writes, bounded by scope + manifest. Exported for tests. */
export async function applyCallerWrites(
  raw: string,
  manifest: CallerWriteIntent[],
  cellAddress: string,
  ctx: ServiceContext,
): Promise<WriteOutcome> {
  if (!ctx.identity.user) return { applied: 0, refused: 0 };
  // Guard 1: scope(caller, write) — the security-critical line.
  if (!hasScope(ctx.identity, 'write:workspace')) {
    ctx.logger.warn('caller-writes denied: caller lacks write scope', { user: ctx.identity.user, cell: cellAddress });
    return { applied: 0, refused: 0, denied: true };
  }
  let requested: RequestedWrite[];
  try {
    requested = parseRequestedWrites(raw);
  } catch (err) {
    ctx.logger.warn('caller-writes header invalid — ignored', { error: (err as Error).message });
    return { applied: 0, refused: 0 };
  }
  let applied = 0;
  let refused = 0;
  if (requested.length > MAX_CALLER_WRITES) {
    ctx.logger.warn('caller-writes batch capped', { requested: requested.length, cap: MAX_CALLER_WRITES });
  }
  for (const w of requested.slice(0, MAX_CALLER_WRITES)) {
    const reserved = RESERVED_WRITE_PREFIXES.some((p) => w.key.startsWith(p));
    // A target slice other than the caller's own is a cross-slice write-through:
    // allowed only when the cell DECLARED `crossSlice` for the prefix, and finally
    // bounded at the act by the caller's own grant (workspace.requireWriteThrough).
    const crossSlice = !!w.owner && w.owner !== ctx.identity.user;
    // Guards 2+3: declared prefix (+ optional type bound, + crossSlice opt-in),
    // never a reserved namespace.
    const declared = manifest.some(
      (m) =>
        w.key.startsWith(m.keyPrefix) &&
        (!m.types || (w.type !== undefined && m.types.includes(w.type))) &&
        (!crossSlice || m.crossSlice === true),
    );
    if (reserved || !declared) {
      refused++;
      ctx.logger.warn('caller-write refused (reserved or not declared)', { key: w.key, type: w.type, reserved, crossSlice, cell: cellAddress });
      continue;
    }
    try {
      // requireWriteThrough (in workspace.remember) enforces the caller's grant on
      // the target slice and re-refuses reserved namespaces — a grant_denied throws
      // here and is counted as refused, never silently dropped.
      await ctx.serviceClient('workspace').command('remember', {
        key: w.key,
        value: w.value,
        ...(w.type ? { type: w.type } : {}),
        ...(w.tags ? { tags: w.tags } : {}),
        ...(crossSlice ? { owner: w.owner } : {}),
        via: w.via ?? cellAddress,
      });
      applied++;
    } catch (err) {
      refused++;
      ctx.logger.warn('caller-write apply failed', { key: w.key, crossSlice, error: (err as Error).message });
    }
  }
  if (applied) ctx.logger.info('caller-writes applied', { applied, refused, cell: cellAddress });
  return { applied, refused };
}

async function route(req: ServiceHttpRequest, ctx: ServiceContext): Promise<ServiceHttpResponse> {
  // Anonymous GET/HEAD flow through so *public* cells can serve pages and
  // assets to a plain browser; `cells.call` is the gate — it only honours
  // anonymous reads for cells marked public, and everything else still
  // requires an authenticated owner-or-granted caller.
  const anonymousRead = req.method === 'GET' || req.method === 'HEAD';
  if (!ctx.identity.user && !anonymousRead) {
    return { statusCode: 401, headers: JSON_HEADERS, body: { error: 'Authentication required' } };
  }
  let parsed = parsePath(req.path);
  if (!parsed) {
    // Userland root (the home demotion): when DISPATCH_DEFAULT_CELL is set
    // ("owner/name"), unmatched paths route to that cell — the platform's
    // face becomes a tier-2 surface. Unset = current behavior.
    const [defOwner, defName] = (process.env.DISPATCH_DEFAULT_CELL ?? '').split('/');
    if (defOwner && defName) {
      parsed = { owner: defOwner, name: defName, subPath: req.path || '/' };
    } else {
      return { statusCode: 404, headers: JSON_HEADERS, body: { error: 'Expected /@<owner>/<cell> path' } };
    }
  }

  let body: unknown;
  if (req.rawBody) {
    try {
      body = JSON.parse(req.rawBody);
    } catch {
      body = req.rawBody;
    }
  }

  // SSR proxy: for an authenticated top-level navigation (subPath '/'), run the
  // cell's declared substrate reads as the caller and hand the shaped results to
  // cells.call → the cell server-renders real content (no token reaches it).
  let ssrData: Record<string, unknown> | undefined;
  if (ctx.identity.user && (req.method === 'GET' || req.method === 'HEAD') && parsed.subPath === '/') {
    try {
      const meta = await ctx.serviceClient('cells').command<{ reads?: SsrRead[] }>('ssrReadsFor', {
        owner: parsed.owner,
        name: parsed.name,
      });
      if (meta?.reads?.length) ssrData = await runSsrReads(meta.reads, ctx);
    } catch (err) {
      ctx.logger.warn('ssr prefetch failed', { error: (err as Error).message });
    }
  }

  try {
    // forge holds the registry + invoke permission; we proxy rather than read its
    // table or invoke the cell ourselves (preserving the cell boundary).
    const result = await ctx.serviceClient('cells').command<CallCellResult>('call', {
      owner: parsed.owner,
      name: parsed.name,
      method: req.method,
      path: parsed.subPath,
      query: new URLSearchParams(req.query).toString(),
      body,
      ...(ssrData ? { ssrData } : {}),
    });
    // Phase 4: a cell may request caller-slice writes via the `x-parc-writes`
    // response header. Apply them AS THE CALLER (bounded by the cell's declared
    // manifest AND scope(caller, write)), then strip the header so it never
    // reaches the browser. Anonymous callers never write (the header is dropped).
    let outHeaders = result.headers ?? JSON_HEADERS;
    const writeHeaderKey = result.headers && Object.keys(result.headers).find((h) => h.toLowerCase() === WRITES_HEADER);
    if (writeHeaderKey) {
      const raw = result.headers![writeHeaderKey];
      outHeaders = { ...result.headers };
      delete outHeaders[writeHeaderKey];
      if (ctx.identity.user) {
        let manifest: CallerWriteIntent[] = [];
        try {
          const meta = await ctx.serviceClient('cells').command<{ writes?: CallerWriteIntent[] }>('callerWritesFor', {
            owner: parsed.owner,
            name: parsed.name,
          });
          manifest = meta?.writes ?? [];
        } catch (err) {
          ctx.logger.warn('callerWritesFor failed', { error: (err as Error).message });
        }
        const outcome = await applyCallerWrites(raw, manifest, `@${parsed.owner}/${parsed.name}`, ctx);
        if (outcome.denied) outHeaders['x-parc-writes-denied'] = 'scope';
        else {
          outHeaders['x-parc-writes-applied'] = String(outcome.applied);
          if (outcome.refused) outHeaders['x-parc-writes-refused'] = String(outcome.refused);
        }
      }
    }
    // Pass the cell's response through faithfully: its headers (content-type
    // for HTML/JS/CSS), its body encoding, its status.
    return {
      statusCode: result.statusCode ?? 200,
      headers: outHeaders,
      body: result.body,
      isBase64Encoded: result.isBase64Encoded,
    };
  } catch (err) {
    ctx.logger.warn('dispatch failed', {
      owner: parsed.owner,
      name: parsed.name,
      error: (err as Error).message,
    });
    return { statusCode: 502, headers: JSON_HEADERS, body: { error: (err as Error).message } };
  }
}

export const handler = defineService({
  name: 'dispatch',
  commands: {},
  http: [
    { method: 'GET', path: '/@*', handler: route },
    { method: 'HEAD', path: '/@*', handler: route },
    { method: 'POST', path: '/@*', handler: route },
    { method: 'PUT', path: '/@*', handler: route },
    { method: 'DELETE', path: '/@*', handler: route },
    // Apex / userland-root (the "home demotion"): when dispatch is the router default
    // (DISPATCH_DEFAULT_CELL set), CloudFront sends every unmatched path here — the apex
    // `/` and its assets. These catch-alls (AFTER `/@*`, so cell paths still win the match)
    // let those reach `route`, which forwards them to the default cell. Without
    // DISPATCH_DEFAULT_CELL, `route` 404s a non-`/@` path exactly as before.
    { method: 'GET', path: '/*', handler: route },
    { method: 'HEAD', path: '/*', handler: route },
  ],
});

export default handler;
