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
