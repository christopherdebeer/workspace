/**
 * Where a frame's time goes, so a heavy frame can be put down to its cause. Anything (main.ts, the model, the cats, the
 * renderer) can say what it spent: `perf.add(name, ms)`, `perf.time(name, fn)`, `perf.count(name)`, `perf.tag(name)`.
 * What's spent between two frames (a pointer's handlers, the readings they make) is put on the frame it held up. Each
 * frame is kept (the last 900, about fifteen seconds), with its interval, its time on the CPU, what it spent on each
 * thing, what it counted, what was going on (a gesture, a remesh, a resize), and the GPU's times for it when they come
 * back (render.ts, where the browser lets them be timed); where the browser reports long animation frames (Chrome), the
 * scripts in them are kept with the frame they fell in. A frame much slower than the frames round it is a heavy frame:
 * kept apart (the last 60), with what most likely made it so.
 *
 * Names are dotted (deeper names are parts of the part before them, `mesh.build.land`, never added to it): the first part is the phase a frame is made of (`input`, `resize`, `mesh`, `cats`, `draw`,
 * `overlay`), the rest says more (`input.move`, `cats.perches`); and some name work done inside a phase wherever it falls
 * (`world.rebuild`, `gesture.trace`), not phases of their own, so they're never counted twice.
 *
 * Cheap enough to leave on: a few `performance.now()` calls and map writes a frame.
 */
export interface FrameRecord {
  id: number; t: number; interval: number; cpu: number;
  spans: Record<string, number>; counts: Record<string, number>; tags: string[];
  /** its time by phase (each phase's own span, or where it's timed only in its parts, their sum) */
  phases?: Record<string, number>;
  gpu?: { shadow: number; main: number; post: number };
  /** the browser's long animation frame that covered it, its scripts (Chrome) */
  loaf?: { duration: number; blocking: number; scripts: Array<{ what: string; ms: number }> };
}
export interface Heavy extends FrameRecord { cause: string; why: string }

const N = 900, PHASES = ['input', 'resize', 'mesh', 'cats', 'draw', 'overlay'];
/** a frame's time by phase: each phase's own span, or where it's timed only in its parts, their sum */
function phasesOf(spans: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(spans)) { const p = k.split('.')[0]; if (!PHASES.includes(p)) continue; if (k === p) out[p] = (out[p] ?? 0) + v; else if (!(p in spans) && k.split('.').length === 2) out[p] = (out[p] ?? 0) + v; }
  for (const k of Object.keys(out)) out[k] = +out[k].toFixed(2);
  return out;
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

class Perf {
  on = true;
  frames: FrameRecord[] = [];
  heavy: Heavy[] = [];
  frameId = 0;
  private spans = new Map<string, number>();
  private counts = new Map<string, number>();
  private tags = new Set<string>();
  private open: Array<{ name: string; t: number }> = [];
  private loafs: Array<{ start: number; end: number; duration: number; blocking: number; scripts: Array<{ what: string; ms: number }> }> = [];

