/**
 * DOES A SAVANNA GET ACACIAS, AND A MANGROVE COAST PALMS?
 *
 *   node cells/drive/devtools/savanna.mjs
 *
 * The guild has asked for both since it shipped; until the bake had them they
 * were 20-triangle archetypes standing beside oaks with real branching. This
 * is the check that the whole chain closes in the LIVE world — ecoregion to
 * guild to family to a baked skeleton with the right silhouette — at places
 * chosen because the answer should be obvious from the ground.
 *
 * Live, so it needs the network; nodraw, so it costs minutes rather than tens
 * of them.
 */
import { openDrive } from './harness.mjs';

const SITES = [
  // Serengeti: RESOLVE 7, tropical grassland and savanna, Afrotropic.
  ['serengeti', 'lat=-2.3330&lon=34.8330&h=90', /acacia/],
  // The Sundarbans edge: RESOLVE 14, mangrove, Indomalayan.
  ['sundarbans', 'lat=21.9500&lon=89.1800&h=90', /palm/],
];

let bad = 0;
const ok = (n, c, saw) => { if (!c) bad++; console.log(`${c ? 'ok   ' : 'FAIL '} ${n}${c ? '' : `\n        saw ${JSON.stringify(saw)}`}`); };

for (const [name, spot, want] of SITES) {
  const d = await openDrive({ spot: `${spot}&cam=chase&wx=clear&time=NOON&nodraw=1`, tag: `sav-${name}`, settle: 0 });
  const w = await d.page.evaluate(() => new Promise((r) => {
    const t0 = performance.now();
    let last = -1, since = performance.now();
    const step = () => {
      const s = window.__siteclim(); const st = window.__stand(300);
      if (st.n !== last) { since = performance.now(); last = st.n; }
      const ms = performance.now() - t0;
      const ready = ms > 90000 && s.elevAbs > 0 && s.ecoState === 'loaded';
      if ((ready && st.n > 0 && performance.now() - since > 25000) || ms > 300000) {
        return r({ secs: Math.round(ms / 1000), state: s.ecoState });
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
  const s = await d.page.evaluate(() => window.__siteclim());
  const st = await d.page.evaluate(() => window.__stand(300));
  console.log(`\n${name.toUpperCase()} (${w.secs}s) — ${s.eco?.name ?? 'NO REGION'} [biome ${s.eco?.biome}, ${s.eco?.realm}]`);
  console.log(`  guild    ${s.guild?.name} · mix ${JSON.stringify(s.guild?.mix)}`);
  if (s.guild?.why?.length) console.log(`  why      ${s.guild.why.join(' · ')}`);
  console.log(`  standing ${JSON.stringify(st.counts)}`);
  console.log(`  forms    ${JSON.stringify(st.forms)} · ${st.perStand} silhouettes a stand`);
  console.log(`  variants ${JSON.stringify(st.variants)}`);
  ok(`${name}: the region loaded`, s.ecoState === 'loaded', s.ecoState);
  ok(`${name}: the guild asks for ${want.source}`,
    Object.keys(s.guild?.mix ?? {}).some((k) => want.test(k)), s.guild?.mix);
  ok(`${name}: no page errors`, d.errors.length === 0, d.errors.slice(0, 3));
  await d.close();
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
