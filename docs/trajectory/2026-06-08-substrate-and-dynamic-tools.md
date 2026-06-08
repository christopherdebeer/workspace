# Trajectory — Observed-state substrate + dynamic MCP tool surface (2026-06-08)

> **Semi-ephemeral handoff doc.** Point a fresh session at this file to continue
> without re-deriving. It records what shipped, what's live, and the exact next
> step (a live end-to-end validation). Durable design lives in
> [`substrate.md`](./substrate.md) and [`dynamic-cells.md`](./dynamic-cells.md) —
> this is the working log, safe to delete once its next-steps are done.

- **Branch:** `claude/forge-dynamic-cell-e2e-qgVeI` (all work below merged to `main` and deployed)
- **Live target:** `https://parc.land` (account `018159942401`, us-east-1)
- **Principal used this session:** `cb47e675-…` with scopes
  `workspace:read/write/admin`, `platform:cells:create`, `platform:*`.

---

## TL;DR — what shipped (3 PRs, all deployed)

1. **#114 — Observed-state substrate + workspace room + sharing.**
   `platform/runtime/state.ts` (the primitive), `services/workspace` (the room:
   `remember`/`recall`/`peek`/`supersede`/`share`/`unshare`/`shared`), grants in
   `services/workspace/grants.ts`. One Substrate; a workspace is a per-user *view*.
2. **#115 — Surface the workspace cell as MCP tools at `/mcp`.**
   `workspace.describeTools` + `'workspace'` added to the gateway's `PROVIDERS`.
3. **#116 — Registry-driven gateway: dynamic cells contribute tools, no deploy.**
   `forge.describeCellTools` / `forge.callCellTool`; the gateway folds dynamic
   cells' tools into `tools/list`. Adding tool surface no longer needs a deploy.

## Verified live this session

- `whoami` → the principal + scopes above (OAuth to `parc.land/mcp` works).
- `recall` (workspace tool, tier-1) → returned a real, salience-shaped slice from
  DynamoDB: `_shaping: { focusThreshold: 0.5, elideThreshold: 0.1, … }`. The slice
  already holds a **`substrate-on-cells`** knowledge graph (keys `e:*` entries,
  `l:*` links, a `meta:schema` decision) — i.e. the primitives are already in real
  use. So **#114 and #115 are proven live.**
- `listCells` → one ACTIVE dynamic cell, `hello-parc-e6badc9b` (the original E2E
  smoke cell). #116's dynamic-tool path is **unit-tested + deployed but not yet
  exercised live** — that's the next step below.

---

## The architecture in one screen

```
parc.land/mcp  (resource cell = the MCP gateway, defineMcpService)
   tool list aggregated per request from two paths:
     1. TIER-1 PROVIDERS = ['forge','workspace']   (explicit; kernel; need IAM grants)
          → forward tools/call via serviceClient(provider).command(name,args)
     2. TIER-2 dynamic cells (registry-driven, NO deploy to add):
          gateway → forge.describeCellTools
             → forge enumerates caller's accessible ACTIVE cells (registry)
             → probes each cell:  GET /_tools   (best-effort, capped)
          gateway → forge.callCellTool  → forge.callCell → POST /_tools/<name>
   scope-filtered + ownership-authorised at the gateway; forge authorises by owner.
```

- **Substrate primitive** (`platform/runtime/state.ts`): `put`/`get`/`read`/`shape`/
  `supersede`. Monotonic — writes bump a revision, nothing is lost; `read` shapes a
  scope's slice by salience (focus/peripheral/elided) from a recent-attention
  trajectory; `shape()` was extracted so a *merged* view (own + granted) is shaped
  once. Storage via `StateStore` (in-memory for tests, DynamoDB for prod).
- **workspace room** (`services/workspace/`): per-user slice = caller identity.
  Sharing (`grants.ts`) exposes a key — or `*` for the whole slice — into another
  user's `recall`; granted facts surface under `<owner>/<key>`.
- **MCP gateway** (`services/resource/service.ts`): the two aggregation paths above.
- **forge** (`services/forge/service.ts`): control plane for dynamic cells +
  `describeCellTools`/`callCellTool` for the registry-driven tool surface.

