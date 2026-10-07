/**
 * Mushrooms in the wood, grown from the Hat-throwers' genome (fungi/genome.ts): its capped forms —
 * inkcaps (a pleated bell, its rim dissolving into ink), mottlegills (a grey cone, black gills
 * showing at the rim, mottled) and fieldcaps (a slimy yolk-yellow dome that flares out) — each
 * species' own heights, bells, colours and counts, drawn as a small cluster on the litter: one
 * picture, painted once, at its size in metres, for the wood to stand on the ground (Mistwood's
 * sprites), lit and fogged and hidden by the grass with everything else.
 *
 * The genome's sizes are millimetres; a dung inkcap is a centimetre tall, so the smallest grow to
 * woodland size (about 9 cm) and the rest keep theirs.
 */
import { hash, seeded } from '../kit/rng';
import { species, type Form, type Genome, type V3 } from '../fungi/genome';

export const MUSHROOM_FORMS: Form[] = ['inkcap', 'mottlegill', 'fieldcap'];
/** a find's form, from its seed (so the card's live view grows the same species) */
export const formOf = (seed: number): Form => MUSHROOM_FORMS[hash(seed, 0x5f0) % MUSHROOM_FORMS.length];
export const mushroomSpecies = (seed: number): Genome => species(seed, formOf(seed));

export interface Cluster { canvas: HTMLCanvasElement; w: number; h: number }
const rgb = (c: V3, k = 1, a = 1) => `rgba(${Math.round(Math.min(1, c[0] * k) * 255)},${Math.round(Math.min(1, c[1] * k) * 255)},${Math.round(Math.min(1, c[2] * k) * 255)},${a})`;

