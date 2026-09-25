/**
 * forge — the control-plane cell (the platform's inward, reflexive API).
 *
 * An MCP server whose tools let an authorised caller create, inspect, share, and
 * invoke **dynamic cells** at runtime — without a `cdk deploy`. Each created cell
 * is its own Lambda + DynamoDB table + permission-bounded IAM role (see
 * `cell-template.ts`), isolated by AWS rather than an in-process sandbox.
 *
 * The reflexive loop closes here: a `tools/call` to `createCell` provisions a new
 * cell through the platform, and `callCell` exercises it over the *same* MCP
 * connection. See `docs/dynamic-cells.md`.
 */
import { randomUUID, createHash } from 'node:crypto';
import {
  defineService,
  requireUser,
  getString,
  getOptional,
  ServiceAuthError,
  ServiceContext,
  RegisteredCommand,
  isTextLikeContentType,
  BLOB_INLINE_MAX_BYTES,
} from '../../platform/runtime';
import { createRegistry, CellRecord, CellRegistry, DeployState } from './registry';
import type { DeployNote } from './registry';
import { leafActOf } from '../../platform/runtime/auth';
import { buildCellTemplate, cellResourceName, cellStackName } from './cell-template';
import { transpileCell, bundleFiles, bundleClientFiles } from './transpile';
import {
  uploadCode,
  uploadPackage,
  deployStack,
  updateStack,
  describeStack,
  deleteStack,
  invokeCell,
  getCellLogs,
  getLogsByGroupName,
  findLogGroup,
  putObject,
  getObject,
  getObjectRaw,
  listObjects,
  deleteObject,
  presignPut,
  updateFunctionCode,
  listObjectsMeta,
  putObjectIf,
  PreconditionFailedError,
} from './provisioner';
import type { InvokeCellResult } from './provisioner';
import { srcKey, srcPrefix, buildKey, dataKey, dataPrefix, cleanPath } from './cell-files';
import { extractTarGz } from './tar';
import {
  contentVersion,
  countLines,
  sliceLines,
  pathMatcher,
  compileQuery,
  searchText,
  lineAt,
  encodeCursor,
  decodeCursor,
  RANGE_MAX_BYTES,
  isTextType,
  mapLimit,
} from './source-text';
import type { SearchMatch } from './source-text';
import { TreeStore, TreeConflictError, isTreeVersion, treeVersionOf, LOCK_TTL_MS } from './source-tree';
import type { Tree, Journal } from './source-tree';
import { planPatch, planReplace, touchedPaths } from './source-patch';
import type { PatchChange, BaseFile } from './source-patch';
import { diffText } from './source-diff';

/** Parse a relative window like "15m", "2h", "1d" into milliseconds. */
function sinceToMs(since: string | undefined): number {
  const m = (since ?? '15m').trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase() as 's' | 'm' | 'h' | 'd'];
  return n * unit;
}

const CREATE_SCOPE = 'cells:create';

/** Normalise a cell name into an address/ARN-safe slug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** Public, owner-namespaced address for a cell, e.g. `/@alice/notes`. */
function cellAddress(owner: string, name: string): string {
  return `/@${owner}/${slugify(name)}`;
}

/** Map a CloudFormation stack status onto our coarse cell status. */
function statusFromStack(stackStatus: string): CellRecord['status'] {
  if (stackStatus.endsWith('_COMPLETE') && stackStatus.startsWith('CREATE')) return 'ACTIVE';
  if (stackStatus.endsWith('_COMPLETE') && stackStatus.startsWith('UPDATE')) return 'ACTIVE';
  if (stackStatus.includes('ROLLBACK') || stackStatus.includes('FAILED')) return 'FAILED';
  if (stackStatus.startsWith('DELETE')) return 'DELETING';
  return 'CREATING';
}

/**
 * Refresh a record's status from its live stack so callers see CREATING → ACTIVE
 * (or → FAILED). Only non-terminal records (CREATING/DELETING) are probed — a
 * stack describe per record is the cost, so terminal ACTIVE/FAILED records are
 * left untouched. A vanished stack is left as-is (createCell treats it as an
 * orphan and allows recreate). Mutates and returns the record.
 */
async function reconcileStatus(registry: CellRegistry, record: CellRecord): Promise<CellRecord> {
  if (record.status !== 'CREATING' && record.status !== 'DELETING') return record;
  const stack = await describeStack(record.stackName);
  if (stack) {
    const fresh = statusFromStack(stack.status);
    if (fresh !== record.status) {
      await registry.setStatus(record.cellId, fresh);
      record.status = fresh;
    }
  }
  return record;
}

/**
 * Deterministic, ARN-safe internal cell id from owner + name. Hashed over the
 * *slug* (not the raw name) so the public address `/@<owner>/<slug>` resolves to
 * the same id whether created via `createCell(name)` or routed via dispatch.
 */
function makeCellId(owner: string, name: string): string {
  const slug = slugify(name);
  const hash = createHash('sha256').update(`${owner}:${slug}`).digest('hex').slice(0, 8);
  return slug ? `${slug}-${hash}` : `cell-${hash}`;
}

interface ForgeEnv {
  registryTable: string;
  codeBucket: string;
  boundaryArn: string;
  eventBusName: string;
  eventBusArn: string;
  region: string;
  accountId: string;
  /** The shared substrate table cells get LeadingKeys-scoped read access to. */
  substrateTable?: { name: string; arn: string };
}

function loadForgeEnv(): ForgeEnv {
  const substrateName = getOptional('CELL_SUBSTRATE_TABLE_NAME');
  const substrateArn = getOptional('CELL_SUBSTRATE_TABLE_ARN');
  return {
    registryTable: getString('TABLE_NAME'),
    codeBucket: getString('CELL_CODE_BUCKET'),
    boundaryArn: getString('CELL_PERMISSION_BOUNDARY_ARN'),
    eventBusName: getString('CELL_EVENT_BUS_NAME'),
    eventBusArn: getString('CELL_EVENT_BUS_ARN'),
    region: getOptional('CELL_REGION') ?? getString('AWS_REGION'),
    accountId: getString('CELL_ACCOUNT_ID'),
    substrateTable:
      substrateName && substrateArn ? { name: substrateName, arn: substrateArn } : undefined,
  };
}

/** Whether a tool-grant pattern list covers a tool name (exact, `*`, or trailing-`*` like `list_*`). */
function toolAllowed(patterns: string[], tool: string): boolean {
  return patterns.some((p) => p === '*' || p === tool || (p.endsWith('*') && tool.startsWith(p.slice(0, -1))));
}

/** The denial teaches the escalation path (docs/scope-grants.md §5). */
function grantDenied(record: CellRecord, tool?: string): string {
  const resource = `cell:${record.owner}/${record.name}:${tool ?? '*'}`;
  return (
    `grant_denied: not authorised for cell "${record.cellId}"${tool ? ` tool "${tool}"` : ''}. ` +
    `Ask the owner: act("workspace.requestGrant", { resource: "${resource}" })`
  );
}

/**
 * Throw unless `user` owns or has been granted access to the cell. A full
 * grant (`grants[]`) covers everything; a per-tool grant (`toolGrants`) lets
 * the principal reach the cell (dispatch, discovery, metadata) but only call
 * the matching tools when a `tool` is named.
 */
function authorizeAccess(record: CellRecord, user: string, tool?: string): void {
  if (record.owner === user || record.grants.includes(user)) return;
  const patterns = record.toolGrants?.[user];
  if (patterns && (!tool || toolAllowed(patterns, tool))) return;
  throw new ServiceAuthError(grantDenied(record, tool));
}

/** A predicate for which of a cell's tools the user may see/call. */
function toolVisibility(record: CellRecord, user: string): (tool: string) => boolean {
  if (record.owner === user || record.grants.includes(user)) return () => true;
  const patterns = record.toolGrants?.[user];
  if (!patterns) return () => false;
  return (tool) => toolAllowed(patterns, tool);
}

// ─── tools ────────────────────────────────────────────────────────

interface CreateCellInput {
  name: string;
  code: string;
  description?: string;
  /** Principals to share the cell with on creation (in addition to the owner). */
  share?: string[];
  /** Web-facing: anonymous GETs are allowed through dispatch (`/@owner/name`). */
  public?: boolean;
  /** Lambda timeout in seconds (10–300; default 10). Long-running work —
   *  e.g. model providers — needs more; the EDGE still caps a synchronous
   *  round trip at ~30s, so >30s only helps fire-and-poll patterns. */
  timeoutSeconds?: number;
  /** Lambda memory in MB (128–3008; default 512). CPU scales with memory
   *  (~1 vCPU at 1769MB), so this is the LATENCY knob for CPU-bound SSR /
   *  scene assembly — the ADR-0043 Inc 4 lesson. Cost ≈ memory×duration, so
   *  raising it for CPU-bound work is close to cost-neutral. */
  memoryMb?: number;
  /** ADR-0095 — give the cell a CDN-fronted public namespace at
   *  `/@<owner>/<name>/~/…`, served from S3 with THIS CELL as the miss handler.
   *  A hit never wakes the Lambda; a miss invokes it, and what it writes to its
   *  own prefix is what the edge serves from then on. */
  publicNamespace?: boolean;
}

const clampTimeout = (n: unknown): number | undefined => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(300, Math.max(10, Math.round(v))) : undefined;
};

const clampMemory = (n: unknown): number | undefined => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(3008, Math.max(128, Math.round(v))) : undefined;
};

/**
 * The public-namespace arg for the cell template (ADR-0095). Keyed by the
 * SLUG, because that is what the canonical address `/@<owner>/<slug>` carries
 * and the S3 key has to match the request path byte for byte. (A caller who
 * reaches the cell by some other spelling that slugifies the same still routes
 * — it just always misses the object and falls through to the cell, which is
 * correct-but-slow rather than wrong.)
 */
const publicNamespaceArg = (
  on: boolean | undefined,
  bucket: string,
  name: string,
): { bucket: string; name: string } | undefined => (on ? { bucket, name: slugify(name) } : undefined);

