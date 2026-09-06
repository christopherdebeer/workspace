/**
 * THE GUILD, ON AUTHORED AND CAPTURED GROUND — offline, deterministic, fast.
 *
 *   node cells/drive/devtools/guild-fixture.test.mjs
 *
 * `devtools/guild-ab.mjs` measures the guild against the LIVE world, which
 * means the network, arrival order, and minutes per boot. This does the same
 * job on fixtures: no tiles, no Overpass, no ecoregion fetch, the same answer
 * every run.
 *
 * That was impossible until the fixtures could carry a region. `ecoAt` refuses
 * to fetch on a fixture — asking would pull the REAL ecology of the authored
 * crossroads' coordinates, the country above Geneva — so every fixture fell
 * back to the climate path and the fast offline harness could say nothing at
 * all about the rule that decides what grows. A fixture now DECLARES its
 * region (`WorldFixture.eco`, filled in for the six captures from one lookup at
 * their own coordinates), and the guild runs on it.
 *
 * The set is chosen so the answers cannot all be the same:
 *
 *   at-campsbay   Fynbos shrubland          biome 12  Afrotropic
 *   at-bixby      Santa Lucia Chaparral     biome 12  Nearctic
 *   at-paris-south European Atlantic forest biome 4   Palearctic
 *   crossroads    (authored — nowhere, and nowhere has no ecoregion)
 *
 * Camps Bay and Big Sur are the SAME RESOLVE biome on two continents, which is
 * the honest answer — fynbos and chaparral really are structurally alike, and
 * the realm only parts them where a cactus is involved. Paris is the contrast,
 * and the authored fixture is the control that must keep the shipping path.
 */
import { openDrive } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok   ' : 'FAIL '} ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

async function read(id) {
  const t0 = Date.now();
  const d = await openDrive({
    spot: `fixture=${id}&cam=chase&time=NOON&nodraw=1`,
    tag: `guildfix-${id}`, settle: 0, bootTimeout: 120000,
  });
  // A fixture has already arrived — every tile is present in the first frame —
  // so the only wait is for the vegetation to seed against ground that exists.
  const waited = await d.page.evaluate(() => new Promise((r) => {
    let f = 0, quiet = 0, last = -1;
    const w = () => {
      const n = window.__stand(300).n;
      if (f > 120 && n === last && n > 0) quiet++; else quiet = 0;
      last = n;
      if (quiet > 60 || ++f > 1500) return r({ f, n });
      requestAnimationFrame(w);
    };
    requestAnimationFrame(w);
  }));
  const site = await d.page.evaluate(() => window.__siteclim());
  const stand = await d.page.evaluate(() => window.__stand(300));
  const errs = d.errors.slice();
  await d.close();
  return { site, stand, waited, errs, secs: (Date.now() - t0) / 1000 };
}

const share = (st, k) => (st.counts[k] ?? 0) / Math.max(1, st.n);

// ── CAMPS BAY: fynbos, on the Twelve Apostles ────────────────────────────
const cb = await read('at-campsbay');
console.log(`\nat-campsbay (${cb.secs.toFixed(0)}s, ${cb.waited.f} frames): `
  + `${cb.site.eco?.name} → ${cb.site.guild?.name} · ${cb.stand.n} plants`);
console.log(`  ${JSON.stringify(cb.stand.counts)}`);
console.log(`  mean scale ${JSON.stringify(cb.stand.meanScale)}`);
check('a capture carries its ecoregion without a fetch',
  cb.site.eco?.name === 'Fynbos shrubland', cb.site.eco);
check('…and it is the fixture\'s own, not the tile route\'s',
  cb.site.ecoState === 'fixture', cb.site.ecoState);
check('the guild is Mediterranean scrub', cb.site.guild?.name === 'mediterranean scrub', cb.site.guild);
check('…which grows no palms at the Cape', share(cb.stand, 'palm') === 0, cb.stand.counts);
check('…and stands things low', cb.site.guild.scale <= 0.7, cb.site.guild.scale);
check('the world actually planted something', cb.stand.n > 20, cb.stand.n);
check('no page errors', cb.errs.length === 0, cb.errs.slice(0, 3));

// ── BIG SUR: the same biome, the other hemisphere, the other realm ───────
const bx = await read('at-bixby');
console.log(`\nat-bixby (${bx.secs.toFixed(0)}s): ${bx.site.eco?.name} → ${bx.site.guild?.name}`);
check('Big Sur is Santa Lucia chaparral', /santa lucia/i.test(bx.site.eco?.name ?? ''), bx.site.eco);
check('…the same guild as the Cape, which is the honest answer',
  bx.site.guild?.name === cb.site.guild?.name, [bx.site.guild?.name, cb.site.guild?.name]);
check('…in the New World', bx.site.eco?.realm === 'Nearctic', bx.site.eco);

// ── VÉLIZY: a different biome entirely ───────────────────────────────────
const pz = await read('at-paris-south');
console.log(`\nat-paris-south (${pz.secs.toFixed(0)}s): ${pz.site.eco?.name} → ${pz.site.guild?.name}`);
console.log(`  ${JSON.stringify(pz.stand.counts)}`);
check('Vélizy is Atlantic mixed forest', pz.site.eco?.biome === 4, pz.site.eco);
check('…and gets a forest guild, not a scrub one',
  pz.site.guild?.name === 'temperate broadleaf forest', pz.site.guild);
check('…which is taller than the Cape\'s', pz.site.guild.scale > cb.site.guild.scale,
  [pz.site.guild.scale, cb.site.guild.scale]);

// ── AN AUTHORED FIXTURE IS NOWHERE ───────────────────────────────────────
const au = await read('crossroads');
console.log(`\ncrossroads (${au.secs.toFixed(0)}s): eco ${JSON.stringify(au.site.eco)} · `
  + `guild ${JSON.stringify(au.site.guild?.name ?? null)}`);
check('an authored fixture declares no region', au.site.eco === null, au.site.eco);
check('…so it keeps the shipping climate path', au.site.guild === null, au.site.guild);
check('…and still grows things', au.stand.n > 0, au.stand.n);

const total = [cb, bx, pz, au].reduce((a, r) => a + r.secs, 0);
console.log(`\nfour worlds in ${total.toFixed(0)}s, no network, same answer every run`);
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
