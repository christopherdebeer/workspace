# 06 — Reserved keys, decorations & the execution tiers

> **Oblique strategy drawn:** *"Make a sudden, destructive, unpredictable action;
> incorporate."*
> Lens: pick one entrenched naming convention, blow it up, and incorporate the
> wreckage into something better. The convention I detonate below is the
> `_prefix/` reserved-key scheme — and I argue the right move is to rename it to
> `meta:` while *folding* the whole "decoration vs domain fact" split into it.

This is one of seven parallel rambles. Domain: the **reserved/structural key
prefixes**, the **"decoration"** concept, and the **executor/dispatch lexicon**
(organ / dispatch / emit / kernel / transformer / tier). Generative, not a spec.

---

## 1. Inventory

### 1a. Reserved / structural key prefixes

Facts live at `pk=STATE#<scope>` / `sk=KEY#<key>`
(`platform/runtime/dynamo-state-store.ts:9`, `platform/infra/substrate-table.ts:24`).
A leading `_` on the *logical key* marks it as **system plumbing** rather than
user knowledge. The convention is real but nowhere centrally declared.

| Prefix | Meaning | Where used (file:line) |
|---|---|---|
| `_actions/<id>` | a declared action (guarded write capability) as a fact | `docs/declarative-actions-vs-code-cells.md:13`; design throughout |
| `_views/<id>` | a declared view (read capability / board membership) | `cells/canvas/index.ts:47,52`; `cells/canvas/client/lib/network/storage.ts:363` |
| `_renderers/<type>` | a renderer fact: JS `source` that mounts an `ElementView` | `cells/canvas/client/lib/elements/substrateTypes.ts:226,230`; `cells/lit/client/main.tsx:141,150,235`; `platform/ui/vocab.ts:12,34` |
| `_types/<type>` | type vocabulary: `{icon, titlePath, href, viewer}` | `cells/kernel/client/main.ts:332,350,355,359`; `cells/canvas/client/lib/network/storage.ts:47`; `cells/home/client/app.tsx:916,945` |
| `_doc/<docId>/<cellKey>` | doc membership + order decoration: `{seq, fold}` | `cells/lit/index.ts:135,137`; `cells/lit/client/main.tsx:53,60,106`; `cells/lit/shared.tsx:20` |
| `_canvas/<cid>/<key>` | canvas placement decoration (geometry) | `cells/canvas/client/lib/network/storage.ts:6,177`; `tests/workspace.test.ts:420` |
| `STATE#<scope>` / `KEY#` / `EDGE#` / `TRAJ#` / `JOB#` / `SECRET#` | physical DynamoDB partition/sort prefixes (storage tier, not logical keys) | `dynamo-state-store.ts:9-11,36`; `substrate-table.ts:24-25`; `services/cells/cell-template.ts:78`; `cells/run/index.ts:41,55,70`; `models/index.ts` `SECRET#<provider>` (trajectory §3) |

The convention is *enforced negatively*: write-through grants and caller-writes
**refuse** reserved (`_`-prefixed) namespaces (`tests/workspace.test.ts:295,978,981`;
`tests/cell-caller-writes.test.ts:128`; `services/cells/service.ts:1339` skips
`_`-typed entries). Tending skips them by default (`includeSystem`,
`platform/runtime/state.ts:595-598`). But there is **no registry, no enum, no
single source of truth** for "what `_` prefixes exist."

### 1b. The "decoration" concept

A **decoration** is a per-`(surface, key)` fact carrying *placement / ordering*
that is separate from the domain fact itself. One fact can sit on many surfaces;
only the decoration differs ("no graduation", trajectory §5).

- `cells/canvas/client/lib/network/storage.ts:4-11` — the load-bearing definition:
  `item = fact × renderer × placement`; geometry → `_canvas/...` placement.
- `cells/lit/shared.tsx:125,141` — "appear in many documents/boards via
  per-surface ordering decorations"; "a single decoration write (no renumbering)".
- `cells/canvas/client/lib/network/crdt.ts:8` — "geometry becomes placement
  decorations."
- `splitElement` (`storage.ts:80-88`) physically splits `{domain, placement}`.

So lit's seam is `fact × renderer × seq` and canvas's is `fact × renderer ×
placement` — the **same primitive**, two surfaces (trajectory §7).

### 1c. The executor / dispatch lexicon