async function createCell(input: CreateCellInput, ctx: ServiceContext): Promise<unknown> {
  // Scope (cells:create) is enforced at the /mcp gateway; forge is a backend
  // reachable only via allow-listed invokes, and authorizes by ownership. Legacy
  // platform:cells:create / platform:* tokens still satisfy it (impliesScope).
  const owner = requireUser(ctx.identity);
  if (!input?.name?.trim()) throw new Error('A cell `name` is required');
  if (!input?.code?.trim()) throw new Error('Cell `code` (a TypeScript module exporting `handler`) is required');

  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cellId = makeCellId(owner, input.name);
  const stackName = cellStackName(cellId);
  const functionName = cellResourceName(cellId);

  const existing = await registry.get(cellId);
  if (existing && existing.status !== 'FAILED') {
    // A record whose CloudFormation stack is already gone is an orphan — the
    // registry never caught up (getCell/listCells only reconcile while the stack
    // still exists), so recreating would otherwise be blocked forever. This covers
    // both a DELETING record whose teardown finished AND a CREATING record whose
    // create failed: deployStack uses `OnFailure: DELETE`, so a rolled-back create
    // leaves no stack behind. Treat a vanished stack as recreatable and let this
    // create overwrite the record.
    const orphaned = (await describeStack(existing.stackName)) === null;
    if (!orphaned) {
      throw new Error(`Cell "${cellId}" already exists (status ${existing.status})`);
    }
  }

  // Cells are authored in TypeScript; transpile to JS before packaging.
  let js: string;
  try {
    js = await transpileCell(input.code);
  } catch (err) {
    throw new Error(`Cell code failed to compile: ${(err as Error).message}`);
  }

  const codeKey = `cells/${cellId}/${randomUUID()}.zip`;
  await uploadCode({ bucket: env.codeBucket, key: codeKey, code: js });

  // Seed the editable source tree so the cell is immediately editable + multi-file:
  // writeFile/readFile/listFiles/deploy operate on cells/<cellId>/src/.
  await putObject(env.codeBucket, srcKey(cellId, 'index.ts'), input.code, 'text/plain');

  const timeoutSeconds = clampTimeout(input.timeoutSeconds);
  const memoryMb = clampMemory(input.memoryMb);
  const template = buildCellTemplate({
    cellId,
    owner,
    codeBucket: env.codeBucket,
    codeKey,
    boundaryArn: env.boundaryArn,
    eventBusName: env.eventBusName,
    eventBusArn: env.eventBusArn,
    region: env.region,
    accountId: env.accountId,
    substrateTable: env.substrateTable,
    timeoutSeconds,
    memorySize: memoryMb,
    publicNamespace: publicNamespaceArg(input.publicNamespace, env.codeBucket, input.name),
  });
  await deployStack(stackName, template);

  const now = new Date().toISOString();
  const grants = Array.from(new Set([owner, ...(input.share ?? [])]));
  const record: CellRecord = {
    cellId,
    name: input.name,
    owner,
    description: input.description ?? null,
    functionName,
    stackName,
    grants,
    public: !!input.public,
    timeoutSeconds,
    memoryMb,
    publicNamespace: !!input.publicNamespace,
    status: 'CREATING',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await registry.put(record);

  ctx.logger.info('dynamic cell create requested', { cellId, owner });
  await ctx.events.emit('cell.create.requested', {
    cellId,
    owner,
    name: input.name,
    address: cellAddress(owner, input.name),
    public: !!input.public,
    description: input.description ?? null,
  });

  return {
    cellId,
    address: cellAddress(owner, input.name),
    status: 'CREATING',
    message:
      'Cell provisioning started. Poll `getCell` until status is ACTIVE, then use `callCell`.',
  };
}

async function listCells(_input: unknown, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cells = await registry.listByOwner(user);
  // Reconcile non-terminal records against their live stacks so the list reflects
  // CREATING → ACTIVE without a getCell round-trip (the gotcha: a stack could be
  // CREATE_COMPLETE while the registry still said CREATING). Only CREATING/DELETING
  // records are probed; the describes run in parallel.
  await Promise.all(cells.map((c) => reconcileStatus(registry, c)));
  return {
    cells: cells.map((c) => ({
      cellId: c.cellId,
      name: c.name,
      status: c.status,
      grants: c.grants,
      public: c.public,
      description: c.description,
      address: cellAddress(c.owner, c.name),
    })),
  };
}

/**
 * The dynamic cells the caller can access — owns **or was granted** — shaped for a
 * directory view. (`cells.list` is owned-only; this adds granted cells.) Internal,
 * not an MCP tool. Currently uncalled since the home `/_catalog` retired in favour
 * of the read/act console; kept as the natural "accessible cells" primitive to
 * expose as a tool (e.g. `cells.accessible`) when a surface needs it. The caller's
 * identity propagates as `user`, so the registry filters to that principal (never
 * leaking other owners' private cells).
 */
async function catalogCells(_input: unknown, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cells = await registry.listAccessibleBy(user);
  return {
    cells: cells.map((c) => ({
      name: c.name,
      owner: c.owner,
      address: cellAddress(c.owner, c.name),
      status: c.status,
      description: c.description,
      shared: c.owner !== user,
    })),
  };
}

interface CellRefInput {
  cellId: string;
}

async function getCell(input: CellRefInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const record = await registry.get(input?.cellId);
  if (!record) throw new Error(`Unknown cell "${input?.cellId}"`);
  authorizeAccess(record, user);

  await reconcileStatus(registry, record);

  return {
    cellId: record.cellId,
    name: record.name,
    owner: record.owner,
    status: record.status,
    grants: record.grants,
    ...(record.toolGrants ? { toolGrants: record.toolGrants } : {}),
    ...(record.deploy ? { deploy: record.deploy } : {}),
    ...(record.lastDeployed ? { lastDeployed: record.lastDeployed } : {}),
    description: record.description,
    address: cellAddress(record.owner, record.name),
    createdAt: record.createdAt,
  };
}

interface GrantInput {
  /** Target the cell by id, or by owner + name. */
  cellId?: string;
  owner?: string;
  name?: string;
  principal: string;
  /** Restrict the grant to these tool patterns (exact or trailing `*`); omit for every tool. */
  tools?: string[];
}

async function grantCapability(input: GrantInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const record = await registry.get(resolveCellId(input ?? {}));
  if (!record) throw new Error(`Unknown cell`);
  if (record.owner !== user) throw new ServiceAuthError('Only the owner can share a cell');
  if (!input?.principal?.trim()) throw new Error('A `principal` to grant is required');
  const tools = Array.isArray(input.tools) ? input.tools.filter((t) => typeof t === 'string' && t.trim()) : undefined;
  const updated = await registry.addGrant(record.cellId, input.principal, tools?.length ? tools : undefined);
  await ctx.events.emit('cell.shared', { cellId: record.cellId, principal: input.principal, ...(tools?.length ? { tools } : {}) });
  return {
    cellId: record.cellId,
    grants: updated?.grants ?? record.grants,
    ...(updated?.toolGrants ? { toolGrants: updated.toolGrants } : {}),
  };
}

interface RevokeInput {
  cellId?: string;
  owner?: string;
  name?: string;
  principal: string;
}

async function revokeCapability(input: RevokeInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const record = await registry.get(resolveCellId(input ?? {}));
  if (!record) throw new Error(`Unknown cell`);
  if (record.owner !== user) throw new ServiceAuthError('Only the owner can revoke access to a cell');
  if (!input?.principal?.trim()) throw new Error('A `principal` to revoke is required');
  if (input.principal === record.owner) throw new Error('The owner cannot be revoked');
  const updated = await registry.removeGrant(record.cellId, input.principal);
  await ctx.events.emit('cell.unshared', { cellId: record.cellId, principal: input.principal });
  return {
    cellId: record.cellId,
    grants: updated?.grants ?? record.grants,
    ...(updated?.toolGrants ? { toolGrants: updated.toolGrants } : {}),
  };
}

interface CallCellInput {
  /** Either an explicit cellId, or owner + name (the `/@owner/name` form). */
  cellId?: string;
  owner?: string;
  name?: string;
  method?: string;
  path?: string;
  body?: unknown;
  /** Raw query string to forward to the cell (no leading `?`). */
  query?: string;
  /** SSR proxy: shaped substrate reads dispatch ran as the caller, forwarded to
   *  the cell's invocation as `event.ssrData` (docs/dynamic-cells.md). */
  ssrData?: Record<string, unknown>;
}

/** Resolve the input's target to an internal cellId. */
function resolveCellId(input: { cellId?: string; owner?: string; name?: string }): string {
  if (input?.cellId) return input.cellId;
  if (input?.owner && input?.name) return makeCellId(input.owner, input.name);
  throw new Error('Provide either `cellId`, or `owner` and `name`');
}

async function callCell(input: CallCellInput, ctx: ServiceContext): Promise<unknown> {
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cellId = resolveCellId(input);
  const record = await registry.get(cellId);
  if (!record) throw new Error(`Unknown cell "${cellId}"`);

  const method = (input.method ?? 'POST').toUpperCase();
  // A public cell is web-facing: anonymous GETs (and HEADs) are allowed so a
  // browser can fetch its pages/assets through dispatch. Everything else
  // still requires an authenticated, owner-or-granted caller.
  const anonymousOk = record.public && (method === 'GET' || method === 'HEAD');
  const path = input.path ?? '/';
  if (!anonymousOk) {
    const user = requireUser(ctx.identity);
    // A tool invocation names its tool in the path — per-tool grants apply.
    const tool = path.match(/^\/_tools\/([^/]+)$/)?.[1];
    authorizeAccess(record, user, tool);
  }

  // The cell data layer, web-served: GET /@owner/cell/_data/<user>/public/<key>
  // streams a blob straight from S3 (no Lambda hop). Only the `public/`
  // sub-space of a user's data is reachable this way — everything else stays
  // tool-only (getData) — and the same public/anonymous gate as pages applies.
  if (method === 'GET' || method === 'HEAD') {
    const dataMatch = path.match(/^\/_data\/([^/]+)\/(public\/.+)$/);
    if (dataMatch) {
      let key: string;
      try {
        key = dataKey(record.cellId, decodeURIComponent(dataMatch[1]), decodeURIComponent(dataMatch[2]));
      } catch {
        return { statusCode: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' };
      }
      const obj = await getObjectRaw(env.codeBucket, key);
      if (!obj) return { statusCode: 404, headers: { 'content-type': 'text/plain' }, body: 'not found' };
      return {
        statusCode: 200,
        headers: {
          'content-type': obj.contentType,
          'cache-control': 'public, max-age=31536000, immutable',
          // Public blobs are anonymous-readable by construction, so a CORS
          // grant discloses nothing — and a module `import()` of a vendored
          // script blob (e.g. home's three bundle) from a cell-subdomain
          // origin REQUIRES it: <img>/<video> tolerate opaque cross-origin
          // responses, ES modules do not.
          'access-control-allow-origin': '*',
        },
        body: method === 'HEAD' ? '' : obj.body.toString('base64'),
        isBase64Encoded: method !== 'HEAD',
      };
    }
  }

  if (record.status !== 'ACTIVE') {
    throw new Error(`Cell "${record.cellId}" is not ACTIVE (status ${record.status})`);
  }

  const bodyStr =
    input.body === undefined
      ? undefined
      : typeof input.body === 'string'
        ? input.body
        : JSON.stringify(input.body);

  const result = await invokeCell({
    functionName: record.functionName,
    event: {
      version: '2.0',
      rawPath: path,
      rawQueryString: input.query ?? '',
      headers: { 'content-type': 'application/json', 'x-cell-caller': ctx.identity.user ?? 'anonymous' },
      requestContext: { http: { method, path } },
      body: bodyStr,
      isBase64Encoded: false,
      // SSR proxy: dispatch ran the cell's declared reads AS THE CALLER and passed
      // the shaped results here; forward them so the cell can server-render real
      // content. The cell never receives a token (docs/dynamic-cells.md).
      ...(input.ssrData ? { ssrData: input.ssrData } : {}),
    },
  });
  return result;
}

/**
 * Internal command used by the `dispatch` cell to resolve a cell for HTTP
 * routing without reading forge's table directly. Not exposed as an MCP tool.
 */
interface ResolveInput {
  cellId: string;
}
async function resolveCell(input: ResolveInput, ctx: ServiceContext): Promise<unknown> {
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const record = await registry.get(input?.cellId);
  if (!record) return null;
  ctx.logger.info('resolveCell', { cellId: record.cellId, status: record.status });
  return {
    cellId: record.cellId,
    functionName: record.functionName,
    owner: record.owner,
    grants: record.grants,
    status: record.status,
  };
}

/**
 * Internal: the cell's declared SSR reads (from its `ssr.json`), for dispatch to
 * run as the caller before invoking the cell. Public-cell metadata only — no
 * auth required (dispatch gates the navigation itself).
 */
async function ssrReadsFor(input: { owner?: string; name?: string; cellId?: string }, ctx: ServiceContext): Promise<unknown> {
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cellId = input.cellId ?? (input.owner && input.name ? makeCellId(input.owner, input.name) : undefined);
  if (!cellId) return { reads: [] };
  const record = await registry.get(cellId);
  ctx.logger.info('ssrReadsFor', { cellId, reads: record?.ssrReads?.length ?? 0 });
  return { reads: record?.ssrReads ?? [] };
}

/**
 * Internal: the cell's declared caller-writes (from `ssr.json` `writes`), for
 * dispatch to bound the writes it applies AS THE CALLER (Phase 4 — the write
 * twin of `ssrReadsFor`). Metadata only; dispatch gates the navigation and
 * enforces `scope(caller, write)` itself.
 */
async function callerWritesFor(input: { owner?: string; name?: string; cellId?: string }, ctx: ServiceContext): Promise<unknown> {
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cellId = input.cellId ?? (input.owner && input.name ? makeCellId(input.owner, input.name) : undefined);
  if (!cellId) return { writes: [] };
  const record = await registry.get(cellId);
  ctx.logger.info('callerWritesFor', { cellId, writes: record?.callerWrites?.length ?? 0 });
  return { writes: record?.callerWrites ?? [] };
}

interface DeleteInput {
  cellId: string;
}
interface ConfigureCellInput extends CellRef {
  timeoutSeconds?: number;
  /** Lambda memory in MB (128–3008). The latency knob for CPU-bound cells;
   *  changing it re-renders the stack (like timeoutSeconds). */
  memoryMb?: number;
  /** Web-facing: anonymous GETs/HEADs are allowed through dispatch so the SPA
   *  shell loads for a signed-out visitor (the client then handles sign-in for
   *  the owner's data). Registry-only — no stack rebuild. */
  public?: boolean;
  /** ADR-0095 — the CDN-fronted public namespace. Unlike `public`, this DOES
   *  re-render the stack: it grants the S3 statement and sets the env the
   *  miss handler writes through. */
  publicNamespace?: boolean;
}
async function configureCell(input: ConfigureCellInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cellId = resolveCellId(input);
  const record = await registry.get(cellId);
  if (!record) throw new Error(`Unknown cell "${cellId}"`);
  if (record.owner !== user) throw new ServiceAuthError('Only the owner can reconfigure a cell');
  const newPublic = input.public === undefined ? record.public : !!input.public;
  // `publicNamespace` is a STACK change (an IAM statement plus the env the
  // handler writes through), so it cannot take the registry-only fast path the
  // way `public` can.
  const newPublicNs =
    input.publicNamespace === undefined ? !!record.publicNamespace : !!input.publicNamespace;
  const nsChanged = newPublicNs !== !!record.publicNamespace;
  // Flip `public` without touching the stack (it lives in the registry record).
  if (input.timeoutSeconds === undefined && input.memoryMb === undefined && !nsChanged) {
    await registry.put({ ...record, public: newPublic, updatedAt: new Date().toISOString() });
    ctx.logger.info('cell reconfigured (registry)', { cellId, public: newPublic });
    return { ok: true, cellId, public: newPublic, publicNamespace: newPublicNs, timeoutSeconds: record.timeoutSeconds ?? null, memoryMb: record.memoryMb ?? null };
  }
  // Stack-shape change: either knob may arrive alone; the other keeps its
  // stored (or default) value so a memory-only change never resets timeout.
  const timeoutSeconds = input.timeoutSeconds === undefined ? record.timeoutSeconds : clampTimeout(input.timeoutSeconds);
  if (input.timeoutSeconds !== undefined && !timeoutSeconds) throw new Error('timeoutSeconds (10–300) is required');
  const memoryMb = input.memoryMb === undefined ? record.memoryMb : clampMemory(input.memoryMb);
  if (input.memoryMb !== undefined && !memoryMb) throw new Error('memoryMb (128–3008) is required');
  const codeKey = `cells/${cellId}/${randomUUID()}.zip`;
  // The template needs a code object; reuse the current src bundle so the
  // stack update does not revert live code.
  const prefix = srcPrefix(cellId);
  const keys = await listObjects(env.codeBucket, prefix);
  const files: Record<string, string> = {};
  for (const k of keys) {
    const rel = k.slice(prefix.length);
    if (!rel) continue;
    const content = await getObject(env.codeBucket, k);
    if (content !== null) files[rel] = content;
  }
  if (!Object.keys(files).length) throw new Error('no source files — cannot reconfigure');
  const entry = files['index.ts'] !== undefined ? 'index.ts' : Object.keys(files)[0];
  const js = await bundleFiles(files, entry);
  await uploadCode({ bucket: env.codeBucket, key: codeKey, code: js });
  const template = buildCellTemplate({
    cellId,
    owner: record.owner,
    codeBucket: env.codeBucket,
    codeKey,
    boundaryArn: env.boundaryArn,
    eventBusName: env.eventBusName,
    eventBusArn: env.eventBusArn,
    region: env.region,
    accountId: env.accountId,
    substrateTable: env.substrateTable,
    timeoutSeconds,
    memorySize: memoryMb,
    publicNamespace: publicNamespaceArg(newPublicNs, env.codeBucket, record.name),
  });
  await updateStack(record.stackName, template);
  await registry.put({
    ...record, public: newPublic, publicNamespace: newPublicNs,
    timeoutSeconds, memoryMb, updatedAt: new Date().toISOString(),
  });
  ctx.logger.info('cell reconfigured', { cellId, timeoutSeconds, memoryMb, public: newPublic, publicNamespace: newPublicNs });
  return {
    ok: true,
    cellId,
    timeoutSeconds,
    memoryMb,
    publicNamespace: newPublicNs,
    note: 'stack update in progress — static/client assets need a cells.deploy after it completes',
  };
}

async function deleteCell(input: DeleteInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const record = await registry.get(input?.cellId);
  if (!record) throw new Error(`Unknown cell "${input?.cellId}"`);
  if (record.owner !== user) throw new ServiceAuthError('Only the owner can delete a cell');
  await deleteStack(record.stackName);
  await registry.setStatus(record.cellId, 'DELETING');
  await ctx.events.emit('cell.delete.requested', { cellId: record.cellId, owner: user });
  return { cellId: record.cellId, status: 'DELETING' };
}

interface CellLogsInput {
  cellId?: string;
  owner?: string;
  name?: string;
  /** Relative window, e.g. "15m", "2h", "1d". Default 15m. */
  since?: string;
  limit?: number;
  /** Optional CloudWatch Logs filter pattern. */
  filter?: string;
}
async function cellLogs(input: CellLogsInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cellId = resolveCellId(input);
  const record = await registry.get(cellId);
  if (!record) throw new Error(`Unknown cell "${cellId}"`);
  authorizeAccess(record, user);

  const events = await getCellLogs({
    functionName: record.functionName,
    startTimeMs: Date.now() - sinceToMs(input.since),
    limit: input.limit ?? 100,
    filterPattern: input.filter,
  });
  return {
    cellId,
    count: events.length,
    events: events.map((e) => ({ time: new Date(e.timestamp).toISOString(), message: e.message })),
  };
}

// ─── cell common layer (S3: source files + per-user blob data) ─────
// All cell S3 access is brokered by forge (it holds the bucket grant), authorized
// by ownership exactly like callCell. See docs/cell-storage-s3.md.

interface CellRef {
  cellId?: string;
  owner?: string;
  name?: string;
}

/** Resolve the target cell and authorize the caller (owner or grantee). */
async function resolveAuthorized(input: CellRef, user: string): Promise<{ record: CellRecord; bucket: string; env: ForgeEnv }> {
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cellId = resolveCellId(input);
  const record = await registry.get(cellId);
  if (!record) throw new Error(`Unknown cell "${cellId}"`);
  authorizeAccess(record, user);
  return { record, bucket: env.codeBucket, env };
}

interface WriteFileInput extends CellRef {
  path: string;
  content: string;
  /**
   * `base64` writes BYTES. Omitted (or `utf8`), `content` is text and is stored
   * as text — which is what every caller has always done and stays the default.
   *
   * A cell could not ship an image before this. Source files are carried
   * through the tools as JSON strings and stored `text/plain; charset=utf-8`,
   * and a PNG does not survive being a string: `Buffer.from(bytes, 'utf8')`
   * replaces every invalid sequence with U+FFFD, so drive's 19,203-byte icon
   * came back 34,465 bytes of mojibake. Its manifest and icons were dead on the
   * live cell from the day they landed, and the workaround — rendering `web/`
   * into a 230KB generated `web-assets.ts` so the bytes ride inside the module
   * graph as base64 string literals — is a workaround for exactly this.
   *
   * Base64 travels in one call, deliberately: `appendToFile` does not take an
   * encoding, because two independently-decoded base64 chunks only concatenate
   * correctly when the first is a multiple of four characters, and a transport
   * that is correct only for aligned chunk sizes is a trap. Binary must fit one
   * write, which the ~1MB request-signing cliff already bounds it to.
   */
  encoding?: 'utf8' | 'base64';
  /** Proof of read: write only if the file is still at this `version`. */
  ifVersion?: string;
  /** Create only: refuse if the file already exists (a typo'd path can't clobber). */
  ifAbsent?: boolean;
  deploy?: boolean;
}

/**
 * Content type from the path, for objects that are not text.
 *
 * S3 keeps this and it is the ONLY durable record that a stored object is
 * bytes: `readFile` and `deployCell` both decide how to read an object by
 * asking what it is, rather than by guessing from its extension a second time.
 */
const BINARY_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  mp4: 'video/mp4', webm: 'video/webm',
  pdf: 'application/pdf', zip: 'application/zip', wasm: 'application/wasm',
};
const binaryTypeFor = (path: string): string =>
  BINARY_TYPES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

/**
 * Announce a source mutation so the cell's substrate pointer fact tracks the
 * file manifest (the workspace projects this into `cells/<cellId>`). Skipped
 * when the mutation is fused with a deploy — `cell.deployed` then carries the
 * canonical manifest and event ordering is not guaranteed.
 */
async function emitFilesChanged(ctx: ServiceContext, record: CellRecord, op: string, paths: string[]): Promise<void> {
  await ctx.events.emit('cell.files.changed', {
    cellId: record.cellId,
    owner: record.owner,
    name: record.name,
    address: cellAddress(record.owner, record.name),
    public: record.public,
    op,
    paths,
  });
}

// ─── Versioned source access ─────────────────────────────────────────
//
// Every read reports the file's content `version` (sha256 of the stored
// bytes); every mutation accepts it back as `ifVersion` and refuses — with
// VERSION_CONFLICT and nothing written — if the file moved in between. The
// read-modify-write ops (replace, append, and any write with a precondition)
// also commit with a conditional PUT pinned to the S3 ETag they read, so even
// a caller that passes no `ifVersion` can no longer lose a concurrent edit:
// the loser gets a conflict instead of silently overwriting the winner.

const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

interface SourceObject {
  body: Buffer;
  contentType: string;
  etag?: string;
  lastModified?: string;
  version: string;
  binary: boolean;
}

async function readSource(bucket: string, cellId: string, path: string): Promise<SourceObject | null> {
  const raw = await getObjectRaw(bucket, srcKey(cellId, path));
  if (raw === null) return null;
  return { ...raw, version: contentVersion(raw.body), binary: !isTextType(raw.contentType) };
}

/** The metadata half of a file — what `readFile` and `listFiles(view:"meta")` report. */
function fileMeta(path: string, obj: SourceObject, text?: string): Record<string, unknown> {
  return {
    path,
    contentType: obj.contentType,
    binary: obj.binary,
    bytes: obj.body.length,
    ...(obj.binary ? {} : { lines: countLines(text ?? obj.body.toString('utf-8')) }),
    version: obj.version,
    ...(obj.etag ? { etag: obj.etag } : {}),
    ...(obj.lastModified ? { modifiedAt: obj.lastModified } : {}),
  };
}

function versionConflict(path: string, expected: string, actual: string): Error {
  return new Error(
    `VERSION_CONFLICT on ${path}: expected ${expected}, found ${actual} — nothing was written. ` +
      're-read the file (readFile returns `version`) and retry against what is there now',
  );
}

interface Preconditions {
  ifVersion?: string;
  ifAbsent?: boolean;
  ifExists?: boolean;
}

/** Validate preconditions against the file as read. Throws; writes nothing. */
function checkPreconditions(path: string, current: SourceObject | null, p: Preconditions): void {
  if (p.ifVersion !== undefined && typeof p.ifVersion !== 'string') throw new Error('ifVersion must be a string');
  if (p.ifAbsent && (p.ifVersion !== undefined || p.ifExists)) throw new Error('ifAbsent cannot be combined with ifVersion or ifExists');
  if (p.ifAbsent && current) throw versionConflict(path, 'absent', current.version);
  if (p.ifExists && !current) throw new Error(`File not found: ${path} (ifExists)`);
  if (p.ifVersion !== undefined && current?.version !== p.ifVersion) {
    throw versionConflict(path, p.ifVersion, current?.version ?? 'absent');
  }
}

/**
 * Commit a read-modify-write: a PUT that only lands if the object is still the
 * generation `current` was read at (or still absent, if it was absent).
 */
async function commitSource(
  bucket: string,
  cellId: string,
  path: string,
  body: string | Buffer,
  contentType: string,
  current: SourceObject | null,
): Promise<void> {
  const key = srcKey(cellId, path);
  try {
    if (!current) await putObjectIf(bucket, key, body, contentType, { ifNoneMatch: '*' });
    else if (current.etag) await putObjectIf(bucket, key, body, contentType, { ifMatch: current.etag });
    else await putObject(bucket, key, body, contentType);
  } catch (err) {
    if (err instanceof PreconditionFailedError) {
      throw versionConflict(path, current?.version ?? 'absent', 'a concurrent write');
    }
    throw err;
  }
}

/** The text of a source object, refusing bytes (a text edit would mangle them). */
function sourceText(path: string, obj: SourceObject, op: string): string {
  if (obj.binary) throw new Error(`${op} refuses ${path}: it is stored as bytes (${obj.contentType}); use writeFile with encoding:'base64'`);
  return obj.body.toString('utf-8');
}

async function writeFile(input: WriteFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  if (typeof input?.content !== 'string') throw new Error('content (string) is required');
  if (input.encoding !== undefined && input.encoding !== 'utf8' && input.encoding !== 'base64') {
    throw new Error("encoding must be 'utf8' or 'base64'");
  }
  const { record, bucket, env } = await resolveAuthorized(input, user);
  const path = cleanPath(input.path);
  let body: string | Buffer;
  let contentType: string;
  if (input.encoding === 'base64') {
    // ROUND-TRIP THE DECODE BEFORE STORING. `Buffer.from(s,'base64')` never
    // throws — it stops at the first character it cannot use and returns what
    // it had — so a truncated or mistyped payload would land as a short file
    // that looks fine until something tries to decode the image. Re-encoding
    // and comparing is the cheap way to refuse it here instead.
    const bytes = Buffer.from(input.content, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== input.content.replace(/[\s=]+$/g, '').replace(/\s/g, '')) {
      throw new Error(`content is not valid base64 for ${path}`);
    }
    body = bytes;
    contentType = binaryTypeFor(path);
  } else {
    body = input.content;
    contentType = TEXT_CONTENT_TYPE;
  }
  let previousVersion: string | undefined;
  if (input.ifVersion !== undefined || input.ifAbsent) {
    // A precondition means read, check, then commit pinned to what was read.
    const current = await readSource(bucket, record.cellId, path);
    checkPreconditions(path, current, { ifVersion: input.ifVersion, ifAbsent: input.ifAbsent });
    previousVersion = current?.version;
    await commitSource(bucket, record.cellId, path, body, contentType, current);
  } else {
    await putObject(bucket, srcKey(record.cellId, path), body, contentType);
  }
  ctx.logger.info('cell file written', { cellId: record.cellId, path });
  const result = {
    ok: true as const,
    cellId: record.cellId,
    path,
    version: contentVersion(body),
    ...(previousVersion ? { previousVersion } : {}),
    bytes: Buffer.byteLength(body),
  };
  if (input.deploy) {
    const started = await requestDeploy(record, env, ctx);
    return { ...result, deploying: true, deploy: started.deploy, message: started.message };
  }
  await emitFilesChanged(ctx, record, 'write', [path]);
  return result;
}

interface ImportSrcInput extends CellRef {
  /** HTTPS URL of a tar / tar.gz archive (e.g. a GitHub codeload tarball). */
  url: string;
  /** Archive path prefix to select AND strip (e.g. `repo-main/src/`). */
  include?: string;
  /** Destination prefix inside the cell's src tree (e.g. `client/`). */
  prefix?: string;
}

/**
 * Bulk-import text sources from a public archive into the cell's src tree —
 * hoisting an existing repo into a cell without pushing it file-by-file.
 * Same ownership gate and path validation as `writeFile`.
 */
async function importSrc(input: ImportSrcInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.url || !/^https:\/\//.test(input.url)) throw new Error('an https `url` is required');
  const { record, bucket } = await resolveAuthorized(input, user);

  const fetchFn = (globalThis as { fetch?: (url: string) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }> }).fetch;
  if (!fetchFn) throw new Error('fetch unavailable in this runtime');
  const res = await fetchFn(input.url);
  if (!res.ok) throw new Error(`archive fetch failed: HTTP ${res.status}`);
  const archive = Buffer.from(await res.arrayBuffer());
  if (archive.length > 30 * 1024 * 1024) throw new Error('archive too large (>30MB)');

  const { entries, skipped } = extractTarGz(archive, { include: input.include });
  const written: string[] = [];
  const skippedPaths: string[] = [];
  for (const entry of entries) {
    const rel = input.include ? entry.name.slice(input.include.length) : entry.name;
    if (!rel) continue;
    const target = `${input.prefix ?? ''}${rel}`;
    try {
      await putObject(bucket, srcKey(record.cellId, target), entry.content, 'text/plain; charset=utf-8');
      written.push(cleanPath(target));
    } catch (err) {
      ctx.logger.warn('importSrc skipped unsafe path', { path: target, error: (err as Error).message });
      skippedPaths.push(target);
    }
  }
  ctx.logger.info('cell src imported', { cellId: record.cellId, url: input.url, files: written.length, skipped });
  if (written.length) await emitFilesChanged(ctx, record, 'import', written);
  return { imported: written.length, files: written, skippedBinary: skipped, skippedUnsafe: skippedPaths };
}

