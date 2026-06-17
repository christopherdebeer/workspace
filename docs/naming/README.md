# Naming across parc.land — a swarm synthesis

> Seven parallel subagents rambled through one naming domain each, every one
> seeded with a different **Oblique Strategies** card (Eno/Schmidt, drawn live
> from `https://obs.parc.land`) to force divergent angles. This README is the
> synthesis: the patterns that recurred across domains, the places the agents
> *disagreed*, a prioritized action list, and a resolution of the `cell`-overload
> question that kicked this off. The seven source docs are the evidence; this is
> the read across them.

| # | Domain | Oblique card |
|---|---|---|
| [01](01-cell-overload-and-core-nouns.md) | `cell` overload + core nouns | *Overtly resist change* |
| [02](02-fact-model-ontology.md) | Fact model & type ontology | *Give way to your worst impulse* |
| [03](03-links-graph-relations.md) | Links / graph / relations | *Remove specifics, convert to ambiguities* |
| [04](04-salience-attention.md) | Salience & attention | *What is the reality of the situation?* |
| [05](05-provenance-capability-consent.md) | Provenance, capability, consent | *The inconsistency principle* |
| [06](06-reserved-keys-decorations-dispatch.md) | Reserved keys, decorations, dispatch | *Make a sudden, destructive action; incorporate* |
| [07](07-product-cell-branding-voice.md) | Product / cell branding & voice | *Consult other sources — promising/unpromising* |

---

## 1. The patterns that recur across every domain

Seven independent rambles, and the *same* four failure modes surfaced in domain
after domain. That convergence is the real finding — these aren't local nits,
they're system-wide habits.

### Pattern A — One short word, N referents (homonyms)
The dominant disease. Every agent found it:

| Word | Referents | Source |
|---|---|---|
| `cell` | deployable unit · lit fragment · canvas element · control-plane · "room" | 01 |
| `type` | content-class · surface-role · key-prefix namespace · (JSON-Schema `type`) | 02 |
| `scope` | OAuth ceiling · Σ authority boundary/slice · resource pattern | 05 |
| `grant` | OAuth ceiling (`grantScopes`) · substrate share (`Grant`) | 05 |
| `owner` | **target slice** (dispatch) · **cell author** (organ handler) | 05 ⚠️ |
| `writer` | username · `@owner/cell` address | 05 |
| `attention` | score term (recent reads) · maintenance read (stale/unlinked) | 04 |
| `kernel` | client session module · reviewed CDK core | 06 |
| `emit` | organ→reef fact write · EventBridge control event | 06 |
| `salience` | subsystem name · default lens · (informally) the score | 04 |

The fix is the same shape every time: **split into two honest words, or add a
typing field** (`writerKind`, `kind`+`role`) so consumers stop sigil-sniffing.

### Pattern B — Vocabulary enforced as folklore, not declared as data
The system's own thesis is *"the vocabulary is the protocol, declared as data"*
— honored for `$types`, **violated** for everything else:
- **rels** have no `$rels` registry; the relation set is discovered only by
  grepping call sites (03).
- **reserved `_` prefixes** are policed by scattered `startsWith('_')` checks in
  ≥4 files, with no `$reserved`/registry fact (06).

Two agents independently proposed the identical cure: **mirror `$types`** with a
discoverable registry (`$rels` in 03; `$reserved`/`meta:registry` in 06). This is
the highest-confidence convergent recommendation in the whole swarm.

### Pattern C — Names that lie about behavior (metaphor > reality)
Agent 04's grounding lens generalized: several names promise a grander
computation than the code performs.
- `recall` dumps the whole shaped slice — the opposite of cued recall (02).
- `centrality` computes local *degree*, not any graph-centrality measure (04).
- `velocity` is a directionless write-magnitude, admittedly redundant (04).
- `tend`/`tending` only *reports*; it never cultivates (04).
- `decoration` is load-bearing *membership/placement*, not ornament (06).
- `remember`/`recall` sell a memory metaphor the store breaks — **nothing
  forgets** (02).
- `_meta.salience` is a read-time *opinion* sitting in the same envelope as
  immutable provenance (`createdAt`/`writer`) — flagged independently by 02 *and*
  04.

### Pattern D — Metaphor families that half-cohere
Cellular biology (`cell`, `organ`, `substrate`, `membrane`, `tending`) is the
generative spine and it *works* (07). But it competes with a machine register
(`kernel`, `dispatch`, `emit`, `transformer`) and — the live clash — **two
biomes**: marine `reef` vs alpine `park`/pines (the shipped icon). See §2.

---

## 2. Where the agents disagree (genuine forks for a human)

The swarm was seeded for divergence, and it delivered real disagreements — these
are decisions, not bugs:

- **Which biome wins, reef or park?** Agent 06 (from inside the execution tier)
  wants to *commit to marine*: keep `reef`/`organ`, and pull the machine words
  into the sea — `@c15r/kernel`→`@c15r/shell`, the CDK core→`bedrock`,
  `emit`→`secrete`. Agent 07 (from the brand surface) wants to *commit to park*:
  it's the shipped identity (icon, palette, field-guide), so demote `reef` to an
  internal codename that never names a cell/tool. **Both agree there should be
  one biome; they pick opposite ones.** This is the single biggest open call.
