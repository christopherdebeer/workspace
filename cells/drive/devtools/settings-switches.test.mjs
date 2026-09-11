/**
 * THE SWITCHES ON THE SETTINGS PANEL, AS A SURFACE YOU CAN ACTUALLY REACH.
 *
 *   node cells/drive/devtools/settings-switches.test.mjs
 *
 * The list used to be a kvTable — sixty-seven rows of text with no click
 * handler — so the one thing SETTINGS could not do was set a setting. The
 * pure half of the replacement (which URL a staged set produces, and that it
 * preserves every key it is not changing) is asserted in switches.test.mjs
 * without a browser. This is the other half, and it needs one: that the rows
 * are on the screen, that a tap stages rather than silently applies, that the
 * filter chips actually narrow the list, and that the staged set can be
 * cleared again.
 *
 * It asserts CONTENT, not that a tab opened. A panel that renders empty looks
 * exactly like a panel that renders from anywhere but a screenshot — the same
 * argument the ABOUT test makes, and the reason that test exists.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

// A switch already set, so the panel has a `•`-equivalent to show and the
// staged-vs-set distinction has something to bite on.
const d = await openDrive({
  spot: 'lat=46.55&lon=10.44&h=277&cam=chase&wx=clear&ez=0',
  tag: 'settings-switches',
  settle: 16000,
});

const shape = await d.page.evaluate(() => {
  window.__menutab?.(4);
  const rows = [...document.querySelectorAll('#menu .m-switch')];
  const chips = [...document.querySelectorAll('#menu .m-swfilter button')]
    .map((b) => b.textContent ?? '');
  return {
    rows: rows.length,
    chips,
    first: rows[0]
      ? {
        id: rows[0].querySelector('.sw-id')?.textContent ?? '',
        note: rows[0].querySelector('.sw-note')?.textContent ?? '',
        marks: [...rows[0].querySelectorAll('.tag')].map((t) => t.textContent ?? ''),
      }
      : null,
    // The tap target the panel insists on everywhere else and missed on the
    // rows that make up most of its own surface.
    minHeight: rows[0] ? Math.round(rows[0].getBoundingClientRect().height) : 0,
    // A row nobody can read is not a row. The note is what makes sixty-seven
    // ids mean anything.
    noted: rows.filter((r) => (r.querySelector('.sw-note')?.textContent ?? '').length > 8).length,
  };
});
console.log('panel:', JSON.stringify(shape.first), `${shape.rows} rows`, shape.chips.join(' | '));

check('the switch rows are on the screen', shape.rows >= 60, shape.rows);
check('every row says what its switch does', shape.noted === shape.rows, shape);
check('a row carries its marks', (shape.first?.marks.length ?? 0) > 0, shape.first);
check('a row is a 44px tap target', shape.minHeight >= 44, shape.minHeight);
check('the filter chips are there, with counts',
  shape.chips.length === 6 && /ALL \d+/.test(shape.chips[0] ?? ''), shape.chips);
check('…and they do not collide with the treatment chooser',
  !shape.chips.some((c) => c.includes('BRACKETS')), shape.chips);

// ── THE FILTER NARROWS, AND THE COUNT ON THE CHIP IS THE TRUTH ──
const filtered = await d.page.evaluate(() => {
  const chip = [...document.querySelectorAll('#menu .m-swfilter button')]
    .find((b) => (b.textContent ?? '').startsWith('LEGACY'));
  const claimed = Number((chip?.textContent ?? '').replace(/\D+/g, ''));
  chip?.click();
  // The click re-renders, so the node just clicked is detached — ask the new
  // DOM whether the chip is pressed, not the old one.
  const fresh = [...document.querySelectorAll('#menu .m-swfilter button')]
    .find((b) => (b.textContent ?? '').startsWith('LEGACY'));
  const rows = [...document.querySelectorAll('#menu .m-switch')];
  return {
    claimed,
    shown: rows.length,
    allLegacy: rows.every((r) => [...r.querySelectorAll('.tag')]
      .some((t) => (t.textContent ?? '') === 'legacy')),
    pressed: fresh?.getAttribute('aria-pressed'),
  };
});
check('LEGACY narrows the list to its own count',
  filtered.shown === filtered.claimed && filtered.claimed > 0, filtered);
check('…and every row it leaves is legacy', filtered.allLegacy, filtered);
check('…and the chip reads as pressed', filtered.pressed === 'true', filtered);

// ── A TAP STAGES. IT DOES NOT RELOAD, AND IT DOES NOT TOUCH THE URL ──
// This is the whole bargain of the surface: a switch is read once at boot, so
// a control that applied one live would be lying about when it takes effect.
const staged = await d.page.evaluate(() => {
  const before = location.search;
  const row = [...document.querySelectorAll('#menu .m-switch')]
    .find((r) => (r.querySelector('.sw-id')?.textContent ?? '') === '?shore');
  row?.click();
  const after = [...document.querySelectorAll('#menu .m-switch')]
    .find((r) => (r.querySelector('.sw-id')?.textContent ?? '') === '?shore');
  const foot = [...document.querySelectorAll('#menu .m-btn .lab')].map((b) => b.textContent ?? '');
  return {
    urlUnchanged: location.search === before,
    marked: after?.classList.contains('staged') ?? false,
    value: after?.querySelector('.sw-val')?.textContent ?? '',
    reload: foot.find((t) => t.startsWith('RELOAD ·')) ?? '',
    hasClear: foot.includes('CLEAR'),
  };
});
check('a tap does not reload or rewrite the URL', staged.urlUnchanged, staged);
check('the tapped row is marked staged', staged.marked, staged);
check('…and shows the value it would take', staged.value === '1', staged);
check('the foot offers one reload for the staged set',
  staged.reload === 'RELOAD · 1 STAGED', staged);
check('…and a way to change your mind', staged.hasClear, staged);

// ── AND CLEAR PUTS IT BACK ──
const cleared = await d.page.evaluate(() => {
  const clear = [...document.querySelectorAll('#menu .m-btn')]
    .find((b) => (b.querySelector('.lab')?.textContent ?? '') === 'CLEAR');
  clear?.click();
  return {
    staged: document.querySelectorAll('#menu .m-switch.staged').length,
    reloadGone: ![...document.querySelectorAll('#menu .m-btn .lab')]
      .some((b) => (b.textContent ?? '').startsWith('RELOAD ·')),
  };
});
check('CLEAR unstages everything', cleared.staged === 0, cleared);
check('…and takes the reload away with it', cleared.reloadGone, cleared);

console.log(bad ? `\n${bad} FAILED` : '\nall ok');
await d.shot('settings-switches');
report(d.errors);
await d.close();
process.exit(bad ? 1 : 0);