interface ReplaceInFileInput extends CellRef {
  path: string;
  /** The exact string to find (case-sensitive). */
  old_str: string;
  /** The replacement (empty string deletes). */
  new_str: string;
  /** Replace every occurrence (default: exactly one — see expectedOccurrences). */
  replace_all?: boolean;
  /**
   * How many times old_str must occur for the edit to proceed. Checked BEFORE
   * anything is written. Defaults to 1 unless replace_all or matchIndex is set,
   * so an ambiguous old_str is refused instead of silently editing the first hit.
   */
  expectedOccurrences?: number;
  /** Replace only the Nth occurrence (0-based) — for deliberately ambiguous edits. */
  matchIndex?: number;
  /** Proof of read: edit only if the file is still at this `version`. */
  ifVersion?: string;
  /** Validate and return the prospective hunk(s) without writing. */
  dryRun?: boolean;
  /** Fused: kick off an async deploy in the same call (poll get for the phase). */
  deploy?: boolean;
}

/** A few lines either side of an edit, before and after — what a dry run shows. */
function hunkAt(before: string, after: string, offset: number, oldLen: number, newLen: number, context = 2): Record<string, unknown> {
  const line = lineAt(before, offset);
  const oldEndLine = lineAt(before, offset + oldLen);
  const newEndLine = lineAt(after, offset + newLen);
  const b = before.split('\n');
  const a = after.split('\n');
  const from = Math.max(1, line - context);
  return {
    line,
    before: b.slice(from - 1, Math.min(b.length, oldEndLine + context)).join('\n'),
    after: a.slice(from - 1, Math.min(a.length, newEndLine + context)).join('\n'),
  };
}

/**
 * Targeted edit on a cell source file — exact string replacement without
 * resending the whole file (the Val Town `replace_in_file` contract).
 *
 * Ambiguity is refused, not reported after the fact: `occurrences` used to come
 * back AFTER the first hit had already been rewritten, which is too late to
 * matter. Now the occurrence count is a precondition (`expectedOccurrences`,
 * default 1), checked with `ifVersion` before any write, and the commit is
 * pinned to the object generation that was read.
 */
async function replaceInFile(input: ReplaceInFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  if (typeof input?.old_str !== 'string' || input.old_str.length === 0) throw new Error('old_str (non-empty string) is required');
  if (typeof input?.new_str !== 'string') throw new Error('new_str (string, may be empty) is required');
  const { record, bucket, env } = await resolveAuthorized(input, user);
  const path = cleanPath(input.path);
  const current = await readSource(bucket, record.cellId, path);
  if (current === null) throw new Error(`File not found: ${path}`);
  checkPreconditions(path, current, { ifVersion: input.ifVersion });
  const content = sourceText(path, current, 'replaceInFile');
  const { next, replacements, occurrences, targets } = planReplace(path, content, input);

  if (input.dryRun) {
    // Hunks are located in the post-edit text by shifting each offset by the
    // length change of the replacements before it.
    const delta = input.new_str.length - input.old_str.length;
    const hunks = targets.slice(0, 20).map((at, i) => hunkAt(content, next, at + i * delta, input.old_str.length, input.new_str.length));
    return {
      ok: true as const, dryRun: true, cellId: record.cellId, path,
      replacements, occurrences, version: current.version, nextVersion: contentVersion(next), hunks,
    };
  }

  await commitSource(bucket, record.cellId, path, next, TEXT_CONTENT_TYPE, current);
  ctx.logger.info('cell file edited', { cellId: record.cellId, path, replacements });
  const result = {
    ok: true as const, cellId: record.cellId, path, replacements, occurrences,
    line: lineAt(content, targets[0]),
    previousVersion: current.version, version: contentVersion(next),
  };
  if (input.deploy) {
    const started = await requestDeploy(record, env, ctx);
    return { ...result, deploy: started.deploy };
  }
  await emitFilesChanged(ctx, record, 'replace', [path]);
  return result;
}

interface AppendToFileInput extends CellRef {
  path: string;
  content: string;
  /** Proof of read: append only if the file is still at this `version`. */
  ifVersion?: string;
  /** Refuse to create the file — a typo'd path fails instead of making a new file. */
  ifExists?: boolean;
  /** Create only: refuse if the file already exists. */
  ifAbsent?: boolean;
  deploy?: boolean;
}

/** Append to a cell source file (creates it when missing, unless ifExists). */
async function appendToFile(input: AppendToFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  if (typeof input?.content !== 'string' || input.content.length === 0) throw new Error('content (non-empty string) is required');
  const { record, bucket, env } = await resolveAuthorized(input, user);
  const path = cleanPath(input.path);
  const current = await readSource(bucket, record.cellId, path);
  checkPreconditions(path, current, { ifVersion: input.ifVersion, ifExists: input.ifExists, ifAbsent: input.ifAbsent });
  const existing = current ? sourceText(path, current, 'appendToFile') : '';
  const next = existing + input.content;
  await commitSource(bucket, record.cellId, path, next, TEXT_CONTENT_TYPE, current);
  const created = current === null;
  ctx.logger.info('cell file appended', { cellId: record.cellId, path, created });
  const result = {
    ok: true as const, cellId: record.cellId, path, created,
    ...(current ? { previousVersion: current.version } : {}),
    version: contentVersion(next),
    bytes: Buffer.byteLength(next),
  };
  if (input.deploy) {
    const started = await requestDeploy(record, env, ctx);
    return { ...result, deploy: started.deploy };
  }
  await emitFilesChanged(ctx, record, 'append', [path]);
  return result;
}

interface ReadFileInput extends CellRef {
  path: string;
  /** 1-based first line (text files). */
  startLine?: number;
  /** 1-based last line, inclusive (defaults to the end, within the byte budget). */
  endLine?: number;
  /** Byte offset (any file). */
  offset?: number;
  /** Byte count from `offset` (defaults to the budget). */
  length?: number;
  /** Force the content encoding; bytes are always base64. */
  encoding?: 'utf8' | 'base64';
}

/**
 * Read a source file — whole (the original contract), a line range, or a byte
 * range — with its metadata and content `version`.
 *
 * A ranged read is the point: a 2.5 MB main.ts used to be all-or-nothing, and
 * "all" meant the `whole:true` transport escape hatch followed by a downstream
 * truncation. A line range stays inside RANGE_MAX_BYTES and says where to
 * continue (`nextStartLine`), so an agent can page through any file.
 */
async function readFile(input: ReadFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  const lineMode = input.startLine !== undefined || input.endLine !== undefined;
  const byteMode = input.offset !== undefined || input.length !== undefined;
  if (lineMode && byteMode) throw new Error('pass either startLine/endLine or offset/length, not both');
  if (input.encoding !== undefined && input.encoding !== 'utf8' && input.encoding !== 'base64') {
    throw new Error("encoding must be 'utf8' or 'base64'");
  }
  const { record, bucket } = await resolveAuthorized(input, user);
  const path = cleanPath(input.path);
  // RAW, THEN DECIDE. Reading as UTF-8 first and checking afterwards is not
  // possible — the damage is done by the decode, and a caller cannot tell a
  // mangled PNG from a text file that happens to contain U+FFFD. The stored
  // content type is the record of what was written, so it makes the choice.
  const obj = await readSource(bucket, record.cellId, path);
  if (obj === null) throw new Error(`file not found: ${path}`);
  const text = obj.binary ? undefined : obj.body.toString('utf-8');
  const meta = { cellId: record.cellId, ...fileMeta(path, obj, text) };
  const asBase64 = obj.binary || input.encoding === 'base64';

  if (lineMode) {
    if (text === undefined) throw new Error(`${path} is stored as bytes (${obj.contentType}); use offset/length for a range`);
    const slice = sliceLines(text, input.startLine ?? 1, input.endLine);
    return {
      ...meta,
      content: asBase64 ? Buffer.from(slice.content, 'utf-8').toString('base64') : slice.content,
      encoding: asBase64 ? 'base64' : 'utf8',
      range: { startLine: slice.startLine, endLine: slice.endLine, totalLines: slice.totalLines },
      truncated: slice.truncated,
      ...(slice.nextStartLine ? { nextStartLine: slice.nextStartLine } : {}),
    };
  }
  if (byteMode) {
    const offset = input.offset ?? 0;
    if (!Number.isInteger(offset) || offset < 0) throw new Error('offset must be an integer >= 0');
    if (input.length !== undefined && (!Number.isInteger(input.length) || input.length < 1)) throw new Error('length must be an integer >= 1');
    const want = Math.min(input.length ?? RANGE_MAX_BYTES, asBase64 ? Math.floor((RANGE_MAX_BYTES * 3) / 4) : RANGE_MAX_BYTES);
    const end = Math.min(obj.body.length, offset + want);
    const chunk = obj.body.subarray(Math.min(offset, obj.body.length), end);
    return {
      ...meta,
      // A byte range of text can split a multi-byte character; ask for
      // encoding:'base64' when exact bytes matter (or use line ranges).
      content: asBase64 ? chunk.toString('base64') : chunk.toString('utf-8'),
      encoding: asBase64 ? 'base64' : 'utf8',
      range: { offset, length: chunk.length, totalBytes: obj.body.length },
      truncated: input.length !== undefined && chunk.length < input.length && end < obj.body.length,
      ...(end < obj.body.length ? { nextOffset: end } : {}),
    };
  }
  return {
    ...meta,
    content: asBase64 ? obj.body.toString('base64') : (text as string),
    encoding: asBase64 ? 'base64' : 'utf8',
  };
}

interface ListFilesInput extends CellRef {
  /** Only paths under this prefix, e.g. `client/hydro/`. */
  prefix?: string;
  /** Only paths matching this glob, e.g. `client/**\/*.ts` or `*.md`. */
  glob?: string;
  /** Page size (paths: unbounded by default; meta: 100 by default). */
  limit?: number;
  /** Resume after this `nextCursor`. */
  cursor?: string;
  /** `paths` (default): string[]; `meta`: one object per file with size, lines, version. */
  view?: 'paths' | 'meta';
}

const LIST_META_DEFAULT = 100;
const LIST_MAX = 1000;

async function listFiles(input: ListFilesInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const view = input?.view ?? 'paths';
  if (view !== 'paths' && view !== 'meta') throw new Error("view must be 'paths' or 'meta'");
  if (input?.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1)) throw new Error('limit must be an integer >= 1');
  const { record, bucket } = await resolveAuthorized(input, user);
  const prefix = srcPrefix(record.cellId);
  const matches = pathMatcher(input.prefix?.replace(/^\/+/, ''), input.glob);
  const all = (await listObjectsMeta(bucket, prefix))
    .map((o) => ({ ...o, path: o.key.slice(prefix.length) }))
    .filter((o) => o.path && matches(o.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const totalBytes = all.reduce((n, o) => n + o.size, 0);

  // The cursor is the last path returned (start-after), so a file created
  // mid-pagination neither shifts nor duplicates the pages around it.
  const after = decodeCursor<{ after: string }>(input.cursor)?.after;
  const rest = after === undefined ? all : all.filter((o) => o.path > after);
  const limit = Math.min(input.limit ?? (view === 'meta' ? LIST_META_DEFAULT : Infinity), LIST_MAX);
  const page = rest.slice(0, limit);
  const nextCursor = rest.length > page.length && page.length ? encodeCursor({ after: page[page.length - 1].path }) : undefined;
  const common = {
    cellId: record.cellId,
    count: page.length,
    total: all.length,
    totalBytes,
    ...(nextCursor ? { nextCursor } : {}),
  };
  if (view === 'paths') return { ...common, files: page.map((o) => o.path) };

  // Metadata needs the bytes (version, line count, stored content type), so a
  // meta page costs one GET per file — which is why it is paged by default.
  const files = await mapLimit(page, 16, async (o) => {
    const obj = await readSource(bucket, record.cellId, o.path);
    if (!obj) return { path: o.path, bytes: o.size, deleted: true };
    return fileMeta(o.path, obj);
  });
  return { ...common, files };
}

interface SearchFilesInput extends CellRef {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  prefix?: string;
  glob?: string;
  contextLines?: number;
  maxMatches?: number;
  cursor?: string;
}

const SEARCH_DEFAULT_MATCHES = 50;
const SEARCH_MAX_MATCHES = 500;

/**
 * Server-side text search over the cell's src tree: returns match locations
 * (path, line, column, the line, optional context) instead of moving source
 * through the MCP boundary. Pair it with a ranged `readFile` on a hit.
 * Bytes (images, fonts) are skipped by stored content type.
 */
async function searchFiles(input: SearchFilesInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const re = compileQuery({ query: input?.query, regex: input?.regex, caseSensitive: input?.caseSensitive });
  const contextLines = Math.max(0, Math.min(10, Math.floor(input.contextLines ?? 0)));
  const maxMatches = Math.max(1, Math.min(SEARCH_MAX_MATCHES, Math.floor(input.maxMatches ?? SEARCH_DEFAULT_MATCHES)));
  const { record, bucket } = await resolveAuthorized(input, user);
  const prefix = srcPrefix(record.cellId);
  const matches = pathMatcher(input.prefix?.replace(/^\/+/, ''), input.glob);
  const paths = (await listObjectsMeta(bucket, prefix))
    .map((o) => o.key.slice(prefix.length))
    .filter((p) => p && matches(p))
    .sort();

  const resume = decodeCursor<{ path: string; line: number }>(input.cursor);
  const out: Array<SearchMatch & { path: string; version: string }> = [];
  let searchedFiles = 0;
  let skippedBinary = 0;
  let bytes = 0;
  let nextCursor: string | undefined;
  for (const path of paths) {
    if (resume && path < resume.path) continue;
    const obj = await readSource(bucket, record.cellId, path);
    if (!obj) continue;
    if (obj.binary) { skippedBinary++; continue; }
    searchedFiles++;
    const afterLine = resume && path === resume.path ? resume.line : 0;
    const found = searchText(obj.body.toString('utf-8'), re, contextLines, maxMatches - out.length + 1, afterLine);
    for (const m of found) {
      const cost = Buffer.byteLength(JSON.stringify(m)) + path.length + 80;
      if (out.length >= maxMatches || (out.length > 0 && bytes + cost > RANGE_MAX_BYTES)) {
        nextCursor = encodeCursor({ path, line: m.line - 1 });
        break;
      }
      out.push({ path, ...m, version: obj.version });
      bytes += cost;
    }
    if (nextCursor) break;
  }
  return {
    cellId: record.cellId,
    matches: out,
    count: out.length,
    searchedFiles,
    skippedBinary,
    truncated: nextCursor !== undefined,
    ...(nextCursor ? { nextCursor } : {}),
  };
}

interface DeleteFileInput extends CellRef {
  path: string;
  /** Proof of read: delete only if the file is still at this `version`. */
  ifVersion?: string;
  /** Fused: kick off an async deploy in the same call (poll get for the phase). */
  deploy?: boolean;
}
async function deleteFile(input: DeleteFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  const { record, bucket, env } = await resolveAuthorized(input, user);
  const path = cleanPath(input.path);
  let previousVersion: string | undefined;
  if (input.ifVersion !== undefined) {
    // Check-then-delete: S3 has no conditional DELETE on general-purpose
    // buckets, so this narrows the window rather than closing it.
    const current = await readSource(bucket, record.cellId, path);
    checkPreconditions(path, current, { ifVersion: input.ifVersion });
    previousVersion = current?.version;
  }
  await deleteObject(bucket, srcKey(record.cellId, path));
  const result = { ok: true as const, cellId: record.cellId, path, ...(previousVersion ? { previousVersion } : {}) };
  if (input.deploy) {
    const started = await requestDeploy(record, env, ctx);
    return { ...result, deploy: started.deploy };
  }
  await emitFilesChanged(ctx, record, 'delete', [path]);
  return result;
}

// ─── Source tree: identity, snapshots, patch sets, diff, batch reads ──
//
// The per-file tools above make ONE edit safe. These make the TREE a unit:
// a treeVersion names an exact source tree, applyPatchSet lands many edits as
// all-or-nothing against it, snapshots freeze it, and deploys build a
// snapshot rather than whatever src/ holds when the worker runs. See
// source-tree.ts for the storage and docs/cell-storage-s3.md for the model.

type ManifestFile = { path: string; version: string; contentType: string };

/** Added / modified / deleted paths between two manifests. */
function compareManifests(from: ManifestFile[], to: ManifestFile[]): {
  added: ManifestFile[];
  modified: Array<{ from: ManifestFile; to: ManifestFile }>;
  deleted: ManifestFile[];
  unchanged: number;
} {
  const a = new Map(from.map((f) => [f.path, f]));
  const b = new Map(to.map((f) => [f.path, f]));
  const added: ManifestFile[] = [];
  const modified: Array<{ from: ManifestFile; to: ManifestFile }> = [];
  const deleted: ManifestFile[] = [];
  let unchanged = 0;
  for (const [p, f] of b) {
    const was = a.get(p);
    if (!was) added.push(f);
    else if (was.version !== f.version) modified.push({ from: was, to: f });
    else unchanged++;
  }
  for (const [p, f] of a) if (!b.has(p)) deleted.push(f);
  const byPath = (x: { path: string }, y: { path: string }): number => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0);
  added.sort(byPath);
  deleted.sort(byPath);
  modified.sort((x, y) => byPath(x.to, y.to));
  return { added, modified, deleted, unchanged };
}

