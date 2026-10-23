/**
 * Percept — local time-reversal of short audio segments.
 * Demonstrates the Saberi & Perrott (1999) effect and turns it into
 * an exploratory / generative medium.
 */

const qs = new URLSearchParams(location.search);
const isPreview = qs.has('preview');

// ---------- DOM ----------
const root = document.createElement('div');
root.id = 'percept';
document.body.appendChild(root);

root.innerHTML = `
<header>
  <a href="/" id="back">← lab</a>
  <span>Percept</span>
  <button id="about-btn" type="button">About</button>
</header>

<main>
  <section class="stage">
    <div class="meters">
      <canvas id="wave" width="800" height="120" aria-label="Waveform"></canvas>
    </div>

    <div class="controls">
      <label class="grain">
        <span>Grain size</span>
        <input type="range" id="grain" min="10" max="200" step="1" value="40">
        <output id="grain-val">40 ms</output>
      </label>

      <div class="row">
        <button id="play-orig" type="button">Play original</button>
        <button id="play-proc" type="button" class="primary">Play processed</button>
        <button id="stop" type="button" disabled>Stop</button>
      </div>

      <div class="row secondary">
        <label><input type="checkbox" id="band-low" checked> Low</label>
        <label><input type="checkbox" id="band-mid" checked> Mid</label>
        <label><input type="checkbox" id="band-high" checked> High</label>
      </div>

      <div class="row">
        <input type="file" id="file" accept="audio/*" hidden>
        <button id="load" type="button">Load audio…</button>
        <select id="sample">
          <option value="">— built-in samples —</option>
          <option value="tone">Synthetic tone (demo)</option>
          <option value="noise">Noise burst (demo)</option>
        </select>
      </div>
    </div>

    <p class="status" id="status">Load a short clip or choose a built-in sample, then adjust grain size.</p>
  </section>

  <aside id="about" hidden>
    <h2>Local time-reversal</h2>
    <p>Speech (and many other structured sounds) remains surprisingly intelligible when successive short segments are reversed in time. For segments around 20–50&nbsp;ms the brain restores the original message; longer grains produce an uncanny or abstract texture.</p>
    <p>This experiment turns that perceptual fact into a controllable medium: the physical signal is scrambled at a chosen temporal scale while the experience can stay coherent.</p>
    <p class="cite">Saberi &amp; Perrott, <em>Nature</em> 1999. BBC Sound Effects material (when used) is under the RemArc non-commercial licence.</p>
    <button id="close-about" type="button">Close</button>
  </aside>
</main>
`;

// ---------- styles ----------
const style = document.createElement('style');
style.textContent = `
:root {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: #1a1c1f;
  background: #f7f6f3;
  --accent: #2b5cff;
  --muted: #6b7280;
}
* { box-sizing: border-box; }
body { margin: 0; }
header {
  height: 56px; padding: 0 20px;
  display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #e5e3de;
  background: #fff;
}
header a { color: var(--muted); text-decoration: none; font-size: 13px; }
header span { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
header button { font: inherit; border: 0; background: none; color: var(--accent); cursor: pointer; }
main { max-width: 720px; margin: 0 auto; padding: 24px 20px 60px; }
.stage { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.meters { margin-bottom: 28px; }
#wave { width: 100%; height: 120px; background: #f0efeb; border-radius: 8px; display: block; }
.controls { display: flex; flex-direction: column; gap: 18px; }
.grain { display: grid; grid-template-columns: 90px 1fr 70px; align-items: center; gap: 12px; font-size: 14px; }
.grain input { width: 100%; }
.grain output { font-variant-numeric: tabular-nums; color: var(--muted); text-align: right; }
.row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.row.secondary { font-size: 13px; color: var(--muted); gap: 16px; }
button {
  font: inherit; font-size: 14px; border: 1px solid #d4d1cb; background: #fff;
  padding: 10px 16px; border-radius: 8px; cursor: pointer; min-height: 42px;
}
button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
button:disabled { opacity: .45; cursor: default; }
select { font: inherit; padding: 9px 12px; border-radius: 8px; border: 1px solid #d4d1cb; }
.status { margin: 20px 0 0; font-size: 13px; color: var(--muted); line-height: 1.5; }
#about {
  position: fixed; inset: 0; background: rgba(0,0,0,.35);
  display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 20;
}
#about[hidden] { display: none; }
#about > * {
  background: #fff; max-width: 480px; padding: 28px 28px 20px; border-radius: 12px;
  max-height: 80vh; overflow: auto;
}
#about h2 { margin: 0 0 12px; font-weight: 500; font-size: 20px; }
#about p { font-size: 15px; line-height: 1.55; margin: 0 0 12px; }
#about .cite { font-size: 12px; color: var(--muted); }
.preview header, .preview .controls, .preview #about-btn { display: none; }
.preview .stage { box-shadow: none; padding: 12px; }
.preview #wave { height: 80px; }
.preview .status { display: none; }
`;
document.head.appendChild(style);