| Term | Meaning | Where (file:line) |
|---|---|---|
| **organ** | a bounded, serialized, IAM-isolated executor (Lambda + table + role) that emits monotonic facts back to the reef | `docs/substrate.md:111-120`; `lib/platform-stack.ts:126`; `cells/run/index.ts:6,63,156` |
| **reef** | the loose monotonic substrate the organs live in | `docs/substrate.md:120`; `docs/declarative-actions-vs-code-cells.md:88` |
| **dispatch** | the single `/@*` HTTP ingress cell that path-routes `/@<owner>/<cell>` and does the SSR-as-caller proxy | `lib/platform-stack.ts:182,218-248`; `services/cells/service.ts:104,520,558`; `cells/lit/index.ts:186-191` |
| **emit** | (a) `parc.emit(key,value)` = organ-path write via the bus, vs. (b) `ctx.events.emit(type, detail)` = EventBridge control event | (a) `cells/run/index.ts:63,70,156`; (b) `services/cells/service.ts:275,390,997` |
| **`substrate.write.requested`** | the bus event an organ emits; the workspace ingests it with pinned provenance | `lib/platform-stack.ts:127-129`; `cells/run/index.ts:70` |
| **kernel** (two senses!) | (a) the **client** kernel `@c15r/kernel` — one shared session/read-act/types module loaded by URL; (b) the conceptual **tier-1 kernel** = reviewed CDK platform core | (a) trajectory §2, `cells/kernel/client/main.ts`; (b) `docs/declarative-actions-vs-code-cells.md:111` |
| **transformer** | a declared morphism over facts (input fact(s) → output fact(s)/render) | trajectory §3, lines 112-123 |
| **tier** | the trust/capability ladder: tier-1 kernel → tier-2 cells → declarative actions; and the *executor* tiers pure/generative/code | `docs/declarative-actions-vs-code-cells.md:106-112`; trajectory §3,§0 |
| **run / exec / agent** | the code-kind verbs: `@c15r/run.exec`, ```agent``` fences | `cells/run/index.ts:156`; `docs/lit-substrate-authoring.md:62-77` |

---

## 2. Tensions

**T1 — `_prefix/` is enforced but never declared.** The convention is policed in
at least four places by independent `startsWith('_')` checks
(`service.ts:1339`, `storage.ts:84`, the grant refusals, `state.ts:595`) and a
human-maintained mental list (`_actions`, `_views`, `_renderers`, `_types`,
`_doc/`, `_canvas/`, `_messages`, `_audit`, `_contested`…). There is no
`RESERVED_PREFIXES` constant, no manifest fact, no `read("$reserved")`. A new
surface inventing `_kanban/` collides silently. **The reserved scheme is
substrate plumbing that is itself not substrate-legible** — which violates the
thesis it serves.

**T2 — the `_` glyph overloads "system" with "hidden".** `_` connotes
"private/internal" (Python, JS convention), but these keys are not private — they
are *the most public protocol in the system* (the vocabulary IS the interface,
`substrate.md:84`). `_actions/` is not an implementation detail to hide; it is
the API. The glyph fights the meaning.

**T3 — "decoration" is a weak, cosmetic word for a load-bearing concept.**
"Decoration" suggests ornament you could strip. But a `_doc/` or `_canvas/` fact
*is membership* — remove it and the fact leaves the surface. It is the
**placement of a fact within a surface's frame** — closer to *binding*,
*mounting*, *pinning*, or *staging* than to decoration. The word undersells that
placement is sovereign and consensual (canvas un-pin, trajectory §10).

**T4 — the execution lexicon is a genuinely mixed metaphor bag.** Three
incompatible metaphor families are load-bearing at once:
- **Biological/marine:** `organ`, `reef` (coherent, evocative — bounded living
  units in a shared medium; this pair *works*).
- **Mechanical/computing:** `dispatch`, `kernel`, `transformer`, `tier`,
  `emit`, `exec` (the OS/electronics register).
- The two collide: an `organ` `emit`s onto a `bus` that a `kernel` ingests, and
  the whole thing is routed by `dispatch`. We are mixing a coral reef with a
  CPU. Neither is wrong; together they have no center.

**T5 — `kernel` means two unrelated things.** The *client* kernel
(`@c15r/kernel`, a browser session/types module) and the *tier-1 kernel*
(reviewed CDK platform core) share a name and share nothing else. A reader
hitting "kernel" cannot know which without context. This is the sharpest
single naming bug in the domain.

**T6 — `emit` is two verbs.** `parc.emit` (a substrate fact write, monotonic,
provenance-attested) and `ctx.events.emit` (a fire-and-forget control event) are
the *same word for opposite tiers*: one is reef truth, one is organ choreography.
`run/index.ts:70` literally calls `events.emit('substrate.write.requested')` to
implement `parc.emit` — the word eats itself.

---

## 3. The disruptive proposal: **detonate `_prefix/`; rename it `meta:`, make it self-describing**

The destructive action: **abolish the leading-`_` reserved convention entirely.**
It is folklore enforced by scattered string checks, it overloads "hidden", and it
is invisible to the substrate. Blow it up. Incorporate the wreckage as a
*first-class, declared* namespace.

### 3a. One reserved namespace, declared as a fact

Replace `_actions/`, `_views/`, `_renderers/`, `_types/`, `_doc/`, `_canvas/`,
`_messages/`, `_audit/` with a **single `meta:` (or `sys:`) keyspace whose
sub-vocabulary is itself a `meta:registry` fact**:

