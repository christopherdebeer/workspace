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
