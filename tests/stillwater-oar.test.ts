import { Pond, type Pad } from '../cells/stillwater/client/world';

/** A pad placed by hand (the pond grows its own; here we want one exactly under a blade). */
function padAt(pond: Pond, x: number, y: number, r = 30): Pad {
  const pad: Pad = {
    id: 99999, x, y, vx: 0, vy: 0, ang: 0, va: 0, ax: x, ay: y, r, seed: 0.5, bank: false,
    drops: [{ x: 0.35, y: 0, r: 0.2, a: 1, to: 1 }, { x: -0.4, y: 0, r: 0.2, a: 1, to: 1 }],
    selected: false, sel: 0, bob: 0, focus: false, flower: 0, touching: false, layer: 0,
    dx: 0, dy: 0, wob: 0, cx: 0, cy: 0, sink: 0, caught: false,
  };
  pond.pads.push(pad);
  return pad;
}

/** Step until the blades are in the drive phase (cos(2π·stroke) well above 0). */
function toDrive(pond: Pond) {
  for (let i = 0; i < 600; i++) {
    if (Math.cos(pond.boat.stroke * Math.PI * 2) > 0.6 && pond.boat.rowing > 0.5) return;
    pond.step(1 / 60, { y0: -1e4, y1: 1e4 }, false);
  }
  throw new Error('never reached the drive');
}

describe('stillwater: an oar blade on a lily pad', () => {
  test('the blade catches the leaf: its edge goes under, it is held, not flung, and the dew there washes off', () => {
    const pond = new Pond(3);
    pond.pads = [];
    pond.floaters = [];
    toDrive(pond);
    const [tx, ty] = pond.oarTip(1);
    // the leaf's centre a little inboard of the blade, so the blade lands on its edge
    const pad = padAt(pond, tx + 20, ty);
    const x0 = pad.x;
    const y0 = pad.y;
    let maxSink = 0;
    let maxSpeed = 0;
    for (let i = 0; i < 20; i++) {
      pond.step(1 / 60, { y0: -1e4, y1: 1e4 }, false);
      maxSink = Math.max(maxSink, pad.sink);
      maxSpeed = Math.max(maxSpeed, Math.hypot(pad.vx, pad.vy));
    }
    expect(maxSink).toBeGreaterThan(0.3);
    // held and dragged, not kicked away (the old shove threw leaves ~15+ units in these frames)
    expect(Math.hypot(pad.x - x0, pad.y - y0)).toBeLessThan(12);
    expect(maxSpeed).toBeLessThan(40);
    // the drop nearest the blade went under and washed off; the far one stayed
    const washed = pad.drops.filter((d) => d.to === 0).length;
    expect(washed).toBeGreaterThanOrEqual(1);
    expect(pad.drops.some((d) => d.to === 1)).toBe(true);
  });

  test('released, the leaf comes back up', () => {
    const pond = new Pond(5);
    pond.pads = [];
    pond.floaters = [];
    toDrive(pond);
    const [tx, ty] = pond.oarTip(-1);
    const pad = padAt(pond, tx - 20, ty);
    for (let i = 0; i < 20; i++) pond.step(1 / 60, { y0: -1e4, y1: 1e4 }, false);
    const sunk = pad.sink;
    expect(sunk).toBeGreaterThan(0.3);
    // move the leaf clear of the blades and let the water have it back
    pad.x += 400;
    pad.ax += 400;
    for (let i = 0; i < 120; i++) pond.step(1 / 60, { y0: -1e4, y1: 1e4 }, false);
    expect(pad.sink).toBeLessThan(sunk * 0.2);
  });

  test('a tap on a leaf presses it down instead of making it hop', () => {
    const pond = new Pond(7);
    pond.pads = [];
    const pad = padAt(pond, 500, 500);
    const hit = pond.splash(515, 500, 6, 2.6);
    expect(hit).toBe(pad);
    expect(pad.sink).toBeGreaterThan(0.5);
    expect(Math.hypot(pad.vx, pad.vy)).toBeLessThan(10);
  });
});
