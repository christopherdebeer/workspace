/**
 * source-diff.ts — line diffs for cell source (pure; no S3).
 *
 * Myers' O(ND) algorithm over lines, after trimming the common prefix and
 * suffix — so a one-line edit to a 60,000-line main.ts costs a few
 * comparisons, not a 60k × 60k table. A diff whose edit distance exceeds
 * `maxD` gives up (returns null) rather than burning the Lambda: the caller
 * reports the file as changed without hunks.
 */

export type Edit = { op: '=' ; a: number; b: number } | { op: '-'; a: number } | { op: '+'; b: number };

/** Split text into lines for diffing (a trailing newline does not add a line). */
export function toLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split('\n');
  if (text.endsWith('\n')) lines.pop();
  return lines;
}

/** The edit script turning `a` into `b`, or null if it needs more than `maxD` edits. */
export function diffLines(a: string[], b: string[], maxD = 4000): Edit[] | null {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const middle = myers(A, B, maxD);
  if (middle === null) return null;
  const out: Edit[] = [];
  for (let i = 0; i < pre; i++) out.push({ op: '=', a: i, b: i });
  for (const e of middle) {
    if (e.op === '=') out.push({ op: '=', a: e.a + pre, b: e.b + pre });
    else if (e.op === '-') out.push({ op: '-', a: e.a + pre });
    else out.push({ op: '+', b: e.b + pre });
  }
  for (let i = 0; i < suf; i++) out.push({ op: '=', a: a.length - suf + i, b: b.length - suf + i });
  return out;
}

function myers(A: string[], B: string[], maxD: number): Edit[] | null {
  const n = A.length;
  const m = B.length;
  if (n === 0) return B.map((_, j) => ({ op: '+' as const, b: j }));
  if (m === 0) return A.map((_, i) => ({ op: '-' as const, a: i }));
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  // trace[d] = v over k ∈ [-(d+1), d+1] after step d; index k + d + 1.
  const trace: Int32Array[] = [];
  for (let d = 0; d <= Math.min(max, maxD); d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice(offset - d - 1, offset + d + 2));
        return backtrack(trace, n, m);
      }
    }
    trace.push(v.slice(offset - d - 1, offset + d + 2));
  }
  return null;
}

function backtrack(trace: Int32Array[], n: number, m: number): Edit[] {
  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const prev = trace[d - 1];
    const at = (k: number): number => prev[k + d];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { edits.push({ op: '=', a: x - 1, b: y - 1 }); x--; y--; }
    if (x === prevX) edits.push({ op: '+', b: y - 1 });
    else edits.push({ op: '-', a: x - 1 });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) { edits.push({ op: '=', a: x - 1, b: y - 1 }); x--; y--; }
  return edits.reverse();
}

export interface LineStats { added: number; removed: number }

export function statsOf(edits: Edit[]): LineStats {
  let added = 0;
  let removed = 0;
  for (const e of edits) {
    if (e.op === '+') added++;
    else if (e.op === '-') removed++;
  }
  return { added, removed };
}

/** Unified-diff hunks (`@@ -a,n +b,m @@` + ` `/`-`/`+` lines) with `context` lines around each change. */
export function unifiedHunks(a: string[], b: string[], edits: Edit[], context = 3): string {
  const changes: number[] = [];
  edits.forEach((e, i) => { if (e.op !== '=') changes.push(i); });
  if (changes.length === 0) return '';
  const groups: Array<[number, number]> = [];
  let start = Math.max(0, changes[0] - context);
  let end = Math.min(edits.length - 1, changes[0] + context);
  for (const c of changes.slice(1)) {
    if (c - context <= end + 1) end = Math.min(edits.length - 1, c + context);
    else {
      groups.push([start, end]);
      start = Math.max(0, c - context);
      end = Math.min(edits.length - 1, c + context);
    }
  }
  groups.push([start, end]);

  const out: string[] = [];
  for (const [s, e] of groups) {
    // Hunk header positions: the first a/b line at or after the hunk start.
    let aStart = 0;
    let bStart = 0;
    for (let i = s; i < edits.length; i++) {
      const ed = edits[i];
      if (ed.op !== '+') { aStart = ed.a; break; }
    }
    for (let i = s; i < edits.length; i++) {
      const ed = edits[i];
      if (ed.op !== '-') { bStart = ed.b; break; }
    }
    let aLen = 0;
    let bLen = 0;
    const body: string[] = [];
    for (let i = s; i <= e; i++) {
      const ed = edits[i];
      if (ed.op === '=') { body.push(` ${a[ed.a]}`); aLen++; bLen++; }
      else if (ed.op === '-') { body.push(`-${a[ed.a]}`); aLen++; }
      else { body.push(`+${b[ed.b]}`); bLen++; }
    }
    // Unified-diff convention: an empty side starts at the line before (0 at top).
    const aNum = aLen === 0 ? aStart : aStart + 1;
    const bNum = bLen === 0 ? bStart : bStart + 1;
    out.push(`@@ -${aNum},${aLen} +${bNum},${bLen} @@`, ...body);
  }
  return out.join('\n');
}

/** Diff two texts into stats + unified hunks; `hunks` is null when the edit distance is too large. */
export function diffText(before: string, after: string, context = 3): { stats: LineStats; hunks: string | null } {
  const a = toLines(before);
  const b = toLines(after);
  const edits = diffLines(a, b);
  if (edits === null) return { stats: { added: b.length, removed: a.length }, hunks: null };
  return { stats: statsOf(edits), hunks: unifiedHunks(a, b, edits, context) };
}
