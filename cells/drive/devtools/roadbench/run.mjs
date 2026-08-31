/**
 * Run the bench.
 *
 *   node cells/drive/devtools/roadbench/run.mjs
 *   node cells/drive/devtools/roadbench/run.mjs shelf causeway
 */
import { runFixture, report } from './bench.mjs';
import { ALL } from './fixtures/synthetic.mjs';

const want = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const keys = want.length ? want : Object.keys(ALL);
for (const k of keys) {
  const make = ALL[k];
  if (!make) { console.log(`no such fixture: ${k} (have ${Object.keys(ALL).join(', ')})`); continue; }
  const f = make();
  report(f, runFixture(f));
}
console.log('\nabs = metres against truth · shape = after one constant offset'
  + ' · recov = fraction of a lateral shift the bench took out');
