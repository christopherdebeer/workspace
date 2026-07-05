<!-- Preserved verbatim from Val Town c15r/workspace, entries.id = b3fe258368e44b
     (parc.land substrate: kb/b3fe258368e44b). Val-Town-era tool references;
     source material for the substrate-native weave machine. -->

# protocol: weave

## Purpose
Reduce the count of unlinked entries in the substrate by proposing and creating explicit `link` relations where the substrate's own signals (shared tags, content similarity, type affinity) indicate a real connection. The substrate's value comes from connective tissue between entries; entries with no links aren't participating in salience, aren't findable by navigation, and tend toward orphan status.

## Trigger
- Scheduled (daily, via the dispatcher routine)
- Or manually, via `workspace_run_start(routine="protocol-execute", protocol=<this_entry_id>)`
- Skip if fewer than 3 entries are currently unlinked (substrate is well-woven). NOTE per first-run observation: exclude entries <24h old — a just-created protocol entry is "unlinked" only because nothing has had time to reference it, not because it's orphaned.

## Steps
Specific about outcomes, underspecified about exact queries — use judgement.

1. **Identify candidates.** Find entries that are active (not superseded) and have no explicit links (inbound or outbound). Exclude `type=run` and `type=log` — those aren't meant to be part of the knowledge graph. Prioritise by age (older = more likely to be genuinely orphaned vs just new).

2. **For each candidate, search for its neighbourhood.** Use `workspace_links` to inspect implicit links (shared-tag co-occurrence). Use `workspace_search` on the candidate's content and tags. You are looking for entries that are *already related in the substrate* but haven't been linked explicitly. NOTE per first-run observation: the `implicit` array returned by `workspace_links` is currently always empty — fall back to `workspace_search` + thematic reasoning until the substrate-level gap is fixed.

3. **Propose links.** For a candidate, identify at most 3 link targets that meet at least one of:
   - 3+ shared tags (strong co-occurrence signal)
   - Explicit mention in content (one entry references the other by name/phrase)
   - Strong type-affinity pattern (e.g. a `decision` that implements a `concept`; a `pattern` that operationalizes a `principle`)

4. **Choose the link relation.** Don't default to `related`. Pick the most informative from the vocabulary: `depends-on`, `supersedes`, `contradicts`, `refines`, `implements`, `inspires`, `unifies`, `grounds`, `formalizes`, `operationalizes`, `motivates`, `extends`, `produces`, `uses`. If nothing stronger than `related` fits, prefer not linking — weak links dilute the graph.

5. **Create links.** Call `workspace_link` for each accepted proposal. Record each linked entry id as an artifact.

6. **Budget.** Aim for 5–15 new links per run. Fewer if high confidence can't be maintained; do not manufacture links to hit a number.

## Success criteria
- Unlinked-entry count decreased, or honestly reported as "no high-confidence links available" with the specific candidates examined
- Every link created has a non-`related` relation, OR a documented reason in the summary for why `related` was the right choice
- No false links — a link you wouldn't defend if asked "why is X related to Y?" is worse than no link

## Invariants (do not violate)
- Never `supersede` entries during weaving. This protocol only adds links.
- Never modify or delete existing links. A weaker link can coexist with a better one.
- Do not link two entries whose connection is purely lexical (they happen to share a word) without semantic justification.
- If you cannot find the candidate's id in a later step, fail — do not invent.

## Artifacts
- Entry ids of any *new links created* (report via `workspace_run_complete` artifacts; they're linked to the run via `produces` so later runs can audit this run's work)
- If the summary reveals a systematic gap (e.g. "I kept wanting relation type `X` but it's not in the vocabulary"), flag it in the summary — that's a pattern worth surfacing to the human.

## Self-improvement
If this protocol produces persistently bad or sparse links, supersede it. The summary of each run should make the next run (or the human reading them) smarter about what's working.
