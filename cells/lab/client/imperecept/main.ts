/**
 * Imperecept — full WebGL surface, touch-responsive.
 * Local time-reversal as latent rule. BBC ambient sources under RemArc.
 */

const qs = new URLSearchParams(location.search);
const isPreview = qs.has('preview');

// ---------- minimal DOM shell (GL owns the visual) ----------
const root = document.createElement('div');
root.id = 'imperecept';
document.body.appendChild(root);

root.innerHTML = `
<canvas id="gl"></canvas>
<div class="hud" id="hud">
  <header class="top">
    <a href="/" class="back">← lab</a>
    <span class="name">Imperecept</span>
    <button type="button" id="reveal-btn" class="ghost">Reveal</button>
  </header>
  <div class="presence" id="presence">
    <p class="prompt" id="prompt">A sound is present.</p>
    <p class="hint" id="hint">The rule remains beneath the surface.</p>
  </div>
  <div class="controls" id="controls">
    <div class="row">
      <button type="button" id="play" class="primary">Listen</button>
      <button type="button" id="stop" disabled>Silence</button>
    </div>
    <div class="row soft">
      <label><input type="checkbox" id="drift" checked> Drift</label>
      <label><input type="checkbox" id="follow"> Amplitude</label>
    </div>
    <div class="grain-wrap">
      <input type="range" id="grain" min="12" max="180" step="1" value="38" aria-label="Grain size">
      <output id="grain-val">38 ms</output>
    </div>
    <div class="row">
      <input type="file" id="file" accept="audio/*" hidden>
      <button type="button" id="load">Bring sound</button>
      <select id="sample" aria-label="BBC ambient">
        <option value="">BBC ambient…</option>
        <option value="rain">Rain on leaves</option>
        <option value="wind">Soft wind</option>
        <option value="forest">Forest edge</option>
        <option value="water">Distant water</option>
        <option value="rural">Rural night</option>
      </select>
    </div>
    <p class="credit" id="credit" hidden>BBC Sound Effects · RemArc</p>
  </div>
</div>
<aside class="substrate" id="substrate" hidden>
  <div class="diagram">
    <div class="node hidden-node">IMPERCEPTIBLE</div>
    <div class="arrow">↓</div>
    <div class="node core">imperecept</div>
    <div class="fork">
      <div class="node">PERCEPT</div>
      <div class="node">PRECEPT</div>
    </div>
  </div>
  <p class="note">Grain is the current precept. It governs without being named.</p>
  <button type="button" id="hide-btn" class="ghost">Return surface</button>
</aside>
`;

