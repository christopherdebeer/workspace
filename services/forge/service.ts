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
  defineMcpService,
  requireScope,
  requireUser,
  getString,
  getOptional,
  ServiceAuthError,
  ServiceContext,
} from '../../platform/runtime';
import { createRegistry, CellRecord } from './registry';
import { buildCellTemplate, cellResourceName, cellStackName } from './cell-template';
import { transpileCell } from './transpile';
import {
  uploadCode,
  deployStack,
  describeStack,
  deleteStack,
  invokeCell,
} from './provisioner';

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
  const owner = requireScope(ctx.identity, CREATE_SCOPE);
  if (!input?.name?.trim()) throw new Error('A cell `name` is required');
  if (!input?.code?.trim()) throw new Error('Cell `code` (an index.js exporting `handler`) is required');

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

export const handler = defineMcpService({
  name: 'forge',
  // resource cell owns `/mcp`; forge's MCP endpoint lives under its own prefix.
  mcpPath: '/forge/mcp',
  serverInfo: { name: 'workspace-forge', version: '1.0.0' },
  events: { emits: ['cell.create.requested', 'cell.shared', 'cell.delete.requested'] },
  tools: {
    createCell: {
      description:
        'Provision a new dynamic cell (an isolated Lambda + table) from `code` — a TypeScript module that exports `handler`, a Lambda Function URL handler `(event) => { statusCode, body }`. forge transpiles it. Returns the cellId and address `/@<owner>/<name>`; poll getCell until ACTIVE.',
      scope: CREATE_SCOPE,
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
      handler: createCell,
    },
    listCells: {
      description: 'List the dynamic cells you own.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      handler: listCells,
    },
    getCell: {
      description: 'Get one dynamic cell, refreshing its provisioning status.',
      inputSchema: {
        type: 'object',
        properties: { cellId: { type: 'string' } },
        required: ['cellId'],
        additionalProperties: false,
      },
      handler: getCell,
    },
    callCell: {
      description:
        'Invoke a dynamic cell you own or were granted, over this same connection. Optionally pass method, path, and a JSON body.',
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
      handler: callCell,
    },
    grantCapability: {
      description: 'Share a cell you own with another principal (expand permissions).',
      inputSchema: {
        type: 'object',
        properties: { cellId: { type: 'string' }, principal: { type: 'string' } },
        required: ['cellId', 'principal'],
        additionalProperties: false,
      },
      handler: grantCapability,
    },
    deleteCell: {
      description: 'Delete a cell you own (tears down its stack).',
      inputSchema: {
        type: 'object',
        properties: { cellId: { type: 'string' } },
        required: ['cellId'],
        additionalProperties: false,
      },
      handler: deleteCell,
    },
  },
  // Non-tool command for the dispatch cell.
  commands: { resolveCell },
});

export default handler;
