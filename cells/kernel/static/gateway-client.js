/**
 * @c15r/kernel/gateway-client — the shared scoped-principal /mcp caller
 * (ADR-0076, C5; joins substrate.js in the kernel SDK, ADR-0017).
 *
 * ONE source for the gateway JSON-RPC choreography every tier-2 cell was
 * hand-copying (run · models · consolidate — three copies, drifted: they
 * disagreed on six read verbs and one dropped the isError check). Where
 * substrate.js is the AMBIENT-IAM client (owner-slice reads + organ writes),
 * this is the SCOPED-PRINCIPAL client: call any read/act capability through
 * the gateway PEP under a minted token (ADR-0022/0074 — the token may carry
 * an adopted posture; that biases reads server-side, invisible here).
 *
 * Served verbatim at /@c15r/kernel/gateway-client.js. Server-side cells do
 * NOT import that URL (a server-side https import hangs the forge bundler,
 * ADR-0017) — `cell-sync push` overlays this file into the cell as
 * `vendor/gateway-client.js` when the cell references it (the automated form
 * of the machine cell's manual keep-in-sync copy).
 *
 * Contract: `gwCall` THROWS GatewayError on any failure (HTTP, JSON-RPC
 * error, tool isError). Consumers whose own contract is `{error}` objects
 * (run/models `parc.call`) wrap it; the error text is preserved verbatim.
 *
 * Read-vs-act classification honours the open-vocabulary discipline: the
 * verb set below is a FLOOR, not truth — on a wrong-verb gateway error
 * ("… invoke it with read, not act" / "… with act, not read") the call is
 * retried once with the other verb, so a misclassified target self-heals
 * instead of drifting per copy. Pass `kind` explicitly to skip classification.
 */

export const GATEWAY_MCP_DEFAULT = 'https://parc.land/mcp';

/** The classification FLOOR (union of the three hand copies + C2's `read`).
 *  Unknown verbs default to `act` and self-heal via the mismatch retry. */
export const READ_VERB_FLOOR = new Set([
  'query', 'peek', 'read', 'get', 'list', 'neighbors', 'links', 'edges', 'recall', 'search',
  'describe', 'whoami', 'stats', 'tags', 'history', 'tending', 'salience', 'graph', 'catalog',
  'types', 'shared', 'members', 'attention', 'changes', 'views', 'groups', 'suggestions',
  'contested', 'declarations', 'fetch', 'latest',
]);

/** @param {string} target @returns {'read'|'act'} */
export const toolVerb = (target) => (READ_VERB_FLOOR.has(target.split('.').pop() ?? target) ? 'read' : 'act');

export class GatewayError extends Error {
  /** @param {string} message @param {string} target */
  constructor(message, target) {
    super(message);
    this.name = 'GatewayError';
    this.target = target;
  }
}

const WRONG_VERB_AS_ACT = 'invoke it with read, not act';
const WRONG_VERB_AS_READ = 'invoke it with act, not read';

/**
 * @param {string} url @param {typeof fetch} fetchImpl @param {string} token
 * @param {'read'|'act'} verb @param {string} target @param {unknown} input
 * @returns {Promise<{ok: true, value: unknown} | {ok: false, error: string}>}
 */
async function rpc(url, fetchImpl, token, verb, target, input) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: verb, arguments: input === undefined ? { target } : { target, input } },
    }),
  });
  if (!res.ok) return { ok: false, error: `gateway HTTP ${res.status}` };
  const body = await res.json();
  const text = body?.result?.content?.[0]?.text ?? '';
  let value = text;
  try {
    value = JSON.parse(text);
  } catch {
    /* raw text result */
  }
  if (body?.error || body?.result?.isError) {
    return { ok: false, error: body?.error?.message ?? (typeof value === 'string' ? value : JSON.stringify(value)) };
  }
  return { ok: true, value };
}

/**
 * Call one /mcp capability as a scoped principal. Throws GatewayError.
 * @param {string} token bearer (a minted, possibly postured, principal)
 * @param {string} target e.g. 'workspace.read' or '@owner/cell.tool'
 * @param {unknown} [input]
 * @param {{kind?: 'read'|'act', url?: string, fetchImpl?: typeof fetch}} [opts]
 */
export async function gwCall(token, target, input, opts) {
  const url = opts?.url ?? (typeof process !== 'undefined' ? process.env?.GATEWAY_MCP_URL : undefined) ?? GATEWAY_MCP_DEFAULT;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const verb = opts?.kind ?? toolVerb(target);
  let out = await rpc(url, fetchImpl, token, verb, target, input);
  // Self-heal a floor misclassification: the gateway's error names the right verb.
  if (!out.ok && !opts?.kind) {
    if (verb === 'act' && out.error.includes(WRONG_VERB_AS_ACT)) out = await rpc(url, fetchImpl, token, 'read', target, input);
    else if (verb === 'read' && out.error.includes(WRONG_VERB_AS_READ)) out = await rpc(url, fetchImpl, token, 'act', target, input);
  }
  if (!out.ok) throw new GatewayError(out.error, target);
  return out.value;
}

/**
 * The third MCP verb: who is this token? Returns {user, scopes, grant, actor?,
 * posture?} — posture is the adopted goal (ADR-0074). `whoami` is a top-level
 * tool, not a read target, so it needs its own envelope.
 * @param {string} token
 * @param {{url?: string, fetchImpl?: typeof fetch}} [opts]
 */
export async function gwWhoami(token, opts) {
  const url = opts?.url ?? (typeof process !== 'undefined' ? process.env?.GATEWAY_MCP_URL : undefined) ?? GATEWAY_MCP_DEFAULT;
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name: 'whoami', arguments: {} } }),
  });
  if (!res.ok) throw new GatewayError(`gateway HTTP ${res.status}`, 'whoami');
  const body = await res.json();
  const text = body?.result?.content?.[0]?.text ?? '';
  let value = text;
  try {
    value = JSON.parse(text);
  } catch {
    /* raw */
  }
  if (body?.error || body?.result?.isError) {
    throw new GatewayError(body?.error?.message ?? (typeof value === 'string' ? value : JSON.stringify(value)), 'whoami');
  }
  return value;
}

/**
 * Run many calls with bounded concurrency (ADR-0073's serial-call wall-clock
 * finding, fixed at the shared seam). Results keep input order; a failed call
 * yields `{error}` in its slot rather than rejecting the batch.
 * @param {string} token
 * @param {Array<{target: string, input?: unknown, kind?: 'read'|'act'}>} calls
 * @param {{concurrency?: number, kind?: 'read'|'act', url?: string, fetchImpl?: typeof fetch}} [opts]
 * @returns {Promise<Array<unknown | {error: string}>>}
 */
export async function gwCallMany(token, calls, opts) {
  const limit = Math.max(1, Math.min(opts?.concurrency ?? 4, 16));
  const results = new Array(calls.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= calls.length) return;
      const c = calls[i];
      try {
        results[i] = await gwCall(token, c.target, c.input, { url: opts?.url, fetchImpl: opts?.fetchImpl, kind: c.kind });
      } catch (err) {
        results[i] = { error: /** @type {Error} */ (err).message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, calls.length) }, () => worker()));
  return results;
}