const style = document.createElement('style');
style.textContent = `
:root {
  --text: #e8e6e1;
  --muted: #8a8780;
  --accent: #7c9cff;
  --dim: rgba(255,255,255,0.08);
  font-family: system-ui, -apple-system, sans-serif;
  color: var(--text);
  background: #050608;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; overflow: hidden; touch-action: manipulation; }
#imperecept { position: fixed; inset: 0; }
#gl {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  display: block;
  touch-action: none;
}
.hud {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  pointer-events: none;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
.hud > * { pointer-events: auto; }
.top {
  height: 52px; padding: 0 16px;
  display: flex; align-items: center; justify-content: space-between;
  background: linear-gradient(to bottom, rgba(5,6,8,0.75), transparent);
}
.back { color: var(--muted); text-decoration: none; font-size: 13px; padding: 10px 0; }
.name { font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); }
.ghost {
  font: inherit; font-size: 13px; background: none; border: 0;
  color: var(--accent); cursor: pointer; padding: 10px 4px; min-height: 44px;
}
.presence {
  flex: 1; display: flex; flex-direction: column; justify-content: center;
  align-items: center; text-align: center; padding: 0 24px;
  pointer-events: none;
}
.prompt { font-size: clamp(18px, 4.5vw, 24px); font-weight: 400; margin: 0 0 8px; letter-spacing: 0.01em; }
.hint { font-size: 13px; color: var(--muted); margin: 0; max-width: 34ch; line-height: 1.45; }
.controls {
  padding: 12px 16px max(20px, env(safe-area-inset-bottom));
  background: linear-gradient(to top, rgba(5,6,8,0.88), transparent);
  display: flex; flex-direction: column; gap: 12px;
}
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.row.soft { font-size: 13px; color: var(--muted); gap: 16px; }
.row.soft label { display: flex; align-items: center; gap: 6px; min-height: 44px; cursor: pointer; }
button, select {
  font: inherit; font-size: 14px; border-radius: 8px;
  border: 1px solid var(--dim); background: rgba(22,24,29,0.85);
  color: var(--text); padding: 12px 16px; min-height: 44px; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
button.primary { background: var(--accent); color: #050608; border-color: var(--accent); }
button:disabled { opacity: 0.4; }
select { min-width: 120px; }
.grain-wrap {
  display: flex; align-items: center; gap: 12px;
}
.grain-wrap input[type=range] {
  flex: 1; height: 44px; margin: 0; accent-color: var(--accent);
  touch-action: pan-x;
}
.grain-wrap output {
  font-variant-numeric: tabular-nums; font-size: 13px; color: var(--muted); min-width: 52px; text-align: right;
}
.credit { font-size: 10px; color: var(--muted); letter-spacing: 0.04em; margin: 0; }
.substrate {
  position: absolute; inset: 0; z-index: 20;
  background: rgba(5,6,8,0.94);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 24px; padding: 24px;
}
.substrate[hidden] { display: none; }
.diagram { text-align: center; font-size: 12px; letter-spacing: 0.06em; }
.node {
  display: inline-block; padding: 10px 16px; border: 1px solid var(--dim);
  border-radius: 4px; margin: 4px;
}
.hidden-node { opacity: 0.5; border-style: dashed; }
.core { background: var(--accent); color: #050608; border-color: var(--accent); letter-spacing: 0.14em; }
.arrow { color: var(--muted); margin: 4px 0; }
.fork { display: flex; gap: 20px; justify-content: center; margin-top: 6px; }
.note { max-width: 36ch; text-align: center; font-size: 14px; color: var(--muted); line-height: 1.5; margin: 0; }
.preview .top, .preview .controls, .preview .hint { display: none; }
.preview .presence { padding-top: 40%; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
document.head.appendChild(style);

// ---------- WebGL field ----------
const canvas = root.querySelector('#gl') as HTMLCanvasElement;
const gl = canvas.getContext('webgl', { antialias: true, alpha: false })!;
if (!gl) throw new Error('WebGL required');

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

const vertSrc = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const fragSrc = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_grain;   // 0..1 mapped from ms
uniform float u_level;   // audio amplitude proxy 0..1
uniform float u_reveal;  // 0 surface, 1 substrate
uniform float u_play;    // 0 or 1

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);

  // soft field — the unrendered substrate
  float t = u_time * 0.08;
  float n1 = noise(p * 2.2 + vec2(t * 0.4, t * 0.25));
  float n2 = noise(p * 5.5 - vec2(t * 0.3, -t * 0.2));
  float field = n1 * 0.65 + n2 * 0.35;

  // grain modulates spatial frequency — the precept as texture
  float g = mix(0.15, 1.4, u_grain);
  float grainField = noise(p * (8.0 + g * 28.0) + t * 1.2);
  float bands = step(0.5, fract(uv.x * (12.0 + u_grain * 40.0) + t * 0.15));
  bands = mix(0.0, bands, u_reveal * 0.35);

  // amplitude breathes the field
  float breath = 0.04 + u_level * 0.12 + u_play * 0.03;

  // base dark surface
  vec3 col = vec3(0.035, 0.038, 0.048);
  col += vec3(0.04, 0.05, 0.09) * field;
  col += vec3(0.06, 0.08, 0.14) * grainField * (0.25 + u_grain * 0.5);
  col += vec3(0.12, 0.16, 0.28) * bands;

  // soft radial falloff so HUD text stays readable
  float vignette = smoothstep(1.35, 0.25, length(p));
  col *= 0.55 + 0.45 * vignette;

  // reveal lifts the field into visibility
  col = mix(col, col * 1.35 + vec3(0.02, 0.03, 0.06), u_reveal * 0.5);

  // gentle pulse when playing
  col += vec3(0.02, 0.025, 0.05) * u_play * (0.5 + 0.5 * sin(u_time * 1.6));

  gl_FragColor = vec4(col, 1.0);
}
`;

function compile(type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
  }
  return s;
}

const prog = gl.createProgram()!;
gl.attachShader(prog, compile(gl.VERTEX_SHADER, vertSrc));
gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc));
gl.linkProgram(prog);
gl.useProgram(prog);

const buf = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const aPos = gl.getAttribLocation(prog, 'a_pos');
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

const uRes = gl.getUniformLocation(prog, 'u_res');
const uTime = gl.getUniformLocation(prog, 'u_time');
const uGrain = gl.getUniformLocation(prog, 'u_grain');
const uLevel = gl.getUniformLocation(prog, 'u_level');
const uReveal = gl.getUniformLocation(prog, 'u_reveal');
const uPlay = gl.getUniformLocation(prog, 'u_play');

