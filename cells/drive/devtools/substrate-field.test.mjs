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
//     number into the shader instead of the table. SUB_CLS_K is the retiring
//     classifier's own set and is deliberately NOT in the shader: phase C took
//     that classifier out of the fragment, and the check says so out loud
//     rather than letting a dead constant sit in the shared table unnoticed.
//   - the MATERIAL TABLE. `SUB_MAT` is the source of record and the terrain
//     kernel inlines a copy, because the kernel's closure is stringified into
//     a worker and may not touch a module binding. That is a real constraint,
//     so the duplicate is parsed out of the kernel's own source and compared —
//     the trick perf-check.mjs uses for refreshVeg, and the only kind of check
//     that can hold a duplicate honest.
//   - the NOISE, by its statistics. subDomainAt is a float64 port of a float32
//     shader function and cannot be compared value for value to something that
//     does not run here; what the weights actually read of it is its mean, its
//     range and that two samples a patch apart have decorrelated.
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

console.log('\nthe retiring classifier still does what it did (phase D takes it):');
{
  const ev = M.subEvidence(0.711, 0.727, 0.746);   // the Yosemite granite reading
  check(ev.warm < 0, `pale granite reads COOL (warm ${ev.warm.toFixed(3)}) — the gate the cover class had to rescue`);
  const bare = M.subWeightsOf(M.subMatOf(60, 0.03), ev.veg, ev.warm, 0.5);
  check(bare.rock > 0.3 && bare.soil > 0.3,
    `and still classifies as outcrop and regolith (rock ${bare.rock.toFixed(3)}, soil ${bare.soil.toFixed(3)})`);
  const snow = M.subEvidence(0.92, 0.94, 0.97);
  const ice = M.subWeightsOf(M.subMatOf(70, 0.05), snow.veg, snow.warm, 0.5);
  check(ice.rock + ice.soil + ice.turf < 0.01,
    `a snowfield is left alone entirely (${(ice.rock + ice.soil + ice.turf).toFixed(4)})`);
  const sea = M.subWeightsOf(M.subMatOf(80, 0), 0, 0, 0.5);
  check(sea.turf < 0.01, 'open water grows no turf');
  // The grass factor is a multiplier, and the doctrine says which way it runs.
  check(M.subGrassFactor({ rock: 0, soil: 0, turf: 1 }) > 0.95, 'turf allows grass');
  check(M.subGrassFactor({ rock: 1, soil: 0, turf: 0 }) < 0.25, 'outcrop does not');
  check(M.subGrassFactor({ rock: 0, soil: 1, turf: 0 }) > M.subGrassFactor({ rock: 1, soil: 0, turf: 0 }),
    'and dirt allows more than stone');
}

console.log(fails ? `\n${fails} FAILURES` : '\nsubstrate-field: all ok');
process.exitCode = fails ? 1 : 0;
