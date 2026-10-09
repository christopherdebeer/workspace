/**
 * Crystals: a seeded mineral specimen, ray-traced in WebGL2. Drag to turn it, pinch or scroll
 * to come closer; left alone it turns on its own, the key light wanders, and a new specimen
 * grows out of its matrix before your eyes.
 *
 * Two passes a frame: the caustic pass sends a sheet of the key light through the crystals
 * (one draw per wavelength, red, green, blue, each at its own index) and splats where each ray
 * lands on the ground into a map; the main pass traces every pixel through the same hulls,
 * reading the map wherever it sees the ground. See shaders.ts for the light, mineral.ts for the
 * specimens. `?seed=` · `?mineral=quartz|amethyst|fluorite|…` · `?q=low|high` · `?still` (no
 * motion) · `?preview`.
 */
import { randomSeed, seedFrom, seedName } from '../kit/rng';
import { growth } from './mineral';
import { createCrystalEngine, type Quality } from './engine';

const qs = new URLSearchParams(location.search);
const preview = qs.has('preview');
const still = qs.has('still');
const quality = (qs.get('q') ?? (preview ? 'low' : /Mobi|Android|iPhone|iPad/.test(navigator.userAgent) ? 'mid' : 'high')) as Quality;
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
if (!gl) throw new Error('WebGL2 needed');
const engine = createCrystalEngine(gl, { quality, still, debug: qs.get('debug') });

// ─── the specimen ─────────────────────────────────────────────────────────────────────────────
let seed = seedFrom(qs.get('seed')) ?? (preview ? 1947 : randomSeed());
function grow(newSeed: number) {
  seed = newSeed;
  engine.grow(seed, qs.get('mineral') ?? undefined);
  const spec = engine.spec;
  const u = new URL(location.href); u.searchParams.set('seed', seedName(seed)); if (!preview) history.replaceState(null, '', u);
  const label = document.getElementById('label');
  if (label) label.innerHTML = `<b>${spec.species.kind}</b><i>${spec.species.name}</i><span>${seedName(seed)} · ${spec.crystals.length} crystals · n ${spec.species.ior.toFixed(2)}</span>`;
}

// ─── the camera ───────────────────────────────────────────────────────────────────────────────
let az = 0.6, el = 0.48, dist = 12.5, spin = 0, dragging = false, lastX = 0, lastY = 0, pinch = 0, idle = 0;
canvas.addEventListener('pointerdown', (ev) => { dragging = true; lastX = ev.clientX; lastY = ev.clientY; canvas.setPointerCapture(ev.pointerId); idle = 0; });
canvas.addEventListener('pointermove', (ev) => { if (!dragging) return; az += (ev.clientX - lastX) * 0.006; el += (ev.clientY - lastY) * 0.004; lastX = ev.clientX; lastY = ev.clientY; idle = 0; });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('wheel', (ev) => { dist = Math.max(5, Math.min(20, dist * (1 + ev.deltaY * 0.001))); ev.preventDefault(); }, { passive: false });
canvas.addEventListener('touchstart', (ev) => { if (ev.touches.length === 2) pinch = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY); }, { passive: true });
canvas.addEventListener('touchmove', (ev) => { if (ev.touches.length === 2 && pinch) { const p = Math.hypot(ev.touches[0].clientX - ev.touches[1].clientX, ev.touches[0].clientY - ev.touches[1].clientY); dist = Math.max(5, Math.min(20, dist * pinch / p)); pinch = p; } }, { passive: true });

// ─── the frame ────────────────────────────────────────────────────────────────────────────────
const scale = quality === 'high' ? 0.8 : quality === 'mid' ? 0.5 : 0.4;
let frames = 0, last = performance.now() / 1000;
function frame() {
  const now = performance.now() / 1000, dt = Math.min(0.1, now - last); last = now;
  if (!dragging && !still) { idle += dt; spin += dt * 0.07 * Math.min(1, idle / 3); }
  const dpr = Math.min(devicePixelRatio || 1, 2) * scale;
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  engine.frame({ az: az + spin, el, dist }, w, h);
  frames++;
  requestAnimationFrame(frame);
}

document.getElementById('another')?.addEventListener('click', () => grow(randomSeed()));
document.getElementById('again')?.addEventListener('click', () => grow(seed));
if (preview) document.body.classList.add('preview');
grow(seed);
(window as unknown as { __crystals: unknown }).__crystals = {
  probe: () => ({ seed: seedName(seed), species: engine.spec.species.name, kind: engine.spec.species.kind, crystals: engine.spec.crystals.length, frames, grown: engine.spec.crystals.every((c) => growth(c, engine.age) >= 1), halfFloat: engine.halfFloat, quality }),
  grow: (s: number) => grow(s),
  settle: () => engine.settle(),
};
requestAnimationFrame(frame);