/** the cluster for a find's seed, painted (px per metre fixed, so near and far are the same picture) */
export function paintCluster(seed: number): Cluster {
  const g = mushroomSpecies(seed);
  const r = seeded(hash(seed, 0xc1));
  // (metres: the genome's millimetres, the smallest grown to woodland size)
  const k = Math.max(1, 90 / g.height[1]) / 1000;
  const n = Math.max(2, Math.min(g.form === 'inkcap' ? 7 : 5, Math.round(g.count * (g.form === 'inkcap' ? 0.3 : 0.8))));
  const tall = g.height[1] * k;
  const bellR = g.bell * k * (g.form === 'fieldcap' ? 1 + g.flare * 0.6 : 1);
  const w = Math.max(0.16, tall * 1.6 + bellR * 2.4), h = tall + bellR * 2.2 + 0.02;
  const PX = 900;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * PX);
  canvas.height = Math.round(h * PX);
  const c = canvas.getContext('2d')!;
  // (y up from the foot, in metres → canvas pixels)
  const X = (x: number) => (x + w / 2) * PX, Y = (y: number) => canvas.height - (y + 0.012) * PX;
  // the litter they stand in: a few dark leaves and a tuft of moss
  for (let i = 0; i < 10; i++) {
    const lx = (r() - 0.5) * w * 0.7, ly = r() * 0.006, s = (0.005 + r() * 0.008) * PX, a = (r() - 0.5) * 0.6;
    c.save(); c.translate(X(lx), Y(ly)); c.rotate(a); c.scale(1, 0.35);
    c.fillStyle = `rgba(${40 + r() * 30},${30 + r() * 20},${18 + r() * 10},.9)`;
    c.beginPath(); c.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); c.fill(); c.restore();
  }
  // the mushrooms, back to front: each its own height, lean, and size
  const them = Array.from({ length: n }, (_, i) => ({ x: (r() - 0.5) * w * 0.55, z: r() * 2 - 1, h: (g.height[0] + (g.height[1] - g.height[0]) * r()) * k, lean: (r() - 0.5) * g.lean, age: 0.55 + 0.45 * r(), i }));
  them.sort((a, b) => a.z - b.z);
  for (const m of them) {
    const depth = 1 - 0.18 * (m.z + 1) / 2, s = depth;
    const H = m.h * s, R = bellR * (0.75 + 0.35 * m.age) * s;
    const stemR = Math.max(0.0015, g.radius * k * 1.4) * s;
    const top: [number, number] = [m.x + Math.sin(m.lean) * H, H * Math.cos(m.lean * 0.5)];
    // the stalk: velvet, tapering up, lit from the left
    const sg = c.createLinearGradient(X(m.x - stemR), 0, X(m.x + stemR), 0);
    sg.addColorStop(0, rgb(g.glass, 1.02)); sg.addColorStop(0.55, rgb(g.glass, 0.86)); sg.addColorStop(1, rgb(g.glass, 0.58));
    c.fillStyle = sg;
    c.beginPath();
    c.moveTo(X(m.x - stemR * 1.25), Y(0));
    c.quadraticCurveTo(X(m.x + (top[0] - m.x) * 0.3 - stemR), Y(H * 0.5), X(top[0] - stemR * 0.8), Y(top[1]));
    c.lineTo(X(top[0] + stemR * 0.8), Y(top[1]));
    c.quadraticCurveTo(X(m.x + (top[0] - m.x) * 0.3 + stemR), Y(H * 0.5), X(m.x + stemR * 1.25), Y(0));
    c.closePath(); c.fill();
    if (g.fuzz > 0.4) { c.strokeStyle = rgb(g.glass, 1.05, 0.5); c.lineWidth = 0.6; for (let j = 0; j < 8; j++) { const t = r(); const sx = m.x + (top[0] - m.x) * t, sy = top[1] * t; c.beginPath(); c.moveTo(X(sx - stemR), Y(sy)); c.lineTo(X(sx - stemR - 0.002), Y(sy + 0.002)); c.stroke(); } }
    // the cap
    c.save();
    c.translate(X(top[0]), Y(top[1]));
    c.rotate(m.lean * 0.6);
    const cw = R * PX, ch = R * PX * (g.form === 'fieldcap' ? 0.62 : g.form === 'mottlegill' ? 1.05 * g.bellTall : 1.25 * g.bellTall);
    const grad = c.createRadialGradient(-cw * 0.35, -ch * 0.75, cw * 0.1, 0, -ch * 0.3, cw * 1.25);
    grad.addColorStop(0, rgb(g.bellTop, 1.12)); grad.addColorStop(0.45, rgb(g.bellColour, 1)); grad.addColorStop(1, rgb(g.bellColour, 0.62));
    c.beginPath();
    if (g.form === 'fieldcap') {
      // a dome that opens out: the rim flared, the gills showing beneath it
      c.fillStyle = rgb(g.gill, 0.9);
      c.beginPath(); c.ellipse(0, 0, cw * 0.98, cw * 0.18, 0, 0, Math.PI * 2); c.fill();
      c.beginPath();
      c.moveTo(-cw, 0);
      c.bezierCurveTo(-cw * 0.9, -ch * 0.9, cw * 0.9, -ch * 0.9, cw, 0);
      c.quadraticCurveTo(0, cw * 0.08, -cw, 0);
    } else {
      // a bell: inkcap tall and pleated, mottlegill a cone with its rim drawn in
      const rim = g.form === 'inkcap' ? 0.92 : 0.78;
      c.moveTo(-cw * rim, 0);
      c.bezierCurveTo(-cw * 1.05, -ch * 0.7, -cw * 0.45, -ch * 1.05, 0, -ch);
      c.bezierCurveTo(cw * 0.45, -ch * 1.05, cw * 1.05, -ch * 0.7, cw * rim, 0);
      c.quadraticCurveTo(0, cw * 0.1, -cw * rim, 0);
    }
    c.closePath();
    c.fillStyle = grad; c.fill();
    c.clip();
    if (g.form === 'inkcap') {
      // pleats from the crown to the rim; the rim going to ink
      c.strokeStyle = rgb(g.bellTop, 0.6, 0.55); c.lineWidth = 0.7;
      const P = Math.min(16, Math.round(g.pleats / 2));
      for (let j = 1; j < P; j++) { const t = j / P - 0.5; c.beginPath(); c.moveTo(t * cw * 0.3, -ch * 0.97); c.quadraticCurveTo(t * cw * 1.6, -ch * 0.5, t * cw * 1.9, 0); c.stroke(); }
      const ink = c.createLinearGradient(0, -ch * (0.25 + 0.3 * g.ink * m.age), 0, 0);
      ink.addColorStop(0, 'rgba(20,16,14,0)'); ink.addColorStop(1, `rgba(20,16,14,${0.55 + 0.4 * g.ink})`);
      c.fillStyle = ink; c.fillRect(-cw * 1.2, -ch, cw * 2.4, ch * 1.2);
    } else if (g.form === 'mottlegill') {
      // the mottling: soft darker blotches
      for (let j = 0; j < 7; j++) { c.fillStyle = rgb(g.bellTop, 0.75, 0.22); c.beginPath(); c.ellipse((r() - 0.5) * cw * 1.4, -r() * ch * 0.9, cw * (0.12 + r() * 0.15), ch * (0.08 + r() * 0.1), 0, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = rgb(g.gill, 1, 0.85); c.fillRect(-cw, -ch * 0.08, cw * 2, ch * 0.12);
    }
    // a slimy cap catches the light
    if (g.slime > 0.3) { c.fillStyle = `rgba(255,252,236,${0.35 * g.slime})`; c.beginPath(); c.ellipse(-cw * 0.3, -ch * 0.62, cw * 0.28, ch * 0.1, -0.5, 0, Math.PI * 2); c.fill(); }
    c.restore();
  }
  return { canvas, w, h };
}
