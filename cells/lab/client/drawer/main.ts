/**
 * The drawer experiment's own page (`/drawer`): the drawer and its sections (client/drawer/*) over a stand-in scene, a
 * stone on a ground, drawn on a canvas, which rises clear of the drawer as it opens (`lift`). Other experiments import
 * the drawer from here (`../drawer/drawer`, `../drawer/sections`); this page is where it's made and judged.
 */
import { drawer, lift } from './drawer';
import { sections } from './sections';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const qs = new URLSearchParams(location.search);
if (qs.has('preview')) document.documentElement.classList.add('preview');
const st = { size: 1, ink: 'sumi', grain: 0.4, crack: true, az: 2.3, el: 0.6, grid: true, zoom: 1, lifting: true, theme: qs.get('theme') === 'dark' ? 'dark' : 'paper' };
const INKS: Record<string, string> = { sumi: '#26221e', sepia: '#6b4a2f', indigo: '#283a5c' };

// ─── the drawer ───
let shift = 0, shiftGoal = 0;
const d = drawer($('drawer'), { start: qs.has('preview') ? 'closed' : (qs.get('drawer') as 'closed' | 'focus' | 'full' | null) ?? 'focus', persist: qs.has('preview') || qs.has('drawer') ? undefined : 'drawer-demo', onHeight: (h) => { shiftGoal = st.lifting ? lift(h, innerHeight) : 0; } });
const s = sections($('drawer'), {
  persist: 'drawer-demo-section',
  summaries: () => ({ subject: `${st.ink} · size ${st.size.toFixed(2)} · grain ${st.grain.toFixed(2)}`, light: `sun ${st.az.toFixed(1)}, ${st.el.toFixed(1)}`, display: `${st.grid ? 'grid' : 'bare'} · zoom ${st.zoom.toFixed(2)}` }),
});
const sync = () => {
  document.documentElement.classList.toggle('dark', st.theme === 'dark');
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme],[data-ink],[data-crack],[data-grid]')) {
    const on = b.dataset.theme ? b.dataset.theme === st.theme : b.dataset.ink ? b.dataset.ink === st.ink : b.dataset.crack ? (b.dataset.crack === 'on') === st.crack : (b.dataset.grid === 'on') === st.grid;
    b.setAttribute('aria-pressed', String(on));
  }
  $('lifting').setAttribute('aria-pressed', String(st.lifting));
  for (const k of ['size', 'grain', 'az', 'el', 'zoom'] as const) { $<HTMLInputElement>(k).value = String(st[k]); $(`${k}-v`).textContent = (st[k] as number).toFixed(2); }
  $('sum').textContent = `${st.ink} stone · sun ${st.az.toFixed(1)} · ${st.grid ? 'grid' : 'bare'}`;
  s.refresh();
};
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-theme]')) b.onclick = () => { st.theme = b.dataset.theme!; sync(); };
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-ink]')) b.onclick = () => { st.ink = b.dataset.ink!; sync(); };
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-crack]')) b.onclick = () => { st.crack = b.dataset.crack === 'on'; sync(); };
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-grid]')) b.onclick = () => { st.grid = b.dataset.grid === 'on'; sync(); };
$('lifting').onclick = () => { st.lifting = !st.lifting; shiftGoal = st.lifting ? lift(d.height, innerHeight) : 0; sync(); };
for (const k of ['size', 'grain', 'az', 'el', 'zoom'] as const) $<HTMLInputElement>(k).oninput = (e) => { st[k] = Number((e.target as HTMLInputElement).value); sync(); };
sync();

// ─── the stand-in scene: a stone on a ground, its middle lifted clear of the drawer ───
const cv = $<HTMLCanvasElement>('view'), g = cv.getContext('2d')!;
function frame() {
  const dpr = Math.min(2, devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  shift += (shiftGoal - shift) * 0.15;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement), dark = st.theme === 'dark', ink = dark ? '#b9b0a2' : INKS[st.ink], hi = dark ? '#5a554e' : css.getPropertyValue('--bg'), cx = W / 2, cy = H * (0.55 - shift * 0.5), R = Math.min(W, H) * 0.18 * st.size * st.zoom;
  // (the ground: a grid in perspective, its horizon lifted with the subject)
  if (st.grid) { g.strokeStyle = css.getPropertyValue('--edge'); g.lineWidth = 1; const hz = cy - R * 0.2; for (let k = 1; k < 14; k++) { const y = hz + (H - hz) * (k / 14) ** 1.6; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } for (let k = -10; k <= 10; k++) { g.beginPath(); g.moveTo(cx + k * 6, hz); g.lineTo(cx + k * W * 0.18, H); g.stroke(); } }
  // (its shadow away from the sun, then the stone, shaded toward the sun)
  const sx = -Math.cos(st.az), sy = Math.sin(st.az) * 0.3, len = R * (1.6 - st.el);
  g.fillStyle = dark ? 'rgba(0,0,0,.35)' : 'rgba(40,34,28,.18)'; g.beginPath(); g.ellipse(cx + sx * len * 0.7, cy + R * 0.62 + sy * len * 0.2, R * 1.1 + len * 0.35, R * 0.22, 0, 0, Math.PI * 2); g.fill();
  const gr = g.createRadialGradient(cx + Math.cos(st.az) * R * 0.5, cy - R * st.el * 0.5, R * 0.1, cx, cy, R * 1.3);
  gr.addColorStop(0, dark ? ink : hi); gr.addColorStop(1, dark ? hi : ink);
  g.fillStyle = gr; g.beginPath(); g.ellipse(cx, cy, R * 1.25, R * 0.72, -0.12, 0, Math.PI * 2); g.fill();
  g.strokeStyle = ink; g.lineWidth = 2; g.stroke();
  if (st.crack) { g.lineWidth = 2.4; g.beginPath(); g.moveTo(cx - R * 0.3, cy - R * 0.66); g.quadraticCurveTo(cx - R * 0.05, cy - R * 0.1, cx + R * 0.25, cy + R * 0.2); g.stroke(); }
  for (let k = 0; k < st.grain * 300; k++) { const a = (k * 2.399) % (Math.PI * 2), r = Math.sqrt(((k * 0.618) % 1)) * R; g.fillStyle = ink; g.globalAlpha = 0.25; g.fillRect(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r * 0.65, 1.2, 1.2); }
  g.globalAlpha = 1;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
(window as unknown as { __drawer: unknown }).__drawer = { drawer: d, sections: s, get state() { return d.state; }, get height() { return d.height; }, get shift() { return shift; } };
