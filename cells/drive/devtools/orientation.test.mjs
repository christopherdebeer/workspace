/**
 * ── A ROTATION MUST COST AND READ THE SAME ──
 *
 * Three things key off `innerWidth`/`innerHeight` and every one of them used to
 * change its mind when a phone was turned:
 *
 *  - THE ART BUFFER was sized as `min(PIX_H, innerHeight)` ROWS, and rows are
 *    the long axis of a phone held upright. Turned, the same dial asked for a
 *    519x240 buffer where upright it asked for 111x240 — 4.7x the fragments,
 *    and the art pixel shrinking from 3.52 CSS pixels across to 1.63, so the
 *    pixels the whole game is drawn in halved in size on the way round.
 *  - THE HUD GRID asked `innerWidth < 760`, which on a 390x844 phone answers
 *    "handset" upright and "desktop" turned: 2 CSS pixels per HUD pixel became
 *    3, at the moment the height to fit in fell from 844 to 390.
 *  - AND NOTHING RE-CHECKED. Every consumer hangs off `resize` and reads the
 *    metrics at the instant it runs, which is right while the event can be
 *    trusted; iOS can deliver one DURING a rotation carrying the metrics from
 *    before it, and there is no second path that would put it right.
 *
 * So this drives a real rotation in the browser and reads the three back, and
 * then stands the recovery up on its own (`__viewport('forget')` is the only
 * way to reach the state a bad event leaves, since a harness resize always
 * carries the truth).
 *
 * THE CONTROL IS THE RULE IT REPLACED, computed here and required to DIFFER in
 * landscape and to AGREE in portrait — a check that cannot tell the two apart
 * is not a check, and the portrait half is what says nothing else moved.
 *
 * No world, no streaming: a fixture, no settle, seconds.
 */
import { openDrive } from './harness.mjs';

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

