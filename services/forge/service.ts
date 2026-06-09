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
import { createRegistry, CellRecord } from './registry';
import { buildCellTemplate, cellResourceName, cellStackName } from './cell-template';
import { transpileCell, bundleFiles } from './transpile';
import {
  uploadCode,
  deployStack,
  describeStack,
  deleteStack,
  invokeCell,
  getCellLogs,
  putObject,
  getObject,
  listObjects,
  deleteObject,
  updateFunctionCode,
} from './provisioner';
import type { InvokeCellResult } from './provisioner';
import { srcKey, srcPrefix, buildKey, dataKey, dataPrefix, cleanPath } from './cell-files';

/** Parse a relative window like "15m", "2h", "1d" into milliseconds. */
function sinceToMs(since: string | undefined): number {
  const m = (since ?? '15m').trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return 15 * 60 * 1000;
  const n = Number(m[1]);
  const unit = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase() as 's' | 'm' | 'h' | 'd'];
  return n * unit;
}

const CREATE_SCOPE = 'platform:cells:create';

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
}

function loadForgeEnv(): ForgeEnv {
  return {
    registryTable: getString('TABLE_NAME'),
    codeBucket: getString('CELL_CODE_BUCKET'),
    boundaryArn: getString('CELL_PERMISSION_BOUNDARY_ARN'),
    eventBusName: getString('CELL_EVENT_BUS_NAME'),
    eventBusArn: getString('CELL_EVENT_BUS_ARN'),
    region: getOptional('CELL_REGION') ?? getString('AWS_REGION'),
    accountId: getString('CELL_ACCOUNT_ID'),
  };
}

/** Throw unless `user` owns or has been granted access to the cell. */
function authorizeAccess(record: CellRecord, user: string): void {
  if (record.owner !== user && !record.grants.includes(user)) {
    throw new ServiceAuthError(`Not authorised for cell "${record.cellId}"`);
  }
}

// ─── tools ────────────────────────────────────────────────────────

interface CreateCellInput {
  name: string;
  code: string;
  description?: string;
  /** Principals to share the cell with on creation (in addition to the owner). */
  share?: string[];
}

async function createCell(input: CreateCellInput, ctx: ServiceContext): Promise<unknown> {
  // Scope (platform:cells:create) is enforced at the /mcp gateway; forge is a
  // backend reachable only via allow-listed invokes, and authorizes by ownership.
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
    throw new Error(`Cell "${cellId}" already exists (status ${existing.status})`);
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
    status: 'CREATING',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await registry.put(record);

  ctx.logger.info('dynamic cell create requested', { cellId, owner });
  await ctx.events.emit('cell.create.requested', { cellId, owner });

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
  return {
    cells: cells.map((c) => ({
      cellId: c.cellId,
      name: c.name,
      status: c.status,
      grants: c.grants,
      description: c.description,
      address: cellAddress(c.owner, c.name),
    })),
  };
}

/**
 * Internal command backing the `home` cell's `/_catalog` merge: the dynamic
 * cells the caller can access (owns or was granted), shaped for the catalog.
 * Not an MCP tool — `home` reaches it via an allow-listed invoke, and the
 * caller's identity propagates as `user`, so the registry filters to that
 * principal (never leaking other owners' private cells).
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

  // Refresh status from the live stack so callers see CREATING → ACTIVE.
  if (record.status === 'CREATING' || record.status === 'DELETING') {
    const stack = await describeStack(record.stackName);
    if (stack) {
      const fresh = statusFromStack(stack.status);
      if (fresh !== record.status) {
        await registry.setStatus(record.cellId, fresh);
        record.status = fresh;
      }
    }
  }

  return {
    cellId: record.cellId,
    name: record.name,
    owner: record.owner,
    status: record.status,
    grants: record.grants,
    description: record.description,
    address: cellAddress(record.owner, record.name),
    createdAt: record.createdAt,
  };
}

interface GrantInput {
  cellId: string;
  principal: string;
}

async function grantCapability(input: GrantInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const record = await registry.get(input?.cellId);
  if (!record) throw new Error(`Unknown cell "${input?.cellId}"`);
  if (record.owner !== user) throw new ServiceAuthError('Only the owner can share a cell');
  if (!input?.principal?.trim()) throw new Error('A `principal` to grant is required');
  const updated = await registry.addGrant(record.cellId, input.principal);
  await ctx.events.emit('cell.shared', { cellId: record.cellId, principal: input.principal });
  return { cellId: record.cellId, grants: updated?.grants ?? record.grants };
}

interface CallCellInput {
  /** Either an explicit cellId, or owner + name (the `/@owner/name` form). */
  cellId?: string;
  owner?: string;
  name?: string;
  method?: string;
  path?: string;
  body?: unknown;
}

