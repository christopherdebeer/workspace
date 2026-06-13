# The park — parc.land's visual language

> Decided 2026-06-12, from a brainstorm grounded in two artifacts: the iOS app
> icon (silhouetted pines under hand-drawn stars, a horizon still warm from
> sunset) and parc.land v1 (the pixel valley: *"a digital communal green
> space… a home for your Digital Garden"*, the 🏛 Visitor Centre). The current
> implementation ships the language in `platform/ui` + the home client; this
> records the rules so future surfaces stay coherent.

## The premise

The substrate's own metaphors were already park language — *"all organs and no
reef"*, **cells**, **tending**, salience, grants, agents that wander in and
read the land. The design commits to it: parc.land looks like the park it is
named for. Warm field-guide paper by day; the icon's dusk palette for scenery
and (later) the night variant.

## Hard rule: motifs never rename the system

Park language lives in **headings, copy, and scenery only**. Technical terms —
`workspace`, `facts`, `cells`, `grants`, `tokens`, `read`/`act`, every target
string — stay exactly as they are, visible and verbatim. The pattern is dual
register: a warm headline, the precise term beside or beneath it
("Identity & grants — *day passes & permits*", "Cells — *your outposts*").
An agent and a human reading the same screen must never diverge on what a
thing is called.

## Tokens (`platform/ui` theme)

| Token | Value | Role |
| --- | --- | --- |
| `bg` | `#f3edde` | day paper (page) |
| `panel` | `#fdf9ef` | signage cards |
| `border` | `#ddd2b8` | card edges |
| `text` / `dim` | `#332e23` / `#85795f` | ink |
| `accent` | `#2e5e43` | pine (actions, links) |
| `danger` | `#b5523c` | terracotta |
| `dusk` / `duskDeep` | `#0d2b33` / `#081d24` | night sky (scenery, machine) |
| `pine` | `#1e3b2c` | treeline |
| `gold` / `horizon` / `cream` | `#e8b04b` / `#f3d27e` / `#fdf6d8` | sunset, stars |
| `serif` | Iowan/Palatino/Georgia stack | display headings |

Type: serif for headings (field-guide voice), system sans for body, mono for
anything that is literally a target/key/scope — mono *is* the marker of "this
string is real vocabulary".

## The structures

- **The trailhead (landing).** Full-bleed dusk-valley hero (currently an
  inline deterministic SVG — gradient sky, seeded stars, two treeline layers
  — built to be replaced 1:1 by the painted hero when generated), the mono
  wordmark, the serif tagline *"a personal substrate for exploring the
  world"*, passkey door, three signage cards (workspace / cells / agents),
  and the Visitor Centre quote as the v1 hat-tip.
- **The dashboard (signed in).** Greeting over a thin dusk strip; stat cards
  (facts/links/views/cells) with a real sparkline from the change feed; quick
  capture (one box → an inbox fact); the workspace window; recent activity
  (the trajectory, reads excluded); identity & grants; pinned views; cells.
- **The field computer.** The one deliberately dark object in the warm room:
  the raw read/act console, OAuth discovery, and the probe live inside a
  collapsed machine housing — green phosphor (`#7fc97f` on `#0a1f1a`) like
  the radio at a ranger station. Approachability and open-ended capability
  coexist by *containment*, not by hiding: the lid opens, everything is there.
- **`CodeBlock` everywhere** keeps a small dark terminal — wherever the
  machine speaks (logs, JSON results), it speaks in phosphor.

## Later

- **Painted assets** — *landed (2026-06-13)*: the hero valley, the dawn
  panorama strip, and the field-computer illustration replaced the SVG
  scenery through the `DuskScene` seam. They ship as data URIs inside
  `app.js` (esbuild `dataurl` loader for `.jpg/.png/.webp`, wired in
  `HttpServiceCell`'s client build) — ~200 KB compressed, cached with the
  bundle. The computer's baked checkerboard was keyed out (large neutral-grey
  connected components → alpha); re-export with real transparency if the
  source ever changes.
- **The night variant** — the dusk tokens become a full theme (time-of-day
  arc: the park darkens with your evening); needs a theme-switching seam in
  `platform/ui` first.
- **Weather** — the v1 idea, substrate-native: scenery reflects state
  (clean tending = clear sky; attention items = gathering clouds).