## The cell-tool convention (opt-in, tiny)

A dynamic cell contributes tools to `/mcp` by answering:

- `GET  /_tools`        → `{ tools: [{ name, description, inputSchema, scope? }] }`
- `POST /_tools/<name>` → (JSON body = arguments) → the tool's result

Gateway-facing names are namespaced `<cellId>__<tool>`. A cell that ignores
`/_tools` contributes nothing.

---

## NEXT STEP — live end-to-end validation of #116 (not yet done)

Goal: prove a runtime-created cell's tools appear at `parc.land/mcp` with no deploy.

1. `createCell` with `name: "tools-demo"` and the code below.
2. Poll `getCell` until `status: "ACTIVE"` (tens of seconds).
3. Confirm the cell serves the convention:
   `callCell { cellId, method: "GET", path: "/_tools" }` → expect the manifest.
4. Re-list MCP tools (fresh `tools/list`): a tool named `tools-demo-<hash>__echo`
   should now appear — **that is the proof.** Call it:
   `<cellId>__echo` with `{ "message": "hi" }` → `{ echoed: "hi", … }`.
   (Or directly: `callCell { cellId, method:"POST", path:"/_tools/echo", body:{message:"hi"} }`.)
5. Clean up with `deleteCell` if desired.

Ready-to-paste cell code (a valid Lambda Function-URL handler):

```ts
export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  const json = (statusCode, body) => ({
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (method === 'GET' && path === '/_tools') {
    return json(200, {
      tools: [
        {
          name: 'echo',
          description: 'Echo a message back (dynamic-cell tool demo).',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string' } },
            required: ['message'],
            additionalProperties: false,
          },
          scope: null,
        },
      ],
    });
  }
  if (method === 'POST' && path === '/_tools/echo') {
    const args = event.body ? JSON.parse(event.body) : {};
    return json(200, { echoed: args.message ?? null, at: new Date().toISOString() });
  }
  return json(404, { error: `no route for ${method} ${path}` });
};
```

Expected outcome: `tools-demo-<hash>__echo` shows up in `tools/list` and returns
the echo — closing the loop that #116 makes possible without a `cdk deploy`.

---

## Open threads (after validation)

- **`tend` loop** — a scheduled pass over the substrate (salience decay /
  housekeeping). Deferred since #114. Natural next feature on the room.
- **Write-through grants** — sharing is read-visibility only today; acting in
  another's slice (capability on `share`) is designed-for but not wired.
- **Manifest caching** — `describeCellTools` probes cells live per `tools/list`
  (capped by `MAX_TOOL_CELLS`). Cache each cell's `/_tools` manifest in the
  registry (with a TTL / refresh on cell update) to cut per-list Lambda invokes.
- **`forge.promote`** — codify a proven dynamic cell into tier-1 via a PR
  (the promotion path; still planned per `dynamic-cells.md`).

## Driving `parc.land/mcp` from a fresh session

The tools are gated behind OAuth (passkey). A fresh session must authenticate to
the `f5bbef8d` MCP server (`parc.land/mcp`) before `whoami`/`createCell`/`recall`
etc. become available; complete the flow with the localhost callback URL. Once
authed, the workspace tools (`remember`/`recall`/…) and the cell control plane
(`createCell`/`callCell`/…) are live, plus any dynamic-cell tools.

## File map

| Concern | File |
| --- | --- |
| Substrate primitive | `platform/runtime/state.ts` |
| Workspace room | `services/workspace/{service,handlers}.ts` |
| Sharing/grants | `services/workspace/grants.ts` |
| MCP gateway (aggregation) | `services/resource/service.ts` |
| Dynamic-cell control plane + tool discovery | `services/forge/service.ts` |
| Cell registry | `services/forge/registry.ts` |
| Stack wiring | `lib/platform-stack.ts` |
| Tests | `tests/{workspace,resource-cell,forge-cell}.test.ts` |
| Durable design | `docs/substrate.md`, `docs/dynamic-cells.md` |
