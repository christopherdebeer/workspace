# ADR-0037 — Closing the loop: widget → agent awareness (MCP Apps view→model bridges)

- **Status:** Accepted — **Increment 1 (capability probe + `updateModelContext` bridge on widget acts) shipped.**
- **Date:** 2026-06-27
- **Depends on:** ADR-0034 (MCP Apps conversation surface; the card as host-proxied MCP client), ADR-0036
  (interactive, progressive widget — drills/ratify via host-proxied `tools/call`), ADR-0032 (ratify), ADR-0033
  (progressive disclosure).

---

## Problem

The conversation card (ADR-0034/0036) is an MCP client to the host: its drills (`read`) and ratify/touch
(`act`) are proxied widget→server and the **results return to the widget only — they never enter the model's
context.** That is the whole point of progressive disclosure (the human expands in place at *zero* token cost,
*no* model turn). The flip side, surfaced in the 2026-06-27 live audit: when a human **ratifies a suggestion**
or drills in the card, **the agent is blind to it** — its only recourse is to re-`read` the substrate to
discover what changed. A decision made in the UI does not reach the conversation.

## What the spec actually provides

Reading the `@modelcontextprotocol/ext-apps` SDK (`app.d.ts`), wire schema (`generated/schema.json`), and
spec types (`spec.types.d.ts`) confirms three first-class **view → conversation** bridges, each gated by a
host capability advertised at the `ui/initialize` handshake and exposed via `app.getHostCapabilities()`:

| Wire method | SDK call | Effect on the agent | Immediate turn? | Capability gate |
|---|---|---|---|---|
| `ui/update-model-context` | `updateModelContext({content, structuredContent})` | Context the model sees **on its next turn**; host defers it until the next user message. **Last-write-wins** (each call overwrites). | **No** — silent awareness | `hostCapabilities.updateModelContext` |
| `ui/message` | `sendMessage({role:"user", content})` | Adds a message to the thread → model responds **now**. | **Yes** | `hostCapabilities.message` |
| `sampling/createMessage` | `createSamplingMessage({messages, …, tools?})` | Widget asks the host's model for a completion; result returns **to the widget**, not the thread. | n/a (widget-drives-model) | `hostCapabilities.sampling` |

The SDK documents the canonical compound pattern: `updateModelContext({…bulk state…})` then optionally a brief
`sendMessage({…trigger…})` — offload bulk to context, send a short prompt.

So the agent's blindness is **by design, and closeable**: widget mutations are silent *unless the widget
explicitly bridges*. We ship none of these today and probe none — so we also can't tell which bridges a given
host (claude.ai web vs mobile) actually honours.

## Decision

Close the loop in two moves, smallest first:

**(a) Probe host capabilities.** On connect, capture `app.getHostCapabilities()`, `sendLog` it (gated on
`logging`), and surface a subtle one-line `host bridges: ctx · msg · sampling` diagnostic in the card footer.
This answers *empirically* which view→model bridges the host supports, instead of guessing — the prerequisite
for everything else.

**(b) Bridge widget decisions → model context.** After a successful widget `act` (ratify/touch/link) — and as
a lighter "the human is looking at X" ambient note on drills — call `updateModelContext` with a **compact
structured note** (`structuredContent` for machine-readability + a one-line `text` gloss): e.g. *"User ratified
`el:x` —refines→ `el:y`; edge written."* The agent is then aware on its next turn with **no substrate re-scan
and no extra model turn now**. Strictly gated on `getHostCapabilities()?.updateModelContext`; degrades silently
when absent (e.g. a host that doesn't support it — the widget still works exactly as before).

`sendMessage` (immediate turn) is **opt-in only** — reserved for an explicit "↗ ask agent about this"
affordance, never automatic, so the widget never hijacks the conversation. `createSamplingMessage` is out of
scope for now (the widget driving its own sub-completions is a separate capability).

## Design notes

- **Last-write-wins** is fine for our use: the model only needs the *most recent* salient action. Acts happen
  after navigation, so the act note naturally supersedes the ambient "viewing" note in the single context slot.
- **No new authority.** `updateModelContext` carries no scope — it's a note *to the model*, not a substrate
  write. The substrate write already happened via the host-proxied `act` under `enforceScope` (ADR-0034). This
  only informs the agent that it happened.
- **Trust / loop-safety.** Because `updateModelContext` does **not** trigger a turn, there is no feedback loop
  risk; the note simply rides along with the human's next message. `sendMessage` (which does trigger) stays
  manual.

## Open questions

- **Which hosts honour `updateModelContext`?** Resolved empirically by (a)'s probe — revisit the bridge's reach
  once we have the claude.ai web/mobile capability readout.
- **Ambient "viewing" granularity** — every drill, or only type/prefix-level navigations? Start with act-only +
  coarse viewing notes; tune if the model's context feels noisy.
- **`sendMessage` affordance** — a per-fact "discuss in chat" button is the obvious next step once (a)/(b) are
  validated live.
