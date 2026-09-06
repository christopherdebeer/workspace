/**
 * THE GUILD, ON AND OFF, AT REAL PLACES.
 *
 *   node cells/drive/devtools/guild-ab.mjs [site]
 *
 * `devtools/guild.test.mjs` proves the rules say what they mean; it says
 * nothing about whether the LANDSCAPE changed, because a rule that never
 * reaches the placement loop looks exactly like one that did. So this boots
 * the same spot twice — `?guild=1` and `?guild=0`, the only difference — and
 * reports what is standing in both, with a frame each.
 *
 * The numbers are the measurement and the frames are the judgement. Read
 * `perHa` first: a guild that changes the species list and not the density has
 * turned a wood into a differently-flavoured wood, which is not what a savanna
 * or a desert needs.
 */
import { openDrive } from './harness.mjs';

const SITES = {
  // The Cape: RESOLVE says fynbos, the five-biome model says temperate, and
  // the difference is a shrubland against a broadleaf wood.
  cape: { spot: 'lat=-34.0918&lon=18.3597&h=120', what: 'fynbos shrubland (RESOLVE 12, Afrotropic)' },
  // The Sahara: the realm gate. Cacti here are the old model's doing.
  sahara: { spot: 'lat=22.7900&lon=5.5300&h=90', what: 'West Saharan xeric woodland (13, Palearctic)' },
  // Yosemite: temperate conifer, where the two models should broadly AGREE —
  // the control, and the one that would expose a guild that changes everything.
  sierra: { spot: 'lat=37.7500&lon=-119.6000&h=90', what: 'Sierra Nevada forests (5, Nearctic)' },
};
const want = process.argv[2];
const chosen = want ? { [want]: SITES[want] } : SITES;

async function run(name, spot, guild) {
  const tag = `guild-${name}-${guild}`;
  const d = await openDrive({ spot: `${spot}&cam=chase&wx=clear&time=NOON&guild=${guild}`, tag, settle: 0 });
  // Wait for the ground, the cover and (with guilds on) the region — the same
  // three-way gate site-world.test.mjs uses, for the same reason: vegetation
  // seeded before its inputs arrived is not this rule's output.
  // A STABLE COUNT IS NOT A SETTLED WORLD. The first run of this accepted
  // twenty frames in, on a world holding 27 plants — the population had simply
  // not started moving yet, and the "comparison" was between two accidents of
  // arrival order. Vegetation seeds from `refreshVeg` every 900ms against cover
  // tiles that are still landing, so the floor is a FRAME COUNT as well, and
  // stability only counts after it.
  //
  // AND THE FRAMES ARE THE BUDGET. Headless paints through SwiftShader at two
  // to four a second and the screenshots mean `nodraw` is not available here,
  // so a pair of runs is most of the harness's twenty-minute fuse. Run ONE
  // SITE PER PROCESS (`node … guild-ab.mjs cape`), or raise HARNESS_FUSE_MIN;
  // six boots in one process blows it with nothing printed, because each
  // site's line is written only after both of its runs.
  const waited = await d.page.evaluate((g) => new Promise((r) => {
    let f = 0, quiet = 0, last = -1, peak = 0;
    const w = () => {
      const s = window.__siteclim();
      const st = window.__stand(300);
      peak = Math.max(peak, st.n);
      const ready = f > 180 && s.elevAbs > 20 && (g === '0' || s.ecoState === 'loaded');
      if (ready && st.n === last && st.n > 0) quiet++; else quiet = 0;
      last = st.n;
      if ((ready && quiet > 18) || ++f > 1200) return r({ f, ready, n: st.n, peak, state: s.ecoState });
      requestAnimationFrame(w);
    };
    requestAnimationFrame(w);
  }), guild);
  const stand = await d.page.evaluate(() => window.__stand(300));
  const kinds = await d.page.evaluate(() => window.__vegkind(200, 24, 20));
  const site = await d.page.evaluate(() => window.__siteclim());
  await d.shot(`${name}-guild${guild}`);
  const errs = d.errors.slice();
  await d.close();
  return { waited, stand, kinds, site, errs };
}

const pct = (counts, n) => Object.entries(counts).sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${((v / n) * 100).toFixed(0)}%`).join(' · ');

let bad = 0;
for (const [name, { spot, what }] of Object.entries(chosen)) {
  console.log(`\n${'='.repeat(72)}\n${name.toUpperCase()} — ${what}\n${'='.repeat(72)}`);
  const on = await run(name, spot, '1');
  const off = await run(name, spot, '0');
  console.log(`\nsite: ${on.site.eco?.name ?? 'NO REGION'} · guild ${on.site.guild?.name ?? 'none'}`);
  if (on.site.guild) {
    console.log(`  mix    ${JSON.stringify(on.site.guild.mix)}`);
    console.log(`  scale  x${on.site.guild.scale} · density ${on.site.guild.density}`);
    if (on.site.guild.why.length) console.log(`  why    ${on.site.guild.why.join(' · ')}`);
  }
  console.log(`\nstanding within 300m (settled after ${on.waited.f}/${off.waited.f} frames`
    + `${on.waited.f > 1590 || off.waited.f > 1590 ? ' — HIT THE CAP, NOT SETTLED' : ''}):`);
  console.log(`  GUILD  ${on.stand.n} plants · ${on.stand.perHa}/ha`);
  console.log(`         ${pct(on.stand.counts, on.stand.n)}`);
  console.log(`         mean scale ${JSON.stringify(on.stand.meanScale)}`);
  console.log(`  OFF    ${off.stand.n} plants · ${off.stand.perHa}/ha`);
  console.log(`         ${pct(off.stand.counts, off.stand.n)}`);
  console.log(`         mean scale ${JSON.stringify(off.stand.meanScale)}`);
  console.log(`\nthe chooser, 20 rolls over a 400m square:`);
  console.log(`  GUILD  ${pct(on.kinds.counts, on.kinds.n)}`);
  console.log(`  OFF    ${pct(off.kinds.counts, off.kinds.n)}`);
  if (on.errs.length || off.errs.length) {
    bad++;
    console.log(`\nPAGE ERRORS: ${JSON.stringify([...on.errs, ...off.errs].slice(0, 3))}`);
  }
}
console.log(bad ? `\n${bad} site(s) logged page errors` : '\nno page errors');
console.log('frames in $DRIVE_WORK (/tmp/drive-tools)');
