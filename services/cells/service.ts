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
} from '../../platform/runtime';
import { createRegistry, CellRecord, CellRegistry, DeployState } from './registry';
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
  putObject,
  getObject,
  getObjectRaw,
  listObjects,
  deleteObject,
  presignPut,
  updateFunctionCode,
} from './provisioner';
import type { InvokeCellResult } from './provisioner';
import { srcKey, srcPrefix, buildKey, dataKey, dataPrefix, cleanPath } from './cell-files';
import { extractTarGz } from './tar';

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
}

const clampTimeout = (n: unknown): number | undefined => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(300, Math.max(10, Math.round(v))) : undefined;
};

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
        headers: { 'content-type': obj.contentType, 'cache-control': 'public, max-age=31536000, immutable' },
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
  timeoutSeconds: number;
}
async function configureCell(input: ConfigureCellInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cellId = resolveCellId(input);
  const record = await registry.get(cellId);
  if (!record) throw new Error(`Unknown cell "${cellId}"`);
  if (record.owner !== user) throw new ServiceAuthError('Only the owner can reconfigure a cell');
  const timeoutSeconds = clampTimeout(input.timeoutSeconds);
  if (!timeoutSeconds) throw new Error('timeoutSeconds (10–300) is required');
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
  });
  await updateStack(record.stackName, template);
  await registry.put({ ...record, timeoutSeconds, updatedAt: new Date().toISOString() });
  ctx.logger.info('cell reconfigured', { cellId, timeoutSeconds });
  return {
    ok: true,
    cellId,
    timeoutSeconds,
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
  deploy?: boolean;
}

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

async function writeFile(input: WriteFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  if (typeof input?.content !== 'string') throw new Error('content (string) is required');
  const { record, bucket, env } = await resolveAuthorized(input, user);
  await putObject(bucket, srcKey(record.cellId, input.path), input.content, 'text/plain; charset=utf-8');
  ctx.logger.info('cell file written', { cellId: record.cellId, path: cleanPath(input.path) });
  if (input.deploy) return requestDeploy(record, env, ctx);
  await emitFilesChanged(ctx, record, 'write', [cleanPath(input.path)]);
  return { ok: true, cellId: record.cellId, path: cleanPath(input.path) };
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
  /** Replace every occurrence (default: first only). */
  replace_all?: boolean;
  /** Fused: kick off an async deploy in the same call (poll get for the phase). */
  deploy?: boolean;
}

/**
 * Targeted edit on a cell source file — exact string replacement without
 * resending the whole file (the Val Town `replace_in_file` contract). The
 * response reports `occurrences` so a caller can detect ambiguity; `deploy`
 * fuses edit + rebuild into one round trip.
 */
async function replaceInFile(input: ReplaceInFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  if (typeof input?.old_str !== 'string' || input.old_str.length === 0) throw new Error('old_str (non-empty string) is required');
  if (typeof input?.new_str !== 'string') throw new Error('new_str (string, may be empty) is required');
  const { record, bucket, env } = await resolveAuthorized(input, user);
  const key = srcKey(record.cellId, input.path);
  const content = await getObject(bucket, key);
  if (content === null) throw new Error(`File not found: ${cleanPath(input.path)}`);
  const occurrences = content.split(input.old_str).length - 1;
  if (occurrences === 0) {
    throw new Error(`old_str not found in ${cleanPath(input.path)} — it must match exactly (case-sensitive, including whitespace)`);
  }
  const next = input.replace_all
    ? content.split(input.old_str).join(input.new_str)
    : content.replace(input.old_str, input.new_str);
  await putObject(bucket, key, next, 'text/plain; charset=utf-8');
  const replacements = input.replace_all ? occurrences : 1;
  ctx.logger.info('cell file edited', { cellId: record.cellId, path: cleanPath(input.path), replacements });
  const result = { ok: true as const, cellId: record.cellId, path: cleanPath(input.path), replacements, occurrences };
  if (input.deploy) {
    const started = await requestDeploy(record, env, ctx);
    return { ...result, deploy: started.deploy };
  }
  await emitFilesChanged(ctx, record, 'replace', [cleanPath(input.path)]);
  return result;
}

interface AppendToFileInput extends CellRef {
  path: string;
  content: string;
  deploy?: boolean;
}

/** Append to a cell source file (creates it when missing). */
async function appendToFile(input: AppendToFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  if (typeof input?.content !== 'string' || input.content.length === 0) throw new Error('content (non-empty string) is required');
  const { record, bucket, env } = await resolveAuthorized(input, user);
  const key = srcKey(record.cellId, input.path);
  const existing = (await getObject(bucket, key)) ?? '';
  await putObject(bucket, key, existing + input.content, 'text/plain; charset=utf-8');
  ctx.logger.info('cell file appended', { cellId: record.cellId, path: cleanPath(input.path), created: existing === '' });
  const result = { ok: true as const, cellId: record.cellId, path: cleanPath(input.path), created: existing === '' };
  if (input.deploy) {
    const started = await requestDeploy(record, env, ctx);
    return { ...result, deploy: started.deploy };
  }
  await emitFilesChanged(ctx, record, 'append', [cleanPath(input.path)]);
  return result;
}

