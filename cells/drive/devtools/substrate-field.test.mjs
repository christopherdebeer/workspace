// THE SUBSTRATE'S TWO HALVES AGREE, IN PURE NODE.
//
//   node cells/drive/devtools/substrate-field.test.mjs
//
// The substrate runs in a fragment (which paints it) and on the main thread
// (where the sward seeder thins its grass on the same outcrop). Nothing here
// can run GLSL, so what is held is the three things that could actually make
// them disagree:
//
//   - the CONSTANTS. They live once in SUB_K and the shader source
//     interpolates them, so the check is that every one of them is literally
//     present in the emitted GLSL — which fails the moment someone types a
//     number into the shader instead of the table. The check that the RETIRED
//     classifier is absent from the shader stands beside it: phase C took it
//     out of the fragment and phase D took it off the sward, and two opinions
//     about the same ground is the fault the rewrite exists to end.
//   - the MATERIAL TABLE. `SUB_MAT` is the source of record and the terrain
//     kernel inlines a copy, because the kernel's closure is stringified into
//     a worker and may not touch a module binding. That is a real constraint,
//     so the duplicate is parsed out of the kernel's own source and compared —
//     the trick perf-check.mjs uses for refreshVeg, and the only kind of check
//     that can hold a duplicate honest.
//   - the NOISE, by its statistics. subDomainAt is a float64 port of a float32
//     shader function and cannot be compared value for value to something that
//     does not run here; what the fragment actually reads of it is its mean,
//     its range and that two samples a patch apart have decorrelated. Since
//     phase D's remainder the SWARD calls that port too: the fragment shifts
//     exposure and the mantle by an 18 m domain noise and the seeder was
//     reading the 33 m field underneath it, so the two agreed about the
//     landform and could disagree entirely about which patch of it is stone.
//     Which makes this the check that holds a port the game now depends on,
//     rather than one that holds a function only this file calls.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CELL = join(HERE, '..'), ROOT = join(HERE, '../../..');
const OUT = join(ROOT, 'node_modules/.cache/substrate-field');
mkdirSync(OUT, { recursive: true });
const BUNDLE = join(OUT, 'substrate-field.mjs');
execSync(`npx esbuild ${join(CELL, 'client/substrate-field.ts')} --bundle --platform=node --format=esm --outfile=${BUNDLE}`,
  { stdio: 'inherit' });
const M = await import(BUNDLE);

let fails = 0;
const check = (ok, what) => { console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) fails++; };

console.log('the diagnostics keep their two authority contracts distinct:');
{
  const main = readFileSync(join(CELL, 'client/main.ts'), 'utf8');
  const views = readFileSync(join(CELL, 'devtools/substrate-views.mjs'), 'utf8');
  const migrationAssignments = main.match(/\.__substrate\s*=/g) ?? [];
  const fieldAssignments = main.match(/\.__substrateField\s*=/g) ?? [];
  check(migrationAssignments.length === 1,
    `the production migration owns __substrate exactly once (${migrationAssignments.length})`);
  check(fieldAssignments.length === 1,
    `the geomorphic point probe owns __substrateField exactly once (${fieldAssignments.length})`);
  check(views.includes('window.__substrateField()') && !views.includes('window.__substrate()'),
    'the field visualizer reads the field probe, not the migration snapshot');

  console.log('\nthe material relief is the substrate\'s own lighting layer:');
  check(main.includes('sh.uniforms.uSubNrm = tdU.uSubNrm'),
    'the live relief dial reaches every detailed terrain shader');
  check(main.includes(".replace('#include <normal_fragment_maps>'"),
    'material relief is layered after the DEM/object-space normal map');
  check(main.includes('dFdx(subRelief)') && main.includes('dFdy(subRelief)'),
    'the lighting normal differentiates the same scalar the material tones produced');
  check(main.includes('subRelief = rockR * e.y') && main.includes('mantleR * e.x'),
    'rock and mantle structure contribute relief');
  // ── AND IT IS THE STRUCTURE, NOT THE TONE ──
  //
  // Each builder returns its relief separately from its colour, because the
  // relief pass bends the normal by a screen derivative and most of what a
  // tone carries has no shape: the rock's 70 m and 26 m massing lit a
  // hillside as though it were corrugated at seventy metres, over the
  // hillside the mesh had already drawn, and the mantle's damp term lit a wet
  // hollow as a dent in flat ground. A needle on the relief's own variables is
  // what stops the two being summed back together by an edit that reads as
  // tidying.
  check(!/subRelief\s*=[^;]*\b(rockT|mantleT|grassT)\b/s.test(main),
    'no tonal term bends the normal — colour and relief are separate returns');
  check(!main.match(/subRelief\s*=.*grassT/),
    'grass does not double-light the sward geometry');
  check(main.includes('uSubNrm > 0.001 && uSubAmt > 0.001'),
    'zero relief or zero substrate preserves the prior DEM-normal result');
  check(main.includes('relief?: number') && main.includes('clamp(opts.relief, 0, 4)'),
    '__tdetail exposes a 0..4 live relief dial');
}

