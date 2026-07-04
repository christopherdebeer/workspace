# Canvas stock-take — the cell and its place beside the substrate

*2026-07-04 · after the hardening cycle on `claude/parcland-canvas-cell-bugs-8ki8du`
(lifecycle correctness, authored-only board, palette search, park polish, white-board
refinement). Companion to `docs/canvas-cell-review.md` (the defect-level review);
this is the architecture-level reading. The actionable half lives in ADR-0053…0057.*

## Thesis

The founding decomposition — **item = fact × renderer × placement** — is right and
substrate-native. But the implementation carries two souls: a **whiteboard app**
(minted `el-*` elements, arrows, undo, blend modes, scripts-in-content) and a
**spatial lens over the workspace** (facts from anywhere, salience, frames, expand,
semantic search). Every product decision of this cycle — authored-only edges,
explicit positioning, the tray over the force field, the white board, prose titles —
moved toward the lens. The whiteboard vestiges are now cost without direction.

## What the bug record proves

The catastrophic class — cross-board supersede, the boot write storm that throttled
DynamoDB, lost membership tags, two-tab revision ping-pong, self-echo polling — were
all one failure: the client's hand-rolled shadow of substrate state (`lastWritten`,
`lastEdges`, `factMeta`, priming, echo windows) drifting from truth. The canvas
reinvented a sync engine in module-level Maps; every seam was a data bug. The
substrate has revisions, seq, and a change feed — but no client SDK that owns
"project this query into live local state; stage writes back durably."
**→ ADR-0053: one sync seam in the kernel; cells become renderers.**

## Membership-as-tag is overloaded

`canvas:<board>` as a tag on the member fact means *viewing a fact mutates it*:
revision churn on facts agents own, write-permission coupling, the open→ self-link,
and tag-loss = the fact silently leaves the board. The placement fact
(`_canvas/<cid>/<key>`, ADR-0046) is already a complete membership signal that lives
in board-space. **→ ADR-0054: membership by placement; member facts untouched.**

## The feed doesn't scale past one attentive user

Live-sync tails the *global* change feed and filters client-side; board load scans
all of `workspace.links`; one user's board opens hit DynamoDB throughput limits.
Agents write constantly. Every open surface pays for the whole workspace.
**→ ADR-0055: server-scoped change feeds.**

## The renderer ladder is the strongest idea and the least protected

fact → typed renderer → declared `ui://` is the substrate's answer to "apps". But
renderer facts are stringly-eval'd source with no contract or version pinning (the
machine renderer silently drifted from the machine's data shape → invisible
elements), and `executeScriptElements` runs `new Function` over element *content* on
a board that renders agent-authored facts. **→ ADR-0056: a renderer contract;
content scripts retired.**

## Three concepts, one idea

Boards (tag membership + placements), views (`_views/` query + render), frames
(regions + tours) are three answers to "a saved way of looking." `?view=` boards
already gesture at the merge. **→ ADR-0057: a board is a view whose render is
spatial; a frame is a camera over it** — and (owner direction, 2026-07-04)
**groups join the same family as first-class member-collection facts** — a frame
is a group with a camera. Blend modes and rotation are kept: they are expressive
spatial-authoring surface, not vestige. The pruning list narrows to what is
actually dead (unreachable group-handle stubs, `versions`, legacy content-script
execution — the latter via ADR-0056).

## What is earned and must be kept

SSR + hydrate boot; the crash discipline (flight recorder, geometry healing, paint
budgets, gesture parking); supersede-never-delete provenance; the unified bottom
sheet; the headless-repro harness with per-fix checks. These are culture made
durable — the ADRs above must not regress them.

## Order of bets

1. ADR-0053 — kernel sync/outbox (eliminates the bug class, not instances)
2. ADR-0054 — membership by placement (makes the integrity class unrepresentable)
3. ADR-0055 — scoped change feeds (scale floor for every surface)
4. ADR-0056 — renderer contract, content scripts retired (the security/drift door)
5. ADR-0057 — boards/views/frames consolidation + vestige pruning (direction)