/** Resolve the input's target to an internal cellId. */
function resolveCellId(input: { cellId?: string; owner?: string; name?: string }): string {
  if (input?.cellId) return input.cellId;
  if (input?.owner && input?.name) return makeCellId(input.owner, input.name);
  throw new Error('Provide either `cellId`, or `owner` and `name`');
}

async function callCell(input: CallCellInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const env = loadForgeEnv();
  const registry = createRegistry(env.registryTable);
  const cellId = resolveCellId(input);
  const record = await registry.get(cellId);
  if (!record) throw new Error(`Unknown cell "${cellId}"`);
  authorizeAccess(record, user);
  if (record.status !== 'ACTIVE') {
    throw new Error(`Cell "${record.cellId}" is not ACTIVE (status ${record.status})`);
  }

  const method = (input.method ?? 'POST').toUpperCase();
  const path = input.path ?? '/';
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
      rawQueryString: '',
      headers: { 'content-type': 'application/json', 'x-cell-caller': user },
      requestContext: { http: { method, path } },
      body: bodyStr,
      isBase64Encoded: false,
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

interface DeleteInput {
  cellId: string;
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
async function writeFile(input: WriteFileInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.path) throw new Error('path is required');
  if (typeof input?.content !== 'string') throw new Error('content (string) is required');
  const { record, bucket, env } = await resolveAuthorized(input, user);
  await putObject(bucket, srcKey(record.cellId, input.path), input.content, 'text/plain; charset=utf-8');
  ctx.logger.info('cell file written', { cellId: record.cellId, path: cleanPath(input.path) });
  if (input.deploy) return deployCell(record, env, ctx);
  return { ok: true, cellId: record.cellId, path: cleanPath(input.path) };
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
  return { ok: true, cellId: record.cellId, path: cleanPath(input.path) };
}

/** Bundle the cell's src/ tree and point its Lambda at the new code (deploy-on-update). */
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

  let js: string;
  try {
    js = await bundleFiles(files, entry);
  } catch (err) {
    throw new Error(`Cell source failed to bundle: ${(err as Error).message}`);
  }

  const version = `${Date.now()}`;
  const codeKey = buildKey(record.cellId, version);
  await uploadCode({ bucket: env.codeBucket, key: codeKey, code: js });
  await updateFunctionCode(record.functionName, env.codeBucket, codeKey);
  await createRegistry(env.registryTable).put({ ...record, updatedAt: new Date().toISOString() });

  ctx.logger.info('cell deployed', { cellId: record.cellId, version, files: Object.keys(files).length });
  await ctx.events.emit('cell.deployed', { cellId: record.cellId, version });
  return { deployed: true, cellId: record.cellId, version, entry, files: Object.keys(files) };
}

async function deploy(input: CellRef, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  const { record, env } = await resolveAuthorized(input, user);
  return deployCell(record, env, ctx);
}

