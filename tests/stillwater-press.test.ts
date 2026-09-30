import { Pond, type Pad } from '../cells/stillwater/client/world';

/** A dry leaf well clear of the boat. */
function leaf(pond: Pond, r = 40): Pad {
  const x = pond.boat.x + 400;
  const y = pond.boat.y;
  const pad: Pad = {
    id: 99998, x, y, vx: 0, vy: 0, ang: 0, va: 0, ax: x, ay: y, r, seed: 0.5, bank: false,
    drops: [], selected: false, sel: 0, bob: 0, focus: false, flower: 0, touching: false, layer: 0,
    dx: 0, dy: 0, wob: 0, cx: 0, cy: 0, sink: 0, caught: false, rx: x, ry: y,
    load: 0, sinkV: 0, support: 0.82 + Math.min(0.28, r / 260), compliance: 1, wet: 0, soak: 0,
  };
  pond.pads.push(pad);
  return pad;
}

const active = { y0: -1e5, y1: 1e5 };

/** Tap (a small dip), hold the finger for `secs`, let go; the deepest the leaf went. */
function press(secs: number) {
  const pond = new Pond(5);
  pond.pads = [];
  pond.floaters = [];
  const p = leaf(pond);
  pond.splash(p.x + 12, p.y, 6, 0.4, false, [p]);
  pond.held = { pad: p, ox: 12, oy: 0 };
  let deepest = p.sink;
  for (let t = 0; t < secs; t += 1 / 60) {
    pond.step(1 / 60, active, false);
    deepest = Math.max(deepest, p.sink);
  }
  pond.held = null;
  return { pond, p, deepest };
}

describe('stillwater: a finger on a dry leaf', () => {
  test('a tap only dips it', () => {
    const { deepest } = press(0.1);
    expect(deepest).toBeLessThan(0.3);
  });

  test('the longer it is held, the deeper it goes', () => {
    const a = press(0.5).deepest;
    const b = press(1).deepest;
    const c = press(2).deepest;
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(a).toBeLessThan(0.55);
    expect(c).toBeGreaterThan(0.8);
  });

  test('let go, it comes back up, and a leaf held under stays down longer than one dipped', () => {
    const up = (secs: number) => {
      const { pond, p } = press(secs);
      for (let t = 0; t < 60; t += 1 / 60) {
        pond.step(1 / 60, active, false);
        if (p.sink < 0.1) return t;
      }
      return Infinity;
    };
    const dipped = up(0.3);
    const drowned = up(2);
    expect(drowned).toBeLessThan(60);
    expect(drowned).toBeGreaterThan(dipped);
  });
});

describe('stillwater: white water where a blade strikes a leaf', () => {
  test('a foaming splash on a leaf still churns white water there', () => {
    const pond = new Pond(5);
    pond.pads = [];
    const p = leaf(pond);
    pond.impulses = [];
    expect(pond.splash(p.x + 20, p.y, 7, 1, true, [p])).toBe(p);
    expect(pond.impulses.some((im) => im.foam && Math.hypot(im.x - (p.x + 20), im.y - p.y) < 1)).toBe(true);
  });
});
