/**
 * Recording Switchback as video, three ways.
 *
 * - **Live** (`REC` in the settings): what you see as you ride, the picture and its speed layer composed into one canvas
 *   each frame and recorded as it plays (MediaRecorder: MP4 where the browser can, WebM where not). It's your run, at
 *   whatever pace the device keeps.
 * - **Export** (`EXPORT` in the settings, or `rec=<seconds>[,<fps>[,<w>x<h>]]` in the address): the run from where it is,
 *   rendered offline, the game stepped a fixed 1/fps a frame (so it's smooth whatever the device manages) at a fixed size,
 *   each frame encoded in the page (WebCodecs) and packed into an MP4 (mp4-muxer, loaded when it's needed); the rider on
 *   the autopilot. The live loop is held while it runs.
 * - **Headless** (`rec=headless`, for `devtools/switchback-video.mjs`): the page steps one frame when asked and hands
 *   back the composed frame as a JPEG, for a script to feed to ffmpeg.
 *
 * (An idea seen in a sibling project's exporter, done here our own way: offline, fixed step, encoded in the page.)
 */
const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm';
// (the codecs tried, best first: H.264 high, main, baseline; VP9; AV1)
const CODECS: [string, 'avc' | 'vp9' | 'av1'][] = [['avc1.640033', 'avc'], ['avc1.4d0033', 'avc'], ['avc1.42003e', 'avc'], ['avc1.640028', 'avc'], ['vp09.00.40.08', 'vp9'], ['av01.0.08M.08', 'av1']];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** the picture and its speed layer, drawn into one canvas */
export class Composer {
  readonly cap = document.createElement('canvas');
  private ctx = this.cap.getContext('2d')!;
  constructor(private layers: HTMLCanvasElement[]) {}
  draw() {
    const [a] = this.layers;
    if (this.cap.width !== a.width || this.cap.height !== a.height) { this.cap.width = a.width; this.cap.height = a.height; }
    this.ctx.clearRect(0, 0, this.cap.width, this.cap.height);
    for (const c of this.layers) if (c.width) this.ctx.drawImage(c, 0, 0, this.cap.width, this.cap.height);
    return this.cap;
  }
}

/** save a blob as a file (shared where the device offers it, else downloaded) */
export async function save(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/.test(navigator.userAgent)) { try { await nav.share({ files: [file] }); return; } catch { /* fall through to a download */ } }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/** live recording: start, then call `frame()` after each drawn frame, then `stop()` for the file */
export class Live {
  private rec: MediaRecorder | null = null; private chunks: Blob[] = []; private type = '';
  constructor(private comp: Composer) {}
  get on() { return !!this.rec; }
  start(fps = 30) {
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
    this.type = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    this.comp.draw();
    const stream = this.comp.cap.captureStream(fps);
    this.chunks = [];
    this.rec = new MediaRecorder(stream, { mimeType: this.type || undefined, videoBitsPerSecond: 12e6 });
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(250);
  }
  frame() { if (this.rec) this.comp.draw(); }
  stop(): Promise<Blob> {
    return new Promise((res) => {
      const r = this.rec!; this.rec = null;
      r.onstop = () => res(new Blob(this.chunks, { type: (this.type || 'video/webm').split(';')[0] }));
      r.stop();
    });
  }
}

export type ExportOpts = { seconds: number; fps: number; w: number; h: number };
/** an export: `step(dt)` advances the game and draws a frame (dt 0 for the first); sizes are set by `size`; progress reported */
export async function exportClip(o: ExportOpts, comp: Composer, size: (w: number, h: number) => void, step: (dt: number) => void, progress: (f: number, msg: string) => void, cancelled: () => boolean): Promise<{ blob: Blob; name: string; note: string }> {
  if (!('VideoEncoder' in window)) throw new Error('this browser has no video encoder (WebCodecs): try a recent Chrome, Edge or Safari, or REC instead');
  const w = o.w & ~1, h = o.h & ~1, n = Math.max(1, Math.round(o.seconds * o.fps));
  let codec: (typeof CODECS)[number] | null = null;
  for (const c of CODECS) { try { const s = await VideoEncoder.isConfigSupported({ codec: c[0], width: w, height: h, bitrate: 14e6, framerate: o.fps }); if (s.supported) { codec = c; break; } } catch { /* next */ } }
  if (!codec) throw new Error(`no video codec here at ${w} × ${h}: try a smaller size`);
  progress(0, 'loading the muxer…');
  const load = new Function('u', 'return import(u)') as (u: string) => Promise<{ Muxer: new (o: unknown) => { addVideoChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void; finalize: () => void }; ArrayBufferTarget: new () => { buffer: ArrayBuffer } }>;
  const { Muxer, ArrayBufferTarget } = await load(MUXER);
  const target = new ArrayBufferTarget();
  const mux = new Muxer({ target, video: { codec: codec[1], width: w, height: h }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let err: unknown = null;
  const enc = new VideoEncoder({ output: (c, m) => mux.addVideoChunk(c, m), error: (e) => { err = e; } });
  enc.configure({ codec: codec[0], width: w, height: h, bitrate: 14e6, framerate: o.fps });
  size(w, h);
  const t0 = performance.now();
  try {
    for (let i = 0; i < n && !err && !cancelled(); i++) {
      step(i ? 1 / o.fps : 0);
      const vf = new VideoFrame(comp.draw(), { timestamp: Math.round((1e6 * i) / o.fps), duration: Math.round(1e6 / o.fps) });
      enc.encode(vf, { keyFrame: i % (o.fps * 2) === 0 }); vf.close();
      while (enc.encodeQueueSize > 4) await sleep(4);
      if (i % 3 === 0) { const left = ((performance.now() - t0) / 1000 / (i + 1)) * (n - i - 1); progress((i + 1) / n, `frame ${i + 1} / ${n} · ${w} × ${h} · about ${Math.ceil(left)} s left`); await sleep(0); }
    }
    if (!err && !cancelled()) await enc.flush();
  } finally { try { enc.close(); } catch { /* closed */ } }
  if (err) throw err;
  if (cancelled()) throw new Error('cancelled');
  mux.finalize();
  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  return { blob, name: `switchback-${w}x${h}-${o.fps}fps-${o.seconds}s.mp4`, note: `${codec[1] === 'avc' ? 'H.264' : codec[1].toUpperCase()} · ${w} × ${h} · ${o.seconds} s · ${(blob.size / 1048576).toFixed(1)} MB` };
}