interface ReadFileInput extends CellRef {
  path: string;
}
async function readFile(input: ReadFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  const { record, bucket } = await resolveAuthorized(input, user);
  const content = await getObject(bucket, srcKey(record.cellId, input.path));
  if (content === null) throw new Error(`file not found: ${cleanPath(input.path)}`);
  return { cellId: record.cellId, path: cleanPath(input.path), content };
}

async function listFiles(input: CellRef, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const { record, bucket } = await resolveAuthorized(input, user);
  const prefix = srcPrefix(record.cellId);
  const keys = await listObjects(bucket, prefix);
  return { cellId: record.cellId, files: keys.map((k) => k.slice(prefix.length)).filter(Boolean) };
}

interface DeleteFileInput extends CellRef {
  path: string;
}
async function deleteFile(input: DeleteFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  const { record, bucket } = await resolveAuthorized(input, user);
  await deleteObject(bucket, srcKey(record.cellId, input.path));
  await emitFilesChanged(ctx, record, 'delete', [cleanPath(input.path)]);
  return { ok: true, cellId: record.cellId, path: cleanPath(input.path) };
}

/** Bundle the cell's src/ tree and point its Lambda at the new code (deploy-on-update). */
/** Client entry conventions, in priority order (the tier-2 `clientEntry`). */
const CLIENT_ENTRIES = ['client/main.tsx', 'client/main.ts', 'client/index.tsx', 'client/index.ts'];

