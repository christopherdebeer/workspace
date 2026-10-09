# Lab

3D and GL experiments, one cell: `@c15r/lab`, at https://c15r-lab.on.parc.land.

## What the Lambda does (and doesn't)

It answers three things:

- `/` is the index. Every experiment, grouped, runs live in its card (only those in view; each
  opens with its `preview` query: small, pixelated, quiet), with its README and its
  presets.
- `/<id>` is a redirect to that experiment's page as it is now, with the query kept, so a shared
  `/mistwood?seed=…` opens where it was left. `/<id>/readme` redirects to its README.
- `/~/…` is a miss in the public namespace (ADR-0095). The file is in this package, so the Lambda
  writes it to the namespace and returns it. That path is never asked of the Lambda again.

Everything under `/~/` is named by its content's hash:

| Path | What |
|---|---|
| `/~/a/<hash>.js` | the bundle, every experiment in it |
| `/~/e/<id>/<hash>/` | an experiment's page |
| `/~/r/<id>/<hash>/` | its README, rendered |

So it is all immutable. A deploy makes new names, old pages keep working, and nothing ever
needs invalidating. Each page shows itself at its stable address (`/<id>?…`, rewritten as it
loads), so a reload asks for the experiment as it is now rather than keeping one deploy's copy. Once a file has been asked for once, opening an experiment costs no compute
at all: CloudFront and S3, never the Lambda.

## Layout

```
index.ts          the Lambda: the index, the redirects, the namespace's misses
experiments.ts    the registry: id, title, group, blurb, page, preview query, README, presets
md.ts             markdown to HTML (the READMEs)
client/main.ts    the one bundle: picks the experiment its page names, imports it lazily
client/<id>/      an experiment's source
client/kit/       what experiments share: seeded randomness (rng.ts), the pencil (pencil.ts)
static/<id>.html  its page (`data-exp="<id>"`; its script `{{app}}`, filled with the hashed bundle;
                  `{{readme}}`, a link to its README)
static/<id>.md    its README (static/: the only files a deploy ships verbatim)
devtools/         the headless harness and tests (not synced to the cell)
```

## A new experiment

1. Put its source in `client/<id>/`, and its README as `static/<id>.md`.
2. Add a line to `client/main.ts`: `<id>: () => import('./<id>/main')`.
3. Add its page as `static/<id>.html`, with `<html data-exp="<id>">` and `<script type="module" src="{{app}}">`.
4. Add its entry to `experiments.ts`.
5. It should take a `preview` query: small, quiet, no buttons.

The bundler keeps each `import()` lazy, so a page runs only its own experiment.

## Deploy

From the repo root: `node scripts/cell-sync.mjs push lab --deploy --message "…"`. It needs a
token: from a session that already holds the substrate (the Substate MCP), mint one directly
with `auth.mintToken` (`scope: "cells:create read:workspace write:workspace"`, a label, a
lifetime) and put it in `PARC_TOKEN` or `/tmp/parc-token.json` as `{"access_token": …}`; the
device flow is only for a session with no substrate access at all. The
experiments' devtools run against the lab's bundle (`EXPERIMENT=<id>`, Mistwood by default; `READY=__<id>`
names the global the page reports itself on, `__mistwood` by default): `node cells/lab/devtools/<tool>.mjs`.

## The experiments

- **Mistwood** (`client/mistwood/`): a walk through a seeded wood in fog. It was its own cell
  (`@c15r/mistwood`); that cell now only redirects here, keeping the query.
- **Marble Run** (`client/marbles/`): a roster of twelve glass marbles (each its own seeded look and name) released from a gate down wide obstacle boards (pegs, deflectors, splitters, chicanes, spinners, funnels, gates, bends) in a seeded run that grows as you build it, to a funnel and a single-file channel where the result sits at rest; rigid spheres with spin against floors, walls, pegs and turning arms (`physics.ts`, `track.ts`, tested on their own), a chase camera, a shadow map.
- **Technic** (`client/technic/`): Bricks evolved: beams, pins and axles on a pegboard, gears, wheels, ramps and marbles, a motor and a hub; a position-based solver (`sim.ts`) runs it. Builds are kept and started from (a start screen), pieces come from a drawer; a drop explains itself, pins and axles come with the drop, gears are magnetic; missions with a bell and a cup; always alive, with pause and rewind; builds are pieces (`keep`). Rules and solver tested on their own (`devtools/technic.test.mjs`).
