// Stub for https://parc.land/@c15r/kernel/app.js — benign no-op substrate.
export const mcp = async () => ({});
export const read = () => new Promise(() => {
  // Never settles: a resolved-empty read would wipe the hydrated board on the
  // background refresh, a rejected one falls back to empty state — pending
  // keeps the hydrate payload live, which is what the harness wants.
});
export const act = async () => ({});
export const ensureAuth = async () => true;
export const isAuthed = () => true;
export const accessToken = () => 'stub-token';
export const authFetch = (...args) => fetch(...args);
export const login = async () => {};
export const signOut = () => {};
export const requestScopes = async () => true;
export const loadTypes = async () => ({});
export const titleOf = (entry) => (entry && entry.key) || 'fact';
export const hrefOf = () => '#';

/* ADR-0053 outbox — REAL semantics (mirrors kernel main.ts) so harness runs
   exercise the same dedupe/priming/echo behavior the live client has. */
export function stableStringify(v) {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : val);
}

export function createOutbox(actFn, opts = {}) {
  const via = opts.via ?? 'kernel-outbox';
  const FLUSH_MS = opts.flushDelayMs ?? 400;
  const ECHO_MS = opts.echoWindowMs ?? 45000;
  const seeded = new Map();
  const pending = new Map();
  const flushedAt = new Map();
  const primingBuffer = new Map();
  let priming = false, flushing = false, failures = 0, timer;
  const schedule = (ms) => { if (!timer) timer = setTimeout(() => { timer = undefined; void flushNow(); }, ms); };
  function stage(key, value, extra) {
    if (priming) { primingBuffer.set(key, { value, ...extra }); return; }
    if (seeded.get(key) === stableStringify(value) && !(extra && extra.tags)) return;
    pending.set(key, { value, ...extra });
    schedule(FLUSH_MS);
  }
  async function flushNow() {
    if (flushing) { schedule(FLUSH_MS); return; }
    if (!pending.size) return;
    flushing = true;
    if (opts.onState) opts.onState('saving');
    let failed = false;
    try {
      const batch = [...pending];
      pending.clear();
      const results = await Promise.allSettled(batch.map(async ([key, p]) => {
        await actFn('workspace.remember', { key, value: p.value, via, ...(p.type ? { type: p.type } : {}), ...(p.tags ? { tags: p.tags } : {}) });
        seeded.set(key, stableStringify(p.value));
        flushedAt.set(key, Date.now());
      }));
      results.forEach((r, i) => {
        if (r.status === 'rejected' && !pending.has(batch[i][0])) { failed = true; pending.set(batch[i][0], batch[i][1]); }
      });
    } finally {
      flushing = false;
      if (opts.onState) opts.onState(failed ? 'failed' : 'saved');
      if (failed) { failures++; schedule(Math.min(30000, 2000 * 2 ** Math.min(failures - 1, 4))); }
      else failures = 0;
    }
  }
  return {
    stage, flushNow,
    seed: (k, v) => { seeded.set(k, stableStringify(v)); },
    seededJson: (k) => seeded.get(k),
    wroteRecently: (k, ms = ECHO_MS) => Date.now() - (flushedAt.get(k) ?? 0) < ms,
    forget: (k) => { seeded.delete(k); },
    keys: () => seeded.keys(),
    beginPriming: () => { priming = true; },
    endPriming: () => { priming = false; const b = [...primingBuffer]; primingBuffer.clear(); for (const [k, p] of b) stage(k, p.value, p); },
    priming: () => priming,
    reset: () => { seeded.clear(); flushedAt.clear(); primingBuffer.clear(); priming = false; },
  };
}

/* ADR-0053 Inc 2 projection — REAL semantics (mirrors kernel main.ts). The
   stub `read` never settles, so a started loop's first pump simply hangs
   pending — same shape the old inline tick loop had under the stub. */
export function createProjection(readFn, outbox, opts) {
  const subscribers = new Set();
  let cursor = 0, timer, running = false, pumping = false;
  const notify = () => { for (const cb of subscribers) { try { cb(); } catch { /* */ } } };
  async function pump() {
    if (pumping) return;
    const scope = opts.scope();
    if (!scope) return;
    pumping = true;
    try {
      if (cursor === 0) { cursor = (await readFn('workspace.changes', { sinceSeq: 'head' })).seq; return; }
      const res = await readFn('workspace.changes', { sinceSeq: cursor, scope });
      cursor = res.seq;
      const events = (res.events ?? []).filter((ev) => {
        if (ev.op === 'link' || ev.op === 'unlink') return true;
        if (ev.op !== 'write' && ev.op !== 'supersede') return false;
        if (!ev.key) return false;
        return !outbox.wroteRecently(ev.key);
      });
      if (events.length && (await opts.apply(events))) notify();
    } finally {
      pumping = false;
    }
  }
  const stop = () => { running = false; if (timer) { clearTimeout(timer); timer = undefined; } };
  const loop = () => {
    timer = setTimeout(async () => {
      try { if (typeof document === 'undefined' || !document.hidden) await pump(); } catch { /* retry next tick */ }
      if (running) loop();
    }, opts.intervalMs ? opts.intervalMs() : 6000);
  };
  return {
    seedInitial: (entries) => { for (const e of entries) outbox.seed(e.key, e.value); notify(); },
    subscribe: (cb) => { subscribers.add(cb); return () => { subscribers.delete(cb); }; },
    pump,
    start: () => { if (!running) { running = true; loop(); } },
    stop,
    dispose: () => { stop(); subscribers.clear(); },
  };
}