console.log('the constants reach the shader:');
{
  const glsl = M.SUB_GLSL;
  const missing = Object.entries(M.SUB_K)
    // A constant the shader has no use for would be a false failure; every one
    // of these is read by a layer transform or by subExpress, so all of them
    // must appear. If that stops being true, name the exemption here.
    .filter(([, v]) => !glsl.includes(String(v)));
  check(missing.length === 0,
    `every SUB_K constant is in the emitted GLSL${missing.length ? ` — missing ${missing.map((m) => m[0]).join(', ')}` : ''}`);
  // AND THE CLASSIFIER'S CONSTANTS ARE NOT. This is the check that fails if
  // someone puts subWeights back into the fragment beside the layered model:
  // two opinions about the same ground is the fault phase C exists to end, and
  // it would show as a shader that classifies AND composites.
  check(!glsl.includes('subWeights('),
    'the retired classifier is not in the shader');

  // ── BAND D: THE HALF-METRE HAS ONE OWNER ──
  //
  // The band was never empty — the detail cascade's third octave has drawn at
  // 0.25 m since long before any of this, keyed on the cover class, so a
  // granite face and a ploughed field wore the same speckle a metre from the
  // wheel. What is held here is that the material's own answer REPLACED it
  // rather than joining it, in both directions: the micro terms are called
  // (an uncalled function is a texture nobody sees) and the octave stands
  // down where they draw (two noises describing one half-metre is worse than
  // either alone).
  const rockBody = glsl.slice(glsl.indexOf('float subRockTone('), glsl.indexOf('// ── LAYER B'));
  const mantleBody = glsl.slice(glsl.indexOf('float subMantleTone('), glsl.indexOf('// ── LAYER C'));
  check(rockBody.includes('subRockMicro(gp, dip, fam, px)'),
    'the rock tone carries its own micro-structure');
  check(mantleBody.includes('subMantleMicro(gp, scree, px)'),
    'the mantle tone carries its own micro-structure');
  // AND IT HAS A DIAL, because a band with two possible owners cannot be
  // judged without handing it back to the other one on the same settled world.
  check(/mic > 0\.001/.test(rockBody) && /mic > 0\.001/.test(mantleBody),
    'both micro terms scale with the live band-D dial');
  // AND IT IS INSIDE THE TONE, NOT BESIDE IT, which is what makes the relief
  // free: subRelief differentiates rockT and mantleT and nothing else, so a
  // micro term added anywhere else would be colour with no light on it.
  check(!glsl.includes('subRockMicro') || glsl.indexOf('float subRockMicro(') < glsl.indexOf('float subRockTone('),
    'subRockMicro is defined before its caller — GLSL ES has no forward declarations');
  check(glsl.indexOf('float subMantleMicro(') < glsl.indexOf('float subMantleTone('),
    'subMantleMicro is defined before its caller');
  // EVERY MICRO TERM IS BAND-LIMITED. This is the band closest to the eye and
  // therefore the one furthest from Nyquist where it draws — and the one that
  // aliases hardest a few metres further on. Each term carries its own tdBand,
  // and the hairlines and chips carry a px gate above them as well, so a
  // fragment past the band pays a compare rather than eight hashes.
  const micro = glsl.slice(glsl.indexOf('float subRockMicro('), glsl.indexOf('// ── LAYER A'));
  //
  // The HAIRLINES are the exemption and are exempt by construction: a line is
  // filtered on its own phase by subLine (fwidth), which is the only filter
  // that can be right for one — a crack read along a dip presents a different
  // period to the screen than it has in the ground, and only the derivative
  // knows which. They carry a px gate above them instead, so the exemption
  // costs nothing at range either.
  const bands = [...micro.matchAll(/tdBand\(px, ([\d.]+)\)/g)].map((m) => Number(m[1]));
  check(bands.length === 4, `every isotropic micro term is band-limited (${bands.length} tdBand calls)`);
  check(bands.every((b) => b <= 0.5), `and all of them inside band D (worst ${Math.max(...bands)} m)`);
  const lines = [...micro.matchAll(/subLine\(/g)];
  check(lines.length === 2 && /if \(px < 0\.1/.test(micro),
    `the hairlines are phase-filtered and gated on the footprint (${lines.length} subLine calls)`);
}

console.log('\nthe half-metre has one owner, not two:');
{
  const main = readFileSync(join(CELL, 'client/main.ts'), 'utf8');
  // THE FIELD IS READ ONCE, ABOVE BOTH CONSUMERS. The shares used to be
  // computed with the substrate, below the cascade, because nothing above them
  // needed to know; band D is what made the cascade need to know. A second
  // read would be a second opinion, which is the fault this whole programme
  // exists to end — so the check is that there is exactly one subExpress call
  // in the fragment and the stand-down reads what it produced.
  const express = main.match(/=\s*subExpress\(/g) ?? [];
  check(express.length === 1,
    `the fragment expresses the shares exactly once (${express.length})`);
  check(main.indexOf('= subExpress(') < main.indexOf('diffuseColor.rgb *= mix(1.0, 0.955'),
    'and does it above the cascade, which is the consumer that needed moving');
  // AND THE CASCADE'S PEDESTAL FOLLOWS ITS DIAL. A fixed 0.955 left a 4.5%
  // luminance step at amount 0, so the control every cascade-versus-substrate
  // comparison is taken against was not a control at all.
  check(main.includes('diffuseColor.rgb *= mix(1.0, 0.955 + d, uTdAmt)'),
    'amount 0 is the palette exactly, not the palette times 0.955');
  check(main.includes('float subMicro = clamp((e.x + e.y)'),
    'the stand-down is the MINERAL share — a meadow expresses almost none of it and keeps its octave');
  // AND THE HANDOVER IS ONE NUMBER IN BOTH DIRECTIONS. uSubMic scales the
  // micro terms and the stand-down together, so micro 0 is the octave whole
  // with no micro under it — the exact world before band D — and no setting of
  // it can leave the half-metre drawn twice or drawn by nobody.
  check(/subMicro = clamp\(\(e\.x \+ e\.y\)[^;]*clamp\(uSubMic/s.test(main),
    'the stand-down is scaled by the same dial the micro terms are');
  check(main.includes('subFam(family), px, pxN, uSubMic, rockR)') && main.includes('mo, px, pxN, uSubMic, mantleR)'),
    'and both tone builders are handed it, beside their relief out-parameter');
  check(main.includes("if (opts?.micro !== undefined) tdU.uSubMic.value = clamp(opts.micro, 0, 2)"),
    '__tdetail({micro}) is the 0..2 live A/B');
  check(/tdBand\(px, 0\.25\)\s*\*\s*\(1\.0 - subMicro\)/.test(main),
    "the cascade's third octave stands down where the substrate draws band D");
  // …AND ONLY THE THIRD. The coarser octaves are 1 m and 4 m features and the
  // substrate says nothing at those scales through a micro term; standing them
  // down too would take texture off ground that has none to spare.
  check(!/tdBand\(px, 1\.0\)[^;]*subMicro/.test(main) && !/tdBand\(px, 4\.0\)[^;]*subMicro/.test(main),
    'and the metre and four-metre octaves are left alone');
}

console.log('\nthe sward reads the field per blade, not only per texel:');
{
  const main = readFileSync(join(CELL, 'client/main.ts'), 'utf8');
  // PHASE D LEFT TWO THINGS BEHIND, both per-blade decisions the seeder cannot
  // reach: how tall a tuft grows and what share of its plants are flowers. The
  // field reaches the vertex shader through ONE channel — sF.a, the mineral
  // share, which the sweep writes as a MAX of the bank's stony margin and the
  // substrate's own expressed rock. What is held here is that both terms read
  // that one channel and that neither restates the density rule.
  check(/float sMineral = clamp\(sF\.a, 0\.0, 1\.0\) \* clamp\(uSwardMic/.test(main),
    'the per-blade terms read the field texture\'s mineral channel');
  check(main.includes('sFlowerChance *= 1.0 - 0.55 * sMineral'),
    'the flower rate thins on it');
  check(/float sShort = \(sIsStone \|\| sIsReed\) \? 1\.0 : 1\.0 - 0\.42 \* sMineral/.test(main),
    'the tuft grows shorter on it — and a stone and a reed are exempt');
  check(main.includes('* sShort * sRangeScale * sAlive'),
    'and the shortening reaches the blade, not only a variable');
  // THE MINERAL SHARE IS A MAX, NOT A SUM. A stony bank below a cliff is not
  // twice as stony as either fact warrants, and a sum would take it past 1.
  check(main.includes('if (subMineral > swardScratchF[k + 3]) swardScratchF[k + 3] = subMineral'),
    'the sweep MAXes the substrate\'s rock with the bank\'s, and does not add them');
  // AND IT HAS A DIAL, for the same reason band D does: swardsub is read once
  // at boot, so without one the frame comparison would be two boots.
  check(main.includes('uSwardMic: { value: SUB_SWARD ? 1 : 0 }'),
    'swardsub=0 still turns the whole of phase D off, dial included');
  check(main.includes('__swardmic') && main.includes('swardU.uSwardMic.value = clamp(v, 0, 1)'),
    '__swardmic(0..1) is the live A/B');
  // …AND THE CHECK THAT NEARLY SHIPPED UNSOUND. The first version of this
  // asserted the EMITTED glsl does not contain a weight expression, meaning to
  // catch a number typed into the shader instead of the table. It cannot: a
  // template literal produces byte-identical text either way, which is the
  // whole point of interpolation. The sound check is on the SOURCE.
  //
  // It is pointed at subExpress, which is where the shared arithmetic lives
  // now: how much of each LAYER is expressed is the thing the sward will have
  // to agree with in phase D. The structure functions beside it are the
  // shader's alone — a wavelength in metres and an amplitude in palette steps
  // are nobody else's business — and are literals by right, exactly as the
  // detail cascade's are.
  const ts = readFileSync(join(CELL, 'client/substrate-field.ts'), 'utf8');
  const expr = ts.slice(ts.indexOf('vec3 subExpress('), ts.indexOf('// ── AND THE COMPOSITE'));
  check(expr.length > 100, 'subExpress is where this check looks for it');
  // 0.0, 0.5 and 1.0 are exempt and are the only exemptions: they are clamp
  // bounds and the domain's own midpoint, which is the DEFINITION of "shift
  // either way about the mean" rather than a number anyone would tune.
  const literals = [...expr.matchAll(/[*+\-] (\d+\.\d+)/g)]
    .map((m) => m[1]).filter((v) => v !== '0.5' && v !== '0.0' && v !== '1.0');
  check(literals.length === 0,
    `no share constant is typed into the shader source as a literal${literals.length ? ` — ${literals.join(', ')}` : ''}`);
}

console.log('\nthe kernel\'s inlined material table matches the source of record:');
{
  const src = readFileSync(join(CELL, 'client/terrain-kernel.ts'), 'utf8');
  const block = src.match(/const TD_MAT: Record<number, \[number, number\]> = \{([\s\S]*?)\n\s*\};/);
  check(!!block, 'the kernel still declares TD_MAT where this check looks for it');
  if (block) {
    const got = {};
    for (const m of block[1].matchAll(/(\d+):\s*\[([\d.]+),\s*([\d.]+)\]/g)) {
      got[Number(m[1])] = [Number(m[2]), Number(m[3])];
    }
    const keys = Object.keys(M.SUB_MAT).map(Number).sort((a, b) => a - b);
    const kk = Object.keys(got).map(Number).sort((a, b) => a - b);
    check(kk.length === keys.length && kk.every((k, i) => k === keys[i]),
      `the same classes (${kk.join(' ')})`);
    const bad = keys.filter((k) => !got[k] || got[k][0] !== M.SUB_MAT[k][0] || got[k][1] !== M.SUB_MAT[k][1]);
    check(bad.length === 0,
      `every class has the same [rough, grain]${bad.length ? ` — ${bad.join(', ')} differ` : ''}`);
  }
}

console.log('\nthe domain is the same field:');
{
  let n = 0, sum = 0, lo = 1, hi = 0;
  for (let i = 0; i < 4000; i++) {
    const v = M.subDomainAt(i * 7.3 - 9000, i * -4.1 + 3000);
    n++; sum += v; lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const mean = sum / n;
  check(Math.abs(mean - 0.5) < 0.04, `mean is a half (${mean.toFixed(4)}) — the weights shift by (dom - 0.5)`);
  check(lo >= 0 && hi <= 1, `clamped to 0..1 (${lo.toFixed(3)}..${hi.toFixed(3)})`);
  check(hi - lo > 0.7, `and actually spans it (${(hi - lo).toFixed(3)})`);
  // Two samples a patch apart must have forgotten each other, or there is no
  // patchwork — just a slow drift, which is what the mottle already was.
  const corr = (step) => {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, m = 0;
    for (let i = 0; i < 3000; i++) {
      const x = i * 3.7 - 5000, z = i * -2.3 + 1200;
      const a = M.subDomainAt(x, z), b = M.subDomainAt(x + step, z + step);
      m++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    }
    const cov = sab / m - (sa / m) * (sb / m);
    return cov / Math.sqrt(Math.max(1e-9, saa / m - (sa / m) ** 2) * Math.max(1e-9, sbb / m - (sb / m) ** 2));
  };
  const near = corr(1), far = corr(40);
  check(near > 0.8, `a metre apart is the same patch (${near.toFixed(3)})`);
  check(Math.abs(far) < 0.3, `forty metres apart is a different one (${far.toFixed(3)})`);
}

console.log('\nthe layered model expresses what the doctrine says:');
{
  // ── THE ONE CLAIM PHASE C IS ABOUT ── the three shares are not a partition:
  // the substrate is everywhere, including under dense sward, and vegetation
  // decides how much of it is VISUALLY EXPRESSED rather than whether it exists.
  // So a well-grassed hillside must still show some rock, and a cliff must not
  // lose its rock to a mantle.
  // grain is the cover class's own [rough, grain] — 0.85 bare, 0.15 grassland,
  // 0.00 snow — and it is here only as the snow veto. See subExpress.
  const ex = (a) => M.subExpressOf(a.ex, a.db, a.sd, a.gpot, a.veg, a.grain ?? 0.85);
  const meadow = ex({ ex: 0.15, db: 0.05, sd: 0.75, gpot: 0.72, veg: 0.22, grain: 0.15 });
  check(meadow.grass > 0.4, `a meadow is grassed (${meadow.grass.toFixed(3)})`);
  check(meadow.rock > 0.01,
    `and its bedrock is still expressed through the sward (${meadow.rock.toFixed(4)}) — never zero`);
  const cliff = ex({ ex: 0.92, db: 0.05, sd: 0.05, gpot: 0.15, veg: 0.05 });
  check(cliff.rock > 0.8, `a face is mostly bare rock (${cliff.rock.toFixed(3)})`);
  check(cliff.mantle < 0.15, `and sheds its mantle (${cliff.mantle.toFixed(3)})`);
  check(cliff.rock > meadow.rock * 8, 'a face shows far more rock than a meadow does');
  const apron = ex({ ex: 0.35, db: 0.80, sd: 0.20, gpot: 0.30, veg: 0.10 });
  check(apron.mantle > 0.5, `an apron is mantled (${apron.mantle.toFixed(3)})`);
  check(apron.rock < cliff.rock, 'and shows less rock than the face above it');
  // A SNOWFIELD IS STILL VETOED BY THE PALETTE. grassPot is a topographic
  // argument and is blind to climate, so without the palette's own green a flat
  // high basin would grow a lawn on it.
  const snow = ex({ ex: 0.10, db: 0.05, sd: 0.60, gpot: 0.80, veg: -0.02, grain: 0 });
  check(snow.grass < 0.01, `a snowfield grows nothing (${snow.grass.toFixed(4)})`);
  // ── AND THE VETO THE FIELD CANNOT SUPPLY ── a flat glacier in a cirque has
  // soil depth and debris by every topographic argument there is, so without
  // the cover class's own grain the mantle would paint it with the fines'
  // oxidised warmth and it would come out beige.
  check(snow.mantle + snow.rock < 0.01,
    `and is left alone entirely (mantle ${snow.mantle.toFixed(4)}, rock ${snow.rock.toFixed(4)})`);
  const thaw = ex({ ex: 0.10, db: 0.05, sd: 0.60, gpot: 0.80, veg: -0.02, grain: 0.85 });
  check(thaw.mantle > 0.5,
    `…and the SAME ground on a bare cover class is mantled (${thaw.mantle.toFixed(3)}) — a veto on two classes, not a classifier`);
}

console.log('\nthe transforms the sward and the fragment share:');
{
  // ── THE ONE THING PHASE D LEFT SHARED, AND IT HAS TO BE ── a blade fades
  // toward the ground it stands in, so `subLayerTint` must be the fragment's
  // own composite. What is checked is the CLAIM rather than the arithmetic:
  // rock pulls the chroma out and cools, fines warm, grass greens, and none of
  // the three moves luminance more than a fraction of a palette step (0.07
  // sRGB), because a brightness difference reads as a different TONE and a hue
  // difference reads as a different MATERIAL.
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const ground = [0.52, 0.50, 0.44];
  const only = (k) => ({ mantle: 0, rock: 0, grass: 0, [k]: 1 });
  const rock = M.subLayerTint(...ground, only('rock'));
  const fines = M.subLayerTint(...ground, only('mantle'));
  const grass = M.subLayerTint(...ground, only('grass'));
  const chroma = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
  check(chroma(rock) < chroma(ground) * 0.5,
    `bedrock pulls the chroma out (${chroma(ground).toFixed(3)} to ${chroma(rock).toFixed(3)})`);
  check(rock[2] / rock[0] > ground[2] / ground[0], 'and cools it');
  check(fines[0] / fines[2] > ground[0] / ground[2],
    `the fines oxidise warm (${(fines[0] / fines[2]).toFixed(2)} against ${(ground[0] / ground[2]).toFixed(2)})`);
  check(grass[1] / grass[0] > ground[1] / ground[0], 'and the grassy complement greens');
  const step = 0.07;
  for (const [name, c] of [['rock', rock], ['fines', fines], ['grass', grass]]) {
    check(Math.abs(lum(c) - lum(ground)) < step * 0.8,
      `${name} holds luminance to under a palette step (${(lum(c) - lum(ground)).toFixed(4)})`);
  }
  // Nothing is composited at all where the shares are zero: the painter's own
  // colour is the honest answer for ground the layers do not describe.
  const none = M.subLayerTint(...ground, { mantle: 0, rock: 0, grass: 0 });
  check(none.every((v, i) => Math.abs(v - ground[i]) < 1e-9), 'no share leaves the palette alone');
  // …and the snow veto's input comes off the same table the kernel copies.
  check(M.subGrainOf(70) === 0 && M.subGrainOf(80) === 0,
    'snow and water carry grain 0 — the veto is a veto on two classes');
  check(M.subGrainOf(60) > 0.5 && M.subGrainOf(40) > 0 && M.subGrainOf(null) === 0.5,
    'bare ground is mineral, cropland is not snow, and unmapped abstains');
}

console.log(fails ? `\n${fails} FAILURES` : '\nsubstrate-field: all ok');
process.exitCode = fails ? 1 : 0;