// ---------- state ----------
let audioCtx: AudioContext | null = null;
let originalBuffer: AudioBuffer | null = null;
let processedBuffer: AudioBuffer | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let playing = false;

const grainEl = root.querySelector('#grain') as HTMLInputElement;
const grainVal = root.querySelector('#grain-val') as HTMLOutputElement;
const statusEl = root.querySelector('#status') as HTMLParagraphElement;
const waveCanvas = root.querySelector('#wave') as HTMLCanvasElement;
const ctx2d = waveCanvas.getContext('2d')!;

function ensureCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function setStatus(msg: string) {
  statusEl.textContent = msg;
}

// ---------- waveform draw ----------
function drawWave(buf: AudioBuffer | null, reversedRegions = false) {
  const w = waveCanvas.width;
  const h = waveCanvas.height;
  ctx2d.fillStyle = '#f0efeb';
  ctx2d.fillRect(0, 0, w, h);
  if (!buf) return;

  const data = buf.getChannelData(0);
  const step = Math.ceil(data.length / w);
  const mid = h / 2;

  ctx2d.strokeStyle = '#2b5cff';
  ctx2d.lineWidth = 1.2;
  ctx2d.beginPath();
  for (let x = 0; x < w; x++) {
    let min = 1, max = -1;
    for (let i = 0; i < step; i++) {
      const v = data[x * step + i] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    ctx2d.moveTo(x, mid + min * mid * 0.9);
    ctx2d.lineTo(x, mid + max * mid * 0.9);
  }
  ctx2d.stroke();

  if (reversedRegions && grainEl) {
    const grainMs = +grainEl.value;
    const grainSamples = Math.round((grainMs / 1000) * buf.sampleRate);
    if (grainSamples > 0) {
      ctx2d.fillStyle = 'rgba(43,92,255,0.08)';
      for (let i = 0; i * grainSamples < data.length; i++) {
        if (i % 2 === 1) {
          const x0 = (i * grainSamples / data.length) * w;
          const x1 = ((i + 1) * grainSamples / data.length) * w;
          ctx2d.fillRect(x0, 0, x1 - x0, h);
        }
      }
    }
  }
}

// ---------- core processing ----------
function reverseLocal(buf: AudioBuffer, grainMs: number): AudioBuffer {
  const ctx = ensureCtx();
  const out = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
  const grain = Math.max(1, Math.round((grainMs / 1000) * buf.sampleRate));

  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch);
    const dst = out.getChannelData(ch);
    for (let i = 0; i < src.length; i += grain) {
      const end = Math.min(i + grain, src.length);
      for (let j = i; j < end; j++) {
        dst[j] = src[end - 1 - (j - i)];
      }
    }
  }
  return out;
}

