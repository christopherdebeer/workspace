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
md.ts             markdown to HTML (the READMEs: images, and a paragraph of only images is a gallery)
views.mjs         makes an experiment's README pictures: `node cells/lab/views.mjs <id>` runs the views it
                  registers in client/<id>/views.mjs, writes static/<id>/v-<name>.jpg, rewrites the README's gallery
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

- **Roof Jumps** (`client/roofjumps/`): a figure running over an endless city of rooftops, leaping whatever is in the way, in any direction. Geometry and rig only, drawn in one grey on purpose so looks can be tried over it: chunks of tagged boxes on a one-metre lattice, with holds for a hand tagged on them (edges, sills, pipes, rails: `city.ts`), a runner that finds where it can next stand and goes there by the move that suits (hop, bound, flip, spring, dive, glide; dash, roll, ledge, wall run: `runner.ts`, tested on its own: `devtools/roofjumps.test.mjs`), a planner that runs a copy of the runner on ahead down a fan of headings and draws the routes into the city (`plan.ts`, `?plan`), every number on a dial in a palette (`tune.ts`, `palette.ts`), a thirteen-bone figure posed from the move, its arms taken to the holds in reach (`rig.ts`), its study tools the page's own modes (`?sheet=` a pose sheet, `?strip=` a run frame by frame; `client/roofjumps/views.mjs` makes the README's pictures from them), and the looks in one shader (`render.ts`: grid, clay, wire, tags, normals).
- **Piste** (`client/piste/`): a fencing bout in first person, through the mask, with two thumbs (left: extend, lunge, advance, retreat; right: the point). Nothing is animated. The épée is an XPBD blade in 1/2000 s substeps, held by a hand of two heavy points on force-limited muscles (`blade.ts`). Contacts cover blade on blade with friction and remembered sides, the bell, and the body; the tip is a compliant contact whose axial force is what the button feels (`contact.ts`). The box has dwell and lockout (`box.ts`). Footwork, body capsules and arm IK are in `fencer.ts`. Everything that decides speaks one `Intent` (`intent.ts`): the thumbs (`input.ts`), the opponent, who sees you a reaction time late (`ai.ts`), the coach (`coach.ts`), and the tests (`devtools/piste.test.mjs`). There are fourteen lessons, each a coach part and a judge that reads form as well as touches, with the pace adapting (`lessons.ts`). The arm tires; the opponent goes for open targets, respects and answers a point in line, and draws out stop-hits; the bout has a clock and a priority minute. Bullet time comes from visible cues, scaled by level (`time.ts`). Replays are exact re-runs of a copied bout (`replay.ts`). `view=side|over` and `readout` are for studying it.
- **Volley** (`client/volley/`): a ball thrown up into fired and glazed sheets and caught again, with no paddle: the screen is a pane and the ball is returned by a hand on it, which is a catch, a pad or a hit by what the finger is doing as the ball lands. `sheet.ts` makes each sheet a Voronoi figure whose sites are laid as motifs (rosettes, fans, ringed holes: faceted rings of tiles), the glaze in bands; `sim.ts` is the game (a falling, spinning sphere against convex prisms; fixed steps; firings of six sheets each, with checkpoints; five lives, four firings against the clock, or free; a stand-in; tested on its own); `draw.ts` draws chamfered, glazed prisms with one casting light and haze, each firing its own palette, through a lens focused on the nearest sheet; `static/volley-brief.md` describes the game with no picture in it.
- **Mistwood** (`client/mistwood/`): a walk through a seeded wood in fog. It was its own cell
  (`@c15r/mistwood`); that cell now only redirects here, keeping the query.
- **Marble Run** (`client/marbles/`): a roster of twelve glass marbles (each its own seeded look and name) released from a gate down wide obstacle boards (pegs, deflectors, splitters, chicanes, spinners, funnels, gates, bends) in a seeded run that grows as you build it, to a funnel and a single-file channel where the result sits at rest; themes (`theme.ts`: atelier by day, nocturne by lamplight) change the place and the materials under a race; rigid spheres with spin against floors, walls, pegs and turning arms (`physics.ts`, `track.ts`, tested on their own), a chase camera, a shadow map.
- **Technic** (`client/technic/`): Bricks evolved: beams, pins and axles on a pegboard, gears, wheels, ramps and marbles, a motor and a hub; a position-based solver (`sim.ts`) runs it. Builds are kept and started from (a start screen), pieces come from a drawer; a drop explains itself, pins and axles come with the drop, gears are magnetic; missions with a bell and a cup; always alive, with pause and rewind; builds are pieces (`keep`). Rules and solver tested on their own (`devtools/technic.test.mjs`).