async function sourceStatus(input: CellRef, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const { record, bucket } = await resolveAuthorized(input, user);
  const store = new TreeStore(bucket, record.cellId);
  const tree = await store.tree();
  await store.flush();
  const deployedTree = record.lastDeployed?.treeVersion;
  let changedSinceDeploy: Record<string, number> | undefined;
  if (deployedTree && deployedTree !== tree.treeVersion) {
    const snap = await store.loadSnapshot(deployedTree);
    if (snap) {
      const d = compareManifests(snap.files, tree.files);
      changedSinceDeploy = { added: d.added.length, modified: d.modified.length, deleted: d.deleted.length };
    }
  }
  return {
    cellId: record.cellId,
    treeVersion: tree.treeVersion,
    files: tree.files.length,
    bytes: tree.bytes,
    deployed: record.lastDeployed ?? null,
    // null = never deployed from a pinned snapshot, so "dirty" is unknowable.
    dirty: deployedTree ? deployedTree !== tree.treeVersion : null,
    ...(changedSinceDeploy ? { changedSinceDeploy } : {}),
    ...(record.deploy ? { deploy: record.deploy } : {}),
  };
}

interface SnapshotInput extends CellRef {
  /** Freeze only if the live tree is still exactly this one. */
  ifTreeVersion?: string;
}

async function snapshotSource(input: SnapshotInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const { record, bucket } = await resolveAuthorized(input, user);
  const store = new TreeStore(bucket, record.cellId);
  const snap = await store.snapshot({ createdBy: user });
  if (input.ifTreeVersion !== undefined && snap.treeVersion !== input.ifTreeVersion) {
    // The snapshot is still valid and kept (it is immutable and harmless) —
    // but it is not the tree the caller asked to freeze.
    throw new TreeConflictError(input.ifTreeVersion, snap.treeVersion);
  }
  return { cellId: record.cellId, treeVersion: snap.treeVersion, count: snap.count, bytes: snap.bytes, createdAt: snap.createdAt };
}

interface ApplyPatchSetInput extends CellRef {
  changes: PatchChange[];
  /** Apply only if the whole source tree is still exactly this one. */
  ifTreeVersion?: string;
  /** Validate and return the combined diff + projected versions; write nothing. */
  dryRun?: boolean;
  /** Freeze the resulting tree as a snapshot (implied by deploy). */
  snapshot?: boolean;
  /** Deploy exactly the resulting tree. */
  deploy?: boolean;
  /** ADR-0099: with deploy:true, why — recorded on the deploy fact (optional). */
  description?: string;
  /** ADR-0099: with deploy:true, where the source came from (optional). */
  source?: string;
  /** Context lines in the dry-run diff (default 3). */
  contextLines?: number;
}

const PATCH_MAX_CHANGES = 200;

async function readBase(bucket: string, cellId: string, paths: string[]): Promise<Map<string, BaseFile | null>> {
  const objs = await mapLimit(paths, 16, (p) => readSource(bucket, cellId, p));
  return new Map(paths.map((p, i) => [p, objs[i]]));
}

function projectTree(tree: Tree, files: Array<{ path: string; status: 'A' | 'M' | 'D'; version?: string }>): string {
  const m = new Map(tree.files.map((f) => [f.path, f.version]));
  for (const f of files) {
    if (f.status === 'D') m.delete(f.path);
    else m.set(f.path, f.version as string);
  }
  return treeVersionOfMap(m);
}
const treeVersionOfMap = (m: Map<string, string>): string => treeVersionOf([...m].map(([path, version]) => ({ path, version })));

/** Per-file stats and one combined unified diff, inside the response budget. */
function describePlan(
  base: Map<string, BaseFile | null>,
  planned: ReturnType<typeof planPatch>['files'],
  contextLines: number,
): { files: Array<Record<string, unknown>>; diff: string; truncated: boolean; omitted: string[] } {
  const files: Array<Record<string, unknown>> = [];
  const parts: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  const movedTo = new Map(planned.filter((f) => f.movedFrom).map((f) => [f.movedFrom as string, f.path]));
  for (const f of planned) {
    // A move is shown as a rename: its content is diffed against the file it came from.
    const origin = f.movedFrom ?? f.path;
    const was = (f.movedFrom ? base.get(f.movedFrom) : base.get(f.path)) ?? null;
    const beforeBinary = was?.binary ?? false;
    const afterBinary = f.next?.binary ?? false;
    const entry: Record<string, unknown> = {
      path: f.path,
      status: f.status,
      ...(f.oldVersion ? { oldVersion: f.oldVersion } : {}),
      ...(f.version ? { version: f.version } : {}),
      ...(f.movedFrom ? { movedFrom: f.movedFrom } : {}),
      ...(movedTo.has(f.path) && f.status === 'D' ? { movedTo: movedTo.get(f.path) } : {}),
    };
    let body: string;
    if (entry.movedTo) {
      body = `renamed to ${String(entry.movedTo)}`;
    } else if (beforeBinary || afterBinary) {
      entry.binary = true;
      body = `Binary file ${f.status === 'D' ? 'deleted' : f.status === 'A' && !f.movedFrom ? 'added' : 'changed'}`;
    } else {
      const d = diffText(was ? was.body.toString('utf-8') : '', f.next ? f.next.body.toString('utf-8') : '', contextLines);
      entry.added = d.stats.added;
      entry.removed = d.stats.removed;
      body = d.hunks || (f.movedFrom ? '(content unchanged)' : '');
      if (d.hunks === null) body = '(too many changes to show hunks — read the file)';
    }
    files.push(entry);
    const fromLabel = f.status === 'A' && !f.movedFrom ? '/dev/null' : `a/${origin}`;
    const toLabel = f.status === 'D' ? '/dev/null' : `b/${f.path}`;
    const chunk = `--- ${fromLabel}\n+++ ${toLabel}\n${body}\n`;
    const cost = Buffer.byteLength(chunk);
    if (used + cost > RANGE_MAX_BYTES && parts.length > 0) {
      omitted.push(f.path);
      continue;
    }
    parts.push(chunk);
    used += cost;
  }
  return { files, diff: parts.join(''), truncated: omitted.length > 0, omitted };
}

function formatConflicts(conflicts: Array<{ index: number; op: string; path: string; error: string }>): string {
  return (
    `PATCH_REJECTED: ${conflicts.length} conflict(s) — nothing was written.\n` +
    conflicts.map((c) => `  [${c.index}] ${c.op} ${c.path}: ${c.error}`).join('\n')
  );
}

/**
 * Apply many edits to a cell's source as ONE change: every precondition is
 * checked before anything is written, then every file is committed — or, if
 * any write loses a race, every write already made is rolled back. Commits
 * serialize on a per-cell lock whose journal lets the next holder undo a
 * commit whose Lambda died half way.
 *
 * Readers can observe the few hundred milliseconds of a commit in progress
 * (S3 has no multi-object transaction); the guarantee is to the AUTHOR: the
 * patch set lands whole or not at all, and never onto a tree it did not name.
 */
async function applyPatchSet(input: ApplyPatchSetInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!Array.isArray(input?.changes) || input.changes.length === 0) throw new Error('changes (non-empty array) is required');
  if (input.changes.length > PATCH_MAX_CHANGES) throw new Error(`at most ${PATCH_MAX_CHANGES} changes per patch set`);
  if (input.ifTreeVersion !== undefined && !isTreeVersion(input.ifTreeVersion)) throw new Error('ifTreeVersion must be tree:<64 hex>');
  const contextLines = Math.max(0, Math.min(10, Math.floor(input.contextLines ?? 3)));
  const { record, bucket, env } = await resolveAuthorized(input, user);
  const store = new TreeStore(bucket, record.cellId);
  const paths = touchedPaths(input.changes);

  /** The tree check: the whole tree, AND every touched file as read, must be the named tree. */
  const treeCheck = (tree: Tree, base: Map<string, BaseFile | null>): string | null => {
    if (input.ifTreeVersion === undefined) return null;
    if (tree.treeVersion !== input.ifTreeVersion) return new TreeConflictError(input.ifTreeVersion, tree.treeVersion).message;
    const listed = new Map(tree.files.map((f) => [f.path, f.version]));
    for (const [p, b] of base) {
      if ((b?.version ?? undefined) !== listed.get(p)) return new TreeConflictError(input.ifTreeVersion, `a tree where ${p} moved mid-read`).message;
    }
    return null;
  };

  if (input.dryRun) {
    const tree = await store.tree();
    const base = await readBase(bucket, record.cellId, paths);
    const plan = planPatch(base, input.changes, binaryTypeFor);
    const conflicts = [...plan.conflicts];
    const treeError = treeCheck(tree, base);
    if (treeError) conflicts.unshift({ index: -1, op: 'ifTreeVersion', path: '*', error: treeError });
    const described = describePlan(base, plan.files, contextLines);
    await store.flush();
    return {
      ok: conflicts.length === 0,
      dryRun: true,
      cellId: record.cellId,
      previousTreeVersion: tree.treeVersion,
      treeVersion: projectTree(tree, plan.files),
      conflicts,
      files: described.files,
      diff: described.diff,
      truncated: described.truncated,
      ...(described.omitted.length ? { omitted: described.omitted } : {}),
    };
  }

  const { lock, recovered } = await store.acquireLock(`${user} applyPatchSet`);
  if (recovered.length) ctx.logger.warn('rolled back an interrupted patch set before this one', { cellId: record.cellId, recovered });
  let result: Record<string, unknown>;
  let changedPaths: string[] = [];
  let snapTreeVersion: string | undefined;
  /** Set when an undo could not finish: the journal must outlive this call. */
  let keepLock = false;
  try {
    const tree = await store.tree();
    const base = await readBase(bucket, record.cellId, paths);
    const treeError = treeCheck(tree, base);
    if (treeError) throw new Error(treeError);
    const plan = planPatch(base, input.changes, binaryTypeFor);
    if (plan.conflicts.length) throw new Error(formatConflicts(plan.conflicts));
    const projected = projectTree(tree, plan.files);

    if (plan.files.length === 0) {
      result = { ok: true, cellId: record.cellId, previousTreeVersion: tree.treeVersion, treeVersion: tree.treeVersion, files: [], unchanged: true };
    } else {
      // Base content goes to blobs/ BEFORE anything is overwritten: the
      // journal's undo — in this process or the next lock holder's — needs it.
      for (const f of plan.files) {
        const b = base.get(f.path);
        if (b) await store.putBlob(b.version, b.body, b.contentType);
      }
      const journal: Journal = { base: {}, next: {}, baseTypes: {} };
      for (const f of plan.files) {
        const b = base.get(f.path);
        journal.base[f.path] = b?.version ?? null;
        journal.next[f.path] = f.version ?? null;
        if (b) journal.baseTypes[f.path] = b.contentType;
      }
      await store.writeJournal(lock, journal);

      const written: Array<{ path: string; etag: string; version: string; contentType: string; bytes: number }> = [];
      try {
        for (const f of plan.files) {
          if (f.status === 'D' || !f.next) continue;
          const b = base.get(f.path);
          const r = await putObjectIf(bucket, srcKey(record.cellId, f.path), f.next.body, f.next.contentType, b ? (b.etag ? { ifMatch: b.etag } : {}) : { ifNoneMatch: '*' });
          if (r.etag) written.push({ path: f.path, etag: r.etag, version: f.version as string, contentType: f.next.contentType, bytes: f.next.body.length });
        }
        for (const f of plan.files) {
          if (f.status !== 'D') continue;
          const b = base.get(f.path) as BaseFile;
          const key = srcKey(record.cellId, f.path);
          // S3 has no conditional DELETE on general-purpose buckets: check,
          // then delete. The journal still covers the window.
          const cur = await getObjectRaw(bucket, key);
          if (!cur || (b.etag && cur.etag !== b.etag)) throw new PreconditionFailedError(key);
          await deleteObject(bucket, key);
        }
      } catch (err) {
        let restored: string[];
        try {
          restored = await store.rollback(journal);
        } catch (undoErr) {
          // Leave the lock and its journal in place: once it expires, the next
          // patch set replays the undo before doing anything else.
          keepLock = true;
          throw new Error(
            `PATCH_INTERRUPTED: commit failed (${(err as Error).message}) and the rollback did too (${(undoErr as Error).message}); ` +
              `the cell stays locked for up to ${Math.round(LOCK_TTL_MS / 1000)}s, then the next applyPatchSet completes the undo`,
          );
        }
        const detail = err instanceof PreconditionFailedError ? `${err.message.replace(/^object changed concurrently: /, '')} changed under the commit (VERSION_CONFLICT)` : (err as Error).message;
        throw new Error(`PATCH_ROLLED_BACK: ${detail}; restored ${restored.length} file(s) — the patch set was not applied. Re-read and retry`);
      }
      await store.seed(written);
      const after = await store.tree();
      changedPaths = plan.files.map((f) => f.path);
      if (input.snapshot || input.deploy) {
        const inline = new Map<string, { body: Buffer; contentType: string }>();
        for (const f of plan.files) if (f.next && f.version) inline.set(f.version, { body: f.next.body, contentType: f.next.contentType });
        snapTreeVersion = (await store.snapshot({ tree: after, createdBy: user, inline })).treeVersion;
      }
      const described = describePlan(base, plan.files, 0);
      result = {
        ok: true,
        cellId: record.cellId,
        previousTreeVersion: tree.treeVersion,
        treeVersion: after.treeVersion,
        // Another writer touched files outside this patch set while it committed.
        ...(after.treeVersion !== projected ? { concurrentChanges: true, projectedTreeVersion: projected } : {}),
        files: described.files,
        ...(snapTreeVersion ? { snapshot: snapTreeVersion } : {}),
      };
    }
    await store.flush();
  } finally {
    if (!keepLock) await store.releaseLock(lock);
  }
  ctx.logger.info('cell patch set applied', { cellId: record.cellId, files: changedPaths.length, treeVersion: result.treeVersion });
  if (input.deploy && snapTreeVersion) {
    const started = await requestDeploy(record, env, ctx, snapTreeVersion, { description: input.description, source: input.source });
    return { ...result, deploy: started.deploy };
  }
  if (changedPaths.length) await emitFilesChanged(ctx, record, 'patch', changedPaths);
  return result;
}

interface MoveFileInput extends CellRef {
  from: string;
  to: string;
  ifVersion?: string;
  overwrite?: boolean;
  ifTreeVersion?: string;
  dryRun?: boolean;
  deploy?: boolean;
}

/** Rename/move one file atomically — a one-change patch set. */
async function moveFile(input: MoveFileInput, ctx: ServiceContext): Promise<unknown> {
  if (!input?.from || !input?.to) throw new Error('from and to are required');
  const { from, to, ifVersion, overwrite, ...rest } = input;
  return applyPatchSet({ ...rest, changes: [{ op: 'move', from, to, ifVersion, overwrite }] }, ctx);
}

interface DiffInput extends CellRef {
  /** `deployed` (default), `current`, or a `tree:<hash>` snapshot. */
  from?: string;
  /** `current` (default), `deployed`, or a `tree:<hash>` snapshot. */
  to?: string;
  view?: 'summary' | 'files' | 'patch';
  prefix?: string;
  glob?: string;
  contextLines?: number;
}

/** A diff side: a manifest plus how to read a file's bytes at a version. */
async function diffSide(spec: string, store: TreeStore, record: CellRecord, live: () => Promise<Tree>): Promise<{ treeVersion: string; files: ManifestFile[] }> {
  if (spec === 'current') {
    const t = await live();
    return { treeVersion: t.treeVersion, files: t.files };
  }
  let tv = spec;
  if (spec === 'deployed') {
    if (!record.lastDeployed?.treeVersion) throw new Error('no pinned deploy yet — "deployed" is known once a deploy has landed from a snapshot');
    tv = record.lastDeployed.treeVersion;
  }
  if (!isTreeVersion(tv)) throw new Error(`diff side "${spec}" must be current, deployed, or tree:<64 hex>`);
  const snap = await store.loadSnapshot(tv);
  if (snap) return { treeVersion: tv, files: snap.files };
  const t = await live();
  if (t.treeVersion === tv) return { treeVersion: tv, files: t.files };
  throw new Error(`no snapshot of ${tv} (and it is not the current tree) — snapshot trees you will want to diff against`);
}

async function diffSource(input: DiffInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const view = input?.view ?? 'files';
  if (!['summary', 'files', 'patch'].includes(view)) throw new Error("view must be 'summary', 'files' or 'patch'");
  const contextLines = Math.max(0, Math.min(10, Math.floor(input.contextLines ?? 3)));
  const { record, bucket } = await resolveAuthorized(input, user);
  const store = new TreeStore(bucket, record.cellId);
  let cached: Promise<Tree> | undefined;
  const live = (): Promise<Tree> => (cached ??= store.tree());
  const fromSpec = input.from ?? 'deployed';
  const toSpec = input.to ?? 'current';
  const [a, b] = [await diffSide(fromSpec, store, record, live), await diffSide(toSpec, store, record, live)];
  await store.flush();
  const matches = pathMatcher(input.prefix?.replace(/^\/+/, ''), input.glob);
  const d = compareManifests(a.files.filter((f) => matches(f.path)), b.files.filter((f) => matches(f.path)));
  const head = {
    cellId: record.cellId,
    from: { spec: fromSpec, treeVersion: a.treeVersion },
    to: { spec: toSpec, treeVersion: b.treeVersion },
    identical: a.treeVersion === b.treeVersion,
    counts: { added: d.added.length, modified: d.modified.length, deleted: d.deleted.length, unchanged: d.unchanged },
  };
  const changes: Array<{ path: string; status: 'A' | 'M' | 'D'; from?: ManifestFile; to?: ManifestFile }> = [
    ...d.added.map((f) => ({ path: f.path, status: 'A' as const, to: f })),
    ...d.modified.map((m) => ({ path: m.to.path, status: 'M' as const, from: m.from, to: m.to })),
    ...d.deleted.map((f) => ({ path: f.path, status: 'D' as const, from: f })),
  ].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));

  // Line stats need the bytes of both sides; bounded so a sweeping diff stays cheap.
  const LINE_STATS_MAX = 100;
  const withLines = changes.length <= LINE_STATS_MAX;
  const texts = new Map<string, { before: string; after: string }>();
  if (withLines || view === 'patch') {
    await mapLimit(changes, 8, async (c) => {
      const binary = (c.from && !isTextType(c.from.contentType)) || (c.to && !isTextType(c.to.contentType));
      if (binary) return;
      const before = c.from ? (await store.readVersion(c.path, c.from.version)).toString('utf-8') : '';
      const after = c.to ? (await store.readVersion(c.path, c.to.version)).toString('utf-8') : '';
      texts.set(c.path, { before, after });
    });
  }
  let added = 0;
  let removed = 0;
  const files: Array<Record<string, unknown>> = [];
  const parts: string[] = [];
  const omitted: string[] = [];
  let used = 0;
  for (const c of changes) {
    const t = texts.get(c.path);
    const entry: Record<string, unknown> = {
      path: c.path,
      status: c.status,
      ...(c.from ? { oldVersion: c.from.version } : {}),
      ...(c.to ? { version: c.to.version } : {}),
    };
    let hunks: string | null = null;
    if (t) {
      const dt = diffText(t.before, t.after, contextLines);
      entry.added = dt.stats.added;
      entry.removed = dt.stats.removed;
      added += dt.stats.added;
      removed += dt.stats.removed;
      hunks = dt.hunks;
    } else if ((c.from && !isTextType(c.from.contentType)) || (c.to && !isTextType(c.to.contentType))) {
      entry.binary = true;
    }
    files.push(entry);
    if (view === 'patch') {
      const body = entry.binary ? 'Binary file differs' : hunks ?? '(too many changes to show hunks — read the file)';
      const chunk = `--- ${c.status === 'A' ? '/dev/null' : `a/${c.path}`}\n+++ ${c.status === 'D' ? '/dev/null' : `b/${c.path}`}\n${body}\n`;
      const cost = Buffer.byteLength(chunk);
      if (used + cost > RANGE_MAX_BYTES && parts.length > 0) omitted.push(c.path);
      else { parts.push(chunk); used += cost; }
    }
  }
  const lines = withLines || view === 'patch' ? { added, removed } : undefined;
  if (view === 'summary') return { ...head, ...(lines ? { lines } : { linesSkipped: true }) };
  if (view === 'files') return { ...head, ...(lines ? { lines } : { linesSkipped: true }), files };
  return {
    ...head,
    lines,
    files,
    patch: parts.join(''),
    truncated: omitted.length > 0,
    ...(omitted.length ? { omitted, hint: 'narrow with prefix/glob to see the omitted files' } : {}),
  };
}

