# Roof Jumps: running log (autonomous passes)

The brief (2026-11-22, while away): (1) one central, easily extended place for the city's procedural tagging, coupled with the
hand and foot holds (not disconnected); (2) a good new green baseline; (3) a first visual pass: basic renders of the tagged
details (windows, wires, pipes, signs and the rest) in the plain looks; (4) later, stroke-gouache done properly, referring back
to Switchback's techniques and rendering. Every half hour: pick up what's outstanding, proceed, note it here.

## Pass 1 (00:17 UTC)

- `parts.ts`: the city's parts registry (`PARTS`, `furnish`). Structure holds, fixtures, a course's holds and bars, drawn holds,
  alley bars, ground detail and details moved out of `city.ts` into one row each, own dice kept: the city is unchanged (the
  holds and details same-whenever-made tests, the lattice, every course check).
- Coupled: details carry `holds`. Pipe bundles and ladders are now climbable pipes (two runs per bundle); window rows above the
  ground sit on their storey's sill; rust links to its unit or pipe. A test checks every link is one of the chunk's own holds.
- Ladders climb as pipes for now (a `ladder` hold kind waits for its own climb pose).

## Pass 1, continued: the first visual pass

- Baseline green after the registry and coupling: 194/197 courses (the same three known), determinism exact over 38 scenes,
  footing 1/46 walking gaps (worst 33 ms), 26 held-pose findings as before. Deployed.
- `dressing.ts`: every detail kind drawn as plain boxes (`DRESS`, a `Record<DetailKind>`), new tags 15 to 25, colours in the plain
  looks (`dressOf` in looks.ts) and in gouache. Gouache's procedural windows are gone; the windows are the details now.
- Weight: the first try was 8 MB of mesh a chunk. Now a window row is one quad cut into panes in the fragment shader (which are lit
  from the seed; the sill band under each where the row has its sill hold), a bundle one striped box a run, a ladder rails and a
  rung quad: 3.7 MB a chunk, of which the city before was 2.3.
- `devtools/roofjumps-still.mjs`: a still of the running page (a look, a seed).
- Next: street-level stills (poles, wires, awnings, vending), a night/lit check, then the stroke-gouache treatment (item 4).

## Queued: Astra's critique (after items 1–4 are done)

The full text is in `static/roofjumps-critique-astra.md`. The thread running through it: a mistake should change what the athlete
can do next, and the player should be able to read, a moment ahead, what this body can still do from here. Don't tune
thresholds to turn checks green. The work, in order:

- **A. The one phrase (priority):** a playable scene as a single sequence. Stand at a parapet, take a small step back,
  change your mind, drive forward, land slightly wrong on the far side. The scene ties the weakest part (brushes) to the
  strongest (recoveries).
- **B. A backward brush that commits gradually:** a 12 px backward brush jumps from a 98° turn to 180° between 242 and 250 ms,
  and from 12 to 47 cm of travel after release. A single backward step should be there across a wide range of brush timings:
  - a shoe reaches behind and takes the weight;
  - the chest keeps facing where the player was looking;
  - if the player keeps going, the trailing hip opens into a turn;
  - if they let go, there is already somewhere to stop.

  Test it by sweeping the brush length one tick at a time and asserting no cliff. Also fix the 39 cm single-tick shoe snap at
  22 px / 400 ms.
- **C. Contact by shape, not by name:** today `standOf` and the pipe, shimmy and fire-escape timing checks go by kind. Keep the
  differences that describe the contact itself (wrappable, forefoot-narrow, whole-shoe deep, no knee clearance), and drop the
  catalogue names. Tests:
  - an unnamed projection the same size as a unit allows the same step;
  - as it gets shallower, the move goes from standing, to a forefoot push, to a hang.
- **D. late-change, made legible rather than green:** the second takeoff should show the bad first landing, through a shorter
  last-but-one stride, the less convenient leg, or a lower line toward a different catch.
- **E. Legibility:** a loaded, bent leg against the stairwell underside should read through the camera and the paint. Keep
  graded outcomes as fixtures, e.g. the slab-height sweep (9.70 m falls, 9.90–10.20 m exits, 10.40 m finds the slab but
  fails the push, 10.75 m and up falls).
- Local leftovers: vault-angles planted slide (8 cm/s); the courtyard pause under the opening runs short.

## Pass 2 (started by hand, about 00:50 UTC)

- Street-level stills (clay and gouache at dusk, from=0.5,36 fixed=-1.5,1.8,22 on seed 1): poles, wires, awnings, neon,
  ladders, pipes and window rows all read.
- Wires were broken into level dashes; each segment now spans its own rise, so the sag joins up.
- Gouache at dusk: lit rooms glow (their own light once the sun is low), dark panes deepen.
- Noted for item 4: gouache's paint thickens wires into heavy black zigzags; thin things need their own stroke rule.
- Noted: street poles stand 1.3 m out in narrow streets and are draw-only (the runner goes through them). They could become
  obstacles, or holds (a pole to swing round), once contact goes by shape (critique C).

### Item 4 begins: stroke-gouache, by Switchback's lessons

- Found and fixed a regression from the first visual pass: in stroke-gouache, every detail claimed depth but had no paint, so
  poles, awnings and window rows were holes of paper. Following Switchback's rule for things, details now claim no depth in the
  stroke pass (render.ts `uNoDetails`; they still cast sun shadows). Each is all marks:
  - a window row, a pull a pane (lit ones warm, glowing at dusk);
  - anything thin, one line along it; a wire, one line a span;
  - anything with faces, its faces filled; rust, a wash.
- Fixed an older bug: bars (railing posts, ladder sides) were always painted as horizontal lines, so posts showed as paper. They
  now follow their longest axis, and stay out to mid-distance (rank 0.62).
- A survey of Switchback's painter (client/switchback/paint.ts, static/switchback.md §Painted) against ours gave this plan, in
  order:
  1. no screen-locked terms in the stroke shader (dry-lift grain and colour grain use gl_FragCoord, so they crawl over moving
     marks): anchor grain to the mark's own coordinates;
  2. a pixel floor and ceiling on mark width (Switchback: 2.4·dpr px minimum, 0.19 of the height maximum), and widths that turn
     toward the eye with distance, so lips, pipes, wires and poles never thin to nothing;
  3. a lift along the view ray in place of the normal bias;
  4. far marks shrink away rather than fade, and the survivors grow; premultiplied blending, chunks painted far to near;
  5. a stamp atlas (bristle lanes, ragged edges, paint piled at the lift), with stamps chosen per subject;
  6. four value bands a stroke, mixed with a neighbouring band, a tint a stroke, stepped haze;
  7. scatter by coverage in two passes (masses, then detail) in place of the opaque fill and a few pulls, sized by distance from
     the line the runner is on. Keep our sun-shadow passages, which Switchback lacks.
- Known: a blade sign's face near the camera on seed 1's street (from=0.5,36) shows as paper. To look at.
