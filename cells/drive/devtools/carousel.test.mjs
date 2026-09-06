/**
 * THE SPLASH CAROUSEL.
 *
 *   node cells/drive/devtools/carousel.test.mjs
 *
 * The hub used to say only "RETURN · BACK TO WHERE YOU WERE", and only once
 * the reel had already carried the session away: a one-way door with no map.
 * You could not see how many places there were, which one was showing, or
 * reach one deliberately. A dot strip answers all three at a glance.
 *
 * What this asserts, and why each is here:
 *
 *   THE STRIP EXISTS AND COUNTS RIGHT — n+1 stops for n drives, because HOME
 *   is the first one. If the count is wrong the whole affordance lies.
 *   HOME IS DISTINGUISHABLE — a square against the reel's dots. Shape reads
 *   before colour at six pixels, and this is what retires RETURN.
 *   RETURN IS GONE from the stack.
 *   THE DOTS ARE TAPPABLE — measured against their real hit boxes, not their
 *   ink. A 6px dot is a 6px target unless something says otherwise, and this
 *   strip sits where a thumb rests.
 *   THE STRIP FITS — no horizontal overflow at phone width. The last screen
 *   this suite checked passed every DOM assertion while visibly clipping.
 */
import { openDrive, report } from './harness.mjs';

let bad = 0;
const check = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};

const d = await openDrive({ spot: 'lat=46.55&lon=10.44&h=277&cam=chase&wx=clear', tag: 'carousel', settle: 16000 });
await d.page.evaluate(() => window.__menutab?.(0));

const s = await d.page.evaluate(() => {
  const strip = document.querySelector('#menu .m-dots');
  const dots = [...(strip?.querySelectorAll('.m-dot') ?? [])];
  const cs = (e) => getComputedStyle(e, '::after');
  return {
    reel: window.__reel?.() ?? null,
    dots: dots.length,
    home: dots.filter((e) => e.classList.contains('home')).length,
    on: dots.filter((e) => e.classList.contains('on')).length,
    label: document.querySelector('#menu .m-dotlab')?.textContent ?? '',
    rows: [...document.querySelectorAll('#menu .m-navrow')]
      .filter((r) => getComputedStyle(r).display !== 'none')
      .map((r) => r.querySelector('.name')?.textContent ?? ''),
    // Hit boxes, and the shapes inside them.
    boxes: dots.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }),
    radii: dots.map((e) => cs(e).borderRadius),
    // Does the strip fit the panel it lives in?
    fits: strip ? strip.scrollWidth <= strip.clientWidth + 1 : false,
    stripW: strip?.scrollWidth ?? 0,
    panelW: strip?.clientWidth ?? 0,
  };
});
console.log(JSON.stringify(s, null, 1));

check('the reel reports a programme', (s.reel?.n ?? 0) > 0, s.reel);
check('one dot per drive, plus HOME', s.dots === (s.reel?.n ?? 0) + 1, [s.dots, s.reel?.n]);
check('exactly one HOME', s.home === 1, s.home);
check('HOME is a square and the drives are round',
  s.radii[0] === '0px' && s.radii.slice(1).every((r) => r !== '0px'), s.radii);
check('RETURN is gone from the stack', !s.rows.includes('RETURN'), s.rows);
check('the strip says where you are', /YOUR OWN ROAD|DRIVE \d+ OF \d+/.test(s.label), s.label);
// A 6px dot is a 6px target unless the hit box says otherwise.
check('every dot is a real touch target (>=22x32)',
  s.boxes.every(([w, h]) => w >= 22 && h >= 32), s.boxes);
check('the strip fits without scrolling sideways', s.fits, [s.stripW, s.panelW]);
check('no page errors', d.errors.length === 0, d.errors);

await d.shot('carousel-splash');
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
report(d.errors);
await d.close();