- **Rename vs freeze, generally.** Agent 01 (lens: *resist change*) is the
  conservative counterweight — it argues most names are load-bearing contracts
  (MCP target stability, promotion-as-copy) and pushes back on renaming anything
  with an external surface. Agents 02/04/06 (lenses: *worst impulse*,
  *reality*, *destruction*) push the other way. The healthy reading: **rename
  freely where addressing is by key (cheap, internal); freeze where the name is
  an MCP `target` or an IAM/storage contract.**
- **`recall`'s replacement.** 02 floats `recall`→`slice` or `view`; 01 wants
  `slice` reserved for "a reader's projection," `scope` for the authority
  boundary. These actually compose (recall *returns* the slice-projection) — but
  someone has to pick the word.

---

## 3. Prioritized action list (synthesized across all seven)

**P0 — actually wrong today, not just verbose (fix regardless of philosophy):**
1. **Provenance direction is inconsistent across cells.** lit writes
   `source --produces--> output`; viewers writes the inverse `produced-by`;
   canvas writes a third synonym `derived-from`. No traversal can read provenance
   uniformly. Pick one canonical arrow (`produces`), migrate the other two. (03)
2. **`RequestedWrite.owner` collides with cell-author `owner`** in adjacent
   dispatch/organ code — the wrong reading is a cross-slice write-authorization
   hazard. Rename to `targetSlice`. (05)

**P1 — declare vocabulary as data, and type instead of sigil-sniff:**
3. Add **`$rels`** registry + a thin canonical rel set, mirroring `$types`. (03)
4. Collapse `_prefix/` into one declared namespace with a **`$reserved`/registry**
   fact and a single `isMeta(key)` predicate. (06)
5. Add **`writerKind`** (`user|cell|agent`) to kill `@`-sigil sniffing (05); split
   `type` into **`kind` (content) + `role` (machinery)** (02) — same move.

**P2 — honesty renames (names should match the math/behavior):**
6. `centrality`→`connectedness`/`degree`; `velocity`→`churn` (or drop). (04)
7. Collapse `score`+`salience`-lens into one field: **`_meta.salience` is the
   number**; document it as a read-time *view*, not provenance. (02, 04)
8. Split `attention` (score term → `interest`; maintenance read → `health`);
   rename `tend`→`audit` until it actually cultivates. (04)
9. `decoration`→**`placement`** across canvas + lit (one `fact × renderer ×
   placement` seam). (06)
10. Fix the two literal homonyms: `@c15r/kernel`→`@c15r/shell`; organ-write
    `emit`→a distinct verb. (06)
11. Rename `recall` (it isn't recall); reserve `view` for the declared-projection
    noun. (02)

**P3 — brand voice (deliberate, low mechanical risk):**
12. Rename **`reef-writer`** — it leaks an internal metaphor into a tool `target`,
    the exact sin `forge→cells` corrected. (07)
13. Make the **biome decision** (§2), then write a one-page **brand bible**
    consolidating the already-implicit rules (noun+bare-verb providers; scenery
    stays in copy; one canon biome). (07)
14. Decide **`lit`** deliberately — keep (lineage-true to `dotlit`, documented) or
    rename to `docs`/`pages` (search-colliding with lit.dev). Don't drift. (07)

**Frozen — do not rename (load-bearing contracts):** the deployable `cell` /
`@owner/cell.tool` targets, `workspace`/`canvas`/`models`/`run`/`viewers`,
`STATE#<owner>`/`LeadingKeys`, the `@owner/cell` scheme itself. (01, 07)

---

## 4. Resolving the original question: the `cell` overload

This swarm grew out of `docs/lit-substrate-authoring.md` §7.4 — *a "cell" is both
a deployable app and a lit document fragment.* Agent 01's answer, endorsed here:

- **Freeze the deployable `cell` (C1).** It is the substrate's signature noun and
  a hard contract — MCP target stability (`@owner/cell.tool`) and promotion-as-
  copy both depend on it. Renaming it taxes the exact stability the substrate
  sells.
- **Rename lit's fragment (C2): `cell:` → `fragment:`** (`type: 'fragment'`), with
  `cell:` kept as a read alias (lit already has the legacy-`blocks[]` fallback
  pattern). C2 is addressed by *key*, not by a `cell.tool` target, so the MCP
  surface is untouched — this is the cheap, targeted cut.
- **Reject `entry`** (collides with `state.ts`'s foundational `Entry`/`EntryMeta`)
  and **`block`** (already retired in the lit migration). Front-runner
  `fragment`; second choice `passage`.

So the head noun "cell" stays where it has a contract, and the one meaning that's
cheap to move (the key-addressed fragment) moves.

---

## 5. How to read this

This is *exploration*, not a mandate — the rambles were seeded to be divergent
and a couple are deliberately provocative (the *worst impulse* and *destruction*
lenses). The durable signal is the **convergence**: when four agents working
different domains independently land on "split the homonym" and two independently
land on "declare the vocabulary as data," that's the system telling you where its
naming actually hurts. The P0 items are the only ones that are *wrong* rather than
*verbose* — everything else is a judgement call, and §2 marks the ones that are
genuinely yours to make.
