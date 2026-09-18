/**
 * ── WHERE THE RENDERER IS LOOKING, AND WHETHER ANYTHING READS IT ──
 *
 *   node cells/drive/devtools/render-focus.test.mjs [path/to/main.ts]
 *
 * Pure node, no browser, under a second.
 *
 * THE FAULT THIS HOLDS SHUT. Trees, impostors, sward, shrubs and the shadow
 * map are expensive witnesses to what is ON SCREEN, and every one of them was
 * centred on the RIG. The clearest form of it: the top camera targets
 * `viewX() + panX` while the GPU sward read `state.x + panX`, so with the drone
 * airborne and the chart open the camera followed the aircraft and the grass
 * grew round the truck — hundreds of metres apart, with nothing to say so.
 *
 * TWO CLAIMS, AND THEY NEED DIFFERENT KINDS OF WITNESS.
 *
 * The first is arithmetic — what `renderFocusXZ` answers in each camera — and
 * is tested by EXTRACTING the shipped function and calling it, which is the
 * rule `veg-anchor.test.mjs` set: a devtool that restates the rule tests its
 * own copy.
 *
 * The second is ORDER, and no value can witness it. `swardFrame`'s uniform
 * writes have to happen BEFORE the early return that waits out a field sweep,
 * or a chart pan or a drone flight freezes the visual focus for as long as a
 * rebuild takes — the grass stops following the camera while the thing it is
 * waiting for is a field for ground the player has already left. So that half
 * is a source-order check, and it carries the lesson the globe test learned
 * twice: BOTH NEEDLES MUST BE REQUIRED TO EXIST, or a renamed line turns the
 * assertion into a true statement about -1.
 *
 * CHECKED AGAINST TWO CONTROLS, because a check that has not been shown to fail
 * on the fault it names is decoration. On the revision before this unit it does
 * not run at all (`renderFocusXZ` does not exist, and it says so rather than
 * passing); and with the GPU sward alone put back the way it was — the rig plus
 * the pan, and the sweep gate above the uniforms — it fails exactly three:
 * `the GPU sward reads renderFocusXZ`, `the eye uniform is written before the
 * sweep gate returns` and `…and so are the band bases`, with every other
 * consumer still green. So the consumer checks are per consumer and not a
 * count, which is the regression they are for.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(process.argv[2] || path.join(HERE, '../client/main.ts'));
const source = fs.readFileSync(SRC, 'utf8');
let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// ── the shipped functions, lifted out of main.ts ─────────────────────────
function fnSource(name) {
  const head = `function ${name}(`;
  const at = source.indexOf(head);
  assert.ok(at >= 0, `not found: ${name}`);
  let depth = 0, seen = false;
  for (let i = at; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(at, i + 1); }
  }
  throw new Error(`unterminated: ${name}`);
}
const NAMES = ['viewX', 'viewZ', 'renderFocusXZ', 'droneGroundFocus'];
const esbuild = await import('esbuild');
// The world these functions read, as plain values. A function declaration DOES
// become a property of a vm context (which is why these four are extracted by
// their `function` form and the lattice helpers next door had to be published
// by hand), so nothing here needs a `globalThis` dance.
const ctx = {
  Math,
  camMode: 'chase', lastPov: 'chase', treeRange: 700,
  panX: 0, panZ: 0,
  state: { x: 100, z: -250, heading: 0 },
  drone: { up: false, x: 0, z: 0, y: 0, heading: 0 },
  groundAt: () => 0,
};
vm.createContext(ctx);
vm.runInContext(esbuild.transformSync(NAMES.map(fnSource).join('\n'),
  { loader: 'ts', target: 'es2022' }).code, ctx);
const focus = () => ctx.renderFocusXZ();

// ── 1. chase and cab stay on the rig ─────────────────────────────────────
// Deliberately, and the reason is in the code: the camera's offsets there are
// metres against a tree range of hundreds, so chasing the suspension's own
// movement would rebuild fields for nothing. A pan cannot exist in a seat.
for (const m of ['chase', 'cab']) {
  ctx.camMode = m;
  ctx.panX = 4000; ctx.panZ = -4000;     // stale pan: a seat must ignore it
  ok(`${m} follows the rig`, JSON.stringify(focus()) === JSON.stringify([100, -250]), focus());
}
ctx.panX = 0; ctx.panZ = 0;

// ── 2. the chart follows what the camera targets, drone included ──────────
// This is the bug the unit was written for, so it is asserted in the exact
// shape it occurred: the drone AIRBORNE and the chart PANNED, where the old
// rule (`state.x + panX`) and the camera's own target part company.
ctx.camMode = 'top';
ctx.panX = 300; ctx.panZ = -120;
ok('the chart follows the rig plus the pan while the drone is down',
  JSON.stringify(focus()) === JSON.stringify([400, -370]), focus());
ctx.drone = { up: true, x: 2000, z: 900, y: 0, heading: 0 };
const withDrone = focus();
ok('…and the AIRCRAFT plus the pan once it is up',
  JSON.stringify(withDrone) === JSON.stringify([2300, 780]), withDrone);
// The control: the rule it replaced, restated here ONLY so the claim is that
// the two answers genuinely differ rather than that one of them is a number.
const oldRule = [ctx.state.x + ctx.panX, ctx.state.z + ctx.panZ];
ok('…which the rule it replaced did not (the control)',
  Math.hypot(withDrone[0] - oldRule[0], withDrone[1] - oldRule[1]) > 1000,
  { shipped: withDrone, oldRule });

// ── 3. the drone looks AHEAD of itself, by its own height ────────────────
// Both its cameras aim at a fixed depression, so the ground the screen's
// centre lands on leads the aircraft by its height over the ground times the
// cotangent of that angle — 2.31x from the nose, 2.89x from the trailing view.
// Asserted as a RATIO rather than a metre count, because that is the claim: a
// fixed lead would be wrong at every altitude but one.
ctx.camMode = 'drone';
ctx.panX = 0; ctx.panZ = 0;
// The height is kept UNDER the cap on purpose (the trailing lens needs the
// lower one: 2.89x of 126 m is past 45% of a 700 m range, and the first run of
// this check measured the cap and called the ratio wrong).
for (const [pov, k, h] of [['cab', 30 / 13, 120], ['chase', 39 / 13.5, 60]]) {
  ctx.lastPov = pov;
  ctx.drone = { up: true, x: 0, z: 0, y: h, heading: 0 };   // heading 0 is NORTH, which is -z
  const [fx, fz] = focus();
  const eye = pov === 'cab' ? h - 0.35 : h + 6.5;
  ok(`the ${pov === 'cab' ? 'nose' : 'trailing'} view leads the aircraft by ${k.toFixed(2)}x its height`,
    Math.abs(fx) < 1e-9 && Math.abs(-fz - eye * k) < 1e-6, { fx, fz, want: -eye * k });
}
// …and the lead is CAPPED against the draw range, or at three hundred metres up
// the geometry asks for eight hundred metres of it and carries the ring off the
// ground under the aircraft entirely.
ctx.drone = { up: true, x: 0, z: 0, y: 4000, heading: 0 };
const [, hifz] = focus();
ok('…and the lead is capped at 45% of the draw range',
  Math.abs(-hifz - ctx.treeRange * 0.45) < 1e-6, { lead: -hifz, cap: ctx.treeRange * 0.45 });
// ON THE GROUND THE NOSE LOOKS AT ITS OWN FEET, and the trailing view does
// not — which is right and is worth asserting rather than assuming. The FPV eye
// sits ON the aircraft (0.35 m under its centre, so the lead clamps to zero at
// rest); the trailing lens stands 6.5 m up and therefore genuinely looks about
// nineteen metres ahead of a landed drone. The first cut of this check asserted
// both at the drone's own point and read the second as a fault.
ctx.lastPov = 'cab';
ctx.drone = { up: true, x: 55, z: -66, y: 0, heading: 1.2 };
ok('…and a landed drone\'s nose looks at its own feet',
  JSON.stringify(focus()) === JSON.stringify([55, -66]), focus());
ctx.lastPov = 'chase';
{
  const [gx, gz] = focus();
  const lead = Math.hypot(gx - 55, gz + 66);
  ok('…while its trailing lens still looks ahead by its own stand-off',
    Math.abs(lead - 6.5 * (39 / 13.5)) < 1e-6, { lead });
}

// ── 4. every render-side consumer reads the authority ────────────────────
// Named one at a time rather than counted: a count passes when a call moves
// from one consumer to another, which is exactly the regression this is for.
// THE PAREN IS PART OF THE NEEDLE, and leaving it off cost a run: without it
// `function refreshSward` matches the PREFIX of `function refreshSwardField`
// eight hundred lines earlier, and the check then reads a body that has nothing
// to do with the consumer it names — a failure that looks exactly like an
// unrouted consumer.
const CONSUMERS = [
  ['the GPU sward', 'function swardFrame('],
  ['the CPU sward', 'function refreshSward('],
  ['the shrubs', 'function refreshShrubs('],
  ['the tree and impostor refresh', 'function* vegRefreshSteps('],
  ['the manifest tally', 'function vegManifestTally('],
];
for (const [label, head] of CONSUMERS) {
  const at = source.indexOf(head);
  ok(`${label} is declared`, at >= 0, head);
  if (at < 0) continue;
  // Bounded at the next top-level declaration, so a call in the NEXT function
  // cannot be read as this one's.
  const end = source.indexOf('\nfunction ', at + head.length);
  const body = source.slice(at, end < 0 ? source.length : end);
  ok(`${label} reads renderFocusXZ`, body.includes('renderFocusXZ()'), label);
}
// The shadow centre is not a function of its own; it is a block in the frame
// loop, so it is found by the line that places the light.
{
  const at = source.indexOf('shadowAt.set(');
  ok('the shadow centre is placed somewhere', at >= 0, at);
  const before = source.slice(Math.max(0, at - 700), at);
  ok('the shadow centre reads renderFocusXZ', before.includes('renderFocusXZ()'),
    before.slice(-200));
}

// ── 5. THE FAST HALF IS WRITTEN BEFORE THE SLOW HALF WAITS ───────────────
// Both needles are required to EXIST before they are compared, which is the
// whole lesson: an indexOf of -1 satisfies `<` against anything and turns this
// into a true statement about nothing.
{
  const at = source.indexOf('function swardFrame');
  const end = source.indexOf('\nfunction ', at + 10);
  const body = source.slice(at, end);
  const eye = body.indexOf('swardU.uSwardEye.value.set(');
  const base = body.indexOf('b.uBase.value.set(');
  const wait = body.indexOf('if (swardRow >= 0)');
  ok('the eye uniform, the band bases and the sweep gate are all there',
    eye >= 0 && base >= 0 && wait >= 0, { eye, base, wait });
  ok('the eye uniform is written before the sweep gate returns', eye >= 0 && wait > eye, { eye, wait });
  ok('…and so are the band bases', base >= 0 && wait > base, { base, wait });
  ok('a sweep in flight can be abandoned for a focus that has moved',
    body.includes('SWARD_ABANDON'), body.slice(wait, wait + 200));
}

// ── 6. the abandon threshold is a jump, not a drive ──────────────────────
// A truck rebuilds at SWARD_REBUILD once a sweep has landed, and a sweep costs
// a fifth of a second at 60 fps — so if these two were close, an ordinary drive
// would abandon sweeps for ever and the field would never land at all.
const num = (name) => {
  const m = source.match(new RegExp(`const ${name} = (\\d+(?:\\.\\d+)?);`));
  assert.ok(m, `not found: ${name}`);
  return Number(m[1]);
};
const rebuild = num('SWARD_REBUILD'), abandon = num('SWARD_ABANDON'), fw = num('SWARD_F') * num('SWARD_FM');
ok('abandoning is well past the distance an ordinary drive rebuilds at',
  abandon > rebuild * 3, { rebuild, abandon });
ok('…and well inside the field it would be abandoning', abandon < fw / 2, { abandon, halfField: fw / 2 });

// ── 7. the world is NOT moved away from the vehicle ──────────────────────
// The retention rule, which is the other half of the three interests: vegGrid
// is also where the collision pass finds its boulders, and that pass is the
// RIG's. A prune that followed the focus would delete the rocks under the
// wheels the moment the drone took off.
{
  const at = source.indexOf('if (vegGrid.size > 900) {');
  ok('the vegetation cell prune is there', at >= 0, at);
  const body = source.slice(at, at + 900);
  ok('the prune keeps the union of the rig and the focus',
    body.includes('vegCellOf(state.x, state.z)') && /far\(kx, kz, cx, cz\) && far\(kx, kz, vcx, vcz\)/.test(body),
    body.slice(0, 400));
}
// …and the streamer is still handed the rig, with the focus asking for its own
// small ring rather than replacing the wedge.
{
  const at = source.indexOf('function streamWorld(');
  const end = source.indexOf('\nfunction ', at + 10);
  const body = source.slice(at, end);
  ok('the stream pass reads the render focus', body.includes('renderFocusXZ()'), 'streamWorld');
  ok('…and pins the tiles it asks for, so the rig\'s wedge cannot drop them',
    body.includes('osmFocusPin.add('), 'streamWorld');
  ok('…and the wedge itself is still the rig\'s', body.includes('osmCarX = ex; osmCarZ = ez;'), 'streamWorld');
}

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
