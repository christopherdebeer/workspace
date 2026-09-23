// THE LAB'S PAINT OVERLAY, ON THE GLASS IT ACTUALLY HAS.
//
// The overlay draws on the HUD canvas, and the lab's own opening turns that
// surface off twice over: `drawAuthoringPreviews` sat after drawHud's
// `!hudOn` early return, and the canvas carries class `ui`, which `body.clean`
// hides. Both are the LAB's own chrome-off state, so the one instrument it
// cannot work without was the one it switched off as it opened.
//
// TWO WITNESSES, because neither is enough alone. `__worldedit().previews`
// is the AUTHORITY — what the lab handed the renderer, by kind and state —
// and the ink on the HUD canvas is the PICTURE. A probe that reports the
// output of a rule cannot witness the rule, and a canvas that is
// `display: none` draws a perfect overlay nobody sees.
//
// THE INK IS A DIFFERENCE, NOT A NUMBER: the same canvas carries the tile
// debug grid, which is identical between the two legs because the chart does
// not move. Armed against disarmed is the preview and nothing else.
import { openDrive, report } from './harness.mjs';
let bad = 0;
const ok = (n, c, saw) => { console.log(`${c ? 'ok  ' : 'FAIL'}  ${n}${c ? '' : ' saw ' + JSON.stringify(saw)}`); if (!c) bad++; };

const d = await openDrive({
  pagePath: '/lab/world-edit?fixture=tee&time=MORNING&cam=chase', tag: 'lab-preview',
  settle: 6000, bootTimeout: 60000, viewport: { width: 390, height: 844 }, dpr: 2,
});
await d.page.waitForFunction(() => typeof window.__worldedit === 'function' && window.__worldedit().tiles > 0, null, { timeout: 45000 });
await d.page.waitForTimeout(2500);

// The HUD canvas is the 520x1126 one; `mini` carries class `ui` too, and a
// first cut of this measurement read the 276x276 MINIMAP and reported a
// working overlay as broken.
const helpers = `
  const hudCanvas = () => [...document.querySelectorAll('canvas')]
    .filter((c) => c.classList.contains('ui'))
    .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;
  const ink = () => {
    const c = hudCanvas();
    if (!c) return -1;
    const im = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < im.length; i += 4) if (im[i] > 8) n++;
    return n;
  };
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const ev = (type, id, x, y) => document.getElementById('scene').dispatchEvent(new PointerEvent(type,
    { pointerId: id, clientX: x, clientY: y, button: 0, buttons: 1, bubbles: true, cancelable: true, isPrimary: id === 1 }));
  const pick = (id) => { const e = document.getElementById('world-authoring-layer'); e.value = id; e.dispatchEvent(new Event('change', { bubbles: true })); };
`;

const surface = await d.page.evaluate(`(async () => { ${helpers}
  const c = hudCanvas();
  return { display: getComputedStyle(c).display, w: c.width, h: c.height,
    clean: document.body.classList.contains('clean'), hudOn: window.__hud().hudOn };
})()`);
console.log('surface', JSON.stringify(surface));
ok('the lab hides the game chrome and keeps its own canvas', surface.clean && !surface.hudOn && surface.display === 'block', surface);

// ── ROADS: a draft polyline in flight ──
const road = await d.page.evaluate(`(async () => { ${helpers}
  pick('road');
  document.getElementById('world-authoring-arm').click();
  ev('pointerdown', 1, 120, 430);
  for (let i = 1; i <= 8; i++) ev('pointermove', 1, 120 + i * 18, 430 + i * 6);
  await frame();
  const armed = { ink: ink(), report: window.__worldedit() };
  window.__labshot = true;
  await new Promise((r) => setTimeout(r, 1200));
  // Disarming publishes nothing: the SAME frame minus the overlay.
  document.getElementById('world-authoring-arm').click();
  await frame();
  const off = { ink: ink(), report: window.__worldedit() };
  return { armed, off };
})()`);
console.log('road', JSON.stringify({ armed: road.armed.ink, off: road.off.ink, previews: road.armed.report.previews }));
ok('a road draft is handed to the overlay', (road.armed.report.previews['polyline:draft'] ?? 0) >= 2, road.armed.report.previews);
ok('…and reaches the glass', road.armed.ink > road.off.ink, { armed: road.armed.ink, off: road.off.ink });
ok('…and leaves it when the lab disarms', (road.off.report.previews && Object.keys(road.off.report.previews).length === 0), road.off.report.previews);
await d.page.screenshot({ path: '/tmp/drive-tools/lab-preview-road.png', timeout: 120000 });

// ── COVER: the cells a stroke wrote, before the rebuild lands ──
const cover = await d.page.evaluate(`(async () => { ${helpers}
  pick('cover');
  document.getElementById('world-authoring-arm').click();
  document.getElementById('world-authoring-brush').click();
  ev('pointerdown', 1, 160, 430);
  for (let i = 1; i <= 6; i++) ev('pointermove', 1, 160 + i * 14, 430 + i * 10);
  await frame();
  const during = { ink: ink(), report: window.__worldedit() };
  ev('pointerup', 1, 160 + 6 * 14, 430 + 6 * 10);
  await frame();
  const after = { ink: ink(), report: window.__worldedit() };
  document.getElementById('world-authoring-arm').click();
  await frame();
  const off = { ink: ink() };
  return { during, after, off };
})()`);
console.log('cover', JSON.stringify({ during: cover.during.ink, after: cover.after.ink, off: cover.off.ink,
  drafting: cover.during.report.previews, pending: cover.after.report.previews }));
ok('a live raster stroke draws its own cells', (cover.during.report.previews['cells:draft'] ?? 0) > 0, cover.during.report.previews);
ok('…and the finished stroke holds them until the rebuild lands',
  ((cover.after.report.previews['cells:pending'] ?? 0) + (cover.after.report.previews['cells:settled'] ?? 0)) > 0, cover.after.report.previews);
ok('…and the cells reach the glass', cover.during.ink > cover.off.ink && cover.after.ink > cover.off.ink,
  { during: cover.during.ink, after: cover.after.ink, off: cover.off.ink });
await d.page.screenshot({ path: '/tmp/drive-tools/lab-preview-cover.png', timeout: 120000 });

report(d.errors);
await d.close();
console.log(bad ? `${bad} FAILED` : 'lab-preview: all ok');
process.exit(bad ? 1 : 0);
