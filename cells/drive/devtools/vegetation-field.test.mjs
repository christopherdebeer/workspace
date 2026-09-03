/**
 * VEGETATION DISTRIBUTION TESTS — no browser, no renderer, no truck.
 *
 *   node cells/drive/devtools/vegetation-field.test.mjs
 *
 * The distribution maths was extracted to `client/vegetation-field.ts` precisely
 * so these questions could be answered in a millisecond instead of over a
 * five-minute harness boot. Two of them cost real time to find the hard way:
 *
 *  - THE MEMBER BUDGET. Counting accepted GROUPS against the old clump demand
 *    spends fewer instances than the old code, because a fringe group carries
 *    about half a stand's membership. Measured in-world as roughly half the
 *    vegetation gone at mid-density fixtures. The parity test below fails on
 *    that in under a second.
 *  - CELL-BOUNDARY CONTINUITY. The whole point of sampling density per
 *    candidate rather than once per cell is that a stand crosses a 220m bucket
 *    edge without a step. That is a property of the field, testable directly.
 *
 * Same esbuild route as climate.test.mjs: the module under test is the one the
 * game ships.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'vegfield-'));
const built = join(tmp, 'vegetation-field.mjs');
execFileSync('npx', ['esbuild', join(HERE, '../client/vegetation-field.ts'),
  '--bundle', '--format=esm', `--outfile=${built}`],
{ cwd: join(HERE, '../../..'), stdio: 'pipe' });
const {
  VEGETATION_DISTRIBUTION: D, vegetationCandidate, vegetationClumpChance,
  vegetationClumpRole, vegetationDensity, vegetationLivingChance, vegetationRoleWeights,
} = await import(pathToFileURL(built).href);

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const VEG_CELL = 220;

// ── the candidate set is bounded, stratified and stable ──
{
  const c = Array.from({ length: D.clumpCandidates },
    (_, i) => vegetationCandidate(7, -3, i, D.clumpCandidates, 0x2a1f4d31));
  ok('every candidate lies inside its own cell',
    c.every((q) => q.u >= 0 && q.u < 1 && q.v >= 0 && q.v < 1),
    c.filter((q) => q.u < 0 || q.u >= 1 || q.v < 0 || q.v >= 1));
  // Stratification: a 5x5 lattice must put one candidate in each column band.
  const cols = Math.ceil(Math.sqrt(D.clumpCandidates));
  const perCol = new Array(cols).fill(0);
  for (const q of c) perCol[Math.min(cols - 1, Math.floor(q.u * cols))]++;
  ok('candidates are stratified, not clustered', perCol.every((n) => n === cols), perCol);
  // Determinism, which is what stops a plant moving on a rebuild or a revisit.
  const again = vegetationCandidate(7, -3, 11, D.clumpCandidates, 0x2a1f4d31);
  ok('a candidate is a pure function of cell, index and salt',
    again.u === c[11].u && again.v === c[11].v && again.accept === c[11].accept
      && again.role === c[11].role && again.seed === c[11].seed, [again, c[11]]);
  // Independent streams: acceptance, role and seed must not be correlated, or
  // changing one decision would silently move or reroll another.
  const acc = c.map((q) => q.accept), rol = c.map((q) => q.role);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const ma = mean(acc), mr = mean(rol);
  const cov = mean(acc.map((a, i) => (a - ma) * (rol[i] - mr)));
  const sd = (a, m) => Math.sqrt(mean(a.map((v) => (v - m) ** 2)));
  const corr = cov / (sd(acc, ma) * sd(rol, mr) || 1);
  ok('acceptance and role are independent rolls', Math.abs(corr) < 0.45, +corr.toFixed(3));
}

// ── the density field is continuous across cell boundaries ──
{
  // The behavioural change of step 2.1: density is a property of the POSITION,
  // so two candidates a metre apart either side of a bucket edge must agree.
  const edge = 12 * VEG_CELL;
  const a = vegetationDensity(edge - 0.5, 4000);
  const b = vegetationDensity(edge + 0.5, 4000);
  ok('density does not step at a 220m cell boundary', Math.abs(a - b) < 0.005,
    { a: +a.toFixed(4), b: +b.toFixed(4) });
  // …and it genuinely varies, or "continuous" would be trivially true.
  const span = [];
  for (let i = 0; i < 400; i++) span.push(vegetationDensity(i * 37, i * 53));
  ok('density spans a useful range',
    Math.max(...span) - Math.min(...span) > 0.5, [Math.min(...span), Math.max(...span)]);
  ok('density stays in 0..1', span.every((v) => v >= 0 && v <= 1), null);
}

// ── role weights ──
{
  const open = vegetationRoleWeights(0.02);
  const mid = vegetationRoleWeights(0.5);
  const dense = vegetationRoleWeights(0.95);
  ok('genuinely open ground forms no groups', open.clump === 0, open);
  ok('dense ground is all stand', dense.stand > 0.99 && dense.clump === 1, dense);
  ok('mid density is eligible for groups', mid.clump > 0.9, mid);
  // The fringe must be a TRANSITION, not a population that outlives the stand:
  // it has to fall away again at the top of the range.
  ok('the fringe response closes at high density',
    vegetationRoleWeights(0.99).fringe < 0.05, vegetationRoleWeights(0.99));
  // Clump weight must be monotone in density, or a denser patch could form
  // fewer groups than a thinner one beside it.
  let mono = true;
  for (let d = 0.02; d <= 1; d += 0.02) {
    if (vegetationRoleWeights(d).clump < vegetationRoleWeights(d - 0.02).clump - 1e-9) mono = false;
  }
  ok('clump weight is monotone in density', mono, null);
}

// ── THE MEMBER BUDGET: expected instances match the old implementation ──
{
  // The old code: clumps = round(ceiling * (floor + d*span)), every clump at
  // full membership. The new code accepts from a bounded candidate set and
  // gives fringe groups fringeCountMul of the membership, so parity has to be
  // asserted in MEMBERS. This is the test that catches the -50% regression.
  const relative = [];
  for (const ceiling of [4, 6, 9, 12, 14]) {
    for (let d = 0.25; d <= 0.95; d += 0.05) {
      const oldMembers = ceiling * (D.demandFloor + d * D.demandSpan);
      const w = vegetationRoleWeights(d);
      const fringeShare = w.fringe / (w.stand + w.fringe);
      const memberMul = 1 - fringeShare * (1 - D.fringeCountMul);
      const accepted = D.clumpCandidates * vegetationClumpChance(ceiling, d);
      relative.push((accepted * memberMul) / oldMembers);
    }
  }
  const lo = Math.min(...relative), hi = Math.max(...relative);
  ok('expected members track the old demand above open ground',
    lo > 0.9 && hi < 1.1, { lo: +lo.toFixed(3), hi: +hi.toFixed(3) });
  // And the acceptance rate must remain a probability.
  ok('clump chance is a probability',
    [0, 0.3, 0.6, 1].every((d) => [1, 14, 400].every((c) => {
      const p = vegetationClumpChance(c, d);
      return p >= 0 && p <= 1;
    })), null);
  ok('open ground accepts no clumps at any ceiling',
    vegetationClumpChance(14, 0.01) === 0, vegetationClumpChance(14, 0.01));
}

// ── clump role selection ──
{
  ok('open ground has no role to assign', vegetationClumpRole(0.01, 0.5) === null, null);
  ok('the densest ground reads as interior',
    vegetationClumpRole(0.98, 0.5) === 'interior', vegetationClumpRole(0.98, 0.5));
  // The split must follow the weights, so a low roll lands interior and a high
  // roll lands fringe rather than the pair being independent of density.
  const w = vegetationRoleWeights(0.55);
  const cut = w.stand / (w.stand + w.fringe);
  ok('the role split follows the stand share',
    vegetationClumpRole(0.55, cut * 0.5) === 'interior'
      && vegetationClumpRole(0.55, cut + (1 - cut) * 0.5) === 'fringe', cut);
}

// ── living strays ──
{
  const habitats = ['open', 'wood', 'water', 'cliff', 'ruin'];
  ok('every habitat has a stray floor',
    habitats.every((h) => vegetationLivingChance(h, 0.2) > 0), null);
  ok('woods and cliffs stay sparser than open ground',
    vegetationLivingChance('wood', 0.2) < vegetationLivingChance('open', 0.2)
      && vegetationLivingChance('cliff', 0.2) < vegetationLivingChance('open', 0.2), null);
  ok('water and ruin ground is richer than open',
    vegetationLivingChance('water', 0.2) > vegetationLivingChance('open', 0.2)
      && vegetationLivingChance('ruin', 0.2) > vegetationLivingChance('open', 0.2), null);
  // A stray inside a stand interior carries no information, so the floor has
  // to fade there rather than adding another plant among the canopy.
  ok('strays fade to nothing inside a strong interior',
    vegetationLivingChance('open', 0.95) < 1e-6, vegetationLivingChance('open', 0.95));
  ok('the stray floor is a long tail, not a population',
    habitats.every((h) => vegetationLivingChance(h, 0.2) < 0.2), null);
}

// ── anchors are rare enough to be memorable ──
{
  ok('anchor promotion is rare', D.anchorChance > 0 && D.anchorChance < 0.01, D.anchorChance);
}

console.log(bad ? `\n${bad} failed` : '\nall good — bounded candidates, continuous field, member parity');
process.exit(bad ? 1 : 0);