let revealAmount = 0;
let targetReveal = 0;
let levelProxy = 0;

function frame(t: number) {
  revealAmount += (targetReveal - revealAmount) * 0.06;
  gl.uniform2f(uRes, canvas.width, canvas.height);
  gl.uniform1f(uTime, t * 0.001);
  gl.uniform1f(uGrain, (+grainEl.value - 12) / 168);
  gl.uniform1f(uLevel, levelProxy);
  gl.uniform1f(uReveal, revealAmount);
  gl.uniform1f(uPlay, playing ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- audio state ----------
let audioCtx: AudioContext | null = null;
let originalBuffer: AudioBuffer | null = null;
let processedBuffer: AudioBuffer | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let playing = false;
let driftTimer: number | null = null;

const grainEl = root.querySelector('#grain') as HTMLInputElement;
const grainVal = root.querySelector('#grain-val') as HTMLOutputElement;
const promptEl = root.querySelector('#prompt') as HTMLParagraphElement;
const hintEl = root.querySelector('#hint') as HTMLParagraphElement;
const driftEl = root.querySelector('#drift') as HTMLInputElement;
const followEl = root.querySelector('#follow') as HTMLInputElement;
const creditEl = root.querySelector('#credit') as HTMLElement;

function ensureCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function setPresence(main: string, sub?: string) {
  promptEl.textContent = main;
  hintEl.textContent = sub ?? '';
}

function reverseLocal(buf: AudioBuffer, grainMs: number): AudioBuffer {
  const ctx = ensureCtx();
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  const grain = Math.max(1, Math.round((grainMs / 1000) * buf.sampleRate));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i += grain) {
      const end = Math.min(i + grain, src.length);
      for (let j = i; j < end; j++) dst[j] = src[end - 1 - (j - i)];
    }
  }
  return out;
}

function reprocess() {
  if (!originalBuffer) return;
  const grainMs = +grainEl.value;
  processedBuffer = reverseLocal(originalBuffer, grainMs);
  grainVal.textContent = `${grainMs} ms`;
  // rough level proxy from first channel
  const d = originalBuffer.getChannelData(0);
  let s = 0;
  for (let i = 0; i < d.length; i += 128) s += Math.abs(d[i]);
  levelProxy = Math.min(1, (s / (d.length / 128)) * 4);
}

grainEl.addEventListener('input', () => {
  reprocess();
  if (playing) { stop(); play(); }
});

function startDrift() {
  stopDrift();
  if (!driftEl.checked) return;
  driftTimer = window.setInterval(() => {
    if (followEl.checked) return;
    const cur = +grainEl.value;
    const next = Math.min(180, Math.max(12, cur + (Math.random() - 0.5) * 4.5));
    grainEl.value = String(Math.round(next));
    reprocess();
    if (playing) { stop(); play(); }
  }, 2200);
}
function stopDrift() {
  if (driftTimer !== null) { clearInterval(driftTimer); driftTimer = null; }
}
driftEl.addEventListener('change', () => driftEl.checked ? startDrift() : stopDrift());
followEl.addEventListener('change', () => {
  if (followEl.checked && originalBuffer) {
    const d = originalBuffer.getChannelData(0);
    let s = 0;
    for (let i = 0; i < d.length; i += 64) s += Math.abs(d[i]);
    const avg = s / (d.length / 64);
    grainEl.value = String(Math.round(Math.min(160, Math.max(16, 18 + avg * 140))));
    reprocess();
  }
});

function stop() {
  if (currentSource) { try { currentSource.stop(); } catch {} currentSource = null; }
  playing = false;
  (root.querySelector('#stop') as HTMLButtonElement).disabled = true;
  (root.querySelector('#play') as HTMLButtonElement).disabled = false;
}
function play() {
  if (!processedBuffer) return;
  stop();
  const ctx = ensureCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = processedBuffer;
  src.connect(ctx.destination);
  src.onended = () => {
    playing = false;
    (root.querySelector('#stop') as HTMLButtonElement).disabled = true;
    (root.querySelector('#play') as HTMLButtonElement).disabled = false;
    setPresence('Returned to silence.', 'The rule remains.');
  };
  src.start();
  currentSource = src;
  playing = true;
  (root.querySelector('#stop') as HTMLButtonElement).disabled = false;
  (root.querySelector('#play') as HTMLButtonElement).disabled = true;
  setPresence('Listening.', 'The precept is active beneath the surface.');
}
root.querySelector('#play')!.addEventListener('click', play);
root.querySelector('#stop')!.addEventListener('click', stop);

