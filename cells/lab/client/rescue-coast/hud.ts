/**
 * The round map in the corner (as on the boards' in-game view): the coast round your boat, turned so the way you're
 * heading is up, the compass's N going round its rim; the little boats still waiting (in their colours), the other
 * lifeboats, the harbour mouth. The coast is painted once from its shore field into a small picture; each frame only
 * places and turns it.
 */
import { NX, NZ, X0, Z0, CELL, GATE_Z, type Coast } from './coast';

const PX = 4; // metres per pixel of the painted coast

export class MiniMap {
  private img: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  constructor(private canvas: HTMLCanvasElement) { this.img = document.createElement('canvas'); this.ctx = canvas.getContext('2d')!; }
  /** paint the coast: blue water lighter toward the shore, a white line of surf, green land, tan rock at the edge */
  paint(c: Coast) {
    const w = Math.floor(((NX - 1) * CELL) / PX), h = Math.floor(((NZ - 1) * CELL) / PX);
    this.img.width = w; this.img.height = h;
    const g = this.img.getContext('2d')!, data = g.createImageData(w, h), d = data.data;
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      const i = Math.min(NX - 1, Math.round((u * PX) / CELL)), j = Math.min(NZ - 1, Math.round((v * PX) / CELL)), s = c.shore[j * NX + i], gr = c.ground[j * NX + i];
      let r: number, gg: number, b: number;
      if (s > 2) { const k = Math.min(1, s / 40); r = 70 - 40 * k; gg = 150 - 60 * k; b = 225 - 25 * k; }
      else if (s > -1.5) { r = 245; gg = 248; b = 250; }
      else if (s > -6) { r = 196; gg = 176; b = 140; }
      else { const k = Math.min(1, gr / 30); r = 120 - 30 * k; gg = 170 - 30 * k; b = 80 - 20 * k; }
      const o = (v * w + u) * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255;
    }
    g.putImageData(data, 0, 0);
  }
  /**
   * draw it round a boat: `dots` are [x, z, css colour, size, ring?] (the ring: the colour of a crew going for it); `boats`
   * are [x, z, heading, css colour, mine?]; the
   * gate is the finish. Heading up; what's to the boat's left is on the left.
   */
  draw(bx: number, bz: number, h: number, dots: [number, number, string, number, string?][], boats: [number, number, number, string, boolean][], gateX: number) {
    const cv = this.canvas, g = this.ctx, W = cv.width, R = W / 2, s = R / 150;
    const cs = Math.cos(h), sn = Math.sin(h);
    const toScreen = (x: number, z: number): [number, number] => { const dx = x - bx, dz = z - bz; return [R + s * (-dx * cs + dz * sn), R - s * (dx * sn + dz * cs)]; };
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, W);
    g.save(); g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#3a78c8'; g.fillRect(0, 0, W, W);
    // (the painted coast, by an affine map from its pixels to the screen)
    const [ex, ey] = toScreen(X0, Z0);
    g.setTransform(-PX * s * cs, -PX * s * sn, PX * s * sn, -PX * s * cs, ex, ey);
    g.imageSmoothingEnabled = true; g.drawImage(this.img, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // (the harbour mouth: a chequered bar)
    const [g0x, g0y] = toScreen(gateX - 26, GATE_Z), [g1x, g1y] = toScreen(gateX + 26, GATE_Z);
    g.lineCap = 'butt'; g.lineWidth = 7; g.strokeStyle = '#111'; g.beginPath(); g.moveTo(g0x, g0y); g.lineTo(g1x, g1y); g.stroke();
    g.setLineDash([5, 5]); g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(g0x, g0y); g.lineTo(g1x, g1y); g.stroke(); g.setLineDash([]);
    for (const [x, z, col, n, ring] of dots) {
      const [px, py] = toScreen(x, z);
      if (Math.hypot(px - R, py - R) > R) continue;
      g.fillStyle = col; g.strokeStyle = ring ?? '#fff'; g.lineWidth = ring ? 4 : 2.5; g.beginPath(); g.arc(px, py, 4 + n * 1.5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    for (const [x, z, hh, col, me] of boats) {
      const [px, py] = toScreen(x, z), a = -(hh - h);
      if (!me && Math.hypot(px - R, py - R) > R) continue;
      g.save(); g.translate(px, py); g.rotate(a);
      const k = me ? 1.6 : 1;
      g.fillStyle = me ? '#ffd23a' : col; g.strokeStyle = me ? '#15306a' : '#fff'; g.lineWidth = me ? 3 : 2;
      g.beginPath(); g.moveTo(0, -9 * k); g.lineTo(6 * k, 7 * k); g.lineTo(0, 4 * k); g.lineTo(-6 * k, 7 * k); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    g.restore();
    // (the rim, and N on it where north is)
    g.lineWidth = 6; g.strokeStyle = 'rgba(14,34,78,.7)'; g.beginPath(); g.arc(R, R, R - 3, 0, Math.PI * 2); g.stroke();
    const nx = R + Math.sin(h) * (R - 15), ny = R - Math.cos(h) * (R - 15);
    g.fillStyle = '#15306a'; g.beginPath(); g.arc(nx, ny, 13, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = '700 16px Fredoka, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny + 1);
  }
}

export const clock = (t: number) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;
