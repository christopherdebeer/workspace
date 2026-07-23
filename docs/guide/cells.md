# Cells

parc.land isn't a fixed set of screens. You can grow new tools into your space —
these are **cells**.

## A small program with its own address

A cell is a little application that lives on the substrate: a tracker, a board,
a feed, a reader, a dashboard. Each has its own address and its own place, and
each does one thing well. Where most platforms make you wait for the vendor to
ship a feature, parc.land lets a new tool take root beside your facts.

## Cells are views over the substrate

A cell doesn't own a private database off to the side. It reads and writes the
same facts everything else does — it's a **view over the substrate**, shaped for
a particular job. A task board and a plain note list can be looking at the very
same tasks, presented two ways. Nothing is duplicated; nothing gets out of sync.

This is why the workspace stays coherent no matter how many tools you add: they
all rest on one shared ground.

## Everyone's cells speak the same vocabulary

Because every cell talks to the substrate through the same `read`/`act`
vocabulary, cells compose. A fact created in one shows up wherever it's
relevant in another. A cell someone else built can work with your facts (within
what you've shared) without any custom integration. The common language is what
lets an ecosystem of small tools behave like one system.

## Building one

Cells are meant to be grown, not just consumed — if you want to build one,
that's a supported path, from a quick personal tool to something you graduate
into shared infrastructure.

*(Builder documentation for authoring and deploying cells lives with the
platform docs — this page is the concept, not the tutorial.)*

---

*The [core concepts](concepts.md) explain the facts and grants a cell is built
on; [for agents & integrators](for-agents.md) covers the vocabulary cells and
agents share.*
