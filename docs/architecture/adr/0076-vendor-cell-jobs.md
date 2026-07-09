# ADR-0076 — Vendor cell-jobs: one async harness, one gateway client

- **Status:** Proposed 2026-07-09 (buffer — feedback welcome before build). Enters
  the buffer beside ADR-0075 as ADR-0074 (principal-adopted goals) moves to built —
  this is **C5** of the second contraction wave (ADR-0067), the DRY completion and
  the wave's last entry.
- **Context doc:** `docs/architecture/compose.md` (C5 row).
- **Depends on:** ADR-0026/0028 (the run/models cells whose in-code TODO this
  honours), ADR-0073 (C8 — the third consumer), ADR-0074 (postured principals —
  the minted tokens these clients call with).

---

## Context (grounded)

Tier-2 cells that do long work or act through the gateway have hand-copied the
same two harnesses three times:

- **The async job pattern** — `submit fast → putJob(pending) → self-invoke →
  do the work → putJob(done|error) → poll via fetch` (the edge caps sync calls at
  ~30s). Duplicated verbatim: `cells/run/index.ts:165-262` and
  `cells/models/index.ts:705-750`.
- **The gateway client** — call `/mcp` as a **scoped principal** (a minted
  token), classify the target read-vs-act, unwrap the JSON-RPC envelope.
  Duplicated three times: `cells/run/index.ts:35-60` (whose comment says *"vendor
  a shared module when a second consumer lands"*), `cells/models/index.ts` (the
  original), and now `cells/consolidate/index.ts` (`gw()` — the C8 organ). The
  TODO's own condition is met twice over.
- **The vendoring precedent exists**: cells already share vendored modules
  (`cells/machine/substrate.js`, the kernel's static client) — a cell bundle is
  self-contained, so "shared" means *one source, vendored at deploy*, not a
  runtime dependency.
- **A vocabulary smell rides along**: each copy hardcodes a `READ_VERBS` set to
  classify targets read-vs-act — a compiled vocabulary that drifts from the real
  descriptors (C2's `read` isn't in models' copy, e.g.). The descriptor's `kind`
  is the truth; a client should learn it from `$catalog` (cached) or take it as
  an argument, per the open-vocabulary discipline (compose.md §8).

```mermaid
flowchart TD
  subgraph before["BEFORE — 3 hand copies, drifting"]
    R0["run: putJob + self-invoke + READ_VERBS proxy"]
    M0["models: putJob + self-invoke + READ_VERBS proxy"]
    C0["consolidate: gw() gateway client"]
  end
  subgraph after["AFTER — one vendored source each"]
    J1["cells/_vendor/cell-jobs —<br/>submitJob · selfInvoke · putJob · fetchJob"]
    G1["cells/_vendor/gateway-client —<br/>call(token, target, input): scoped principal,<br/>kind from $catalog (cached) not a compiled set"]
    R1["run"] --- J1 & G1
    M1["models"] --- J1 & G1
    C1["consolidate"] --- G1
  end
  before ==vendor==> after
```

## Sketch (decisions, tentative)

1. **Two modules, one home.** `cells/_vendor/cell-jobs.ts` (the async harness)
   and `cells/_vendor/gateway-client.ts` (the scoped-principal caller), vendored
   into each cell's bundle at deploy exactly like the substrate.js precedent —
   no runtime coupling between cells.
2. **cell-jobs surface.** `submitJob(table, kind, input) → {jobId, poll}` ·
   `runJob(jobId, work)` (self-invoke wrapper: pending → work() → done|error) ·
   `fetchJob(table, jobId)`. The cells keep their own TOOLS/table names — the
   module owns only the choreography.
3. **gateway-client surface.** `call(token, target, input)` — JSON-RPC envelope,
   error unwrap, and read-vs-act from a **cached `$catalog` lookup** with the
   compiled verb set demoted to a fallback floor (open-vocabulary rule). Timeout
   + single retry knobs, since organ wall-clock is dominated by these calls
   (ADR-0073 impl log).
4. **Behaviour-preserving.** run/models/consolidate keep byte-identical tool
   results; the only change is where the code lives. Gate: existing cell tests +
   a jobs-module unit gate (pending→done, pending→error, poll shape).
5. **Postured principals plug in.** The client takes the minted token as-is; a
   parent that postures a child token (ADR-0074) changes nothing here — the bias
   is applied by the workspace read path, invisibly to the client.

## Why now (buffer rationale)

C5 is the wave's last row. Every earlier contraction either composed a surface
(C1/C2/C3) or completed a loop (C6/C7/C8); C5 is pure debt — and it grew a third
copy while the wave ran. Landing it closes ADR-0067's table and hands the next
wave a clean seam: any future organ (goal-driven agents on postured tokens are
the obvious next) starts from the vendored client instead of a fourth copy.

## Open questions

1. Vendor at deploy (cell-sync copies `_vendor/` into the bundle) vs a build-time
   import path — which does the current esbuild bundling make cheaper?
2. Should `gateway-client` also own token minting/revocation choreography
   (mint-per-run, revoke-after), or stay call-only? Leaning call-only — minting
   policy is the organ's, not the transport's.
3. Does the `$catalog` kind cache live per-invocation (simple) or in the cell's
   table (fewer catalog reads)? Leaning per-invocation until measured.
