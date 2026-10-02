/**
 * Screenshots of the wood, each once it has settled.
 *
 *   node cells/lab/devtools/shots.mjs 'seed=moss-ford-7&fixed&hour=11' near 'seed=moss-ford-7&find=pond&fixed'
 *
 * Arguments are query strings (one page each), or a name for the one before it (a word with no
 * `=`); output in devtools/out/ (MISTWOOD_OUT to change). `--width=` `--height=` set the
 * viewport (default a phone, 390×844); `--montage=<name>` puts them side by side too.
 */
import { withWood } from './harness.mjs';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const list = [];
for (const a of args.filter((a) => !a.startsWith('--'))) {
  if (a.includes('=') || a.includes('&') || !list.length) list.push({ query: a, name: `shot${list.length + 1}` });
  else list[list.length - 1].name = a;
}
if (!list.length) {
  console.log('usage: shots.mjs <query> [name] [<query> [name] …] [--width= --height= --montage=name]');
  process.exit(1);
}
await withWood(
  async (wood) => {
    const paths = [];
    for (const { query, name } of list) {
      const page = await wood.open(query);
      const settled = await wood.settle(page);
      const path = await wood.shot(page, name);
      const s = await wood.state(page);
      console.log(`${name}${settled ? '' : ' (not settled)'}: ${path}\n  ${JSON.stringify({ seed: s.seed, at: s.at, heading: s.heading, place: s.place, live: s.live, cards: s.cards, deer: s.deer.slice(0, 2) })}`);
      if (page.errors.length) console.log('  errors:', page.errors);
      paths.push(path);
      await page.close();
    }
    if (opt.montage) console.log('montage:', await wood.montage(paths, opt.montage, { labels: list.map((l) => l.name) }));
  },
  { width: Number(opt.width) || 390, height: Number(opt.height) || 844 },
);