```
meta:vocab/action/<id>        (was _actions/<id>)
meta:vocab/view/<id>          (was _views/<id>)
meta:vocab/render/<type>      (was _renderers/<type>)
meta:vocab/type/<type>        (was _types/<type>)
meta:place/doc/<docId>/<key>  (was _doc/<docId>/<key>)
meta:place/board/<cid>/<key>  (was _canvas/<cid>/<key>)
meta:log/message/...          (was _messages)
meta:log/audit/...            (was _audit)
meta:registry                 ← lists every prefix above, salience-shaped
```

Now `read("$reserved")` (or `read("meta:registry")`) returns the live, tended
list of structural namespaces. T1 dissolves: the plumbing becomes substrate. The
four scattered `startsWith('_')` checks collapse to one `startsWith('meta:')`
helper exported from `platform/runtime` and imported everywhere — drift killed.

### 3b. "decoration" → **"placement"** (and the family: `meta:place/...`)

Rename the concept *decoration* → **placement** (the word `storage.ts` already
half-uses: `splitElement` returns `{domain, placement}`). A placement fact binds
a domain fact into a surface's frame at a position. `fact × renderer × placement`
becomes the one item seam for *both* canvas (geometry) and lit (`seq`) — already
true mechanically (trajectory §7), now true in name. Reserve "decoration" for
genuinely cosmetic overrides (edge label/color, `storage.ts:188`).

### 3c. Heal the execution metaphor: commit to the **reef/organ** biology, demote the machine words

The marine pair (`reef`/`organ`) is the strong, coherent metaphor and it maps the
*actual* law (monotonic reef vs. serialized organ, `substrate.md:111-120`). Keep
it. Then rehome the machine words *under* it so they stop competing:

- **`kernel`** → split the collision (fixes T5). The CDK core becomes the
  **"bedrock"** (marine floor under the reef — also already the deferred AWS
  provider pun, trajectory §12); the client module `@c15r/kernel` becomes
  **`@c15r/shell`** (it is the session + read/act surface every cell wears — a
  shell, marine-adjacent, and accurate: it is the outer layer, not the core).
- **`emit`** → split the two verbs (fixes T6). Organ→reef fact writes become
  **`secrete`** (organs secrete facts into the reef — biologically exact and
  unmistakably distinct from control events). `ctx.events.emit` keeps `emit` for
  EventBridge choreography. `parc.emit(key,value)` → `parc.secrete(key,value)`.
- **`dispatch`** stays — it is the one ingress, and "dispatch" as *routing a
  request to a destination* is precise and uncontested. (Don't blow up what
  works; the strategy says incorporate, not vandalize.)
- **`transformer`** → keep; "a morphism over facts" is honest and the taxonomy
  (pure/generative/code) is the system's clearest naming win. Optionally rename
  the *executor* tiers to marine kinds later, but transformer earns its keep.
- **`tier`** → keep for the trust ladder; it is standard and unambiguous.

### 3d. How the system reincorporates the wreckage

- **Migration is additive and substrate-native.** A one-pass `tend`/`ingest`
  rewrites `_x/` keys to `meta:x/...` and supersedes the old (supersede-not-delete
  already exists, `state.ts:610`). The `meta:registry` fact is written once.
- **Surfaces follow the registry, not hardcoded prefixes.** Canvas/lit/home stop
  carrying private prefix lists; they read `meta:registry` through the shell.
  This is the exact property trajectory §9 proved for `_types`, generalized.
- **Enforcement centralizes.** The grant-refusal, tending-skip, and catalog-skip
  paths import one `isMeta(key)` predicate. One definition, one place to change.
- **Nothing in the calculus moves.** `meta:` keys are still facts; the
  reef/organ law is unchanged; `dispatch` and EventBridge are untouched
  infrastructure. The detonation is *naming and discoverability*, not semantics —
  exactly the seam the thesis says should move freely (trajectory §0).

---

## 4. Top 3 concrete recommendations

1. **Collapse `_prefix/` into one declared `meta:` namespace with a
   `meta:registry` fact, and export a single `isMeta(key)` predicate from
   `platform/runtime`.** This kills the scattered `startsWith('_')` checks
   (`service.ts:1339`, `storage.ts:84`, the grant refusals, `state.ts:595`),
   makes the reserved scheme `read`-able (`read("$reserved")`), and stops
   `_kanban/`-style silent collisions. Highest leverage, lowest semantic risk.

2. **Fix the two literal homonyms first, even if you adopt nothing else:**
   rename the *client* `@c15r/kernel` → `@c15r/shell` (T5), and split the
   `emit` verb so organ→reef writes use a distinct word (`secrete`) from
   control-event `emit` (T6). These two collisions actively mislead readers of
   `cells/run/index.ts:70` and any doc that says "kernel"; they are cheap to fix
   and pay off immediately.

3. **Rename the concept "decoration" → "placement" across canvas + lit**, and
   reserve "decoration" only for cosmetic edge overrides. `splitElement` already
   returns `{domain, placement}` (`storage.ts:80-88`); the comments in
   `crdt.ts:8`, `shared.tsx:125,141`, and `storage.ts:4-11` should follow so the
   one item seam (`fact × renderer × placement`) reads identically on both
   surfaces.
