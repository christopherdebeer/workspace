// Hat-throwers' rules, on their own: the same seed is the same species and patch; all four kinds
// come up; a stalk's day runs in order; an ascus ripens before it fires.
// (node cells/lab/devtools/fungi.test.mjs)
import { build } from 'esbuild';
import assert from 'node:assert/strict';
const out = await build({ entryPoints: [new URL('../client/fungi/genome.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
const { species, patch, cushions, litter, state, ascusState, along, radius, DAY } = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));

assert.deepEqual(species(31), species(31));
// the tall ones: a bell on a stem, and they never ink
for (const kind of ['mottlegill', 'fieldcap']) for (let seed = 1; seed <= 12; seed++) {
  const g = species(seed, kind);
  assert.equal(g.form, kind);
  for (const st of patch(seed, g)) {
    assert.ok(st.bell > 0 && st.ink === 0 && st.len > 25, `${kind}: a capped stem`);
    assert.equal(state(st, st.t1 + 10).inked, 0, `${kind}: doesn't ink`);
  }
}
// the second wave's kinds, asked for: an eyelash cup's saucers, the flasks
for (const kind of ['eyelash', 'flask']) for (let seed = 1; seed <= 20; seed++) {
  const g = species(seed, kind);
  assert.equal(g.form, kind);
  for (const st of patch(seed, g)) assert.ok(st.t0 < st.t1 && st.tl > 1e8 && (kind === 'eyelash' ? st.bell > 0 : st.bell === 0));
}
assert.deepEqual(patch(31, species(31)), patch(31, species(31)));
const forms = {};
for (let seed = 1; seed <= 300; seed++) {
  const g = species(seed);
  (forms[g.form] ??= []).push(seed);
  const ps = patch(seed, g);
  const cs = cushions(seed, g);
  litter(seed, g);
  if (g.form === 'cup') {
    assert.equal(ps.length, 0);
    assert.equal(cs.length, g.count);
    for (const c of cs) for (const a of c.asci) {
      assert.ok(a.t0 < a.tr && a.tr < a.tl && a.tl < DAY + 4);
      const s = ascusState(a, a.tl - 0.01);
      assert.ok(s.up === 1 && s.ripe === 1 && s.fired < 0);
    }
    continue;
  }
  assert.equal(ps.length, g.count);
  for (const st of ps.slice(0, 10)) {
    assert.ok(st.t0 < st.t1 && st.t1 < st.tv);
    if (g.throws) assert.ok(st.tl > st.tv && st.tl < DAY, `seed ${seed}: throws at ${st.tl}`);
    const mid = state(st, st.tv + 1.5);
    assert.ok(mid.grown === 1 && (!g.throws || mid.swell > 0.5));
    if (g.form === 'thrower' || g.form === 'pin') {
      const top = Math.max(...[0.85, 0.9, 0.95, 0.98, 0.99].map((u) => radius(st, mid, u)));
      assert.ok(top > radius(st, mid, 0.5), `seed ${seed}: a head on it`);
    }
    if (g.form === 'inkcap') {
      assert.ok(st.bell > 0);
      const late = state(st, st.t1 + (st.t1 - st.t0) * 1.7);
      assert.ok(late.open > 0.95, `seed ${seed}: open in its own time`);
    }
    assert.ok(along(st, mid, 1).p[1] > 0);
  }
}
for (const f of ['thrower', 'pin', 'inkcap', 'cup']) {
  console.log(f.padEnd(8), forms[f].length, 'e.g.', forms[f].slice(0, 6).join(' '));
  assert.ok(forms[f].length > 20, f);
}
console.log('ok');

// the terrarium: the succession runs in order, and the early ones give out before the end
{
  const out2 = await build({ entryPoints: [new URL('../client/fungi/terrarium.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
  const { terrarium, DAYS } = await import('data:text/javascript;base64,' + Buffer.from(out2.outputFiles[0].text).toString('base64'));
  const order = { pin: 0, thrower: 0, cup: 1, eyelash: 1, flask: 1, fieldcap: 2, inkcap: 2, mottlegill: 2 };
  for (const seed of [1, 2, 3, 5, 8]) {
    const t = terrarium(seed);
    assert.ok(t.species.length >= 2, `seed ${seed}: a cast`);
    const first = (s) => Math.min(...(s.g.form === 'cup' ? s.cups : s.stalks).map((x) => x.t0), Infinity);
    const last = (s) => Math.max(...(s.g.form === 'cup' ? s.cups : s.stalks).map((x) => x.t0), -Infinity);
    // (the early and middle ones always fruit; a late one, costly, on worn-out dung, may not)
    for (const s of t.species) if (!['fieldcap', 'mottlegill'].includes(s.g.form)) assert.ok(first(s) < DAYS * 24, `seed ${seed}: ${s.g.form} fruits`);
    for (const a of t.species) for (const b of t.species) {
      if (order[a.g.form] < order[b.g.form] && first(b) < Infinity) assert.ok(first(a) < first(b), `seed ${seed}: ${a.g.form} before ${b.g.form}`);
    }
    for (const s of t.species) if (s.g.form === 'thrower' || s.g.form === 'pin') assert.ok(last(s) < (DAYS - 3) * 24, `seed ${seed}: ${s.g.form} gives out`);
    assert.ok(t.moments.length > 10);
    // what it leaves: thrown caps and spores, each for a while; a cap held only by what's standing
    for (const m of t.marks) {
      assert.ok(m.t0 < m.t1, `seed ${seed}: a mark lasts`);
      if (m.on) assert.ok(m.t1 <= m.on.st.tEnd, `seed ${seed}: a cap held no longer than its host`);
    }
  }
  // the second wave turns up in some, after the first
  // the loops: fruiting draws down its reserves; the grazers are where the animals are
  {
    const t = terrarium(3);
    assert.ok(t.grazers.length === t.ground.length && t.grazers.some((g) => g.some((v) => v > 0.25)), 'grazers come');
  }
  const lates = new Set();
  for (let seed = 1; seed <= 12; seed++) for (const s of terrarium(seed).species) lates.add(s.g.form);
  assert.ok(lates.has('eyelash') && lates.has('flask'), 'eyelash cups and flasks come');
  // the animals: some of each, in the dung, while there's dung; climbers gone with the sporangium
  const out3 = await build({ entryPoints: [new URL('../client/fungi/critters.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
  const { critters, drawCritters, limbs, zoo, whereIs, ROWW, MAXP } = await import('data:text/javascript;base64,' + Buffer.from(out3.outputFiles[0].text).toString('base64'));
  const t2 = terrarium(2);
  const c = critters(2, t2);
  assert.ok(c.worms.length > 10 && c.mites.length > 3 && c.springs.length > 3, 'nematodes, mites, springtails');
  assert.ok(c.mites.some((m) => m.kind === 'macro') && c.springs.length > 0, 'kinds');
  // (a passenger goes where its sporangium goes)
  for (const w of c.worms) if (w.on) assert.ok(w.t1 >= w.on.st.tl && (w.on.st.launch.end.kind !== 'away' || w.t1 - w.on.st.tl < 0.01));
  // the throw: one record — released from the tip, slowed by the air, and where it ends is where
  // its residue is
  for (const sp of t2.species) for (const st of sp.stalks) {
    const l = st.launch;
    if (!sp.g.throws) continue;
    assert.ok(l && l.path.length >= 8, 'a path');
    const n = l.path.length / 4;
    const v1 = Math.hypot(l.path[5] - l.path[1], l.path[6] - l.path[2], l.path[7] - l.path[3]) / (l.path[4] - l.path[0] || 1);
    assert.ok(Math.hypot(...l.v0) > 6000, 'fast off');
    assert.ok(l.path[(n - 1) * 4] > 0, 'it flies');
    if (l.end.kind === 'stalk' || l.end.kind === 'bell') {
      const m = t2.marks.find((k) => k.on && k.on.st === l.end.host && Math.abs(k.t0 - (st.tl + l.end.t / 3600)) < 1e-9);
      assert.ok(m, 'its residue where it stuck');
    }
    void v1;
  }
  // drawn as limbs: whole rows, finite, each with 2..MAXP points; up close, all their parts
  const near = (list) => [list.hi, list.mid, list.lo, list.glassHi, list.glassMid];
  for (const kind of ['macro', 'ori', 'hypo', 'iso', 'ento', 'worm']) {
    const z = zoo(kind, 3);
    for (const time of [0, 1.7, 33.3]) {
      const out = limbs();
      drawCritters(z, 10, time, () => 0, [0, 1.5, 2.5], out);
      const rows = near(out).reduce((n, l) => (assert.equal(l.length % (ROWW * 4), 0), n + l.length / (ROWW * 4)), 0);
      assert.ok(rows >= (kind === 'worm' ? 1 : 8), `${kind}: built of limbs (${rows})`);
      for (const l of near(out)) {
        assert.ok(l.every(Number.isFinite), `${kind}: finite`);
        for (let i = 0; i < l.length; i += ROWW * 4) {
          const n = l[i + MAXP * 4 + 4];
          assert.ok(n >= 2 && n <= MAXP, `${kind}: points ${n}`);
        }
      }
      const p = whereIs(z, 0, 10, time, () => 0);
      assert.ok(p && p.every(Number.isFinite));
    }
  }
  for (const T of [60, 200, 400]) {
    const out = limbs();
    drawCritters(c, T, 3.3, () => 0, [0, 20, 30], out);
    assert.ok(near(out).every((l) => l.every(Number.isFinite)), `T ${T}: drawn finite`);
  }
  console.log('terrarium ok');
}

// the field: the world's hour is the local one; which pat is where, and when it fell, is the
// same however and whenever you ask; a pat is moved whole into place and time
{
  const out4 = await build({ entryPoints: [new URL('../client/fungi/pasture.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'node' });
  const { worldNow, dateOf, dropsNear, place, patHeight, PAT_LIFE, PAT_GONE } = await import('data:text/javascript;base64,' + Buffer.from(out4.outputFiles[0].text).toString('base64'));
  // (06:30 UTC on 4 October is 07:30 in the field, which keeps British Summer Time)
  const now = new Date(Date.UTC(2026, 9, 4, 6, 30));
  const T = worldNow(now);
  assert.ok(Math.abs(((T + 21) % 24) - 7.5) < 1e-6, 'local hour');
  assert.equal(dateOf(T).getUTCHours(), 7);
  const a = dropsNear(1, 0, 0, T, 300);
  assert.ok(a.length > 5, 'pats about');
  assert.equal(new Set(a.map((d) => d.seed)).size, a.length, 'no pat twice');
  for (const d of a) {
    assert.ok(T - d.drop <= PAT_GONE && d.drop <= T + 24);
    assert.equal(((d.drop % 24) + 24) % 24, 0, 'dropped at nine in the evening');
    // (asked from elsewhere, or a few days on while it's still there: the same pat)
    const b = dropsNear(1, d.x + 40, d.z - 30, T + 50, 120).find((e) => e.seed === d.seed);
    if (T + 50 - d.drop < PAT_GONE) assert.ok(b && b.x === d.x && b.drop === d.drop, 'the same pat');
  }
  const ages = a.map((d) => (T - d.drop) / 24);
  assert.ok(Math.min(...ages) < 21 && Math.max(...ages) > 21, 'young and old');
  assert.equal(patHeight(-1), 0);
  assert.ok(patHeight(PAT_LIFE - 1) > 3 && patHeight(PAT_GONE + 1) === 0);
  const d = a[0];
  const p = place(d);
  const st = p.terr.species[0].stalks[0];
  if (st) assert.ok(st.t0 > d.drop && Math.hypot(st.base[0] - d.x, st.base[2] - d.z) < 40, 'moved into place and time');
  for (const m of p.terr.moments) assert.ok(m.T > d.drop);
  for (const w of p.crit.worms) assert.ok(w.t1 > d.drop);
  console.log('pasture ok');
}
