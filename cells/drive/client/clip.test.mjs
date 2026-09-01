/**
 * TILE CLIPPING — no browser, no renderer, no truck.
 *
 *   node cells/drive/client/clip.test.mjs
 *
 * `renderGated` clips every highway to its own tile before building it, so a
 * road is drawn by each tile it passes through and by no other. That makes this
 * function the one place a road can go missing without anything failing: no
 * fetch errors, no console, the way present and complete in the tile's own
 * data, and simply nothing built where it crosses.
 *
 * Which is what happened. Reported from the seat driving Edge Hill to Ben Nevis
 * at Senqu: short segments missing, consistently where a road nicks the CORNER
 * of a tile between two nodes. The vertex walk that used to live here opened a
 * run only when a vertex was INSIDE the box, so a segment that entered and left
 * between two consecutive nodes was dropped whole. The first case below is that
 * road; it fails against the old clipper and passes against this one.
 *
 * The rest are the properties the old one did hold and the new one must not
 * lose — above all that adjacent tiles meet EXACTLY on their shared edge, which
 * is what stops the fix from trading a gap for a seam.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const tmp = mkdtempSync(join(tmpdir(), 'clip-'));
const built = join(tmp, 'clip.mjs');
execFileSync('npx', ['esbuild', join(HERE, 'clip.ts'), '--bundle', '--format=esm', `--outfile=${built}`],
  { cwd: ROOT, stdio: 'pipe' });
const { clipToBounds } = await import(pathToFileURL(built).href);

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
const P = (lat, lon) => ({ lat, lon });
// A unit box, so every expectation is readable as a number.
const B = { latS: 0, latN: 1, lonW: 0, lonE: 1 };
const near = (a, b2, e = 1e-9) => Math.abs(a - b2) < e;

// ── THE BUG ──
// A segment from outside to outside that cuts the top-left corner. No vertex
// is ever inside the box; the old clipper emitted nothing.
{
  // Both ends outside — one beyond the west edge, one beyond the north — with
  // the segment between them cutting the top-left corner.
  const runs = clipToBounds([P(0.7, -0.2), P(1.1, 0.2)], B);
  check('a corner nick is clipped at all', runs.length === 1, runs);
  const r = runs[0] ?? [];
  check('and comes back as one two-point run', r.length === 2, r);
  check('entering on the west edge', r[0] && near(r[0].lon, 0) && near(r[0].lat, 0.9), r[0]);
  check('and leaving on the north edge', r[1] && near(r[1].lat, 1) && near(r[1].lon, 0.1), r[1]);
}
// The same, cutting a corner without touching either axis-aligned extreme —
// the case a bbox-overlap test would also pass but a vertex walk cannot.
{
  const runs = clipToBounds([P(1.05, 0.5), P(0.5, -0.05)], B);
  check('a shallower corner nick survives too', runs.length === 1 && runs[0].length === 2, runs);
}

// ── what must not regress ──
check('a polyline wholly inside is returned whole',
  JSON.stringify(clipToBounds([P(0.2, 0.2), P(0.5, 0.5), P(0.8, 0.3)], B))
  === JSON.stringify([[P(0.2, 0.2), P(0.5, 0.5), P(0.8, 0.3)]]), null);

check('a polyline wholly outside returns nothing',
  clipToBounds([P(2, 2), P(3, 3)], B).length === 0, null);

{
  const runs = clipToBounds([P(-0.5, 0.5), P(0.5, 0.5)], B);
  check('entering lands exactly on the edge',
    runs.length === 1 && near(runs[0][0].lat, 0) && near(runs[0][1].lat, 0.5), runs);
}
{
  // Out, in, out, in — two separate runs, not one joined across the gap.
  const runs = clipToBounds([P(0.5, -0.5), P(0.5, 0.2), P(0.5, -0.5), P(0.5, 0.8)], B);
  check('leaving and re-entering makes two runs', runs.length === 2, runs);
}

// ── ADJACENCY: the property the fix must keep ──
// Two boxes sharing the lon = 1 edge. One road crossing both must come back as
// two pieces that meet on that edge to the last bit — a gap here is the same
// class of bug as the one above, and an overlap doubles the ribbon.
{
  const L = { latS: 0, latN: 1, lonW: 0, lonE: 1 };
  const R = { latS: 0, latN: 1, lonW: 1, lonE: 2 };
  const road = [P(0.3, 0.4), P(0.7, 1.6)];
  const l = clipToBounds(road, L), r = clipToBounds(road, R);
  check('a road crossing a tile edge is clipped by both sides',
    l.length === 1 && r.length === 1, { l, r });
  const end = l[0][l[0].length - 1], start = r[0][0];
  check('and the two pieces meet exactly, no gap and no overlap',
    end.lat === start.lat && end.lon === start.lon, { end, start });
  check('on the shared edge itself', near(end.lon, 1), end);
}
// …and the same for a corner nick straddling two tiles: each side must own its
// half and they must still meet.
{
  const L = { latS: 0, latN: 1, lonW: 0, lonE: 1 };
  const R = { latS: 0, latN: 1, lonW: 1, lonE: 2 };
  const road = [P(1.4, 0.6), P(0.6, 1.4)];
  const l = clipToBounds(road, L), r = clipToBounds(road, R);
  check('a corner nick spanning two tiles is owned by both', l.length === 1 && r.length === 1, { l, r });
  check('and still meets exactly',
    l[0][l[0].length - 1].lon === r[0][0].lon && l[0][l[0].length - 1].lat === r[0][0].lat,
    { l: l[0], r: r[0] });
}

// A segment that only TOUCHES a corner has no interior extent — a two-point
// run of identical points would be a zero-length ribbon with no normal.
{
  const runs = clipToBounds([P(0.8, -0.2), P(1.2, 0.2)], B);
  check('a segment that only grazes a corner yields nothing', runs.length === 0, runs);
}

// A degenerate way (one node) has no segment and no run.
check('a one-point way yields nothing', clipToBounds([P(0.5, 0.5)], B).length === 0, null);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exitCode = bad ? 1 : 0;
