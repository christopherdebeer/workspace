# The cell contract — five slots

*(ADR-0044 Inc 6 — the one-page answer to "what does a cell declare?". The survey found the contract
spread across four files and three conventions; this names it. `@c15r/starter` is the worked floor;
no cell fills every slot.)*

A tier-2 cell is a Lambda + table + scoped IAM role (`services/cells/cell-template.ts`), reachable only
through dispatch (`x-cell-caller` is the dispatch-validated identity — a cell never sees a token). What
makes a cell a *citizen* rather than a webhook is what it **declares**. There are exactly five slots:

| Slot | Declared in | Mechanism | Who consumes it |
|---|---|---|---|
| **1. Reads** | `ssr.json`, or code via `@parc/runtime/cell` | Dispatch runs declared reads *as the caller* and injects them (`ssrReads`); or the cell reads its owner's slice itself via `createCellReader` (IAM `LeadingKeys`-scoped; `list(prefix)` cheap, `query` salience-ranked) — plus `buildTypeVocabulary` to resolve `$types` locally (ADR-0044 Inc 2) | The cell's own SSR |
| **2. Writes** | `ssr.json` (`writes` manifest) or the organ path | `x-parc-writes` response header — dispatch applies the write *as the caller*, bounded by the manifest ∩ the caller's scope (the cell holds no token); or `substrate.write.requested` on the bus with an IAM-pinned `Source` (machine-attested organ provenance) | Dispatch / the substrate ingester |
| **3. Types** | `types.json` | Stored on the cell's registry record at deploy; `cells.describeTypes` federates all cells' declarations into the canonical half of `$types`. A type is one object: `shape` (fields/keyPattern/keyEdges), `present` (icon/label/render), `handlers` (open/edit/embed/render/create), `manager` (ADR-0002) | Every surface — home, lit, the card, other cells |
| **4. Renderers / forms** | `handlers.render[].renderer` (types) or `ui:{renderer,form,as}` (tool descriptors) | A `ui://@owner/cell/…` asset the cell serves (self-registering classic script, `fn(host,value,api)` / `fn(host,schema,value,api)`); the gateway provider-hop resolves it; hosts run it **sandboxed** (opaque origin, host-proxied `api.call`) — surfaces A/B/C per ADR-0043 | The conversation card, home, lit — any embedding host |
| **5. Tools** | `GET /_tools` → `POST /_tools/<name>` | `{name, description, kind: read\|act, inputSchema, scope?, ui?}` descriptors; the gateway routes `read`/`act` on `@owner/cell.tool` through `cells.callCellTool` (ownership/grant-checked, `x-cell-caller` forwarded) | Agents and other cells via the gateway |

**The trust grammar behind the slots:** a cell never authenticates itself to anyone. Identity flows *in*
(`x-cell-caller`), writes flow *out* as declarations someone with authority applies (slot 2), UI flows
*out* as inert code another surface runs in a sandbox with *its* session (slot 4). Every slot narrows —
none grants.

**Who fills what today** (survey of 2026-07-01): starter 1+2+3 (the floor: one type, one read, the
caller-write demo) · home 1+2+3 (15 types — the knowledge base) · lit 1+2 (docs/blocks/log types) ·
canvas 3+4+5 (board renderer + `scene` read) · machine 1+2+3+4+5 (the full contract) · input 2+3+4+5
(capture organ + `ui://` form) · models/run/reef-writer/regwatch 5 (+2 via organ) — headless tool cells
· viewers 4-ish (serves renderer modules; predates the `ui://` declaration — ADR-0044 Inc 4 folds it) ·
kernel none (it *is* shared client code, delivered by URL).

**Rules of thumb:** a cell that renders someone's facts should declare types (slot 3) rather than
hardcode routing; a cell whose facts appear on other surfaces should serve a renderer (slot 4) rather
than expect an origin-iframe; a cell that computes should expose tools (slot 5) rather than bespoke
HTTP; and *nothing* should write the substrate except through slot 2's two audited paths.
