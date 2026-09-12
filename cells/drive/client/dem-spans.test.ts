import { clearDemSpans, DEM_SPAN_DEFAULTS, type DemSpan } from './dem-spans';

const W = 64;
const fail = (m: string): never => { throw new Error(m); };

/** A straight span down the middle of the tile, in pixel space. */
const midSpan = (halfPx: number): DemSpan =>
  ({ pts: Float64Array.from([W / 2, 0, W / 2, W - 1]), halfPx });

const flat = (v = 0): Float32Array => new Float32Array(W * W).fill(v);
const at = (d: Float32Array, x: number, y: number): number => d[y * W + x];

export function runDemSpanSelfTest(): void {
  // ── A DECK OVER FLAT WATER IS TAKEN DOWN TO THE WATER ──
  {
    const d = flat(0);
    for (let y = 0; y < W; y++) for (let x = W / 2 - 2; x <= W / 2 + 2; x++) d[y * W + x] = 60;
    const r = clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W);
    if (r.moved < 5 * W * 0.9) fail(`the deck should come down: moved ${r.moved}`);
    if (Math.abs(at(d, W / 2, W / 2) - 1) > 0.01) fail(`cleared to ${at(d, W / 2, W / 2)}, wanted the water + 1`);
    if (Math.abs(r.worstM - 59) > 0.01) fail(`worst ${r.worstM}`);
    if (at(d, 0, W / 2) !== 0) fail('the water either side must not move');
  }
  // ── A ROAD AT GRADE IS NOT A STRUCTURE ──
  {
    const d = flat(12);
    const r = clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W);
    if (r.moved) fail(`nothing stands proud here: moved ${r.moved}`);
  }
  // ── AND NEITHER IS THE HILL A BRIDGE CROSSES ──
  // The mask is the deck's own width, so the walk leaves it within a few
  // texels and finds the hill at its own height. A rule that read the tile's
  // low ground instead would trench the hill from side to side.
  {
    const d = flat(0);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const r2 = Math.hypot(x - W / 2, y - W / 2);
        d[y * W + x] = Math.max(0, 60 - r2 * 2);   // 30% of a 6m texel
      }
    }
    const before = Float32Array.from(d);
    const r = clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W);
    if (r.moved) fail(`a hill under a bridge is still a hill: moved ${r.moved}`);
    for (let i = 0; i < d.length; i++) if (d[i] !== before[i]) fail('the hill moved');
  }
  // ── NOR A STEEP ONE: THE PROMINENCE A MASK SHOWS IS SLOPE x HALF MASK ──
  {
    const d = flat(0);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const r2 = Math.hypot(x - W / 2, y - W / 2);
        d[y * W + x] = Math.max(0, 150 - r2 * 3);     // 50% of a 6m texel
      }
    }
    const r = clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W);
    if (r.moved) fail(`a steep hill is still a hill: moved ${r.moved}`);
  }
  // ── AND A MODEST DECK IS STILL A DECK ──
  {
    const d = flat(0);
    for (let y = 0; y < W; y++) for (let x = W / 2 - 2; x <= W / 2 + 2; x++) d[y * W + x] = 20;
    const r = clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W);
    if (r.moved < 5 * W * 0.9) fail(`a twenty-metre deck should come down too: moved ${r.moved}`);
  }
  // ── A SPAN WIDER THAN THE WALK IS REFUSED, NOT GUESSED ──
  {
    const d = flat(0);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (Math.abs(x - W / 2) <= 20) d[y * W + x] = 60;
    const r = clearDemSpans(d, [midSpan(20)], { ...DEM_SPAN_DEFAULTS, reachPx: 6 }, W);
    if (r.moved) fail(`an embankment is not a deck: moved ${r.moved}`);
    if (!r.refused) fail('the refusal has to be counted, or it looks like a no-op');
  }
  // ── THE HIGHER SIDE WINS: A DECK ALONG A SHORELINE ──
  {
    const d = flat(0);
    for (let y = 0; y < W; y++) for (let x = W / 2 + 3; x < W; x++) d[y * W + x] = 20;
    for (let y = 0; y < W; y++) for (let x = W / 2 - 2; x <= W / 2 + 2; x++) d[y * W + x] = 60;
    clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W);
    if (Math.abs(at(d, W / 2, W / 2) - 21) > 0.01) fail(`cleared to ${at(d, W / 2, W / 2)}, wanted the bank + 1`);
  }
  // ── IT ONLY EVER LOWERS ──
  {
    const d = flat(30);
    for (let y = 0; y < W; y++) for (let x = W / 2 - 2; x <= W / 2 + 2; x++) d[y * W + x] = -10;
    const before = Float32Array.from(d);
    const r = clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W);
    if (r.moved) fail(`a cutting is not a deck: moved ${r.moved}`);
    for (let i = 0; i < d.length; i++) if (d[i] !== before[i]) fail('a lowering rule raised something');
  }
  // ── THE COVER'S WATER IS THE REFERENCE WHERE THERE IS ANY ──
  // The surface model smears a structure wider than its carriageway, so the
  // first texel off the mask is more deck and a rule that stands on it lowers
  // a hundred-metre bridge to thirty. Measured at the Pont de Normandie before
  // the cover was asked: 62.55 m of "ground" came down to 32.45.
  {
    const d = flat(0);
    // A deck five texels wide inside a structure eleven wide — the smear.
    for (let y = 0; y < W; y++) {
      for (let x = W / 2 - 5; x <= W / 2 + 5; x++) d[y * W + x] = 40;
      for (let x = W / 2 - 2; x <= W / 2 + 2; x++) d[y * W + x] = 100;
    }
    const wet = (px: number) => Math.abs(px - W / 2) > 8;
    const r = clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W, (px) => wet(px));
    if (Math.abs(at(d, W / 2, W / 2) - 1) > 0.01) fail(`cleared to ${at(d, W / 2, W / 2)}, wanted the water + 1`);
    if (!r.onWater) fail('the water has to be counted, or nothing says which rule ran');
    // …and with no cover to ask, the old rule stands: the smear is the ground.
    const d2 = flat(0);
    for (let y = 0; y < W; y++) {
      for (let x = W / 2 - 5; x <= W / 2 + 5; x++) d2[y * W + x] = 40;
      for (let x = W / 2 - 2; x <= W / 2 + 2; x++) d2[y * W + x] = 100;
    }
    const r2 = clearDemSpans(d2, [midSpan(3)], DEM_SPAN_DEFAULTS, W);
    if (Math.abs(at(d2, W / 2, W / 2) - 41) > 0.01) fail(`no cover: cleared to ${at(d2, W / 2, W / 2)}, wanted the smear + 1`);
    if (r2.onWater) fail('no cover, no water');
  }
  // ── WATER ON ONE SIDE AND A BANK ON THE OTHER: THE WATER IS THE BED ──
  // The other flank of a span is as often its own pylon as it is a bank, and
  // nothing in a height reading tells those apart. The cover does.
  {
    const d = flat(0);
    for (let y = 0; y < W; y++) for (let x = W / 2 + 3; x < W; x++) d[y * W + x] = 20;
    for (let y = 0; y < W; y++) for (let x = W / 2 - 2; x <= W / 2 + 2; x++) d[y * W + x] = 60;
    clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W, (px) => px < W / 2 - 6);
    if (Math.abs(at(d, W / 2, W / 2) - 1) > 0.01) fail(`cleared to ${at(d, W / 2, W / 2)}, wanted the water + 1`);
  }
  // ── AND A HILL IS STILL A HILL WITH THE COVER ASKED ──
  {
    const d = flat(0);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const r2 = Math.hypot(x - W / 2, y - W / 2);
        d[y * W + x] = Math.max(0, 60 - r2 * 2);
      }
    }
    const r = clearDemSpans(d, [midSpan(3)], DEM_SPAN_DEFAULTS, W, () => false);
    if (r.moved) fail(`a hill under a bridge is still a hill: moved ${r.moved}`);
  }
  // ── NO SPANS IS NOT A PASS OVER THE TILE ──
  {
    const d = flat(0);
    d[0] = 900;
    const r = clearDemSpans(d, [], DEM_SPAN_DEFAULTS, W);
    if (r.moved || d[0] !== 900) fail('with no spans the raster is untouched');
  }
}