async function loadArrayBuffer(ab: ArrayBuffer) {
  const ctx = ensureCtx();
  originalBuffer = await ctx.decodeAudioData(ab.slice(0));
  reprocess();
  setPresence('A sound has been brought in.', 'It is already under the rule.');
  creditEl.hidden = true;
  if (driftEl.checked) startDrift();
}
root.querySelector('#load')!.addEventListener('click', () => (root.querySelector('#file') as HTMLInputElement).click());
root.querySelector('#file')!.addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  await loadArrayBuffer(await f.arrayBuffer());
});

const BBC_AMBIENTS: Record<string, { label: string; urls: string[] }> = {
  rain: { label: 'Rain on leaves', urls: ['https://sound-effects-media.bbcrewind.co.uk/mp3/07026098.mp3', 'https://sound-effects-media.bbcrewind.co.uk/mp3/NHU05013181.mp3'] },
  wind: { label: 'Soft wind', urls: ['https://sound-effects-media.bbcrewind.co.uk/mp3/07042175.mp3', 'https://sound-effects-media.bbcrewind.co.uk/mp3/NHU05071067.mp3'] },
  forest: { label: 'Forest edge', urls: ['https://sound-effects-media.bbcrewind.co.uk/mp3/NHU05013181.mp3', 'https://sound-effects-media.bbcrewind.co.uk/mp3/07026098.mp3'] },
  water: { label: 'Distant water', urls: ['https://sound-effects-media.bbcrewind.co.uk/mp3/07034176.mp3', 'https://sound-effects-media.bbcrewind.co.uk/mp3/07026098.mp3'] },
  rural: { label: 'Rural night', urls: ['https://sound-effects-media.bbcrewind.co.uk/mp3/NHU05071067.mp3', 'https://sound-effects-media.bbcrewind.co.uk/mp3/07042175.mp3'] },
};

function makeFallbackBed(duration = 8): AudioBuffer {
  const ctx = ensureCtx();
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * duration);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 1.5) * Math.min(1, (duration - t) * 1.2);
    last = (last + (Math.random() * 2 - 1) * 0.04) * 0.98;
    d[i] = last * 0.35 * env;
  }
  return buf;
}

async function loadBbcAmbient(key: string) {
  const entry = BBC_AMBIENTS[key];
  if (!entry) return;
  setPresence('Bringing a BBC atmosphere…', '');
  creditEl.hidden = false;
  const ctx = ensureCtx();
  for (const url of entry.urls) {
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      originalBuffer = await ctx.decodeAudioData((await res.arrayBuffer()).slice(0));
      reprocess();
      setPresence(`${entry.label} is present.`, 'BBC · the rule is already acting.');
      if (driftEl.checked) startDrift();
      return;
    } catch {}
  }
  creditEl.hidden = true;
  originalBuffer = makeFallbackBed();
  reprocess();
  setPresence('Archive unreachable.', 'A quiet bed is used. Bring your own sound if you wish.');
  if (driftEl.checked) startDrift();
}

root.querySelector('#sample')!.addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  if (v && BBC_AMBIENTS[v]) void loadBbcAmbient(v);
});

// reveal / hide
const substrate = root.querySelector('#substrate') as HTMLElement;
root.querySelector('#reveal-btn')!.addEventListener('click', () => {
  targetReveal = 1;
  substrate.hidden = false;
  setPresence('Substrate visible.', 'You are reading the rule as well as hearing its effects.');
});
root.querySelector('#hide-btn')!.addEventListener('click', () => {
  targetReveal = 0;
  substrate.hidden = true;
  setPresence(playing ? 'Listening.' : 'A sound is present.', playing ? 'The precept is active beneath the surface.' : 'The rule remains beneath the surface.');
});

// query + preview
const grainQ = qs.get('grain');
if (grainQ && !Number.isNaN(+grainQ)) {
  grainEl.value = String(Math.min(180, Math.max(12, +grainQ)));
  grainVal.textContent = `${grainEl.value} ms`;
}
if (isPreview) {
  document.documentElement.classList.add('preview');
  originalBuffer = makeFallbackBed(3.5);
  if (!grainQ) { grainEl.value = '36'; grainVal.textContent = '36 ms'; }
  reprocess();
  setPresence('A sound is present.', '');
} else {
  setPresence('A sound is present.', 'The rule that shapes it remains beneath the surface.');
}
