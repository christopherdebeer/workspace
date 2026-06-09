# Platform cells — taxonomy, naming, and tending

As the platform evolved (substrate → read/act gateway → dynamic cells → S3
authoring), the tier-1 cell roster accreted. This is a **tending pass** over the
kernel itself: classify every tier-1 cell, fix the naming convention, and prune
what no longer earns its place — the same discipline the legacy substrate's
`tending` protocol applies to its own entries, turned on the platform.

## Three kinds of tier-1 cell

The read/act `target` is `<cell>.<command>`, but a cell's name only becomes
**user-facing vocabulary** if the cell is a gateway *provider*. That split is the
key:

1. **Provider cells** — expose read/act tools; the **name *is* the namespace** an
   agent types (`workspace.recall`, `forge.createCell`). Listed in the gateway's
   `PROVIDERS`. Naming matters most here.
2. **Infrastructure cells** — run the platform but **never appear in a `target`**:
   `resource` (the gateway), `dispatch` (the `/@*` router), `home` (the SPA
   front-door), `auth` (passkey/OAuth/tokens). Name = internal clarity only.
3. **Example / legacy cells** — bootstrap-era demos: `documents`, `render`.

## Naming convention (provider cells)

A provider's name is the namespace, so it should read as a **generic domain noun**,
with **bare verbs** (the namespace already says the noun): `<domain>.<verb>` reads
as a sentence — no brand metaphors, no redundant suffix.

`workspace` already follows this. `forge` is the outlier (a metaphor, with
verbs that repeat "Cell"):

```
forge.createCell  →  cells.create
forge.listCells   →  cells.list
forge.getCell     →  cells.get
forge.callCell    →  cells.call
forge.deleteCell  →  cells.delete
forge.cellLogs    →  cells.logs
forge.grantCapability → cells.grant
forge.writeFile   →  cells.writeFile      (or cells.file.write)
forge.deploy      →  cells.deploy
forge.putData     →  cells.data.put       (getData/listData → cells.data.get/list)
forge.describeCellTools / callCellTool → cells.describeTools / callTool (internal)
```

`act("cells.deploy", …)`, `read("cells.logs", …)` — that's the tier-1 vocabulary.
The "forge" metaphor moves to a code comment, not the API.

**Why now:** it *is* the read/act target string. Pre-adoption it's a mechanical
rename; once agents/clients hardcode `forge.createCell` it's a breaking change.

## Per-cell tending verdict

| Cell | Kind | Role | Verdict |
| --- | --- | --- | --- |
| `auth` | infra | passkey + OAuth + scoped tokens; mints the **username principal** | **Keep** — essential |
| `workspace` | provider | the observed-state substrate room | **Keep** — good name |
| `forge` | provider | dynamic-cell control plane + S3 authoring | **Rename → `cells`**, bare verbs |
| `resource` | infra | the `/mcp` gateway (`whoami`/`read`/`act`) | **Keep, rename → `gateway`** (RFC-9728 jargon; invisible to users → low urgency) |
| `dispatch` | infra | `/@*` userland router → `cells.call` | **Keep** — name fine |
| `home` | infra | SPA front-door + `/_catalog` | **Keep, redesign** (`home-cell.md`); `/_catalog` retires into `read("$catalog")` |
| `documents` | example | demo DynamoDB cell (calls `render`, emits `document.created`) | **Retire from the deployed stack** — superseded by `workspace` (real persistence) + `cells` (the real reflexive example); keep code as a reference snippet/test if useful |
| `render` | example | one-command sync peer (only `documents` uses it) | **Retire with `documents`** |

## Net tending actions

1. **Rename `forge → cells`** (+ bare verbs) — provider; touches: the cell name,
   gateway `PROVIDERS`, `dispatch`'s `callCell`/`resolveCell`, the `allow()`
   wiring, `describeTools`, `home`'s `catalogCells`, tests, `dynamic-cells.md`.
   Mechanical; do it as its own clean PR. **Sequencing:** the S3 layer just added
   `writeFile`/`deploy`/`data` to forge, so land the S3 branch *first*, then rename
   once — avoids renaming the same surface twice.
2. **Rename `resource → gateway`** — infra; low urgency (invisible to users), bundle
   with (1) or defer.
3. **Retire `documents` + `render`** — remove from the deployed stack (drop the
   `HttpServiceCell`s + the `/_catalog` entries); optionally keep the code as a
   documented "minimal cell" reference. Cuts catalog noise, IAM surface, deploy
   time, cognitive load.
4. **Redesign `home`** — see [`home-cell.md`](./home-cell.md).

> The principle: the kernel deserves the same tending as the substrate. Provider
> names are public vocabulary (keep them generic and stable); infrastructure names
> are internal (clarity only); example cells are scaffolding (remove once real
> cells outgrow them).