function reprocess() {
  if (!originalBuffer) return;
  const grainMs = +grainEl.value;
  processedBuffer = reverseLocal(originalBuffer, grainMs);
  drawWave(processedBuffer, true);
  setStatus(`Grain ${grainMs} ms · ${originalBuffer.duration.toFixed(2)} s source`);
}

grainEl.addEventListener('input', () => {
  grainVal.textContent = `${grainEl.value} ms`;
  reprocess();
});

// ---------- playback ----------
function stop() {
  if (currentSource) {
    try { currentSource.stop(); } catch {} 
    currentSource = null;
  }
  playing = false;
  (root.querySelector('#stop') as HTMLButtonElement).disabled = true;
}

function play(buf: AudioBuffer | null) {
  if (!buf) return;
  stop();
  const ctx = ensureCtx();
  if (ctx.state === 'suspended') ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.onended = () => {
    playing = false;
    (root.querySelector('#stop') as HTMLButtonElement).disabled = true;
  };
  src.start();
  currentSource = src;
  playing = true;
  (root.querySelector('#stop') as HTMLButtonElement).disabled = false;
}

root.querySelector('#play-orig')!.addEventListener('click', () => play(originalBuffer));
root.querySelector('#play-proc')!.addEventListener('click', () => play(processedBuffer));
root.querySelector('#stop')!.addEventListener('click', stop);

// ---------- loading ----------
async function loadArrayBuffer(ab: ArrayBuffer) {
  const ctx = ensureCtx();
  originalBuffer = await ctx.decodeAudioData(ab.slice(0));
  reprocess();
  setStatus(`Loaded ${originalBuffer.duration.toFixed(2)} s · ${originalBuffer.numberOfChannels} ch`);
}

root.querySelector('#load')!.addEventListener('click', () => {
  (root.querySelector('#file') as HTMLInputElement).click();
});

root.querySelector('#file')!.addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const ab = await f.arrayBuffer();
  await loadArrayBuffer(ab);
});

// simple built-in generators so the experiment works offline
function makeTone(duration = 2.5, freq = 220): AudioBuffer {
  const ctx = ensureCtx();
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * duration);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 8) * Math.min(1, (duration - t) * 4);
    d[i] = Math.sin(2 * Math.PI * freq * t) * 0.35 * env
         + Math.sin(2 * Math.PI * freq * 2 * t) * 0.12 * env
         + Math.sin(2 * Math.PI * freq * 3 * t) * 0.06 * env;
  }
  return buf;
}

function makeNoise(duration = 1.8): AudioBuffer {
  const ctx = ensureCtx();
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * duration);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const env = Math.min(1, t * 12) * Math.min(1, (duration - t) * 5);
    d[i] = (Math.random() * 2 - 1) * 0.25 * env;
  }
  return buf;
}

root.querySelector('#sample')!.addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  if (v === 'tone') {
    originalBuffer = makeTone();
    reprocess();
    setStatus('Synthetic tone loaded');
  } else if (v === 'noise') {
    originalBuffer = makeNoise();
    reprocess();
    setStatus('Noise burst loaded');
  }
});

// ---------- about ----------
root.querySelector('#about-btn')!.addEventListener('click', () => {
  (root.querySelector('#about') as HTMLElement).hidden = false;
});
root.querySelector('#close-about')!.addEventListener('click', () => {
  (root.querySelector('#about') as HTMLElement).hidden = true;
});

// ---------- query + preview ----------
const grainQ = qs.get('grain');
if (grainQ && !Number.isNaN(+grainQ)) {
  grainEl.value = String(Math.min(200, Math.max(10, +grainQ)));
  grainVal.textContent = `${grainEl.value} ms`;
}

if (isPreview) {
  document.documentElement.classList.add('preview');
  originalBuffer = makeTone(1.6, 196);
  if (!grainQ) {
    grainEl.value = '35';
    grainVal.textContent = '35 ms';
  }
  reprocess();
}

// initial empty wave
drawWave(null);
setStatus(isPreview ? '' : 'Load a short clip or choose a built-in sample, then adjust grain size.');
