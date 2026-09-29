/**
 * Frame telemetry, for attributing a stutter from a phone we can't attach to.
 *
 * Each frame is split into sections by `mark(name)`; the time since the
 * previous mark is charged to that section. The last ten seconds of frames
 * are kept for percentiles; every long frame (> 33 ms) is counted, and the
 * worst frame keeps its section breakdown and the scene's counts at the time,
 * so a spike can be blamed on the world step, the fish, or the draw submit.
 * CPU only: GPU time is not observable here, but a frame whose sections sum to
 * much less than its length was waiting on the GPU (or the browser).
 */
export interface Counts {
  [k: string]: number;
}

interface Frame {
  ms: number;
  sections: Record<string, number>;
}

export class Perf {
  private ring: number[] = [];
  private frames = 0;
  private t0 = 0;
  private tMark = 0;
  private cur: Record<string, number> = {};
  private sum: Record<string, number> = {};
  private sumFrames = 0;
  long = 0;
  veryLong = 0;
  worst: (Frame & { at: number; counts: Counts }) | null = null;
  recentWorst: (Frame & { at: number; counts: Counts }) | null = null;
  private sinceReset = 0;
  private lastCounts: Counts = {};

  begin(now: number) {
    this.t0 = now;
    this.tMark = now;
    this.cur = {};
  }

  /** Charge the time since the last mark to `name`. */
  mark(name: string) {
    const now = performance.now();
    this.cur[name] = (this.cur[name] ?? 0) + (now - this.tMark);
    this.tMark = now;
  }

  /** The frame's wall time is `ms` (as the browser reported it); `counts` is what was in the scene. */
  end(ms: number, counts: Counts, at: number) {
    this.lastCounts = counts;
    this.frames += 1;
    this.sumFrames += 1;
    this.ring.push(ms);
    if (this.ring.length > 600) this.ring.shift();
    for (const k of Object.keys(this.cur)) this.sum[k] = (this.sum[k] ?? 0) + this.cur[k];
    const cpu = Object.values(this.cur).reduce((a, b) => a + b, 0);
    this.cur.wait = Math.max(0, ms - cpu);
    this.sum.wait = (this.sum.wait ?? 0) + this.cur.wait;
    if (ms > 33) this.long += 1;
    if (ms > 100) this.veryLong += 1;
    const frame = { ms, sections: { ...this.cur }, at, counts };
    if (!this.worst || ms > this.worst.ms) this.worst = frame;
    if (!this.recentWorst || ms > this.recentWorst.ms) this.recentWorst = frame;
    this.sinceReset += ms;
    if (this.sinceReset > 10_000) {
      this.sinceReset = 0;
      this.recentWorst = frame;
    }
  }

  private pct(p: number): number {
    if (!this.ring.length) return 0;
    const s = this.ring.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  }

  /** A compact picture of the last ten seconds and the worst moments so far. */
  summary() {
    const r1 = (x: number) => Math.round(x * 10) / 10;
    const avg: Record<string, number> = {};
    for (const k of Object.keys(this.sum)) avg[k] = r1(this.sum[k] / Math.max(1, this.sumFrames));
    const round = (f: (Frame & { at: number; counts: Counts }) | null) =>
      f && { ms: r1(f.ms), at: Math.round(f.at), sections: Object.fromEntries(Object.entries(f.sections).map(([k, v]) => [k, r1(v)])), counts: f.counts };
    return {
      frames: this.frames,
      p50: r1(this.pct(0.5)),
      p95: r1(this.pct(0.95)),
      max10s: r1(this.ring.length ? Math.max(...this.ring) : 0),
      long: this.long,
      veryLong: this.veryLong,
      /** Average ms per frame charged to each section since load ('wait' = not on our CPU). */
      sections: avg,
      worst: round(this.worst),
      recentWorst: round(this.recentWorst),
      counts: this.lastCounts,
      memoryMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576)
        : undefined,
    };
  }
}