let bad = 0;
const ok = (name, cond, saw) => {
  if (!cond) bad++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${cond ? '' : `\n        saw ${JSON.stringify(saw)}`}`);
};
/** The rule this replaced: PIX_H rows off the height, whatever the aspect. */
const oldRule = (w, h, pix) => {
  const ah = Math.min(pix, Math.round(h));
  return { w: Math.max(2, Math.round((w / h) * ah)), h: ah };
};
const read = (page) => page.evaluate(() => ({
  ...window.__viewport(),
  canvas: { w: document.querySelector('#scene').width, h: document.querySelector('#scene').height },
}));

// DPR 3, BECAUSE THE HUD GRID IS SNAPPED TO DEVICE PIXELS. `hudResize` picks a
// whole number of device pixels per HUD pixel, so the same rule gives a
// different grid at DPR 1 and DPR 3 — and the claim here is about a phone. At
// the harness's own DPR 1 the landscape HUD reads 422x195 where a DPR-3 phone
// reads 506x234, and a bar set against one is meaningless on the other.
const d = await openDrive({ pagePath: '/?fixture=crossroads&nodraw=1', tag: 'orient', settle: 0, dpr: 3 });
try {
  await d.page.setViewportSize(PORTRAIT);
  await d.page.waitForTimeout(600);
  const up = await read(d.page);
  // THE DIAL IS READ OFF THE BUFFER RATHER THAN TYPED. In portrait the height
  // is far over any stop of the PIXEL dial, so `min(PIX_H, innerHeight)` is
  // PIX_H exactly and the art height IS the dial — which keeps this check true
  // at whichever stop the rack happens to be on.
  const PIX = up.art.h;
  console.log(`portrait  art ${up.art.w}x${up.art.h} · css/art ${up.art.cssPerArt.toFixed(2)}`
    + ` · hudS ${up.hud.s.toFixed(3)} ${up.hud.w}x${up.hud.h}`);

  await d.page.setViewportSize(LANDSCAPE);
  await d.page.waitForTimeout(600);
  const flat = await read(d.page);
  console.log(`landscape art ${flat.art.w}x${flat.art.h} · css/art ${flat.art.cssPerArt.toFixed(2)}`
    + ` · hudS ${flat.hud.s.toFixed(3)} ${flat.hud.w}x${flat.hud.h}`);

  // ── the art buffer ──
  const upPx = up.art.w * up.art.h, flatPx = flat.art.w * flat.art.h;
  ok('the rotated buffer is the same size as the upright one (within 2%)',
    Math.abs(flatPx - upPx) / upPx < 0.02, { upPx, flatPx, ratio: flatPx / upPx });
  ok('the art pixel is the same size on the glass either way up (within 3%)',
    Math.abs(flat.art.cssPerArt - up.art.cssPerArt) / up.art.cssPerArt < 0.03,
    { up: up.art.cssPerArt, flat: flat.art.cssPerArt });
  // …and the control, which is what says the two rules are being told apart.
  const ctlUp = oldRule(PORTRAIT.width, PORTRAIT.height, PIX);
  const ctlFlat = oldRule(LANDSCAPE.width, LANDSCAPE.height, PIX);
  ok('UPRIGHT IS UNCHANGED: the old rule and this one agree exactly',
    ctlUp.w === up.art.w && ctlUp.h === up.art.h, { old: ctlUp, now: up.art });
  ok('TURNED IS NOT: the old rule wanted a bigger buffer, so the check can see the difference',
    ctlFlat.w * ctlFlat.h > flatPx * 1.5, { old: ctlFlat, oldPx: ctlFlat.w * ctlFlat.h, nowPx: flatPx });

  // ── the HUD grid ──
  ok('the HUD grid does not change when the phone is turned',
    Math.abs(flat.hud.s - up.hud.s) < 1e-9, { up: up.hud, flat: flat.hud });
  // The control again: the old width test promoted a turned phone to the
  // desktop grid, which is 1.5x the HUD pixel and so two thirds of the rows.
  const oldTarget = (LANDSCAPE.width < 760 ? 2 : 3) * (up.hud.s * 3 / 2 / 3);  // hudSize, back out of the portrait grid
  const oldN = Math.max(2, Math.round(oldTarget * 3));
  const oldHH = Math.round(LANDSCAPE.height / (oldN / 3));
  ok('TURNED KEEPS ITS ROWS: the old width test cost a third of them',
    flat.hud.h > oldHH * 1.4, { oldHH, now: flat.hud.h });

  // ── the chain ran at all ──
  ok('the viewport chain acted on the metrics the window now has',
    !flat.stale && flat.seen.w === LANDSCAPE.width && flat.seen.h === LANDSCAPE.height, flat);
  // THE BACKING STORE IS THE WINDOW TIMES THE RENDERER'S PIXEL RATIO, which is
  // capped and is not the device's — at DPR 3 this reads 1688x780 for an
  // 844x390 window. So the claim is that both axes carry the SAME ratio and it
  // is a whole one: a buffer left over from the other orientation would not.
  const rx = flat.canvas.w / LANDSCAPE.width, ry = flat.canvas.h / LANDSCAPE.height;
  ok('the drawing buffer follows the window on both axes at one ratio',
    rx === ry && Number.isInteger(rx) && rx >= 1, { ...flat.canvas, rx, ry });

  // ── and the recovery, which no resize can reach ──
  const before = await d.page.evaluate(() => {
    window.__orientN = 0;
    addEventListener('resize', () => { window.__orientN++; });
    window.__viewport('forget');
    return window.__viewport().stale;
  });
  ok('forget leaves the chain behind the window (the state a bad event leaves)', before === true, before);
  await d.page.evaluate(() => dispatchEvent(new Event('orientationchange')));
  await d.page.waitForTimeout(700);
  const after = await d.page.evaluate(() => ({ n: window.__orientN, ...window.__viewport() }));
  ok('an orientationchange re-runs the chain when the metrics have moved',
    after.n >= 1 && !after.stale, after);
  // …and is a no-op when they have not, or a rotation would cost three rebuilds.
  const n0 = after.n;
  await d.page.evaluate(() => dispatchEvent(new Event('orientationchange')));
  await d.page.waitForTimeout(700);
  const idle = await d.page.evaluate(() => window.__orientN);
  ok('…and re-runs nothing when they have not', idle === n0, { n0, idle });

  ok('no page errors', d.errors.length === 0, d.errors.slice(0, 4));
} finally {
  await d.close();
}
console.log(bad ? `\nFAIL ${bad}` : '\nPASS: a rotation keeps the buffer, the art pixel and the HUD grid, and the chain recovers');
process.exit(bad ? 1 : 0);