interface ReadFilesInput extends CellRef {
  files: Array<{ path: string; startLine?: number; endLine?: number }>;
  /** Total response budget in bytes (max and default ~48KB). */
  maxBytes?: number;
}

const READ_FILES_MAX = 50;

/**
 * Batch read: assemble context from several files (or line ranges) in one
 * call, under ONE shared byte budget. Files are filled in the order given;
 * a file cut by the budget reports `nextStartLine`, and files past it come
 * back as `omitted` with their metadata, so the caller knows exactly what to
 * ask for next.
 */
async function readFiles(input: ReadFilesInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!Array.isArray(input?.files) || input.files.length === 0) throw new Error('files (non-empty array) is required');
  if (input.files.length > READ_FILES_MAX) throw new Error(`at most ${READ_FILES_MAX} files per call`);
  const budget = Math.max(1024, Math.min(RANGE_MAX_BYTES, Math.floor(input.maxBytes ?? RANGE_MAX_BYTES)));
  const { record, bucket } = await resolveAuthorized(input, user);
  const reqs = input.files.map((f) => {
    if (!f || typeof f.path !== 'string') throw new Error('each entry needs a path');
    return { ...f, path: cleanPath(f.path) };
  });
  const objs = await mapLimit(reqs, 16, (f) => readSource(bucket, record.cellId, f.path));
  let remaining = budget;
  const out: Array<Record<string, unknown>> = [];
  reqs.forEach((f, i) => {
    const obj = objs[i];
    if (!obj) { out.push({ path: f.path, error: 'not found' }); return; }
    const text = obj.binary ? undefined : obj.body.toString('utf-8');
    const meta = fileMeta(f.path, obj, text);
    if (text === undefined) {
      const b64 = obj.body.toString('base64');
      if (b64.length > remaining) { out.push({ ...meta, omitted: true }); return; }
      out.push({ ...meta, content: b64, encoding: 'base64' });
      remaining -= b64.length;
      return;
    }
    const startLine = f.startLine ?? 1;
    // Not even room for a first line: leave it for the next call.
    const firstLineCost = Buffer.byteLength(text.split('\n', startLine)[startLine - 1] ?? '') + 1;
    if (remaining < Math.min(firstLineCost, 256)) { out.push({ ...meta, omitted: true, nextStartLine: startLine }); return; }
    try {
      const slice = sliceLines(text, startLine, f.endLine, remaining);
      remaining -= Buffer.byteLength(slice.content);
      out.push({
        ...meta,
        content: slice.content,
        encoding: 'utf8',
        range: { startLine: slice.startLine, endLine: slice.endLine, totalLines: slice.totalLines },
        truncated: slice.truncated,
        ...(slice.nextStartLine ? { nextStartLine: slice.nextStartLine } : {}),
      });
    } catch (err) {
      out.push({ path: f.path, error: (err as Error).message });
    }
  });
  return { cellId: record.cellId, files: out, budget, used: budget - Math.max(0, remaining) };
}

/** Bundle the cell's src/ tree and point its Lambda at the new code (deploy-on-update). */
/** Client entry conventions, in priority order (the tier-2 `clientEntry`). */
const CLIENT_ENTRIES = ['client/main.tsx', 'client/main.ts', 'client/index.tsx', 'client/index.ts'];

/** Which source a deploy builds and what it is called: a pinned snapshot, or (legacy events) live src/. */
interface DeployPin {
  treeVersion?: string;
  version?: string;
  /** ADR-0099: who asked and why — rides onto `cell.deployed`. */
  note?: DeployNote;
  /** ADR-0099: the tree live before this deploy, for the file-level change summary. */
  previousTreeVersion?: string;
}

/** A deploy's file-level change against the previously deployed tree (ADR-0099). */
export interface DeployChanges {
  added: string[];
  modified: string[];
  removed: string[];
  counts: { added: number; modified: number; removed: number };
  /** True when a list was clipped at DEPLOY_CHANGES_LIST_MAX. */
  truncated?: boolean;
}
const DEPLOY_CHANGES_LIST_MAX = 50;

/** Pure: diff two {path→content version} listings into a DeployChanges. */
export function deployChangesOf(
  before: Array<{ path: string; version: string }>,
  after: Array<{ path: string; version: string }>,
): DeployChanges {
  const a = new Map(before.map((f) => [f.path, f.version]));
  const b = new Map(after.map((f) => [f.path, f.version]));
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const [p, v] of b) {
    if (!a.has(p)) added.push(p);
    else if (a.get(p) !== v) modified.push(p);
  }
  for (const p of a.keys()) if (!b.has(p)) removed.push(p);
  const cap = (xs: string[]) => xs.sort().slice(0, DEPLOY_CHANGES_LIST_MAX);
  const truncated = [added, modified, removed].some((xs) => xs.length > DEPLOY_CHANGES_LIST_MAX);
  return {
    added: cap([...added]),
    modified: cap([...modified]),
    removed: cap([...removed]),
    counts: { added: added.length, modified: modified.length, removed: removed.length },
    ...(truncated ? { truncated: true } : {}),
  };
}

/**
 * The deploy's source, as text files + byte blobs. A pinned deploy reads its
 * immutable snapshot (manifest + blobs/), so the bundle is exactly the tree
 * the deploy was requested for; only an unpinned (pre-snapshot) event falls
 * back to reading live src/.
 */
async function loadDeploySource(
  record: CellRecord,
  env: ForgeEnv,
  treeVersion: string | undefined,
): Promise<{ files: Record<string, string>; blobs: Record<string, Buffer> }> {
  const files: Record<string, string> = {};
  /** Bytes, kept out of `files` so nothing can hand them to a bundler. */
  const blobs: Record<string, Buffer> = {};
  // THE CONTENT TYPE DECIDES, not the extension and not the caller. Anything
  // written as bytes (writeFile with encoding:'base64') comes back as bytes
  // and never touches a UTF-8 decode; everything else is source and is text.
  // `files` stays `Record<string, string>` deliberately — the bundler, the
  // types.json parse and the ssr.json parse all take strings, and widening
  // that type is how a Buffer would end up concatenated into a bundle.
  const place = (path: string, body: Buffer, contentType: string): void => {
    if (isTextType(contentType)) files[path] = body.toString('utf-8');
    else blobs[path] = body;
  };
  if (treeVersion) {
    const store = new TreeStore(env.codeBucket, record.cellId);
    const snap = await store.loadSnapshot(treeVersion);
    if (!snap) throw new Error(`snapshot ${treeVersion} not found — cells.snapshot first`);
    await mapLimit(snap.files, 16, async (f) => {
      const body = await store.readBlob(f.version);
      if (!body) throw new Error(`snapshot ${treeVersion} is missing the blob for ${f.path} (${f.version})`);
      place(f.path, body, f.contentType);
    });
    return { files, blobs };
  }
  const prefix = srcPrefix(record.cellId);
  const keys = await listObjects(env.codeBucket, prefix);
  for (const k of keys) {
    const rel = k.slice(prefix.length);
    if (!rel) continue;
    const raw = await getObjectRaw(env.codeBucket, k);
    if (raw === null) continue;
    place(rel, raw.body, raw.contentType);
  }
  return { files, blobs };
}

/** Thrown when a newer deploy was requested while this one was bundling — it must not land. */
class DeploySupersededError extends Error {}

async function deployCell(record: CellRecord, env: ForgeEnv, ctx: ServiceContext, pin: DeployPin = {}): Promise<unknown> {
  const { files, blobs } = await loadDeploySource(record, env, pin.treeVersion);
  if (Object.keys(files).length === 0) throw new Error('no source files to deploy (write to src/ first)');
  const entry = files['index.ts'] !== undefined ? 'index.ts' : files['index.js'] !== undefined ? 'index.js' : Object.keys(files)[0];

  // One import map (`client/imports.json`) declares the cell's npm deps for BOTH
  // bundlers: the server inlines them from esm.sh (node target), the client fetches
  // them from esm.sh in the browser — same pins, so an isomorphic cell stays on the
  // byte-identical dependency on both sides.
  let imports: Record<string, string> | undefined;
  if (files['client/imports.json'] !== undefined) {
    try {
      imports = JSON.parse(files['client/imports.json']) as Record<string, string>;
    } catch {
      throw new Error('client/imports.json is not valid JSON');
    }
  }

  let js: string;
  try {
    js = await bundleFiles(files, entry, imports);
  } catch (err) {
    throw new Error(`Cell source failed to bundle: ${(err as Error).message}`);
  }
  const pkg: Array<{ name: string; content: string | Buffer }> = [{ name: 'index.js', content: js }];

  // The tier-2 mirror of home's `clientEntry`: a `client/` entry in the src
  // tree browser-bundles to `app.js` (declared deps become esm.sh externals);
  // `static/` files ship verbatim. The handler serves both from its package
  // (fs.readFileSync — they sit beside index.js in /var/task).
  const clientEntry = CLIENT_ENTRIES.find((c) => files[c] !== undefined);
  if (clientEntry) {
    try {
      pkg.push({ name: 'app.js', content: await bundleClientFiles(files, clientEntry, imports) });
    } catch (err) {
      throw new Error(`Cell client failed to bundle: ${(err as Error).message}`);
    }
  }
  // `static/` ships verbatim — text as text, bytes as bytes. The blob half is
  // what makes an icon, a font or a sound possible at all: it goes into the
  // package as a Buffer and `zipStore` writes it without a decode, so what the
  // cell's handler reads off /var/task is byte-for-byte what was written.
  const staticText = Object.keys(files).filter((f) => f.startsWith('static/'));
  const staticBlobs = Object.keys(blobs).filter((f) => f.startsWith('static/'));
  for (const f of staticText) pkg.push({ name: f, content: files[f] });
  for (const f of staticBlobs) pkg.push({ name: f, content: blobs[f] });
  const staticFiles = [...staticText, ...staticBlobs];

  // Vocabulary as data (docs/type-vocabulary.md): a cell declares the fact
  // types it manages in a `types.json` at its src root. They are stored on the
  // cell's *registry* record — one global table — so the type vocabulary is
  // canonical and readable by every user (and the anonymous landing), not
  // siloed in the owner's slice. `cells.describeTypes` aggregates them.
  let declaredTypes: Array<Record<string, unknown>> | undefined;
  if (files['types.json'] !== undefined) {
    try {
      const parsed = JSON.parse(files['types.json']) as { types?: Array<Record<string, unknown>> };
      if (Array.isArray(parsed.types) && parsed.types.length) declaredTypes = parsed.types;
    } catch (err) {
      ctx.logger.warn('cell types.json invalid — skipped', { cellId: record.cellId, error: (err as Error).message });
    }
  }

  // SSR reads (docs/dynamic-cells.md): a cell declares substrate reads forge runs
  // as the authenticated caller and injects into the invocation, so the cell can
  // server-render real content without a token. Stored on the registry like types.
  let ssrReads: CellRecord['ssrReads'];
  // Phase 4: declared caller-writes (write twin of ssrReads). dispatch applies
  // these AS THE CALLER, bounded to scope(caller, write) ∩ declared prefixes.
  let callerWrites: CellRecord['callerWrites'];
  if (files['ssr.json'] !== undefined) {
    try {
      const parsed = JSON.parse(files['ssr.json']) as {
        reads?: CellRecord['ssrReads'];
        writes?: Array<{ keyPrefix?: unknown; types?: unknown; crossSlice?: unknown }>;
      };
      if (Array.isArray(parsed.reads) && parsed.reads.length) ssrReads = parsed.reads;
      if (Array.isArray(parsed.writes) && parsed.writes.length) {
        const cleaned = parsed.writes
          .filter((w): w is { keyPrefix: string; types?: string[]; crossSlice?: boolean } => !!w && typeof w.keyPrefix === 'string' && w.keyPrefix.length > 0)
          .map((w) => ({
            keyPrefix: w.keyPrefix,
            ...(Array.isArray(w.types) && w.types.every((t) => typeof t === 'string') ? { types: w.types } : {}),
            ...(w.crossSlice === true ? { crossSlice: true } : {}),
          }));
        if (cleaned.length) callerWrites = cleaned;
      }
    } catch (err) {
      ctx.logger.warn('cell ssr.json invalid — skipped', { cellId: record.cellId, error: (err as Error).message });
    }
  }

  // The build is named by the request that asked for it, so a request, its
  // package and its registry state share one version.
  const version = pin.version ?? `${Date.now()}`;
  const codeKey = buildKey(record.cellId, version);
  await uploadPackage({ bucket: env.codeBucket, key: codeKey, files: pkg });
  // LAST CHECK BEFORE GOING LIVE: deploys are not serialized, so an older
  // bundle that finishes after a newer one was requested must not repoint the
  // Lambda backwards. The window left is between this read and the update.
  if (pin.version) {
    const latest = (await createRegistry(env.registryTable).get(record.cellId))?.deploy;
    if (latest && latest.version !== pin.version && Number(latest.version) > Number(pin.version)) {
      throw new DeploySupersededError(`deploy ${pin.version} superseded by ${latest.version}`);
    }
  }
  await updateFunctionCode(record.functionName, env.codeBucket, codeKey);
  await createRegistry(env.registryTable).put({
    ...record,
    ...(declaredTypes ? { types: declaredTypes } : {}),
    // Persist (or clear) the declared SSR reads + caller-writes each deploy.
    ssrReads: ssrReads ?? undefined,
    callerWrites: callerWrites ?? undefined,
    updatedAt: new Date().toISOString(),
  });

  ctx.logger.info('cell deployed', {
    cellId: record.cellId,
    version,
    files: Object.keys(files).length,
    client: clientEntry ?? null,
    static: staticFiles.length,
    types: declaredTypes?.length ?? 0,
  });
  // ADR-0099: the file-level change against the tree that was live before —
  // best-effort (a legacy unpinned deploy has no prior snapshot to diff).
  let changes: DeployChanges | undefined;
  if (pin.treeVersion && pin.previousTreeVersion && pin.previousTreeVersion !== pin.treeVersion) {
    try {
      const store = new TreeStore(env.codeBucket, record.cellId);
      const [prev, next] = await Promise.all([store.loadSnapshot(pin.previousTreeVersion), store.loadSnapshot(pin.treeVersion)]);
      if (prev && next) changes = deployChangesOf(prev.files, next.files);
    } catch (err) {
      ctx.logger.warn('deploy change summary failed (deploy unaffected)', { cellId: record.cellId, error: (err as Error).message });
    }
  } else if (pin.treeVersion && pin.previousTreeVersion === pin.treeVersion) {
    changes = deployChangesOf([], []);
  }
  await ctx.events.emit('cell.deployed', {
    cellId: record.cellId,
    owner: record.owner,
    name: record.name,
    address: cellAddress(record.owner, record.name),
    public: record.public,
    version,
    ...(pin.treeVersion ? { treeVersion: pin.treeVersion } : {}),
    ...(pin.previousTreeVersion ? { previousTreeVersion: pin.previousTreeVersion } : {}),
    ...(pin.note ? { note: pin.note } : {}),
    ...(changes ? { changes } : {}),
    deployedAt: new Date().toISOString(),
    files: Object.keys(files),
    clientEntry: clientEntry ?? null,
    staticFiles,
  });
  return {
    deployed: true,
    cellId: record.cellId,
    version,
    ...(pin.treeVersion ? { treeVersion: pin.treeVersion } : {}),
    entry,
    clientEntry: clientEntry ?? null,
    staticFiles,
    files: Object.keys(files),
  };
}

/**
 * Kick off an **asynchronous** deploy. Bundling a cell (esm.sh dep fetches + two
 * esbuild passes + package upload + `updateFunctionCode`) can outlast the
 * synchronous request path — forge's Lambda has 60s+, but the `/mcp` gateway and
 * CloudFront in front of it time out sooner, returning a misleading 502 while the
 * work actually completes. So `deploy` records `DEPLOYING`, emits
 * `cell.deploy.requested` (routed back to forge as a fresh event-driven
 * invocation — see `onDeployRequested`), and returns immediately. Callers poll
 * `get` until `deploy.phase` is `DEPLOYED` or `FAILED`. (Mirrors `createCell`,
 * whose long work — CloudFormation — is likewise async.)
 */
interface DeployStarted {
  deploying: true;
  cellId: string;
  version: string;
  treeVersion: string;
  deploy: DeployState;
  message: string;
}

/** Kick off the async deploy: record DEPLOYING, emit `cell.deploy.requested`
 *  (routed back to `onDeployRequested`), and return the marker. Shared by the
 *  `deploy` command and the write/edit `deploy:true` flags so every deploy path
 *  is off the synchronous request/edge timeout. */
async function requestDeploy(
  record: CellRecord,
  env: ForgeEnv,
  ctx: ServiceContext,
  treeVersion?: string,
  note: { description?: string; source?: string } = {},
): Promise<DeployStarted> {
  // PIN THE SOURCE NOW. The worker runs later, off the request path; if it read
  // src/ then, it would build whatever had been written in between — not the
  // tree this request was for. A snapshot freezes it (cheap after the first:
  // only files that changed since the last snapshot are copied).
  const store = new TreeStore(env.codeBucket, record.cellId);
  let pinned: string;
  if (treeVersion !== undefined) {
    if (!isTreeVersion(treeVersion)) throw new Error('treeVersion must be tree:<64 hex> (from cells.status, cells.snapshot or applyPatchSet)');
    if (!(await store.loadSnapshot(treeVersion))) {
      const snap = await store.snapshot();
      if (snap.treeVersion !== treeVersion) {
        throw new TreeConflictError(treeVersion, snap.treeVersion);
      }
    }
    pinned = treeVersion;
  } else {
    pinned = (await store.snapshot({ createdBy: 'deploy' })).treeVersion;
  }
  const version = `${Date.now()}`;
  // ADR-0099: who asked, and (optionally) why — carried to the worker so the
  // landed `cell.deployed` event can become a durable deploy fact. Bus events
  // carry no caller identity, so it is captured here, on the authorized path.
  const deployNote = deployNoteOf(ctx, note);
  const deployState: DeployState = { phase: 'DEPLOYING', version, requestedAt: new Date().toISOString(), treeVersion: pinned, ...(deployNote ? { note: deployNote } : {}) };
  await createRegistry(env.registryTable).setDeploy(record.cellId, deployState);
  await ctx.events.emit('cell.deploy.requested', {
    cellId: record.cellId,
    owner: record.owner,
    name: record.name,
    version,
    treeVersion: pinned,
    ...(deployNote ? { note: deployNote } : {}),
  });
  ctx.logger.info('cell deploy requested', { cellId: record.cellId, version, treeVersion: pinned });
  return {
    deploying: true,
    cellId: record.cellId,
    version,
    treeVersion: pinned,
    deploy: deployState,
    message: 'Bundling in the background. Poll `get` until `deploy.phase` is DEPLOYED (or FAILED).',
  };
}

