/**
 * A PROBE PATH IS NOT A DOT-SEPARATED STRING.
 *
 *   node cells/drive/devtools/probe-path.test.mjs
 *
 * The probe channel resolves a request by walking a path from `window`, which
 * is deliberately smaller than eval — the CSP forbids eval anyway, and a path
 * is the whole of what diagnosis needs. But the first cut split the request on
 * every '.', and the very first real question asked through it was
 *
 *     __demcheck(-33.93,18.42,14)
 *
 * which that splitter cut into `__demcheck(-33`, `93,18`, `42,14)` — three
 * fragments, none of them a path. Almost everything worth asking this game is
 * somewhere on a map, so almost everything worth asking was unaskable, and the
 * failure looked like a syntax error in the question rather than a bug in the
 * reader.
 *
 * So: a dot inside parens, brackets or quotes is DATA. Only a dot at depth
 * zero separates one segment of the path from the next.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({
  spot: 'lat=-33.93&lon=18.42&h=0&cam=chase&wx=clear&time=NOON&probe=harnesstest01',
  tag: 'probe-path',
});

// The channel only exists when a key was asked for, so this is also the
// assertion that the key gate opens at all.
const live = await d.page.evaluate(() => typeof window.__probepath === 'function');
check('the probe channel armed, so there is a resolver to test', live, live);
if (!live) { report(d.errors); process.exit(1); }

const splits = await d.page.evaluate(() => ({
  plain: window.__probepath('__demsrc()'),
  decimals: window.__probepath('__demcheck(-33.93,18.42,14)'),
  dotted: window.__probepath('__course().obsNext'),
  dottedArgs: window.__probepath('__groundAt(1.5,2.5).terrain'),
  quoted: window.__probepath('__find("a.b.c")'),
  bracket: window.__probepath('__t([1.5,2.5])'),
}));

check('a bare call is one segment', splits.plain.length === 1, splits.plain);
check('DECIMALS IN ARGUMENTS SURVIVE — one segment, not three',
  splits.decimals.length === 1 && splits.decimals[0] === '__demcheck(-33.93,18.42,14)', splits.decimals);
check('a real path still splits', splits.dotted.join('|') === '__course()|obsNext', splits.dotted);
check('…and splits after a call carrying decimals',
  splits.dottedArgs.join('|') === '__groundAt(1.5,2.5)|terrain', splits.dottedArgs);
check('a dot inside a string is data', splits.quoted.length === 1, splits.quoted);
check('so is a dot inside brackets', splits.bracket.length === 1, splits.bracket);

// End to end through the real resolver: the answer is JSON the server would
// have stitched, not an error about the question.
const asked = await d.page.evaluate(async () => ({
  src: await window.__probeask('__demsrc()'),
  decimals: await window.__probeask('__groundAt(1.5,2.5)'),
  missing: await window.__probeask('__nosuchprobe()'),
}));
check('a probe answers with its reading', /"mth"|"aws"/.test(asked.src), asked.src.slice(0, 200));
check('A DECIMAL CALL REACHES THE FUNCTION rather than failing to parse',
  !/not a probe path/.test(asked.decimals), asked.decimals.slice(0, 200));
check('an unknown probe says so, and says it is unknown — not unparseable',
  /not callable|undefined/.test(asked.missing), asked.missing.slice(0, 200));

await d.page.evaluate(() => window.__probestop?.());
report(d.errors);
await d.close();
if (bad) process.exitCode = 1;
console.log(bad ? `${bad} FAILED` : 'all good');