  constructor() {
    // (the browser's own account of long frames, where it gives one: Chrome's long animation frames, and its scripts)
    try {
      if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as Array<{ startTime: number; duration: number; blockingDuration?: number; scripts?: Array<{ invoker?: string; sourceFunctionName?: string; duration: number }> }>) {
            const scripts = (e.scripts ?? []).map((s) => ({ what: s.sourceFunctionName || s.invoker || '?', ms: +s.duration.toFixed(1) })).sort((a, b) => b.ms - a.ms).slice(0, 5);
            this.loafs.push({ start: e.startTime, end: e.startTime + e.duration, duration: +e.duration.toFixed(1), blocking: +(e.blockingDuration ?? 0).toFixed(1), scripts });
            if (this.loafs.length > 60) this.loafs.shift();
          }
        }).observe({ type: 'long-animation-frame', buffered: true });
      }
    } catch { /* (not where it isn't) */ }
  }

  /** time spent on something, put on this frame */
  add(name: string, ms: number) { if (this.on) this.spans.set(name, (this.spans.get(name) ?? 0) + ms); }
  /** something counted, on this frame (a world rebuilt, a sim made) */
  count(name: string, n = 1) { if (this.on) this.counts.set(name, (this.counts.get(name) ?? 0) + n); }
  /** what was going on this frame (a gesture's mode, a remesh) */
  tag(name: string) { if (this.on) this.tags.add(name); }
  /** time a function, as `name` */
  time<T>(name: string, fn: () => T): T {
    if (!this.on) return fn();
    const t = now();
    try { return fn(); } finally { this.add(name, now() - t); }
  }
  /** a function that times itself whenever it's called (an event's handler) */
  wrap<A extends unknown[], R>(name: string, fn: (...a: A) => R): (...a: A) => R { return (...a: A) => this.time(name, () => fn(...a)); }
  /** begin and end by hand, where a span doesn't fit in a function */
  begin(name: string) { if (this.on) this.open.push({ name, t: now() }); }
  end() { const o = this.open.pop(); if (o) this.add(o.name, now() - o.t); }

  /** a frame drawn: what it spent is kept, and if it was heavy, why */
  frame(t: number, interval: number, cpu: number) {
    if (!this.on) return;
    const rec: FrameRecord = { id: this.frameId, t, interval: +interval.toFixed(2), cpu: +cpu.toFixed(2), spans: {}, counts: {}, tags: [...this.tags] };
    for (const [k, v] of this.spans) rec.spans[k] = +v.toFixed(2);
    for (const [k, v] of this.counts) rec.counts[k] = v;
    this.spans.clear(); this.counts.clear(); this.tags.clear();
    rec.phases = phasesOf(rec.spans);
    this.frames.push(rec);
    if (this.frames.length > N) this.frames.shift();
    this.frameId++;
    this.judge(rec);
  }
  /** the GPU's times for a frame, as they come back (a few frames late) */
  gpu(id: number, shadow: number, main: number, post: number) {
    const f = this.find(id);
    if (f) f.gpu = { shadow: +shadow.toFixed(2), main: +main.toFixed(2), post: +post.toFixed(2) };
    const h = this.heavy.find((q) => q.id === id);
    if (h) { h.gpu = f?.gpu; this.explain(h); }
  }
  private find(id: number) { const k = this.frames.length - 1 - (this.frameId - 1 - id); return k >= 0 && k < this.frames.length && this.frames[k].id === id ? this.frames[k] : undefined; }

  /** the typical interval of the frames before this one (their median) */
  private typical(): number {
    const xs = this.frames.slice(-121, -1).map((f) => f.interval).sort((a, b) => a - b);
    return xs.length ? xs[Math.floor(xs.length / 2)] : 16.7;
  }
  /** heavy: much slower than the frames round it, or over a budget of its own */
  private judge(f: FrameRecord) {
    const typ = this.typical();
    if (!(f.interval > Math.max(34, typ * 1.8) || f.cpu > 24)) return;
    const h: Heavy = { ...f, cause: '', why: '' };
    // (the browser's long frame that covered it, if it says)
    const l = this.loafs.find((q) => q.start < f.t + f.interval && q.end > f.t);
    if (l) h.loaf = { duration: l.duration, blocking: l.blocking, scripts: l.scripts };
    this.explain(h, typ);
    this.heavy.push(h);
    if (this.heavy.length > 60) this.heavy.shift();
  }
  /** why a heavy frame was heavy: the phase that spent most, against what wasn't accounted for on the CPU (the GPU, the
   * browser, a pause) */
  private explain(h: Heavy, typ = this.typical()) {
    const phase = h.phases ?? phasesOf(h.spans);
    const accounted = Object.values(phase).reduce((a, b) => a + b, 0);
    const gpu = h.gpu ? h.gpu.shadow + h.gpu.main + h.gpu.post : 0;
    const unaccounted = Math.max(0, h.interval - accounted);
    const top = Object.entries(phase).sort((a, b) => b[1] - a[1])[0];
    const parts = Object.entries(h.spans).filter(([k]) => k.includes('.')).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(1)}`);
    if (top && top[1] >= unaccounted * 0.6) { h.cause = top[0]; h.why = `${top[0]} ${top[1].toFixed(1)} ms of ${h.interval.toFixed(1)} (typical ${typ.toFixed(1)})${parts.length ? `: ${parts.join(', ')}` : ''}`; }
    else if (gpu > 0 && gpu >= unaccounted * 0.6) { h.cause = 'gpu'; h.why = `GPU ${gpu.toFixed(1)} ms (shadow ${h.gpu!.shadow}, main ${h.gpu!.main}, post ${h.gpu!.post})`; }
    else if (h.loaf && h.loaf.scripts.length) { h.cause = 'script'; h.why = `long frame ${h.loaf.duration} ms, scripts: ${h.loaf.scripts.map((s) => `${s.what} ${s.ms}`).join(', ')}`; }
    else { h.cause = 'unaccounted'; h.why = `${unaccounted.toFixed(1)} ms not on the CPU here (GPU not timed, the browser, or a pause)${h.tags.length ? `; during ${h.tags.join(', ')}` : ''}`; }
  }

  /** what it all comes to: per phase and per part, over the frames kept; the heavy frames and their causes */
  report() {
    const fs = this.frames, n = fs.length;
    const pct = (xs: number[], p: number) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2); };
    const names = new Set<string>(); for (const f of fs) for (const k of Object.keys(f.spans)) names.add(k);
    const spans: Record<string, { framesWith: number; mean: number; p95: number; max: number; total: number }> = {};
    for (const k of [...names].sort()) {
      const xs = fs.map((f) => f.spans[k] ?? 0), with_ = xs.filter((x) => x > 0);
      spans[k] = { framesWith: with_.length, mean: +(xs.reduce((a, b) => a + b, 0) / Math.max(1, n)).toFixed(3), p95: pct(xs, 0.95), max: +Math.max(0, ...xs).toFixed(2), total: +xs.reduce((a, b) => a + b, 0).toFixed(1) };
    }
    const cn = new Set<string>(); for (const f of fs) for (const k of Object.keys(f.counts)) cn.add(k);
    const counts: Record<string, { total: number; maxInFrame: number }> = {};
    for (const k of [...cn].sort()) { const xs = fs.map((f) => f.counts[k] ?? 0); counts[k] = { total: xs.reduce((a, b) => a + b, 0), maxInFrame: Math.max(...xs) }; }
    const causes: Record<string, number> = {}; for (const h of this.heavy) causes[h.cause] = (causes[h.cause] ?? 0) + 1;
    return {
      frames: n, interval: { p50: pct(fs.map((f) => f.interval), 0.5), p95: pct(fs.map((f) => f.interval), 0.95), p99: pct(fs.map((f) => f.interval), 0.99), max: pct(fs.map((f) => f.interval), 1) },
      cpu: { p50: pct(fs.map((f) => f.cpu), 0.5), p95: pct(fs.map((f) => f.cpu), 0.95), max: pct(fs.map((f) => f.cpu), 1) },
      spans, counts, heavyCauses: causes,
      heavy: this.heavy.slice(-20).map((h) => ({ id: h.id, ago: +((now() - h.t) / 1000).toFixed(1), interval: h.interval, cpu: h.cpu, cause: h.cause, why: h.why, tags: h.tags, spans: h.spans, counts: h.counts, gpu: h.gpu, loaf: h.loaf })),
    };
  }
  /** the last `s` seconds, per phase, for the on-screen meter */
  recent(s = 2) {
    const t0 = now() - s * 1000, fs = this.frames.filter((f) => f.t >= t0), out: Record<string, number> = {};
    for (const f of fs) for (const [k, v] of Object.entries(f.phases ?? {})) out[k] = (out[k] ?? 0) + v;
    for (const k of Object.keys(out)) out[k] = +(out[k] / Math.max(1, fs.length)).toFixed(2);
    const iv = fs.map((f) => f.interval).sort((a, b) => a - b);
    return { frames: fs.length, fps: fs.length ? +(fs.length / s).toFixed(0) : 0, p95: iv.length ? iv[Math.floor(iv.length * 0.95)] : 0, phases: out, heavy: this.heavy.filter((h) => h.t >= t0).length };
  }
  reset() { this.frames = []; this.heavy = []; }
}

export const perf = new Perf();