interface DeployInput extends CellRef {
  /** Deploy exactly this snapshot (default: snapshot the current tree now). */
  treeVersion?: string;
  /** ADR-0099: why this deploy — a commit-message-grade line (optional). */
  description?: string;
  /** ADR-0099: where the source came from — e.g. `git:<repo>@<sha>` or a tarball URL (optional). */
  source?: string;
}

const DEPLOY_DESCRIPTION_MAX = 1000;
const DEPLOY_SOURCE_MAX = 500;

/**
 * The deploy's provenance (ADR-0099): the authorized caller — principal, the
 * delegated leaf actor (ADR-0024) and the self-declared participant (ADR-0086)
 * — plus the caller's optional description and source. Provenance only: none
 * of it gates anything. Over-long text is clipped, not refused — a deploy never
 * fails for its note.
 */
export function deployNoteOf(
  ctx: Pick<ServiceContext, 'identity'>,
  note: { description?: string; source?: string } = {},
): DeployNote | undefined {
  const clip = (v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const t = v.trim();
    return t ? (t.length > max ? `${t.slice(0, max - 1)}…` : t) : undefined;
  };
  const by = ctx.identity?.user;
  const actor = leafActOf(ctx.identity) ?? undefined;
  const participant = clip(ctx.identity?.participant, 120);
  const description = clip(note.description, DEPLOY_DESCRIPTION_MAX);
  const source = clip(note.source, DEPLOY_SOURCE_MAX);
  const out: DeployNote = {
    ...(by ? { by } : {}),
    ...(actor && actor !== by ? { actor } : {}),
    ...(participant ? { participant } : {}),
    ...(description ? { description } : {}),
    ...(source ? { source } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

async function deploy(input: DeployInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const { record, env } = await resolveAuthorized(input, user);
  return requestDeploy(record, env, ctx, input?.treeVersion, { description: input?.description, source: input?.source });
}

/**
 * Event-driven worker for `cell.deploy.requested` (routed back to forge). Runs the
 * heavy bundle off the request path, then records the terminal deploy phase so a
 * poller sees DEPLOYED/FAILED. Bus events carry no caller identity — trust comes
 * from the IAM-attested `source` (pinned to `cells` by the route), and the deploy
 * was already authorized by the `deploy` command that emitted it.
 */
async function onDeployRequested(detail: Record<string, unknown>, ctx: ServiceContext): Promise<void> {
  const cellId = String(detail.cellId ?? '');
  if (!cellId) {
    ctx.logger.warn('cell.deploy.requested without cellId');
    return;
  }
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const record = await registry.get(cellId);
  if (!record) {
    ctx.logger.warn('cell.deploy.requested for unknown cell', { cellId });
    return;
  }
  const eventVersion = typeof detail.version === 'string' ? detail.version : undefined;
  const current = record.deploy;
  if (eventVersion && current && current.version === eventVersion && current.phase !== 'DEPLOYING') {
    // EventBridge is at-least-once: this request already finished.
    ctx.logger.info('cell.deploy.requested redelivered after it finished — skipped', { cellId, version: eventVersion });
    return;
  }
  if (eventVersion && current && current.version !== eventVersion && Number(current.version) > Number(eventVersion)) {
    ctx.logger.info('cell.deploy.requested superseded by a newer request — skipped', { cellId, version: eventVersion, latest: current.version });
    return;
  }
  const requestedAt = current?.requestedAt ?? new Date().toISOString();
  const version = eventVersion ?? current?.version ?? `${Date.now()}`;
  // The event carries the pin; the registry marker is the fallback for events
  // emitted before treeVersion rode on them.
  const treeVersion =
    typeof detail.treeVersion === 'string'
      ? detail.treeVersion
      : !eventVersion || current?.version === eventVersion
        ? current?.treeVersion
        : undefined;
  const note =
    detail.note && typeof detail.note === 'object'
      ? (detail.note as DeployNote)
      : !eventVersion || current?.version === eventVersion
        ? current?.note
        : undefined;
  try {
    const result = (await deployCell(record, env, ctx, {
      treeVersion,
      version: eventVersion ?? current?.version,
      note,
      previousTreeVersion: record.lastDeployed?.treeVersion,
    })) as { version: string };
    const deployedAt = new Date().toISOString();
    await registry.setDeploy(cellId, { phase: 'DEPLOYED', version: result.version, requestedAt, ...(treeVersion ? { treeVersion } : {}) });
    await registry.setLastDeployed(cellId, { version: result.version, ...(treeVersion ? { treeVersion } : {}), deployedAt });
  } catch (err) {
    if (err instanceof DeploySupersededError) {
      ctx.logger.info('cell deploy superseded before going live — not applied', { cellId, version, error: err.message });
      return;
    }
    ctx.logger.error('cell deploy failed', { cellId, error: (err as Error).message });
    await registry.setDeploy(cellId, { phase: 'FAILED', version, requestedAt, error: (err as Error).message, ...(treeVersion ? { treeVersion } : {}) });
  }
}

interface PutDataInput extends CellRef {
  key: string;
  /** Inline content — or omit and pass `url` for a server-side fetch. */
  content?: string;
  /** Interpret `content` as base64 bytes — images and other binary blobs. */
  encoding?: 'utf8' | 'base64';
  contentType?: string;
  /** https URL to fetch server-side (large blobs would fail the edge's
   *  request-signing; the platform's own egress has no such cap). */
  url?: string;
  /** Return a presigned PUT url instead of writing — the browser uploads
   *  the bytes straight to S3 (no edge body cap, no inline base64). */
  presign?: boolean;
}
async function putData(input: PutDataInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.key) throw new Error('key is required');
  if (input.presign) {
    const { record, bucket } = await resolveAuthorized(input, user);
    const key = cleanPath(input.key);
    const contentType = input.contentType ?? 'application/octet-stream';
    const uploadUrl = presignPut(bucket, dataKey(record.cellId, user, input.key), contentType, 300);
    const url =
      record.public && key.startsWith('public/')
        ? `/@${record.owner}/${record.name}/_data/${user}/${key}`
        : null;
    return { ok: true, cellId: record.cellId, user, key, uploadUrl, contentType, url };
  }
  let body: string | Buffer;
  let fetchedType: string | undefined;
  if (typeof input.url === 'string') {
    if (!/^https:\/\//.test(input.url)) throw new Error('url must be https');
    const fetchFn = (globalThis as { fetch?: typeof fetch }).fetch;
    if (!fetchFn) throw new Error('fetch unavailable in this runtime');
    const res = await fetchFn(input.url);
    if (!res.ok) throw new Error(`url fetch failed: HTTP ${res.status}`);
    body = Buffer.from(await res.arrayBuffer());
    fetchedType = res.headers.get('content-type') ?? undefined;
  } else if (typeof input.content === 'string') {
    body = input.encoding === 'base64' ? Buffer.from(input.content, 'base64') : input.content;
  } else {
    throw new Error('either content (string) or url (https) is required');
  }
  const { record, bucket } = await resolveAuthorized(input, user);
  if (body.length > 8 * 1024 * 1024) throw new Error('blob too large (>8MB)');
  const key = cleanPath(input.key);
  const resolvedType = input.contentType ?? fetchedType ?? 'application/octet-stream';
  await putObject(bucket, dataKey(record.cellId, user, input.key), body, resolvedType);
  // ADR-0030 (blob text extraction): for a SMALL TEXT blob, carry a bounded UTF-8
  // preview on the event so the workspace can inline searchable `content` on the
  // `file` fact (ADR-0027 §1 — small text inlines; binary/large stay pointers, and a
  // Textract lane is the follow-up for true binary). The producer already holds the
  // bytes, so this needs no S3 read-back or new IAM downstream.
  let content: string | undefined;
  if (isTextLikeContentType(resolvedType) && body.length <= BLOB_INLINE_MAX_BYTES) {
    const text = (typeof body === 'string' ? body : body.toString('utf8')).trim();
    if (text) content = text.slice(0, 8000);
  }
  // Blobs under public/ in a public cell are web-served (see the `_data`
  // intercept in callCell) — hand back the address so a client can embed it.
  const url =
    record.public && key.startsWith('public/')
      ? `/@${record.owner}/${record.name}/_data/${user}/${key}`
      : null;
  // ADR-0027 Inc 2: mirror the blob into a `file` fact (the workspace projects it
  // into the uploading user's slice). Synchronous-write path only — presigned
  // direct-to-S3 uploads bypass this (documented follow-up: an S3→EventBridge rule).
  await ctx.events.emit('cell.data.changed', {
    cellId: record.cellId,
    owner: record.owner,
    name: record.name,
    user,
    key,
    bytes: body.length,
    contentType: resolvedType,
    ...(content ? { content } : {}),
    ...(url ? { url } : {}),
  });
  return { ok: true, cellId: record.cellId, user, key, bytes: body.length, url };
}

interface DataRefInput extends CellRef {
  key?: string;
  user?: string;
}
/** Blob owner: your own space by default; another user's only if you own the cell. */
function targetDataUser(input: DataRefInput, caller: string, record: CellRecord): string {
  const target = input.user ?? caller;
  if (target !== caller && record.owner !== caller) {
    throw new ServiceAuthError(`only the cell owner may access another user's data`);
  }
  return target;
}

async function getData(input: DataRefInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.key) throw new Error('key is required');
  const { record, bucket } = await resolveAuthorized(input, user);
  const target = targetDataUser(input, user, record);
  const content = await getObject(bucket, dataKey(record.cellId, target, input.key));
  if (content === null) throw new Error(`data not found: ${cleanPath(input.key)}`);
  return { cellId: record.cellId, user: target, key: cleanPath(input.key), content };
}

async function listData(input: DataRefInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const { record, bucket } = await resolveAuthorized(input, user);
  const target = targetDataUser(input, user, record);
  const prefix = dataPrefix(record.cellId, target);
  const keys = await listObjects(bucket, prefix);
  return { cellId: record.cellId, user: target, keys: keys.map((k) => k.slice(prefix.length)).filter(Boolean) };
}

async function deleteData(input: DataRefInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.key) throw new Error('key is required');
  const { record, bucket } = await resolveAuthorized(input, user);
  const target = targetDataUser(input, user, record);
  const key = cleanPath(input.key);
  await deleteObject(bucket, dataKey(record.cellId, target, input.key));
  // Retire the mirrored `file` fact (ADR-0027 Inc 2): the workspace supersedes it
  // on a delete-op `cell.data.changed`.
  await ctx.events.emit('cell.data.changed', { cellId: record.cellId, owner: record.owner, name: record.name, user: target, key, op: 'delete' });
  return { ok: true, cellId: record.cellId, user: target, key, deleted: true };
}

// ─── registry-driven cell tools ──────────────────────────────────
//
// Beyond forge's own control-plane tools, the /mcp gateway also surfaces the
// tools that the caller's *dynamic cells* advertise — so a cell created at
// runtime can contribute tools to /mcp with no gateway change and no deploy.
//
// The convention is deliberately tiny so any cell author can opt in:
//   • GET  /_tools           → { tools: [{ name, description, inputSchema, scope? }] }
//   • POST /_tools/<name>     → (body = arguments) → the tool's result
// A cell that doesn't answer /_tools simply contributes nothing.

const TOOLS_PATH = '/_tools';
/** Cap how many cells we probe per discovery, to bound tools/list cost. */
const MAX_TOOL_CELLS = 25;
const SAFE_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

interface CellToolDescriptor {
  /** Gateway-facing name, namespaced by cellId so it never collides. */
  name: string;
  /** Dotted target the gateway advertises: `@<owner>/<slug>.<tool>`. */
  address: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string | null;
  /** `read` = side-effect-free; `act` = may mutate. From the cell's manifest (default act). */
  kind: 'read' | 'act';
  cellId: string;
  /** The cell's own (un-namespaced) tool name, used to route the call. */
  tool: string;
  /**
   * Third-party-cell disclosure (docs/capability-consent.md). Present only when
   * the caller is NOT the cell owner: invoking runs the author's code, which can
   * observe the reads the cell declares (`ssr.json`) and persist results into the
   * AUTHOR's slice (the organ-write path). The honest "may share data with its
   * developer" surface, shown at discovery/first-invoke for humans and agents.
   */
  disclosure?: { author: string; reads: string[]; writes?: string[]; note: string };
  /** ADR-0039 Inc 2 / ADR-0041 Inc 3: a cell-authored conversational renderer
   *  (`renderer`/`as` — output) and/or a bespoke argument form (`form` — input)
   *  for this TOOL, the per-tool analogue of a type's `handlers.render`/`create`.
   *  The gateway stamps `renderer` onto the result as `_render` (the card runs
   *  it); `form` is surfaced directly on the catalog capability (a human must
   *  see it BEFORE invoking, to fill the form). `as`/`form` name the
   *  `window.__parcRender`/`__parcForm` keys the served scripts register under. */
  ui?: { renderer?: string; as?: string; form?: string };
}

/** Selector: omit to enumerate all accessible cells (catalog); give one to resolve a single target. */
interface DescribeCellToolsInput {
  cellId?: string;
  owner?: string;
  name?: string;
}

/**
 * Ask cells what tools they advertise. Registry-driven and best-effort: with no
 * selector it enumerates the caller's own/granted ACTIVE cells (`listAccessibleBy`)
 * for the gateway's `read("$catalog")`; with a selector it resolves a single cell
 * (cheap path for a concrete `read`/`act` target). A cell that errors or advertises
 * nothing is skipped. The gateway forwards calls via `callCellTool`.
 */
async function describeCellTools(input: DescribeCellToolsInput | undefined, ctx: ServiceContext): Promise<{ tools: CellToolDescriptor[] }> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);

  let cells: CellRecord[];
  if (input?.cellId || (input?.owner && input?.name)) {
    const rec = await registry.get(resolveCellId(input));
    const accessible =
      rec && (rec.owner === user || rec.grants.includes(user) || !!rec.toolGrants?.[user]);
    cells = rec && accessible && rec.status === 'ACTIVE' ? [rec] : [];
  } else {
    cells = (await registry.listAccessibleBy(user)).filter((c) => c.status === 'ACTIVE').slice(0, MAX_TOOL_CELLS);
  }

  const out: CellToolDescriptor[] = [];
  await Promise.all(
    cells.map(async (cell) => {
      const address = cellAddress(cell.owner, cell.name).slice(1); // `@<owner>/<slug>`
      // Advertise only what this caller may call (per-tool grants filter here).
      const visible = toolVisibility(cell, user);
      // Disclose the third-party-author trust when the caller isn't the owner:
      // the author's code runs, sees the reads it declares, and can persist into
      // the author's own slice (docs/capability-consent.md). Owners see no notice
      // (writing to your own cell's slice is writing to yourself).
      const writePrefixes = Array.from(new Set((cell.callerWrites ?? []).map((w) => w.keyPrefix)));
      const crossSlice = (cell.callerWrites ?? []).some((w) => w.crossSlice);
      const disclosure =
        cell.owner !== user
          ? {
              author: cell.owner,
              reads: Array.from(new Set((cell.ssrReads ?? []).map((r) => r.target))),
              ...(writePrefixes.length ? { writes: writePrefixes } : {}),
              note:
                `Runs @${address}'s code: its author (${cell.owner}) can observe the reads it declares and persist results into ${cell.owner}'s workspace.` +
                (writePrefixes.length
                  ? ` It may also ask to write facts into YOUR slice under: ${writePrefixes.join(', ')} (bounded by your own write access).`
                  : '') +
                (crossSlice
                  ? ' Some of these writes may target other slices you have granted write access to.'
                  : ''),
            }
          : undefined;
      try {
        const res = await invokeCell({
          functionName: cell.functionName,
          event: {
            version: '2.0',
            rawPath: TOOLS_PATH,
            rawQueryString: '',
            headers: { 'content-type': 'application/json', 'x-cell-caller': user },
            requestContext: { http: { method: 'GET', path: TOOLS_PATH } },
            isBase64Encoded: false,
          },
        });
        if (res.statusCode !== 200) return;
        const body = res.body as { tools?: Array<Record<string, unknown>> } | undefined;
        if (!body || !Array.isArray(body.tools)) return;
        for (const t of body.tools) {
          const tool = typeof t.name === 'string' ? t.name : '';
          if (!SAFE_TOOL_NAME.test(tool)) continue;
          if (!visible(tool)) continue;
          out.push({
            name: `${cell.cellId}__${tool}`,
            address,
            description: typeof t.description === 'string' ? t.description : `${cell.name} · ${tool}`,
            inputSchema:
              t.inputSchema && typeof t.inputSchema === 'object'
                ? (t.inputSchema as Record<string, unknown>)
                : { type: 'object', additionalProperties: true },
            scope: typeof t.scope === 'string' ? t.scope : null,
            kind: t.kind === 'read' ? 'read' : 'act',
            cellId: cell.cellId,
            tool,
            ...(disclosure ? { disclosure } : {}),
            ...(t.ui && typeof t.ui === 'object' ? { ui: t.ui as { renderer?: string; as?: string; form?: string } } : {}),
          });
        }
      } catch (err) {
        ctx.logger.warn('cell tool discovery failed', { cellId: cell.cellId, error: (err as Error).message });
      }
    }),
  );
  return { tools: out };
}

/**
 * The canonical type vocabulary (docs/type-vocabulary.md): every ACTIVE cell's
 * declared types, aggregated into `{ <type>: decl }` with the cell's address
 * stamped as `manager`. Global and unauthenticated-friendly — type decls say
 * *how* to open a fact, not *whether* you may. The gateway's `$types` serves
 * this merged under the caller's per-user `_types/` overrides.
 */
/** Pure aggregation half of {@link describeTypes} (exported for tests).
 *
 *  Collision rule (ADR-0093 Inc 4): **first-declarer-wins, visibly.** Cells
 *  aggregate oldest-first (registry `createdAt`, tie: cellId), and a type name
 *  already declared is NOT overridden — the status quo (`out[type] = value`
 *  over a cellId sort) was last-writer-wins, which let any newly deployed cell
 *  silently hijack an established type's handlers (its `open` path, its
 *  renderer) for every viewer: the same threat class as reserved usernames
 *  (ADR-0091 §5). A losing declaration is recorded on the winner as
 *  `conflicts: ["@owner/name", …]` so the collision is observable data, never
 *  silent. Per-user `_types/` overrides (the existing gateway merge) remain
 *  the personal escape hatch for a viewer who prefers the newcomer's handling. */
export function aggregateTypes(
  cells: Array<{ owner: string; name: string; cellId: string; createdAt: string; types?: Array<Record<string, unknown>> }>,
): { types: Record<string, unknown>; conflicts: number } {
  const out: Record<string, unknown> = {};
  let conflicts = 0;
  const ordered = [...cells].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.cellId.localeCompare(b.cellId),
  );
  for (const c of ordered) {
    for (const decl of c.types ?? []) {
      const type = typeof decl.type === 'string' ? decl.type : '';
      if (!type || type.startsWith('_')) continue;
      // The conflict annotation names the actual declaring CELL (registry
      // identity), never the decl's self-declared `manager` — a hijacker must
      // not get to choose how it appears in the audit trail.
      const declaringCell = cellAddress(c.owner, c.name);
      if (out[type]) {
        const winner = out[type] as { conflicts?: string[] };
        if (!winner.conflicts?.includes(declaringCell)) (winner.conflicts ??= []).push(declaringCell);
        conflicts++;
        continue;
      }
      const value: Record<string, unknown> = { ...decl, manager: typeof decl.manager === 'string' ? decl.manager : declaringCell };
      delete value.type;
      out[type] = value;
    }
  }
  return { types: out, conflicts };
}

