# ADR-0049 — Capabilities in context: the catalog shaped by what you're holding

- **Status:** proposed 2026-07-02 (design settled; implementation next increment). Companion to
  ADR-0048 — the same audit, applied to the CAPABILITY surface instead of the fact surface.
- **Depends on:** ADR-0029 R1 (inline type affordances on reads), ADR-0048 (shaping vocabulary),
  ADR-0044 L1 (declare once, project everywhere).

## The gap (what the ADR-0048 audit didn't cover)

`$catalog` is tiered but not **contextual**: 20.4 KB grouped menu, 135.8 KB with every schema —
always the WHOLE verb surface, regardless of what the caller is looking at. Meanwhile the
capability-by-type projection already half-exists:

- **ADR-0029 R1** infects every read with a `types` map — but it stops at DECLARED HANDLERS
  (open/edit/render/create as surfaces/hints). It cannot say "`@c15r/machine.step` exists, takes
  `{key, input}`" for a machine fact.
- **`$cells`** (7.4 KB) knows each cell's tools and published types; **`$types`** (34 KB) knows
  each type's manager. The join `fact → type → manager → that cell's tools+schemas` exists as
  data, but every consumer must make three reads and correlate by hand.

So the field computer downloads 135.8 KB of everything to offer commands, and the palette's
"selection-seeded commands" follow-up (ADR-0047) would have to re-derive the join client-side.

## Decision (to implement)

1. **`$catalog {for: <factKey>}` / `{forType: <type>}`** — the gateway resolves the fact's type
   signals (the same `typeSignals` ladder the render floor uses), follows type → manager cell, and
   returns a ~3–8 KB CONTEXTUAL menu: the type's declared handlers, the managing cell's tools
   (WITH schemas — this is the escalation tier, small because it's scoped), and the generally
   applicable workspace verbs (peek/neighbors/link/remember…). One read answers "what can act on
   this?".
2. **Types declare verbs, not just surfaces** — a type declaration may name cell tools as
   handlers (e.g. `_types/machine.handlers.step → { tool: "@c15r/machine.step" }`). R1's inline
   `types` map and `$catalog {for}` both project from that SAME declaration (L1): declare once in
   `types.json`, and the affordance appears on reads, in the contextual catalog, and as a
   palette chip.
3. **Palette adoption** — selecting a graph node reads `$catalog {for: key}` and seeds the
   context panel with runnable commands (the ADR-0047 follow-up, substrate-backed instead of a
   client heuristic; forms ride the existing ui://form → SchemaForm floor).

## Non-goals

- No new authority: the contextual catalog is a FILTER over what the token could already call —
  shaping is presentation (ADR-0048), authority only narrows (L2).
- No per-consumer catalog dialects: one `for`/`forType` argument, same entry shape as today's
  catalog (L4).
