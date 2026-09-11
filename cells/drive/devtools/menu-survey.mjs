/**
 * THE MENU, PHOTOGRAPHED END TO END.
 *
 *   node cells/drive/devtools/menu-survey.mjs
 *
 * Three sessions of rig and menu work shipped with the note "live visual
 * validation is blocked because the available cloud browser cannot create a
 * WebGL context", and every one of them was right about the vehicle bay and
 * wrong about the panel: the menu is DOM (see the header of client/menu.ts,
 * which records why it left the canvas), so it photographs perfectly well
 * without a GPU. What cannot be photographed is the 3D bay behind it.
 *
 * SETTINGS is one scroll region several times taller than the window, so a
 * single screenshot of it is the first screenful and an assumption about the
 * rest — which is how a page grew to nine screenfuls without anyone saying so.
 * This scrolls it a screenful at a time and names the sections in each, then
 * walks the other tabs, because they share `.m-row` and `.m-dial` with it and
 * a change to those is a change to DRIVES, SURVEYS and RIG whether it was
 * meant to be or not.
 *
 * It also prints the foot per tab. The foot is not one thing — see the notes
 * in CLAUDE.md — and the table is how that was established.
 *
 * Frames land in $DRIVE_WORK (/tmp/drive-tools).
 */
import { openDrive, report } from './harness.mjs';

const d = await openDrive({
  spot: 'lat=46.55&lon=10.44&h=277&cam=chase&wx=clear&ez=0',
  tag: 'menu-survey',
  settle: 16000,
});

const TABS = [
  [0, 'hub'], [1, 'surveys'], [2, 'rig'], [3, 'drives'],
  [5, 'line'], [6, 'about'], [7, 'progress'],
];

// ── SETTINGS, a screenful at a time ──
const geom = await d.page.evaluate(() => {
  window.__menutab?.(4);
  const b = document.querySelector('#menu .m-body');
  b.scrollTop = 0;
  return { scrollH: b.scrollHeight, clientH: b.clientHeight };
});
const steps = Math.ceil(geom.scrollH / geom.clientH);
console.log(`settings: ${geom.scrollH}px of content in a ${geom.clientH}px window — ${steps} screens`);

for (let i = 0; i < steps; i++) {
  const at = await d.page.evaluate((n) => {
    const b = document.querySelector('#menu .m-body');
    b.scrollTop = n * b.clientHeight;
    // What is actually on screen, so the caption is not a guess.
    const secs = [...document.querySelectorAll('#menu .m-sect')]
      .filter((s) => {
        const r = s.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        return r.top >= br.top - 12 && r.top <= br.bottom;
      })
      .map((s) => s.textContent ?? '');
    return { top: Math.round(b.scrollTop), secs };
  }, i);
  await d.shot(`settings-${String(i + 1).padStart(2, '0')}`);
  console.log(`  settings-${String(i + 1).padStart(2, '0')}  top=${at.top}  ${at.secs.join(' · ')}`);
}

// ── and the foot, which is the question ──
const foots = await d.page.evaluate(() => {
  const out = {};
  for (const t of [0, 1, 2, 3, 4, 5, 6, 7]) {
    window.__menutab?.(t);
    const f = document.querySelector('#menu .m-foot');
    const shown = f ? getComputedStyle(f).display !== 'none' : false;
    out[t] = {
      shown,
      buttons: [...(f?.querySelectorAll('.m-btn .lab') ?? [])].map((b) => b.textContent ?? ''),
    };
  }
  return out;
});
console.log('\nfoot by tab:');
for (const [t, v] of Object.entries(foots)) {
  console.log(`  tab ${t}: shown=${v.shown} [${v.buttons.join(' | ')}]`);
}

// ── the other screens ──
for (const [t, name] of TABS) {
  const info = await d.page.evaluate((tab) => {
    window.__menutab?.(tab);
    const b = document.querySelector('#menu .m-body');
    if (b) b.scrollTop = 0;
    return {
      rows: document.querySelectorAll('#menu .m-row').length,
      hits: document.querySelectorAll('#menu .m-row.hit').length,
      dials: document.querySelectorAll('#menu .m-dial').length,
      scrollH: b?.scrollHeight ?? 0,
      clientH: b?.clientHeight ?? 0,
    };
  }, t);
  await d.shot(`tab-${name}`);
  console.log(`  tab-${name}  rows=${info.rows} hit=${info.hits} dials=${info.dials}  ${info.scrollH}/${info.clientH}px`);
}

report(d.errors);
await d.close();