async function describeTypes(_input: unknown, ctx: ServiceContext): Promise<{ types: Record<string, unknown> }> {
  const env = loadForgeEnv();
  const cells = await createRegistry(env.registryTable).listActive();
  const { types, conflicts } = aggregateTypes(cells);
  ctx.logger.info('type vocabulary aggregated', { cells: cells.length, types: Object.keys(types).length, conflicts });
  if (conflicts) ctx.logger.warn('type vocabulary collisions — first declarer kept, losers annotated in `conflicts`', { conflicts });
  return { types };
}

/**
 * The Cell axis as a self-model surface (ADR-0008) — powers `read("$cells")`. For
 * each cell the caller can reach (owns or was granted), its **contract**: what it
 * *publishes* (the Type Declarations it supplies — the `describeTypes` seam), what
 * it *backs* (the affordance surfaces those types name it for), and the *substrate
 * access* it declares (`ssrReads`/`callerWrites` — bounded, and gated by the Grant
 * axis). `$catalog` lists a cell's capabilities; this names the cell's whole
 * contract in one place. Mirrors `$grants`: the two orthogonal axes, made legible.
 */
async function cellContracts(_input: unknown, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cells = await registry.listAccessibleBy(user);
  return {
    cells: cells
      .sort((a, b) => cellAddress(a.owner, a.name).localeCompare(cellAddress(b.owner, b.name)))
      .map((c) => {
        const declared = c.types ?? [];
        const typeNames = declared
          .map((t) => (typeof t.type === 'string' ? t.type : ''))
          .filter((t) => t && !t.startsWith('_'));
        // the affordance surfaces those types back (open/edit/render/create…)
        const backs = Array.from(
          new Set(
            declared.flatMap((t) =>
              t.handlers && typeof t.handlers === 'object' ? Object.keys(t.handlers as Record<string, unknown>) : [],
            ),
          ),
        ).sort();
        return {
          address: cellAddress(c.owner, c.name),
          name: c.name,
          owner: c.owner,
          status: c.status,
          public: c.public,
          ...(c.owner !== user ? { shared: true } : {}),
          ...(c.description ? { description: c.description } : {}),
          publishes: typeNames, // → $types vocabulary
          backs, // affordance intents these types resolve through this cell
          substrate: {
            ssrReads: (c.ssrReads ?? []).map((r) => r.target),
            callerWrites: (c.callerWrites ?? []).map((w) => ({ keyPrefix: w.keyPrefix, ...(w.crossSlice ? { crossSlice: true } : {}) })),
          },
        };
      }),
    hint:
      'A Cell supplies Declarations (publishes → $types) and backs Affordances (open/edit/render). Its `substrate` access is declared cell-side and gated by the Grant axis ($grants). The infra axis beside the authority axis; $catalog lists capabilities, this names the contract.',
  };
}

/** Scrub bearer tokens / JWTs / labelled secrets from a log line — platform logs
 *  can carry credentials, and `platform.logs` is diagnostic, not an exfil path. */
export function redactLogLine(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._\-]{20,}/g, '[REDACTED-JWT]')
    // labelled secrets — require an assignment separator (`:`/`=`), not a bare space,
    // so prose like "token expired" / "secret sauce" is left intact.
    .replace(/\b(authorization|access_token|refresh_token|token|password|secret|api[_-]?key)(\s*[:=]\s*)["']?[^\s"',}]+/gi, '$1$2[REDACTED]');
}

interface PlatformLogsInput {
  /** A tier-1 platform service: auth/workspace/gateway/dispatch/cells. */
  service?: string;
  since?: string;
  limit?: number;
  filter?: string;
}

/** service → its HttpServiceCell construct id; the CFN log group is
 *  `/aws/lambda/<stack>-<ConstructId>Function…` (resolved by prefix at runtime, so
 *  no per-function CDK reference is needed — avoids a gateway↔cells dependency cycle). */
const PLATFORM_SERVICE_LABELS: Record<string, string> = {
  // (tier-1 `home` retired — the platform face is the tier-2 @c15r/home cell, use cells.logs)
  auth: 'AuthService',
  workspace: 'WorkspaceService',
  gateway: 'GatewayService',
  dispatch: 'DispatchService',
  cells: 'CellsService',
};

/**
 * Internal: tail a TIER-1 platform service's CloudWatch logs — the analogue of
 * `cells.logs` for the services that route/gate everything (the home-demotion
 * incident's blind spot, `kb/platform-observability-gap`). Reached only via the
 * gateway's `platform.logs` target, which enforces `platform:admin` first. The
 * service's Lambda is auto-named, so the log group is discovered by prefix; every
 * line is redacted (platform logs can carry credentials).
 */
async function platformLogs(input: PlatformLogsInput, ctx: ServiceContext): Promise<unknown> {
  requireUser(ctx.identity);
  const known = Object.keys(PLATFORM_SERVICE_LABELS);
  const service = (input?.service ?? '').trim();
  if (!service) return { services: known, hint: 'Pass `service` (one of services[]) + optional since (e.g. 30m), limit (default 200, returns the most-recent tail), filter (a CloudWatch pattern — server-side grep, e.g. "reaction invoke failed" or a correlationId).' };
  const label = PLATFORM_SERVICE_LABELS[service];
  if (!label) throw new Error(`Unknown platform service "${service}". Known: ${known.join(', ')}`);
  const stack = process.env.PLATFORM_STACK_NAME;
  if (!stack) throw new Error('platform.logs unavailable: PLATFORM_STACK_NAME not configured');
  const prefix = `/aws/lambda/${stack}-${label}Function`;
  const logGroupName = await findLogGroup(prefix);
  if (!logGroupName) return { service, count: 0, events: [], note: `no log group matching "${prefix}"` };
  const events = await getLogsByGroupName(logGroupName, {
    startTimeMs: Date.now() - sinceToMs(input.since),
    limit: input.limit ?? 200,
    filterPattern: input.filter,
  });
  ctx.logger.info('platform logs read', { service, logGroup: logGroupName, count: events.length });
  return {
    service,
    logGroup: logGroupName,
    count: events.length,
    events: events.map((e) => ({ time: new Date(e.timestamp).toISOString(), message: redactLogLine(e.message) })),
  };
}

interface CallCellToolInput {
  /** Target the cell by id, or by owner + name (the `@owner/name` address form). */
  cellId?: string;
  owner?: string;
  name?: string;
  tool: string;
  args?: unknown;
}

/**
 * Forward a gateway `read`/`act` to a dynamic cell's tool (`POST /_tools/<tool>`).
 * Reuses `callCell`, so ownership/grant authorisation and the ACTIVE check apply
 * unchanged; non-2xx from the cell surfaces as an error.
 */
async function callCellTool(input: CallCellToolInput, ctx: ServiceContext): Promise<unknown> {
  if (!input?.tool || !SAFE_TOOL_NAME.test(input.tool)) throw new Error('a valid tool name is required');
  // `as` is membrane metadata (ADR-0086), never a cell-tool argument. The
  // gateway strips it on both dispatch verbs, but a leaked key observed live
  // (2026-07-16: @c15r/tasks.create_task 400'd on a strict body parser —
  // kb/cross-cell-act-drops-participant-as) proves at least one path reaches
  // here without that strip. Strip defensively at this choke point so no cell
  // grows an accidental parameter; carrying the participant TO the cell (an
  // identity envelope, not body mutation) is the deferred feature half.
  let args = input.args ?? {};
  if (typeof (args as Record<string, unknown>).as === 'string') {
    const { as: _as, ...rest } = args as Record<string, unknown>;
    args = rest;
  }
  const res = (await callCell(
    {
      cellId: input.cellId,
      owner: input.owner,
      name: input.name,
      method: 'POST',
      path: `${TOOLS_PATH}/${input.tool}`,
      body: args,
    },
    ctx,
  )) as InvokeCellResult;
  if (typeof res?.statusCode === 'number' && res.statusCode >= 400) {
    // Surface the cell's own error — an opaque status helps nobody.
    const detail = (res.body as { error?: string } | undefined)?.error;
    throw new Error(`Cell tool "${input.tool}" failed (status ${res.statusCode})${detail ? `: ${detail}` : ''}`);
  }
  return res?.body;
}

/**
 * forge is a **backend tool-provider**, not a public MCP endpoint. The `/mcp`
 * gateway (the `resource` cell) aggregates these tools, enforces their scopes
 * against the caller, and forwards `tools/call` to the matching command here.
 * `describeTools` is how the gateway discovers them.
 */
interface ToolSpec {
  description: string;
  inputSchema: Record<string, unknown>;
  /** Scope the gateway enforces before forwarding (null = any authenticated user). */
  scope: string | null;
  /** `read` = side-effect-free; `act` = may mutate. Routes the gateway's read/act dispatch. */
  kind: 'read' | 'act';
  /** The declared result envelope (surfaced by the gateway as the tool's output schema). */
  resultSchema?: Record<string, unknown>;
  handler: RegisteredCommand;
}

// ─── Shared schema fragments for the source-file tools ───────────────
const CELL_REF_PROPS = {
  cellId: { type: 'string' },
  owner: { type: 'string' },
  name: { type: 'string' },
};
const IF_VERSION = {
  type: 'string',
  description: 'Proof of read: the `version` a prior readFile/listFiles/searchFiles returned. The call fails with VERSION_CONFLICT (nothing written) if the file has changed since.',
};
const VERSION_PROP = { type: 'string', description: 'Content version, `sha256:<hex>` of the stored bytes. Pass back as ifVersion.' };
const TREE_VERSION_PROP = { type: 'string', description: 'Tree version, `tree:<hex>` — names an exact source tree (sorted path + content versions).' };
const FILE_META_PROPS = {
  path: { type: 'string' },
  contentType: { type: 'string' },
  binary: { type: 'boolean', description: 'Stored as bytes (content comes back base64)' },
  bytes: { type: 'number' },
  lines: { type: 'number', description: 'Line count (text files only)' },
  version: VERSION_PROP,
  etag: { type: 'string' },
  modifiedAt: { type: 'string' },
};
const MUTATION_RESULT = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    cellId: { type: 'string' },
    path: { type: 'string' },
    version: VERSION_PROP,
    previousVersion: { type: 'string', description: 'The version this mutation replaced (when it was read)' },
    deploy: { type: 'object', description: 'Present when deploy:true — the DEPLOYING marker; poll get for the phase' },
  },
};

