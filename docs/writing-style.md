# Writing style for parc.land docs

Most docs in this repo were written by Claude, and they read like it. This doc
describes the owner's actual voice — taken from the dotlit `.lit` corpus
(176 files, 2021–2024) — so new docs sound like the person whose workspace
this is.

## The voice, observed

From [[wiki-links]], [[time_to_pudding]], [[plugin_system]],
[[divergence_from_markdown]], [[local_remote_files]], the daily logs:

- **Open with what the thing is.** One plain sentence. "Wiki links, that is,
  non standard markdown links borrowed from it's namesakes." "`.lit` is a
  plain text document format, really it's just **Markdown**." No scene-setting.
- **Problem stated flat, then a list.** "The problem is, that deployment to
  GitHub pages results in a remote file that *seems* newer than the local file
  that created it." Then `## Potential solutions` — bullets, trade-offs noted
  inline, checkboxes for the undecided ones.
- **Hedges are honest and personal.** "at least to me", "I guess", "I suspect
  this is just me being biased-toward/shilling `.lit`", "for now", "hopefully
  … this won't remain the case for long". Uncertainty is information; it stays
  in the text.
- **Quotes carry the theory.** Blockquote + attribution link (Wikipedia,
  Maggie Appleton, MIT Tech Review). He excerpts authorities; he doesn't
  paraphrase them into his own claims.
- **Concepts are wiki-links**, not bold terms. The link *is* the definition.
- **Lists beat paragraphs.** Many docs are five lines. "See [[wiki-links]] for
  now" instead of a section. Checkboxes hold open state — "to consider…" items
  left unchecked for years, on purpose.
- **Wit is dry and small.** "Time to Pudding 🍰". "File not *yet* found, edit
  this to change that." Emoji in titles. Never a joke that needs a paragraph.
- **Unpolished on purpose.** Typos survive. Fragments fine. Capture beats
  copy-editing — the docs are a garden ([[seedling]] → evergreen), and a
  doc's maturity is marked, not faked.

## What to stop doing

The Claude tells, all present in the current docs/ tree:

- Verdict aphorisms: "a cache is not content", "the budget was never the
  problem". If the claim matters, make it specific; don't make it quotable.
- The em-dash cascade and the "X: the Y that Z" apposition, three per
  paragraph. One dash per paragraph is plenty.
- ALL-CAPS emphasis and bold-led bullets ("**The real gap.**"). His bullets
  start with the noun.
- Anthropomorphizing: the membrane doesn't "answer honestly", the graph
  doesn't have a "soul", nothing "refuses loud". The query returns an error.
- Dramatic scene-setting openers and *italic thesis lines* under titles.
- Grand section names ("The evening: what the budget broke that mattered").
  His are "Key differences", "Potential solutions", "Issues".
- Ending with a Verdict. End when the content ends.

## Before / after

From `guide/concepts.md`:

> Five ideas make everything in parc.land fall into place. None of them is
> about storage or code — they're about how the substrate behaves for you.

→ "parc.land has five core concepts. The rest follows from them."

From a trajectory doc:

> *2026-07-29 — the content-lifecycle audit, and what opening the queue found
> that counting it missed.*

→ "Audit of the content lifecycle. Counting the queue said one thing; opening
it said another."

From the dotlit review:

> dotlit's soul is that a document runs, writes its results into itself, and
> extends its own renderer; lit currently renders, embeds, and executes — but
> forgets.

→ "In dotlit a document runs and writes its results back into itself. lit
renders and executes but doesn't write results back. See persisted output
cells."

## Where this applies

Docs under `docs/` (they get ingested by docs-sync and become the substrate's
own reading), ADR prose, commit message bodies when they run long. Trajectory
docs can keep more narrative — they're a log — but the tells above apply
there too.

Not covered: code comments (they have their own conventions in CLAUDE.md),
and the historical record — don't rewrite existing trajectory/ADR docs to
match. Apply going forward.