async function deployCell(record: CellRecord, env: ForgeEnv, ctx: ServiceContext): Promise<unknown> {
  const prefix = srcPrefix(record.cellId);
  const keys = await listObjects(env.codeBucket, prefix);
  const files: Record<string, string> = {};
  for (const k of keys) {
    const rel = k.slice(prefix.length);
    if (!rel) continue;
    const content = await getObject(env.codeBucket, k);
    if (content !== null) files[rel] = content;
  }
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
  const pkg: Array<{ name: string; content: string }> = [{ name: 'index.js', content: js }];

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
  const staticFiles = Object.keys(files).filter((f) => f.startsWith('static/'));
  for (const f of staticFiles) pkg.push({ name: f, content: files[f] });

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

  const version = `${Date.now()}`;
  const codeKey = buildKey(record.cellId, version);
  await uploadPackage({ bucket: env.codeBucket, key: codeKey, files: pkg });
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
  await ctx.events.emit('cell.deployed', {
    cellId: record.cellId,
    owner: record.owner,
    name: record.name,
    address: cellAddress(record.owner, record.name),
    public: record.public,
    version,
    files: Object.keys(files),
    clientEntry: clientEntry ?? null,
    staticFiles,
  });
  return {
    deployed: true,
    cellId: record.cellId,
    version,
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
  deploy: DeployState;
  message: string;
}

/** Kick off the async deploy: record DEPLOYING, emit `cell.deploy.requested`
 *  (routed back to `onDeployRequested`), and return the marker. Shared by the
 *  `deploy` command and the write/edit `deploy:true` flags so every deploy path
 *  is off the synchronous request/edge timeout. */
async function requestDeploy(record: CellRecord, env: ForgeEnv, ctx: ServiceContext): Promise<DeployStarted> {
  const version = `${Date.now()}`;
  const deployState: DeployState = { phase: 'DEPLOYING', version, requestedAt: new Date().toISOString() };
  await createRegistry(env.registryTable).setDeploy(record.cellId, deployState);
  await ctx.events.emit('cell.deploy.requested', {
    cellId: record.cellId,
    owner: record.owner,
    name: record.name,
    version,
  });
  ctx.logger.info('cell deploy requested', { cellId: record.cellId, version });
  return {
    deploying: true,
    cellId: record.cellId,
    version,
    deploy: deployState,
    message: 'Bundling in the background. Poll `get` until `deploy.phase` is DEPLOYED (or FAILED).',
  };
}

async function deploy(input: CellRef, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const { record, env } = await resolveAuthorized(input, user);
  return requestDeploy(record, env, ctx);
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
  const requestedAt = record.deploy?.requestedAt ?? new Date().toISOString();
  const version = record.deploy?.version ?? `${Date.now()}`;
  try {
    const result = (await deployCell(record, env, ctx)) as { version: string };
    await registry.setDeploy(cellId, { phase: 'DEPLOYED', version: result.version, requestedAt });
  } catch (err) {
    ctx.logger.error('cell deploy failed', { cellId, error: (err as Error).message });
    await registry.setDeploy(cellId, { phase: 'FAILED', version, requestedAt, error: (err as Error).message });
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
  await putObject(bucket, dataKey(record.cellId, user, input.key), body, input.contentType ?? fetchedType ?? 'application/octet-stream');
  // Blobs under public/ in a public cell are web-served (see the `_data`
  // intercept in callCell) — hand back the address so a client can embed it.
  const url =
    record.public && key.startsWith('public/')
      ? `/@${record.owner}/${record.name}/_data/${user}/${key}`
      : null;
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
async function describeTypes(_input: unknown, ctx: ServiceContext): Promise<{ types: Record<string, unknown> }> {
  const env = loadForgeEnv();
  const cells = await createRegistry(env.registryTable).listActive();
  const out: Record<string, unknown> = {};
  for (const c of cells.sort((a, b) => a.cellId.localeCompare(b.cellId))) {
    for (const decl of c.types ?? []) {
      const type = typeof decl.type === 'string' ? decl.type : '';
      if (!type || type.startsWith('_')) continue;
      const value: Record<string, unknown> = { ...decl, manager: typeof decl.manager === 'string' ? decl.manager : cellAddress(c.owner, c.name) };
      delete value.type;
      out[type] = value;
    }
  }
  ctx.logger.info('type vocabulary aggregated', { cells: cells.length, types: Object.keys(out).length });
  return { types: out };
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
  const res = (await callCell(
    {
      cellId: input.cellId,
      owner: input.owner,
      name: input.name,
      method: 'POST',
      path: `${TOOLS_PATH}/${input.tool}`,
      body: input.args ?? {},
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
  handler: RegisteredCommand;
}

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
      "Write a source file to a cell's editable tree (cells/<id>/src/<path>). Pass deploy:true to kick off an async deploy in the same call (poll get for deploy.phase), else call deploy.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        path: { type: 'string', description: 'Relative path under src/, e.g. index.ts or lib/util.ts' },
        content: { type: 'string' },
        deploy: { type: 'boolean', description: 'Kick off an async bundle + redeploy after writing (poll get for deploy.phase)' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    handler: writeFile as RegisteredCommand,
  },
  replaceInFile: {
    description:
      "Preferred for editing an existing cell source file: exact string replacement without resending the whole file. old_str must match exactly (case-sensitive); new_str may be empty to delete; replace_all replaces every occurrence (default: first). Returns `occurrences` so ambiguity is detectable. Pass deploy:true to kick off an async deploy in the same call (poll get for deploy.phase). Use writeFile only when rewriting most of a file.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        path: { type: 'string', description: 'Relative path under src/, e.g. client/main.ts' },
        old_str: { type: 'string', description: 'Exact string to find (case-sensitive, including whitespace)' },
        new_str: { type: 'string', description: 'Replacement (empty string deletes)' },
        replace_all: { type: 'boolean', description: 'Replace every occurrence (default: first only)' },
        deploy: { type: 'boolean', description: 'Kick off an async bundle + redeploy after the edit (poll get for deploy.phase)' },
      },
      required: ['path', 'old_str', 'new_str'],
      additionalProperties: false,
    },
    handler: replaceInFile as RegisteredCommand,
  },
  appendToFile: {
    description: "Append content to the end of a cell source file (creates it when missing) — add a function or section without resending the file. Pass deploy:true to kick off an async deploy in the same call (poll get for deploy.phase).",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        path: { type: 'string' },
        content: { type: 'string', description: 'Content to append (lead with \\n for a separator)' },
        deploy: { type: 'boolean', description: 'Kick off an async bundle + redeploy after appending (poll get for deploy.phase)' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
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
    description: "Read one source file from a cell's src/ tree.",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        path: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: readFile as RegisteredCommand,
  },
  listFiles: {
    description: "List a cell's source files (its src/ tree).",
    scope: null,
    kind: 'read',
    inputSchema: {
      type: 'object',
      properties: { cellId: { type: 'string' }, owner: { type: 'string' }, name: { type: 'string' } },
      additionalProperties: false,
    },
    handler: listFiles as RegisteredCommand,
  },
  deleteFile: {
    description: "Delete one source file from a cell's src/ tree (redeploy to take effect).",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { cellId: { type: 'string' }, owner: { type: 'string' }, name: { type: 'string' }, path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    handler: deleteFile as RegisteredCommand,
  },
  deploy: {
    description: "Bundle a cell's src/ tree (resolving relative imports) and point its Lambda at the new build — no cdk deploy. Runs ASYNCHRONOUSLY: returns immediately with `deploy.phase: DEPLOYING`; poll `get` until `deploy.phase` is DEPLOYED (or FAILED, with `deploy.error`).",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { cellId: { type: 'string' }, owner: { type: 'string' }, name: { type: 'string' } },
      additionalProperties: false,
    },
    handler: deploy as RegisteredCommand,
  },
  configureCell: {
    description: 'Reconfigure a cell you own: Lambda timeoutSeconds (10–300). Re-renders the stack and preserves live code; run cells.deploy afterwards to restore client/static assets.',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        cellId: { type: 'string' },
        owner: { type: 'string' },
        name: { type: 'string' },
        timeoutSeconds: { type: 'number' },
      },
      required: ['timeoutSeconds'],
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
};

/** Tool manifest for the gateway: name, schema, and the scope it should enforce. */
function describeTools(): { tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; scope: string | null; kind: 'read' | 'act' }> } {
  return {
    tools: Object.entries(TOOLS).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
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
    ],
    // forge consumes its own `cell.deploy.requested` (routed back by the
    // CellDeployRoute in platform-stack) to run the bundle asynchronously.
    handles: { 'cell.deploy.requested': onDeployRequested },
  },
});

export default handler;