const TOOLS: Record<string, ToolSpec> = {
  create: {
    description:
      'Provision a new dynamic cell (an isolated Lambda + table) from `code` — a TypeScript module that exports `handler`, a Lambda Function URL handler `(event) => { statusCode, body }`. forge transpiles it. Returns the cellId and address `/@<owner>/<name>`; poll getCell until ACTIVE. ' +
      'Happy path (optional, not required): a cell can be isomorphic React — render the SAME tree to a string on the server (`renderToString`) and hydrate it on the client (`hydrateRoot`), which removes the first-paint flash. Author the server entry as plain `index.ts` (no JSX), keep JSX in `.tsx` modules it imports, and add a `client/main.tsx` (browser bundle → `app.js`). Declare any npm deps ONCE in `client/imports.json` — they are bundled into the server from esm.sh AND fetched by the browser at the same pin. Copy `@c15r/starter` as the template; `@c15r/lit` is the full reference.',
    scope: CREATE_SCOPE,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human name for the cell' },
        code: { type: 'string', description: 'TypeScript source exporting `handler`' },
        description: { type: 'string' },
        share: { type: 'array', items: { type: 'string' }, description: 'Principals to share with' },
        public: { type: 'boolean', description: 'Web-facing: allow anonymous GETs via /@<owner>/<name>' },
        timeoutSeconds: { type: 'number', description: 'Lambda timeout 10–300s (default 10)' },
        memoryMb: { type: 'number', description: 'Lambda memory 128–3008 MB (default 512). CPU scales with memory — the latency knob for CPU-bound SSR' },
        publicNamespace: { type: 'boolean', description: 'ADR-0095: give the cell a CDN-fronted static prefix at /@owner/name/~/… served from S3, with the cell itself as the cache-miss handler — a hit never wakes the Lambda' },
      },
      required: ['name', 'code'],
      additionalProperties: false,
    },
    handler: createCell as RegisteredCommand,
  },
  list: {
    description: 'List the dynamic cells you own.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: listCells as RegisteredCommand,
  },
  get: {
    description: 'Get one dynamic cell, refreshing its provisioning status.',
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { cellId: { type: 'string' } },
      required: ['cellId'],
      additionalProperties: false,
    },
    handler: getCell as RegisteredCommand,
  },
  call: {
    description:
      'Invoke a dynamic cell you own or were granted, over this same connection. Optionally pass method, path, and a JSON body.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        method: { type: 'string' },
        path: { type: 'string' },
        body: {},
      },
      additionalProperties: false,
    },
    handler: callCell as RegisteredCommand,
  },
  grant: {
    description:
      'Share a cell you own with another principal. Omit `tools` for full access; pass `tools` (exact names or trailing-`*` patterns like "list_*") to grant just those — the principal can reach the cell but only call matching tools. Re-granting replaces their standing (so a grant can narrow).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        principal: { type: 'string' },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tool patterns to allow (omit = every tool)' },
      },
      required: ['principal'],
      additionalProperties: false,
    },
    handler: grantCapability as RegisteredCommand,
  },
  revoke: {
    description: "Revoke a principal's access to a cell you own (removes full and per-tool grants).",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        principal: { type: 'string' },
      },
      required: ['principal'],
      additionalProperties: false,
    },
    handler: revokeCapability as RegisteredCommand,
  },
  delete: {
    description: 'Delete a cell you own (tears down its stack).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { cellId: { type: 'string' } },
      required: ['cellId'],
      additionalProperties: false,
    },
    handler: deleteCell as RegisteredCommand,
  },
  logs: {
    description:
      "Fetch a cell's recent CloudWatch logs (observability). Identify the cell by cellId or owner+name; optional `since` (e.g. 15m, 2h), `limit`, and `filter` (CloudWatch filter pattern).",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        since: { type: 'string', description: 'Relative window, e.g. 15m, 2h, 1d' },
        limit: { type: 'number' },
        filter: { type: 'string', description: 'CloudWatch Logs filter pattern' },
      },
      additionalProperties: false,
    },
    handler: cellLogs as RegisteredCommand,
  },
  writeFile: {
    description:
      "Write a source file to a cell's editable tree (cells/<id>/src/<path>). Text by default; encoding:'base64' writes bytes (images, fonts) with a content type from the extension. Safe forms: ifVersion (replace only the version you read) or ifAbsent (create only). Returns the new `version`. Pass deploy:true to kick off an async deploy in the same call (poll get for deploy.phase), else call deploy.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        path: { type: 'string', description: 'Relative path under src/, e.g. index.ts or lib/util.ts' },
        content: { type: 'string', description: 'File body — text, or base64 when encoding is base64' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'base64 stores BYTES (binary assets); default utf8 text' },
        ifVersion: IF_VERSION,
        ifAbsent: { type: 'boolean', description: 'Create only: fail with VERSION_CONFLICT if the file already exists' },
        deploy: { type: 'boolean', description: 'Kick off an async bundle + redeploy after writing (poll get for deploy.phase)' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    resultSchema: MUTATION_RESULT,
    handler: writeFile as RegisteredCommand,
  },
  replaceInFile: {
    description:
      "Preferred for editing an existing cell source file: exact string replacement without resending the whole file. old_str must match exactly (case-sensitive); new_str may be empty to delete. SAFE BY DEFAULT: old_str must occur exactly once (expectedOccurrences, default 1) or nothing is written — widen old_str, or pass matchIndex (0-based) / replace_all. Pass ifVersion from your readFile to refuse edits to a file that changed since. dryRun:true returns the prospective hunks without writing. Returns the new `version`. Pass deploy:true to kick off an async deploy in the same call (poll get for deploy.phase). Use writeFile only when rewriting most of a file.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        path: { type: 'string', description: 'Relative path under src/, e.g. client/main.ts' },
        old_str: { type: 'string', description: 'Exact string to find (case-sensitive, including whitespace)' },
        new_str: { type: 'string', description: 'Replacement (empty string deletes)' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence' },
        expectedOccurrences: { type: 'number', description: 'Required occurrence count, checked before writing (default 1 unless replace_all/matchIndex)' },
        matchIndex: { type: 'number', description: 'Replace only the Nth occurrence (0-based)' },
        ifVersion: IF_VERSION,
        dryRun: { type: 'boolean', description: 'Validate and return the prospective hunks; write nothing' },
        deploy: { type: 'boolean', description: 'Kick off an async bundle + redeploy after the edit (poll get for deploy.phase)' },
      },
      required: ['path', 'old_str', 'new_str'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        ...MUTATION_RESULT.properties,
        replacements: { type: 'number' },
        occurrences: { type: 'number' },
        line: { type: 'number', description: 'Line of the first replacement' },
        dryRun: { type: 'boolean' },
        nextVersion: { type: 'string', description: 'dryRun: the version the edit would produce' },
        hunks: { type: 'array', items: { type: 'object', properties: { line: { type: 'number' }, before: { type: 'string' }, after: { type: 'string' } } } },
      },
    },
    handler: replaceInFile as RegisteredCommand,
  },
  appendToFile: {
    description: "Append content to the end of a text cell source file (creates it when missing) — add a function or section without resending the file. Agent-safe form: ifExists:true (a typo'd path fails instead of creating a file) plus ifVersion. Returns the new `version`. Pass deploy:true to kick off an async deploy in the same call (poll get for deploy.phase).",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        path: { type: 'string' },
        content: { type: 'string', description: 'Content to append (lead with \\n for a separator)' },
        ifVersion: IF_VERSION,
        ifExists: { type: 'boolean', description: 'Fail instead of creating the file when it is missing' },
        ifAbsent: { type: 'boolean', description: 'Create only: fail with VERSION_CONFLICT if the file exists' },
        deploy: { type: 'boolean', description: 'Kick off an async bundle + redeploy after appending (poll get for deploy.phase)' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: { ...MUTATION_RESULT.properties, created: { type: 'boolean' }, bytes: { type: 'number' } },
    },
    handler: appendToFile as RegisteredCommand,
  },
  importSrc: {
    description:
      "Bulk-import text sources from a public https tar/tar.gz archive (e.g. a GitHub codeload tarball) into the cell's src tree — hoist an existing repo into a cell without pushing it file-by-file. `include` selects+strips an archive prefix; `prefix` is the destination under src/. Redeploy with cells.deploy.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        url: { type: 'string', description: 'https tarball, e.g. https://codeload.github.com/<o>/<r>/tar.gz/refs/heads/main' },
        include: { type: 'string', description: 'Archive prefix to select and strip, e.g. "repo-main/src/"' },
        prefix: { type: 'string', description: 'Destination prefix in src/, e.g. "client/"' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    handler: importSrc as RegisteredCommand,
  },
  readFile: {
    description: `Read one source file from a cell's src/ tree, with its metadata (bytes, lines, contentType) and content \`version\` (pass back as ifVersion on edits). Whole file by default; for large files read a LINE RANGE (startLine/endLine, 1-based inclusive) or a BYTE RANGE (offset/length). Ranged reads are capped at ~${RANGE_MAX_BYTES / 1024}KB and report truncated + nextStartLine/nextOffset to continue. Bytes (images, fonts) come back base64. Find where to read with searchFiles.`,
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        path: { type: 'string' },
        startLine: { type: 'number', description: 'First line, 1-based (text files)' },
        endLine: { type: 'number', description: 'Last line, inclusive (default: as far as the budget allows)' },
        offset: { type: 'number', description: 'Byte offset (any file)' },
        length: { type: 'number', description: 'Byte count from offset' },
        encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'Force base64 output for text; bytes are always base64' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        ...FILE_META_PROPS,
        content: { type: 'string' },
        encoding: { type: 'string', enum: ['utf8', 'base64'] },
        range: {
          type: 'object',
          properties: {
            startLine: { type: 'number' }, endLine: { type: 'number' }, totalLines: { type: 'number' },
            offset: { type: 'number' }, length: { type: 'number' }, totalBytes: { type: 'number' },
          },
        },
        truncated: { type: 'boolean', description: 'The budget cut the range short of what was asked' },
        nextStartLine: { type: 'number' },
        nextOffset: { type: 'number' },
      },
      required: ['path', 'content', 'encoding', 'version'],
    },
    handler: readFile as RegisteredCommand,
  },
  listFiles: {
    description: "List a cell's source files (its src/ tree). Narrow with prefix (e.g. client/hydro/) and/or glob (e.g. **/*.ts). view:'meta' returns per-file bytes, lines, contentType and version (paged, 100 by default); the default view returns paths. Page with limit + nextCursor. Always reports total and totalBytes for the filtered set.",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        prefix: { type: 'string', description: 'Only paths under this prefix, e.g. client/hydro/' },
        glob: { type: 'string', description: 'Only paths matching, e.g. client/**/*.ts (no slash = basename anywhere, e.g. *.md)' },
        limit: { type: 'number', description: `Page size (max ${LIST_MAX})` },
        cursor: { type: 'string', description: 'nextCursor from the previous page' },
        view: { type: 'string', enum: ['paths', 'meta'] },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        files: {
          type: 'array',
          description: "Paths (view:'paths') or file metadata objects (view:'meta')",
          items: { anyOf: [{ type: 'string' }, { type: 'object', properties: FILE_META_PROPS }] },
        },
        count: { type: 'number' },
        total: { type: 'number' },
        totalBytes: { type: 'number' },
        nextCursor: { type: 'string' },
      },
      required: ['files'],
    },
    handler: listFiles as RegisteredCommand,
  },
  searchFiles: {
    description: "Search a cell's source tree server-side and return match locations (path, line, column, the matching line, optional context) — find a symbol in a large file without reading it, then readFile the lines around the hit. Literal by default; regex:true for a JS regex (matched per line). Narrow with prefix/glob. Binary files are skipped. Page with nextCursor.",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        query: { type: 'string', description: 'Text (or regex) to find' },
        regex: { type: 'boolean', description: 'Treat query as a JavaScript regular expression' },
        caseSensitive: { type: 'boolean', description: 'Default true' },
        prefix: { type: 'string', description: 'Only paths under this prefix' },
        glob: { type: 'string', description: 'Only paths matching, e.g. client/**/*.ts' },
        contextLines: { type: 'number', description: 'Lines of context before/after each match (0–10, default 0)' },
        maxMatches: { type: 'number', description: `Default ${SEARCH_DEFAULT_MATCHES}, max ${SEARCH_MAX_MATCHES}` },
        cursor: { type: 'string', description: 'nextCursor from the previous page' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        matches: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' }, line: { type: 'number' }, column: { type: 'number' }, text: { type: 'string' },
              before: { type: 'array', items: { type: 'string' } }, after: { type: 'array', items: { type: 'string' } },
              version: VERSION_PROP,
            },
          },
        },
        count: { type: 'number' },
        searchedFiles: { type: 'number' },
        skippedBinary: { type: 'number' },
        truncated: { type: 'boolean' },
        nextCursor: { type: 'string' },
      },
      required: ['matches'],
    },
    handler: searchFiles as RegisteredCommand,
  },
  deleteFile: {
    description: "Delete one source file from a cell's src/ tree. Pass ifVersion to delete only the version you read. Redeploy to take effect, or pass deploy:true to kick one off in the same call.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        path: { type: 'string' },
        ifVersion: IF_VERSION,
        deploy: { type: 'boolean', description: 'Kick off an async bundle + redeploy after deleting (poll get for deploy.phase)' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    resultSchema: MUTATION_RESULT,
    handler: deleteFile as RegisteredCommand,
  },
  status: {
    description: "The cell's source tree at a glance: `treeVersion` (tree:<hash> naming this exact source — pass it as ifTreeVersion to applyPatchSet or as treeVersion to deploy), file count and bytes, the last deployed tree, whether source is `dirty` (differs from what is deployed) and how many files changed since.",
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: { ...CELL_REF_PROPS }, additionalProperties: false },
    resultSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        treeVersion: TREE_VERSION_PROP,
        files: { type: 'number' },
        bytes: { type: 'number' },
        deployed: { type: ['object', 'null'], description: '{version, treeVersion, deployedAt} of the last deploy that landed' },
        dirty: { type: ['boolean', 'null'], description: 'Source differs from the deployed tree (null: never deployed from a snapshot)' },
        changedSinceDeploy: { type: 'object', properties: { added: { type: 'number' }, modified: { type: 'number' }, deleted: { type: 'number' } } },
        deploy: { type: 'object' },
      },
      required: ['treeVersion'],
    },
    handler: sourceStatus as RegisteredCommand,
  },
  snapshot: {
    description: "Freeze the cell's current source tree as an immutable snapshot and return its `treeVersion`. Snapshots are what deploys build and what diff compares; content is stored once per version, so re-snapshotting an unchanged tree is free. ifTreeVersion refuses if the tree has moved.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { ...CELL_REF_PROPS, ifTreeVersion: { type: 'string', description: 'Fail with TREE_CONFLICT unless the live tree is exactly this one' } },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: { cellId: { type: 'string' }, treeVersion: TREE_VERSION_PROP, count: { type: 'number' }, bytes: { type: 'number' }, createdAt: { type: 'string' } },
      required: ['treeVersion'],
    },
    handler: snapshotSource as RegisteredCommand,
  },
  applyPatchSet: {
    description:
      "Apply several edits across files as ONE all-or-nothing change — the tool for coupled multi-file work. Each change is {op:'write'|'replace'|'append'|'delete'|'move', ...} with the same fields and preconditions as the single-file tools (ifVersion, ifAbsent, ifExists, expectedOccurrences, matchIndex; move takes from/to/overwrite). Preconditions refer to the tree BEFORE the patch set; edits apply in order. ifTreeVersion (from cells.status) refuses unless the WHOLE tree is still the one you inspected. dryRun:true returns every conflict at once, per-file +/- lines, one combined unified diff and the projected treeVersion, writing nothing. A real run validates everything first, then commits every file or rolls every write back; snapshot:true freezes the result, deploy:true deploys exactly the result.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        changes: {
          type: 'array',
          description: `1–${PATCH_MAX_CHANGES} changes, applied in order`,
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['write', 'replace', 'append', 'delete', 'move'] },
              path: { type: 'string', description: 'write/replace/append/delete: the file' },
              content: { type: 'string', description: 'write/append' },
              encoding: { type: 'string', enum: ['utf8', 'base64'], description: 'write: base64 stores bytes' },
              old_str: { type: 'string', description: 'replace' },
              new_str: { type: 'string', description: 'replace' },
              replace_all: { type: 'boolean' },
              expectedOccurrences: { type: 'number' },
              matchIndex: { type: 'number' },
              from: { type: 'string', description: 'move: source path' },
              to: { type: 'string', description: 'move: destination path' },
              overwrite: { type: 'boolean', description: 'move: replace an existing destination' },
              ifVersion: IF_VERSION,
              ifAbsent: { type: 'boolean', description: 'write: create only' },
              ifExists: { type: 'boolean', description: 'append: never create' },
            },
            required: ['op'],
          },
        },
        ifTreeVersion: { type: 'string', description: 'Refuse (TREE_CONFLICT) unless the whole source tree is still exactly this tree:<hash>' },
        dryRun: { type: 'boolean', description: 'Validate; return conflicts, combined diff and projected treeVersion; write nothing' },
        snapshot: { type: 'boolean', description: 'Freeze the resulting tree' },
        deploy: { type: 'boolean', description: 'Deploy exactly the resulting tree (implies snapshot)' },
        description: { type: 'string', description: 'With deploy:true — optional WHY for the deploy fact (ADR-0099)' },
        source: { type: 'string', description: 'With deploy:true — optional source provenance, e.g. "git:owner/repo@<sha>" (ADR-0099)' },
        contextLines: { type: 'number', description: 'Dry-run diff context (0–10, default 3)' },
      },
      required: ['changes'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        dryRun: { type: 'boolean' },
        cellId: { type: 'string' },
        previousTreeVersion: TREE_VERSION_PROP,
        treeVersion: { ...TREE_VERSION_PROP, description: 'The tree after the patch set (projected, on a dry run)' },
        conflicts: {
          type: 'array',
          items: { type: 'object', properties: { index: { type: 'number' }, op: { type: 'string' }, path: { type: 'string' }, error: { type: 'string' } } },
        },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' }, status: { type: 'string', enum: ['A', 'M', 'D'] },
              oldVersion: { type: 'string' }, version: { type: 'string' },
              added: { type: 'number' }, removed: { type: 'number' },
              movedFrom: { type: 'string' }, movedTo: { type: 'string' }, binary: { type: 'boolean' },
            },
          },
        },
        diff: { type: 'string', description: 'Dry run: one combined unified diff (budgeted; see omitted)' },
        truncated: { type: 'boolean' },
        omitted: { type: 'array', items: { type: 'string' } },
        snapshot: TREE_VERSION_PROP,
        concurrentChanges: { type: 'boolean', description: 'Files outside the patch set changed while it committed' },
        deploy: { type: 'object' },
      },
    },
    handler: applyPatchSet as RegisteredCommand,
  },
  moveFile: {
    description: 'Rename/move one source file atomically (a one-change applyPatchSet): the destination appears and the source disappears together. ifVersion guards the source; overwrite:true replaces an existing destination; ifTreeVersion, dryRun and deploy as in applyPatchSet.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        from: { type: 'string' },
        to: { type: 'string' },
        ifVersion: IF_VERSION,
        overwrite: { type: 'boolean' },
        ifTreeVersion: { type: 'string' },
        dryRun: { type: 'boolean' },
        deploy: { type: 'boolean' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    handler: moveFile as RegisteredCommand,
  },
  diff: {
    description: "Diff two source trees without downloading them — \"what changed since my last look / since deploy?\". from/to are 'current', 'deployed' (the last landed deploy) or a tree:<hash> (a snapshot, or the current tree); default deployed → current. view 'summary' (counts + total +/- lines), 'files' (default: per-file A/M/D with +/- lines), or 'patch' (unified hunks, budgeted — narrow with prefix/glob). ",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        from: { type: 'string', description: "current | deployed | tree:<hash> (default deployed)" },
        to: { type: 'string', description: "current | deployed | tree:<hash> (default current)" },
        view: { type: 'string', enum: ['summary', 'files', 'patch'] },
        prefix: { type: 'string' },
        glob: { type: 'string' },
        contextLines: { type: 'number', description: 'Patch context (0–10, default 3)' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        from: { type: 'object', properties: { spec: { type: 'string' }, treeVersion: TREE_VERSION_PROP } },
        to: { type: 'object', properties: { spec: { type: 'string' }, treeVersion: TREE_VERSION_PROP } },
        identical: { type: 'boolean' },
        counts: { type: 'object', properties: { added: { type: 'number' }, modified: { type: 'number' }, deleted: { type: 'number' }, unchanged: { type: 'number' } } },
        lines: { type: 'object', properties: { added: { type: 'number' }, removed: { type: 'number' } } },
        files: { type: 'array', items: { type: 'object' } },
        patch: { type: 'string' },
        truncated: { type: 'boolean' },
        omitted: { type: 'array', items: { type: 'string' } },
      },
      required: ['from', 'to', 'counts'],
    },
    handler: diffSource as RegisteredCommand,
  },
  readFiles: {
    description: `Read several source files (or line ranges of them) in one call under ONE shared byte budget (maxBytes, default and max ~${RANGE_MAX_BYTES / 1024}KB) — assemble context for a subsystem without a round trip per file. Filled in order; a file cut short reports nextStartLine, files past the budget come back \`omitted\` with their metadata. Each file carries its \`version\`.`,
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        files: {
          type: 'array',
          description: `1–${READ_FILES_MAX} files`,
          items: {
            type: 'object',
            properties: { path: { type: 'string' }, startLine: { type: 'number' }, endLine: { type: 'number' } },
            required: ['path'],
          },
        },
        maxBytes: { type: 'number' },
      },
      required: ['files'],
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        files: { type: 'array', items: { type: 'object', properties: { ...FILE_META_PROPS, content: { type: 'string' }, encoding: { type: 'string' }, truncated: { type: 'boolean' }, nextStartLine: { type: 'number' }, omitted: { type: 'boolean' }, error: { type: 'string' } } } },
        budget: { type: 'number' },
        used: { type: 'number' },
      },
      required: ['files'],
    },
    handler: readFiles as RegisteredCommand,
  },
  deploy: {
    description: "Bundle a cell's source (resolving relative imports) and point its Lambda at the new build — no cdk deploy. SOURCE-PINNED: the deploy builds an immutable snapshot — `treeVersion` if given (from cells.status / cells.snapshot / applyPatchSet), else a snapshot of the tree taken now — never whatever src/ holds when the worker runs. Runs ASYNCHRONOUSLY: returns immediately with `deploy.phase: DEPLOYING` and the pinned `treeVersion`; poll `get` until `deploy.phase` is DEPLOYED (or FAILED, with `deploy.error`). A newer deploy supersedes an older one still bundling. Each landed deploy becomes a durable `cells/<id>/deploy/<version>` fact (who, why, source, files changed) linked to the cell and the deploy before it (ADR-0099) — pass `description` to say why.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        ...CELL_REF_PROPS,
        treeVersion: { type: 'string', description: 'Deploy exactly this tree (tree:<hash>). Omit to snapshot and deploy the current tree.' },
        description: { type: 'string', description: 'Optional, recommended: WHY this deploy — one commit-message-grade line (≤1000 chars). Recorded on the durable cells/<id>/deploy/<version> fact (ADR-0099); absent, the fact still carries the file-level change summary.' },
        source: { type: 'string', description: 'Optional: where this source came from — e.g. "git:owner/repo@<sha>" or the importSrc tarball URL (≤500 chars).' },
      },
      additionalProperties: false,
    },
    resultSchema: {
      type: 'object',
      properties: {
        deploying: { type: 'boolean' },
        cellId: { type: 'string' },
        version: { type: 'string' },
        treeVersion: TREE_VERSION_PROP,
        deploy: { type: 'object' },
      },
    },
    handler: deploy as RegisteredCommand,
  },
  configureCell: {
    description: "Reconfigure a cell you own: `timeoutSeconds` (10–300) and/or `memoryMb` (128–3008; CPU scales with memory — the latency knob) re-render the stack — run cells.deploy afterwards to restore client/static assets; `public` (registry-only, no rebuild — web-facing so a signed-out visitor gets the SPA shell). Pass any combination.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        timeoutSeconds: { type: 'number' },
        memoryMb: { type: 'number', description: 'Lambda memory 128–3008 MB (default 512)' },
        public: { type: 'boolean', description: 'Allow anonymous GETs through dispatch (the SPA shell loads signed-out; the client handles sign-in for data)' },
        publicNamespace: { type: 'boolean', description: 'ADR-0095: give the cell a CDN-fronted static prefix at /@owner/name/~/… served from S3, with the cell itself as the cache-miss handler. Re-renders the stack.' },
      },
      additionalProperties: false,
    },
    handler: configureCell as RegisteredCommand,
  },
  putData: {
    description: "Store a blob in a cell's per-caller data space (cells/<id>/data/<you>/<key>) — for content too big/binary for the substrate. Pass encoding 'base64' + a contentType for binary (images); keys under public/ in a public cell are web-served at /@owner/cell/_data/<you>/<key> (returned as `url`).",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        key: { type: 'string' },
        content: { type: 'string' },
        encoding: { type: 'string', enum: ['utf8', 'base64'] },
        contentType: { type: 'string' },
        url: { type: 'string', description: 'https URL to fetch server-side (for blobs too large to inline)' },
        presign: { type: 'boolean', description: 'Return {uploadUrl} (presigned S3 PUT, 5 min) instead of writing — for browser uploads of any size' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    handler: putData as RegisteredCommand,
  },
  getData: {
    description: "Read a blob from a cell's data space (your own by default; another user's only if you own the cell).",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        key: { type: 'string' },
        user: { type: 'string', description: "Whose data (owner-only for others); defaults to you" },
      },
      required: ['key'],
      additionalProperties: false,
    },
    handler: getData as RegisteredCommand,
  },
  listData: {
    description: "List blob keys in a cell's data space (your own by default; another user's only if you own the cell).",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        user: { type: 'string', description: "Whose data (owner-only for others); defaults to you" },
      },
      additionalProperties: false,
    },
    handler: listData as RegisteredCommand,
  },
  deleteData: {
    description: "Delete a blob from a cell's data space (your own by default; another user's only if you own the cell). Idempotent. Also retires the mirrored `file/cells/<id>/data/<key>` fact.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        key: { type: 'string' },
        user: { type: 'string', description: 'Whose data (owner-only for others); defaults to you' },
      },
      required: ['key'],
      additionalProperties: false,
    },
    handler: deleteData as RegisteredCommand,
  },
};

/** Tool manifest for the gateway: name, schema, and the scope it should enforce. */
function describeTools(): {
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; resultSchema?: Record<string, unknown>; scope: string | null; kind: 'read' | 'act' }>;
} {
  return {
    tools: Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.resultSchema ? { resultSchema: t.resultSchema } : {}),
      scope: t.scope,
      kind: t.kind,
    })),
  };
}

const commands: Record<string, RegisteredCommand> = {
  resolveCell: resolveCell as RegisteredCommand,
  ssrReadsFor: ssrReadsFor as RegisteredCommand,
  callerWritesFor: callerWritesFor as RegisteredCommand,
  catalogCells: catalogCells as RegisteredCommand,
  describeTools: (() => describeTools()) as RegisteredCommand,
  // Registry-driven dynamic-cell tools (internal: the gateway aggregates and
  // forwards these; they are not themselves advertised as forge MCP tools).
  describeCellTools: describeCellTools as RegisteredCommand,
  callCellTool: callCellTool as RegisteredCommand,
  describeTypes: describeTypes as RegisteredCommand,
  contracts: cellContracts as RegisteredCommand,
  platformLogs: platformLogs as RegisteredCommand,
};
for (const [name, spec] of Object.entries(TOOLS)) {
  commands[name] = spec.handler;
}

export const handler = defineService({
  name: 'cells',
  commands,
  events: {
    emits: [
      'cell.create.requested',
      'cell.deploy.requested',
      'cell.shared',
      'cell.unshared',
      'cell.delete.requested',
      'cell.deployed',
      'cell.files.changed',
      'cell.data.changed',
    ],
    // forge consumes its own `cell.deploy.requested` (routed back by the
    // CellDeployRoute in platform-stack) to run the bundle asynchronously.
    handles: { 'cell.deploy.requested': onDeployRequested },
  },
});

export default handler;
