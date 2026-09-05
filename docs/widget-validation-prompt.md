# parc.land conversation-card validation prompt (ADR-0034 → 0038)

> **The card is DISABLED pending rework.** The gateway serves no `ui://parc/card`
> and advertises no widget binding while `MCP_UI_CHANNEL` is unset, so this prompt
> has nothing to audit — set `MCP_UI_CHANNEL=on` on the gateway Lambda first.

Paste the block below into a **fresh claude.ai chat connected to the parc.land MCP connector**
(mobile *and* desktop, separately — host capabilities differ). It exercises every render
surface and interaction the card now supports and records a structured audit fact.

---

You are auditing the **parc.land conversation card** — the MCP-Apps widget bound to the `read`
tool (it renders the `structuredContent` of substrate reads, and is interactive: drills, acts,
graph, links, and grant escalation all happen in the card via host-proxied calls).

For **each step**: invoke the call, look at the rendered card (not just the JSON), and decide
**pass / warn / fail** with a one-line note on *expected vs actual*. Keep going on failure.
Many checks are about the **rendered widget**, so describe what you actually see.

**First, the meta-check:** every card has a tiny footer line `host bridges · ctx ? · msg ? ·
sampling ?`. **Record those three ✓/✗ verbatim** — they tell us which view→model bridges this
host honours (ADR-0037). This is the single most important readout.

### A. Identity & overview
1. `whoami` — identity card: user + scope chips. Note the **host bridges** footer values.
2. `read("workspace.recall")` (no args) — overview: salience bands, **By type** / **By prefix**
   capped to ~6 rows each with a **"+N more"** toggle (tap it — does the rest reveal in place,
   no new model turn?), plus a Focus list of clamped cards. Verify it is **glanceable**, not a
   full dump.

### B. Typed lists, clamping, progressive disclosure
3. `read("workspace.query", { type: "decision", limit: 12 })` — typed cards, real markdown
   bodies. Confirm bodies **clamp** (a "show more" appears only on long ones; short ones have
   none) and the list caps at 5 + "+N more". Each card has a neighbours **↹** button.
4. Tap **show more** on a clamped card → expands in place. Tap a **+N more** → reveals the rest.

### C. Search (semantic) — ranking & nuance
5. `read("workspace.query", { text: "progressive disclosure of the substrate", limit: 8 })` —
   ranked cards each show a **similarity bar** + score (not a bare number). If the deployment
   has no vector backend, a **degraded hint** line should show. Verify ordering looks ranked.
6. On a search result card, tap **↹ neighbours** — it must open the neighbours of the **correct
   fact** (not an array-index artefact). This is the Inc-6 mis-key fix.

### D. Single fact, docs, backlinks
7. `read("workspace.peek", { key: <any fact key from step 3> })` — single full card (no clamp).
8. Pick a **doc**: `read("workspace.query", { prefix: "doc:", limit: 5 })`, then
   `read("workspace.peek", { key: "doc:<one>" })` — below the metadata it should **assemble the
   document's ordered blocks** ("Document (N blocks)"). Also look for a **"Linked from"**
   (backlinks) section on facts that have inbound references.

### E. Neighbours & back-navigation
9. From any fact, tap **↹** — a neighbours view with **Outbound / Inbound** drillable rows
   (rel + neighbor label). It must render the **edges even when no neighbor entries resolve**
   (no raw-JSON dump — the prior critical bug). Tap a row → peeks that neighbor.
10. After drilling, a **←** appears in the header — tap it → returns to the previous view instantly.

### F. Links (wiki + markdown)
11. Find a fact whose body has a `[[wikilink]]` or a markdown link (e.g. a lit `doc-block`). In
    the card, `[[target]]` should render as a **link** (not literal brackets). **Tap it** → it
    should navigate **in-card** (peek the target), not open a browser tab. External `http(s)`
    links should be offered via the host's open-link, not break the frame.

### G. Graph mode
12. On any list result (recall focus, a query, or a search), tap **"⊹ view as graph"** → a
    node-link **graph** (mermaid) of the result set's edges + one-hop neighbours. Tap ← to return.
13. `read("$graph")` — the Reference graph as a diagram (authored solid, derived
    dashed), capped with an "N of M" note. `$graph` is the SKIM (a bounded page);
    `read("workspace.edges", { limit, cursor })` pages the whole projection.

### H. Inboxes & triage (the operational surfaces)
14. `read("workspace.attention")` — triage: **stale / unlinked / dangling** counts + sections;
    stale/unlinked items drill (peek / neighbours).
15. `read("workspace.grantRequests")` — **incoming** requests with **approve / deny** buttons +
    an **answers** list. (Don't approve unless you mean it.)
16. `read("workspace.changes", { sinceSeq: "head" })` — head seq; then `{ sinceSeq: <n> }` for a
    drillable event feed.

### I. Authority & registries (generic structured rendering — no JSON dumps)
17. `read("$grants")` — authority surface: active scope / ceiling chips, slice, grant counts.
18. Each of these must render as **readable list sections**, never a raw `<pre>` JSON blob:
    `read("workspace.actions")`, `read("workspace.views")`, `read("workspace.subscriptions")`,
    `read("workspace.groups")`, `read("workspace.shared")`.
19. `read("$catalog")` and `read("$types")` — structured, skimmable (not a wall of JSON).

### J. Suggestions — informed ratification (ADR-0032/0037)
20. `read("workspace.suggestions")` — a ratify queue: top-N pairs (capped + "+N more"), each with
    a **👁 peek** (tap → both facts' content inline, so you can judge the relationship) and
    `refines/grounds/duplicates/…` chips.
21. Tap **👁 peek** on one, read both, then tap a rel chip → it should **ratify** (write the edge)
    and **re-render the queue in place**. Note whether the **agent becomes aware** of the
    ratification on your next message **without you re-reading the substrate** (this is the
    `updateModelContext` bridge — only works if `ctx ✓` in the footer).

### K. Grant escalation (ADR-0038 Inc 5)
22. Trigger a denial: try a `read`/`act` on a target outside your active scope (e.g. a
    `platform:admin`-gated read like `read("platform.logs")` if you lack it, or any cell tool you
    haven't been granted). The card should show an **"Access needed"** panel — **"widen session"**
    (if within your grant ceiling) or **"escalate (passkey)"** + a **retry** button — not a raw
    error. If "widen session" appears, tap it → it should widen and **auto-retry**.

### L. Sizing & chrome
23. Across all of the above: confirm cards **grow to content** (no clipping, no inner scrollbar
    fighting the chat). Note any surface that clips.

### Record the result
Write your findings to the substrate as one fact:

`act("workspace.remember", { key: "widget-test/<today>", type: "audit", tags: ["widget-test"],
value: { scope, host: { platform, ctx, msg, sampling }, pass, warn, fail,
results: [ { step, surface, result, note } … ], root_bugs: [...], warnings: [...],
sizing_verdict, summary } })`

Set `host.platform` to web or mobile. Be specific in notes (expected vs actual). List every
**fail** and **warn** with a concrete repro. Finish with a one-paragraph `summary`.
