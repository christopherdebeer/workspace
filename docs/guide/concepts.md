# Core concepts

Five ideas make everything in parc.land fall into place. None of them is about
storage or code — they're about how the substrate behaves for you.

## Facts

A **fact** is the atom. Every single thing in parc.land is one: a note, a link,
a task, a person, a decision, even a whole document. A fact has a key (its
address), a value (its content), and a little history (when it changed, and who
wrote it).

Because everything is the same kind of thing, everything is searchable,
linkable, and shareable in the same way. There are no special cases — no
"but tasks work differently." Learn facts once and you understand the whole
substrate.

## Types

A fact isn't just a blob — it knows **what it is**. A `note`, a `task`, a `doc`,
a `person`. The type tells parc.land how to show the fact (an icon, a title, a
sensible preview) and where to open it for a closer look or an edit.

You mostly don't think about types — you write a note and it looks like a note.
But types are why your workspace feels coherent instead of like a wall of raw
text, and they're extensible: new kinds of things can teach the substrate how
they want to be shown.

## The graph

Your slice of the substrate is a **graph** — facts as points, their
relationships as the lines between them. parc.land renders it as a sky you can
move through: related facts cluster, well-connected ones sit prominently, and
browsing becomes a way of remembering.

The graph isn't a separate "visualization" of your data. It *is* your workspace
— the primary way you see and navigate what you've kept.

## Salience

A growing pile of notes usually gets *harder* to use. parc.land pushes the other
way: it continuously judges **salience** — how much a fact matters right now —
from how recently you touched it, how densely it's connected, and how often you
return to it. The things that matter rise; the noise settles.

This is why you rarely have to organize. You don't maintain the important stuff
at the top; the substrate keeps it there for you.

## Sharing & grants

By default your slice is yours alone. When you want someone else — a person, a
group, or the whole public — to see part of it, you make a **grant**: a share of
a specific fact, a prefix of them, or your whole slice, as read-only or
writable.

Grants are how one private substrate becomes a shared one without copying
anything. The public trails you can explore on parc.land are exactly this: facts
their owner granted to everyone. What you see is precisely what was shared —
never more.

---

*Ready to connect an agent? See [for agents & integrators](for-agents.md). Want
to build a tool into your space? See [cells](cells.md).*
