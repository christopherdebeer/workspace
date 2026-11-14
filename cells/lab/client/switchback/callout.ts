/**
 * The callouts written by hand (`ink`): a trick, a checkpoint, a wipe-out, written by the autograph's hand (the newest
 * Claude Hand, joined, as a signature is written) and inked as a loaded brush in the speed layer's canvas, so it's
 * in the picture (and in a video of it), not set in type over it. Each writes itself out at a lick, the strokes laid in
 * the order and at the pace the hand made them (sped up), holds, and fades; a cream line over an orange one a little
 * offset (the type's own orange shadow). Written in sentence case ("Double backflip"), as a hand writes.
 */
import { write } from '../autograph/hands/v34';
import type { Sig } from './sign';

const PEN = 30;
type Item = { sig: Sig; t0: number; end: number; box: number[] };

export class Callouts {
  private item: Item | null = null; private n = 0;
  /** a callout, written from game time t (s) */
  say(text: string, t: number) {
    const words = text.toLowerCase().replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
    const sig = write(words, 7 + this.n++ * 13);
    if (!sig.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, end = 0;
    for (const s of sig) for (let i = 0; i < s.length; i += 3) { x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]); end = Math.max(end, s[i + 2]); }
    this.item = { sig, t0: t, end, box: [x0, y0, x1, y1] };
  }
  /** drawn over the canvas (its size W × H in CSS pixels, at dpr), at game time t */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number, t: number) {
    const it = this.item; if (!it) return;
    // (written in about 0.6 s whatever its length, held, then faded)
    const write = Math.max(0.45, Math.min(0.8, it.end / 300)), age = t - it.t0, hold = write + 0.9, fade = 0.45;
    if (age > hold + fade) { this.item = null; return; }
    const upTo = Math.min(1, age / write) * it.end, alpha = age < hold ? 1 : 1 - (age - hold) / fade;
    const [x0, y0, x1, y1] = it.box, bw = W * 0.86, bh = H * 0.2, k = Math.min(bw / Math.max(1, x1 - x0), bh / Math.max(1, y1 - y0));
    const ox = W / 2 - ((x0 + x1) / 2) * k, oy = H * 0.3 - ((y0 + y1) / 2) * k, pen = Math.max(3, PEN * k * 1.5);
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.globalAlpha = Math.max(0, alpha);
    // (each stroke one continuous line, as a loaded brush lays it: its width with the hand's speed (broad where it went
    // slowly), round where it turns and ends; an orange line under it a little offset; bristle grooves along it)
    const path = (s0: number[], dx: number, dy: number, f: (x0: number, y0: number, x1: number, y1: number, w: number, i: number) => void) => {
      let px = 0, py = 0, w = 1;
      for (let i = 0; i < s0.length; i += 3) {
        if (s0[i + 2] > upTo) break;
        const x = ox + s0[i] * k + dx, y = oy + s0[i + 1] * k + dy;
        if (i) { const dt = Math.max(1, s0[i + 2] - s0[i - 1]), v = Math.hypot(s0[i] - s0[i - 3], s0[i + 1] - s0[i - 2]) / dt; w += (Math.max(0.5, Math.min(1.3, 1.35 - v / 55)) - w) * 0.35; f(px, py, x, y, w, i); }
        px = x; py = y;
      }
    };
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const [col, dx, dy, wk] of [['#e85a0d', pen * 0.16, pen * 0.28, 1.12], ['#fbf3e6', 0, 0, 1]] as [string, number, number, number][]) {
      ctx.strokeStyle = col;
      for (const st of it.sig) path(st, dx, dy, (x0, y0, x1, y1, w) => { ctx.lineWidth = pen * wk * w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); });
    }
    // (the bristles: fine grooves along the cream, a little darker, either side of its middle)
    ctx.strokeStyle = 'rgba(205,180,150,.55)';
    for (const st of it.sig) for (const side of [-0.28, 0.06, 0.3]) path(st, 0, 0, (x0, y0, x1, y1, w) => {
      const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = (-(y1 - y0) / L) * pen * w * side, ny = ((x1 - x0) / L) * pen * w * side;
      ctx.lineWidth = Math.max(0.6, pen * w * 0.1); ctx.beginPath(); ctx.moveTo(x0 + nx, y0 + ny); ctx.lineTo(x1 + nx, y1 + ny); ctx.stroke();
    });
    ctx.restore();
  }
}
