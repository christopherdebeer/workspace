/**
 * ── THE PARAPET, FROM THE STREET ──
 *
 *   node devtools/flat-roof-lab.mjs
 *
 * The seat asked for "an edge/small wall" on a flat roof, and that is a thing
 * you see from the pavement, not from the chart. The façade lab is where a
 * wall is judged: one building at the building survey's own 26 m stand-off,
 * the production shader, the production materials, no world to stream and no
 * HUD to dodge — which is the whole reason a lab exists here, and the reason
 * the flat entry on its ROOF dial now draws something.
 *
 * Two frames a tradition, ROOF = FLAT: a low sun so the coping casts, and a
 * high one so the roof deck and the plant read. The frames are the argument;
 * there is no number in this one, deliberately — the lab's light rig is not
 * the game's (no bldSkylit), so a luminance here would not be the world's.
 */
import { openDrive } from './harness.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.OUT ?? '/tmp/drive-tools/flat-roof-lab';
mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const d = await openDrive({ pagePath: '/lab/facade', tag: 'frlab', settle: 6000, bootTimeout: 60000 });
const set = async (id, value, ev = 'input') => d.page.evaluate(([i, v, e]) => {
  const el2 = document.getElementById(i);
  if (!el2) return false;
  if (el2.type === 'checkbox') el2.checked = v === '1'; else el2.value = v;
  el2.dispatchEvent(new Event(e, { bubbles: true }));
  return true;
}, [id, String(value), ev]);

// FOLD THE DIALS. At a phone's 390 px the panel is most of the glass and the
// wall is a sliver behind it — the first run photographed the dials. 'H' is
// the lab's own fold key and it gives the gutter back.
await d.page.keyboard.press('h');
await d.page.waitForTimeout(600);

const errors = [];
for (const [name, culture] of [['ile-de-france', 't:ile-de-france'], ['cape', 't:cape'], ['sahel', 't:sahel']]) {
  await set('culture', culture, 'change');
  await set('roof', 'flat', 'change');
  // THE STAND-OFF IS THE SURVEY'S, THE EYE IS NOT. `camera.lookAt(0, eye, 0)`
  // keeps the lens horizontal, so a 1.3 m cab eye at 26 m puts a four-storey
  // building's top edge off the top of a portrait frame — which is the one
  // part of it this tool exists to photograph. Raised until the parapet is in
  // shot, which is what a person on the far pavement does with their head.
  await set('dist', 34);
  await set('eye', 7);
  await set('storeys', 4);
  await set('width', 16);
  await set('depth', 11);
  await d.page.waitForTimeout(1200);
  for (const [tag, alt] of [['low', 18], ['high', 58]]) {
    await set('sunAlt', alt);
    await d.page.waitForTimeout(900);
    const buf = await d.page.screenshot({ timeout: 120000 });
    writeFileSync(`${OUT}/${name}-${tag}.png`, buf);
  }
  const rep = await d.page.evaluate(() => window.__facade?.());
  console.log(`[${el()}] ${name}: roof ${rep?.roof} · ${rep?.w} x ${rep?.d} m · ${rep?.storeys} storeys = ${rep?.height?.toFixed?.(1)} m · refused ${rep?.roofRefused}`);
}
await d.page.evaluate(() => localStorage.removeItem('drive.lab.facade.dials'));
errors.push(...d.errors);
await d.close();
console.log(`[${el()}] page errors: ${errors.length} ${JSON.stringify(errors.slice(0, 3))}`);
console.log(`frames in ${OUT}`);
