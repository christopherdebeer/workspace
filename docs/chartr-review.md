# chartr, read at the source

*2026-07-30 · from a fresh clone of [rengwu/chartr](https://github.com/rengwu/chartr)
(Go + Svelte, ~16 ADRs, dogfooded — its own `.plan/` holds the maps that built it).*

chartr is an agent multiplexer with "a map of the work": a plan lives as
markdown tickets under `.plan/maps/<slug>/`, renders as a star-map, and you
spawn an agent session against the frontier — the open, unblocked tickets.
The session opens with the map body, its ticket, and its blockers' answers
already in the buffer.

The overlap with parc.land is not cosmetic. Both render work as a star-map.
Both have a tasks-with-dependencies vocabulary. Both hand agents context at
spawn. The differences are where the learning is.

## The ideas, and what they map to here

**Status is derived, never stored.** A ticket is `resolved` because its
`## Answer` section exists with prose under it — not because a status field
says so. "A fact copied has two homes, and goes stale in one of them." Their
frontier is one function over the files; it survives a crash because there is
nothing in memory to lose. Our `@c15r/tasks` stores `status: todo|doing` as a
field. The tonight-adjacent version of this bug: decompose batons needed
delete-timer TTLs because their state could orphan. Derived state can't
orphan.

**Never write the count down.** Progress is counted from the tickets when
asked, wherever asked. "Four of nine resolved is true for a week and wrong
forever after." Dated handoffs are exempt — history never claimed to be
current. Our docs violate this constantly; every stale count in
`docs/` that docs-sync then embeds as authoritative is this bug.

**The map is an index.** It gists a decision in one line and links the ticket
that holds the detail. A ticket's facts (type, edges, status) are read from
the ticket, never copied into map prose. This is the anti-restatement
discipline our trajectory docs half-follow.

**The context bundle.** Assembled fresh per spawn: map body, the ticket, its
blockers' answers, the glossary, the skill manifest. Never accumulated. Their
ADR-0005 rejects an agent-learnings store outright: "a claim no human ever
gated becomes gospel for every session after it." parc *is* the rejected
alternative — an accumulating store — but with the gates they lack:
provenance, supersede, salience decay, ratification. So the steal isn't
"no store"; it's the bundle. `tasks.next` returns a task today; it should
return an orientation — goal body, the task, its dependencies' outcomes, the
type vocabulary. That's the membrane-probes ambient-frame plan taken one step
further than the tease.

**The glossary with Avoid-lists.** Their CONTEXT.md defines every term and
lists the words *not* to use ("_Avoid_: plan, effort, graph, board"), and it
ships in every context bundle. Cheap, and it visibly kept 16 ADRs
terminologically coherent. We have naming drift and no glossary fact.

**`undermined_by`.** A second edge type beside `blocked_by`: a later ticket
can undermine an already-resolved decision without reopening it. Doubt gets
provenance instead of living in someone's head. Our contested-pairs backlog
wants exactly this edge.

**Out-of-scope never satisfies a dependency.** Their closed statuses split:
`resolved` unblocks dependents, `out_of_scope` closes the ticket but "is not
a decision on the route" and never satisfies a `blocked_by`. Our tasks cell
treats `cancelled` as satisfying a dep. Theirs is the sounder default — a
cancelled blocker didn't answer the question the dependent was waiting on.

**Names over ids.** "A wall of `03, 04, 05` is illegible; names read at a
glance. The id doesn't vanish — it rides *inside* the name." Our surfaces
lead with keys (`task/consolidation/mro5zqkugqq3`). Every human-facing list
should lead with the title and wrap the key in it.

**Waiting-on-you as a first-class signal.** Their sidebar flags which session
is blocked on the operator, derived from what the agent draws. Our
`workspace.attention` reports structural debt (stale, unlinked, dangling) but
never separates "waiting on you" from "background rot" — the ratification
queue is waiting-on-human and nothing says so.

**Tickets sized to a session, typed by work shape.** `grilling`, `research`,
`prototype`, `task` — the type picks the skill and shapes the payload.
"Plan, don't do": planning maps produce decisions, and "the pull to just do
the work is usually the signal you've reached the edge of the map." Our
tasks are untyped and unsized.

**Amendments that name the forfeit.** Their ADR-0004 amendment withdraws a
review gate and says plainly: "The containment is forfeited, knowingly...
the cut exits the judgment business." Recording what a simplification gives
up, in the ADR it amends, is a discipline worth copying as-is.

## Worth stealing, in order

- [ ] The glossary: `docs/glossary.md` with Avoid-lists, docs-sync'd so
  agents retrieve it; injected via the recall hints. Cheapest, highest-leverage.
- [ ] The context bundle: `tasks.next` returns orientation (goal, task,
  dependency outcomes, vocabulary), not a bare task. Extends the
  ambient-frame plan (Inc 2) rather than replacing it.
- [ ] Names-over-ids in every human-facing surface (attention, ambient frame,
  palette rows).
- [ ] `undermined_by` as an edge in the tasks/goal vocabulary, aimed at the
  contested-pairs backlog.
- [ ] Split `workspace.attention` into waiting-on-you vs background debt.
- [ ] Cancelled-satisfies-a-dep: flip to chartr's rule, or make it per-edge.
- [ ] Derive task status where an artifact can carry it (a task with a
  `produced` edge to its outcome *is* done — ties into the decompose-seam
  `produced` edge already on the list).
- [ ] Ticket types → skill selection at spawn, when agent-spawning lands.

## Where we differ on purpose

- chartr keeps no store; the map is the memory. parc's whole thesis is the
  store — with provenance and decay as the gate chartr solves socially
  ("the operator is present"). Not a gap on either side; different bets on
  where judgment lives.
- chartr's unit of serialisation is one working tree per space, sessions
  serialised. parc is concurrent by design (writers, provenance, supersede).
- Their skills are files shadowed space → user → built-in; ours are heading
  toward facts with grants. Same need, different substrate — the shadowing
  *resolution order* is the part worth remembering.