interface PutDataInput extends CellRef {
  key: string;
  content: string;
}
async function putData(input: PutDataInput, ctx: ServiceContext): Promise<unknown> {
  const user = requireUser(ctx.identity);
  if (!input?.key) throw new Error('key is required');
  if (typeof input?.content !== 'string') throw new Error('content (string) is required');
  const { record, bucket } = await resolveAuthorized(input, user);
  await putObject(bucket, dataKey(record.cellId, user, input.key), input.content);
  return { ok: true, cellId: record.cellId, user, key: cleanPath(input.key) };
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
    cells = rec && rec.grants.includes(user) && rec.status === 'ACTIVE' ? [rec] : [];
  } else {
    cells = (await registry.listAccessibleBy(user)).filter((c) => c.status === 'ACTIVE').slice(0, MAX_TOOL_CELLS);
  }

  const out: CellToolDescriptor[] = [];
  await Promise.all(
    cells.map(async (cell) => {
      const address = cellAddress(cell.owner, cell.name).slice(1); // `@<owner>/<slug>`
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
          });
        }
      } catch (err) {
        ctx.logger.warn('cell tool discovery failed', { cellId: cell.cellId, error: (err as Error).message });
      }
    }),
  );
  return { tools: out };
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
    throw new Error(`Cell tool "${input.tool}" failed (status ${res.statusCode})`);
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
  createCell: {
    description:
      'Provision a new dynamic cell (an isolated Lambda + table) from `code` — a TypeScript module that exports `handler`, a Lambda Function URL handler `(event) => { statusCode, body }`. forge transpiles it. Returns the cellId and address `/@<owner>/<name>`; poll getCell until ACTIVE.',
    scope: CREATE_SCOPE,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Human name for the cell' },
        code: { type: 'string', description: 'TypeScript source exporting `handler`' },
        description: { type: 'string' },
        share: { type: 'array', items: { type: 'string' }, description: 'Principals to share with' },
      },
      required: ['name', 'code'],
      additionalProperties: false,
    },
    handler: createCell as RegisteredCommand,
  },
  listCells: {
    description: 'List the dynamic cells you own.',
    scope: null,
    kind: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: listCells as RegisteredCommand,
  },
  getCell: {
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
  callCell: {
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
  grantCapability: {
    description: 'Share a cell you own with another principal (expand permissions).',
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { cellId: { type: 'string' }, principal: { type: 'string' } },
      required: ['cellId', 'principal'],
      additionalProperties: false,
    },
    handler: grantCapability as RegisteredCommand,
  },
  deleteCell: {
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
  cellLogs: {
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
      "Write a source file to a cell's editable tree (cells/<id>/src/<path>). Pass deploy:true to bundle + redeploy immediately, else call deploy.",
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
        deploy: { type: 'boolean', description: 'Bundle + redeploy after writing' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    handler: writeFile as RegisteredCommand,
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
    description: "Bundle a cell's src/ tree (resolving relative imports) and point its Lambda at the new build — no cdk deploy.",
    scope: null,
    kind: 'act',
    inputSchema: {
      type: 'object',
      properties: { cellId: { type: 'string' }, owner: { type: 'string' }, name: { type: 'string' } },
      additionalProperties: false,
    },
    handler: deploy as RegisteredCommand,
  },
  putData: {
    description: "Store a blob in a cell's per-caller data space (cells/<id>/data/<you>/<key>) — for content too big/binary for the substrate.",
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
      },
      required: ['key', 'content'],
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
  catalogCells: catalogCells as RegisteredCommand,
  describeTools: (() => describeTools()) as RegisteredCommand,
  // Registry-driven dynamic-cell tools (internal: the gateway aggregates and
  // forwards these; they are not themselves advertised as forge MCP tools).
  describeCellTools: describeCellTools as RegisteredCommand,
  callCellTool: callCellTool as RegisteredCommand,
};
for (const [name, spec] of Object.entries(TOOLS)) {
  commands[name] = spec.handler;
}

export const handler = defineService({
  name: 'forge',
  commands,
  events: { emits: ['cell.create.requested', 'cell.shared', 'cell.delete.requested', 'cell.deployed'] },
});

export default handler;
