/**
 * The notebook's pen: samples inked onto paper. It's the same pen as Switchback's pad (heavier where the hand is slow),
 * but it draws several writings to one fit, so they can be laid over one another (the examiner's way of comparing
 * signatures). And it has a second way of looking: TIME, the line as dots at every hundredth of a second, so their
 * spacing is the speed.
 */
import type { Sig } from '../switchback/sign';

const PEN = 30;

/** the ink's width along a stroke, by how fast the hand went there (as the pad's pen), eased */
function widths(s: number[]) {
  const out = [1];
  let w = 1;
  for (let i = 3; i < s.length; i += 3) {
    const v = Math.hypot(s[i] - s[i - 3], s[i + 1] - s[i - 2]) / Math.max(1, s[i + 2] - s[i - 1]);
    w += (Math.max(0.42, Math.min(1.3, 1.35 - v / 55)) - w) * 0.35;
    out.push(w);
  }
  return out;
}

/** the extent of some writings together */
export function bounds(sigs: Sig[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sig of sigs) for (const s of sig) for (let i = 0; i < s.length; i += 3) {
    x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); y0 = Math.min(y0, s[i + 1]); y1 = Math.max(y1, s[i + 1]);
  }
  return { x0, y0, x1, y1, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** when a writing ended */
export const ended = (sig: Sig) => sig.reduce((t, s) => Math.max(t, s[s.length - 1] ?? 0), 0);

/** how to draw: ink or time; the colours; as far as `upTo`; the pen's weight; and a scale to share (px a unit), so
 * writings in separate canvases come out the same size */
export type Look = { mode: 'ink' | 'time'; ink: string; faint: string; upTo?: number; weight?: number; k?: number };
/** the scale that fits these writings to a canvas of this size */
export const fitK = (sigs: Sig[], W: number, H: number) => { const b = bounds(sigs), edge = Math.max(6, H * 0.08); return Math.min((W - edge * 2) / b.w, (H - edge * 2) / b.h); };

/** a layer to draw one writing on, before it's laid over the others */
let layer: HTMLCanvasElement | null = null;

/** the writings drawn into the canvas, all to one fit (kept in proportion, centred), each as far as `upTo` */
export function paint(cv: HTMLCanvasElement, sigs: Sig[], look: Look) {
  const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(3, devicePixelRatio || 1);
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const b = bounds(sigs), k = look.k ?? fitK(sigs, W, H);
  const ox = (W - b.w * k) / 2 - b.x0 * k, oy = (H - b.h * k) / 2 - b.y0 * k, at = (x: number, y: number) => [ox + x * k, oy + y * k];
  const upTo = look.upTo ?? Infinity, pen = Math.max(1, PEN * k) * (look.weight ?? 1);
  // (laid over one another: each writing drawn solid on a layer of its own, then the layers laid down a little
  // transparent, so where they agree the ink is dark and where they differ it frays, and no writing darkens itself)
  const layered = sigs.length > 1;
  if (layered && (!layer || layer.width !== cv.width || layer.height !== cv.height)) { layer = document.createElement('canvas'); layer.width = cv.width; layer.height = cv.height; }
  const base = g;
  for (const sig of sigs) {
    const g = layered ? layer!.getContext('2d')! : base;
    if (layered) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, layer!.width, layer!.height); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const s of sig) {
      let m = 0;
      while (m * 3 < s.length && s[m * 3 + 2] <= upTo) m++;
      if (!m) continue;
      const p = (i: number) => at(s[i * 3], s[i * 3 + 1]);
      if (look.mode === 'time') {
        // (the line, faint; then a dot at every hundredth of a second along it)
        g.strokeStyle = look.faint; g.lineWidth = 1; g.beginPath();
        for (let i = 0; i < m; i++) { const [x, y] = p(i); if (i) g.lineTo(x, y); else g.moveTo(x, y); }
        g.stroke();
        g.fillStyle = look.ink;
        const t0 = s[2], t1 = s[(m - 1) * 3 + 2];
        let j = 0;
        for (let t = t0; t <= t1; t += 1) {
          while (j < m - 2 && s[(j + 1) * 3 + 2] < t) j++;
          const ta = s[j * 3 + 2], tb = s[Math.min(m - 1, j + 1) * 3 + 2], u = tb > ta ? (t - ta) / (tb - ta) : 0;
          const [ax, ay] = p(j), [bx, by] = p(Math.min(m - 1, j + 1));
          g.beginPath(); g.arc(ax + (bx - ax) * u, ay + (by - ay) * u, Math.max(1.1, pen * 0.32), 0, Math.PI * 2); g.fill();
        }
        continue;
      }
      g.strokeStyle = g.fillStyle = look.ink;
      if (m === 1) { const [x, y] = p(0); g.beginPath(); g.arc(x, y, pen * 0.55, 0, Math.PI * 2); g.fill(); continue; }
      const w = widths(s);
      let [ax, ay] = p(0);
      for (let i = 1; i < m; i++) {
        const [px, py] = p(i), [qx, qy] = i < m - 1 ? p(i + 1) : [px, py], mx = (px + qx) / 2, my = (py + qy) / 2;
        g.lineWidth = pen * w[i];
        g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(px, py, mx, my); g.stroke();
        ax = mx; ay = my;
      }
    }
    if (layered) { base.save(); base.setTransform(1, 0, 0, 1, 0, 0); base.globalAlpha = 0.42; base.drawImage(layer!, 0, 0); base.restore(); }
  }
  g.globalAlpha = 1;
}

/** the writings written out again as they were (all at once, if several), at their own pace or a little quicker */
export function replay(cv: HTMLCanvasElement, sigs: Sig[], look: () => Look, done?: () => void) {
  const end = Math.max(...sigs.map(ended)), rate = Math.max(1, end / 300), t0 = performance.now();
  const token = (cv.dataset.replay = String(Math.random()));
  const frame = (now: number) => {
    if (!cv.isConnected || cv.dataset.replay !== token) return;
    const t = ((now - t0) / 10) * rate;
    paint(cv, sigs, { ...look(), upTo: t });
    if (t < end) requestAnimationFrame(frame); else done?.();
  };
  requestAnimationFrame(frame);
}
