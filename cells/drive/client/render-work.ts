/** Work proportional to what reaches the renderer, without changing its choices. */

/** Square rings in the original x-major order. Visit the perimeter directly:
 * scanning the interior of every ring costs cubic work at the range dial's
 * upper stops, although the output contains only a square's worth of cells.
 *
 * `from` skips the rings a caller has already walked, so a wider pass over the
 * same centre covers only its own ANNULUS. Without it a second pass re-walks
 * the first one's square — which is not free once the two differ by a factor
 * of two, and is the reason the tree manifest is a separate walk rather than a
 * wider `reach` on the existing one. */
export function squareRings(cx: number, cz: number, reach: number, from = 0): Array<[number, number]> {
  const out: Array<[number, number]> = from <= 0 ? [[cx, cz]] : [];
  for (let d = Math.max(1, Math.floor(from)); d <= reach; d++) {
    for (let x = cx - d; x <= cx + d; x++) {
      if (x === cx - d || x === cx + d) {
        for (let z = cz - d; z <= cz + d; z++) out.push([x, z]);
      } else {
        out.push([x, cz - d], [x, cz + d]);
      }
    }
  }
  return out;
}

/** Exactly stable sort-by-distance then slice, with O(n log k) selection when
 * only a small prefix is wanted. Input order breaks ties, including at the
 * admission edge: an equidistant tree or pin must not change identity merely
 * because the selection algorithm changed. The caller owns the input array. */
export function nearestStable<T>(list: T[], count: number, distance: (v: T) => number): T[] {
  const k = Math.max(0, Math.floor(count));
  if (!k) return [];
  if (k * 4 >= list.length) return list.sort((a, b) => distance(a) - distance(b)).slice(0, k);
  const heap: number[] = [];
  const worse = (a: number, b: number): boolean => {
    const da = distance(list[a]), db = distance(list[b]);
    return da > db || (da === db && a > b);
  };
  for (let i = 0; i < list.length; i++) {
    if (heap.length < k) {
      let at = heap.length;
      heap.push(i);
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (!worse(heap[at], heap[parent])) break;
        [heap[at], heap[parent]] = [heap[parent], heap[at]];
        at = parent;
      }
    } else if (worse(heap[0], i)) {
      heap[0] = i;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        if (left >= k) break;
        const right = left + 1;
        const child = right < k && worse(heap[right], heap[left]) ? right : left;
        if (!worse(heap[child], heap[at])) break;
        [heap[at], heap[child]] = [heap[child], heap[at]];
        at = child;
      }
    }
  }
  heap.sort((a, b) => distance(list[a]) - distance(list[b]) || a - b);
  return heap.map(i => list[i]);
}

/**
 * ── A CANDIDATE LIST IS CUT TO A PREFIX BEFORE IT IS SELECTED FROM ──
 *
 * `nearestStable` is O(n log k) while k is small against n, and falls back to
 * a FULL SORT of the list once k·4 >= n. The mid rung made that the common
 * case for the tree admission: its caps are about five times the full rung's,
 * so a family whose selection used to be a small heap over a big list is now
 * a sort of most of it — 65 ms a call on a device where 8 was the reading
 * the day before, in one unyielding block. This is the histogram prefix the
 * doctrine sketched for it. Two O(n) passes: bin the distances linearly into
 * `bins` buckets, prefix-sum to the bucket where the cumulative count first
 * reaches k, and keep every element in that bucket or a nearer one, IN INPUT
 * ORDER. The selection then runs over the residue — about k plus one bucket.
 *
 * EXACT, NOT APPROXIMATE, and the argument is short: bins are monotone in the
 * distance, so every element in a nearer bucket than the k-th nearest's is
 * strictly nearer than it, and there are fewer than k of those (or the prefix
 * sum would have stopped earlier) — hence the cut bucket is at or past the
 * k-th nearest's, the first k of the stable order are all kept, and their
 * relative order is untouched. Ties share a bucket by construction, so the
 * tie rule `nearestStable` promises (input order, and `perf-check` holds it)
 * cannot be broken at the edge. The keep test uses the SAME bin arithmetic as
 * the count, never the bucket's edge in floats, so what was counted into the
 * cut bucket is what is kept.
 *
 * Returns the list itself when there is nothing to cut — k covers the list,
 * every distance is equal, or the k-th nearest sits in the last bucket. The
 * caller passes the result to `nearestStable`; this function never sorts and
 * never mutates.
 */
export function nearestPrefix<T>(list: T[], count: number, distance: (v: T) => number, bins = 512): T[] {
  const k = Math.max(0, Math.floor(count));
  const n = list.length;
  if (!k) return [];
  if (k >= n) return list;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const d = distance(list[i]); if (d < lo) lo = d; if (d > hi) hi = d; }
  if (!(hi > lo)) return list;
  const scale = bins / (hi - lo);
  const counts = new Int32Array(bins);
  for (let i = 0; i < n; i++) {
    let b = ((distance(list[i]) - lo) * scale) | 0;
    if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  let cut = 0;
  for (let seen = 0; cut < bins; cut++) { seen += counts[cut]; if (seen >= k) break; }
  if (cut >= bins - 1) return list;
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    let b = ((distance(list[i]) - lo) * scale) | 0;
    if (b >= bins) b = bins - 1;
    if (b <= cut) out.push(list[i]);
  }
  return out;
}

interface UploadAttribute {
  itemSize: number;
  needsUpdate: boolean;
  clearUpdateRanges(): void;
  addUpdateRange(start: number, count: number): void;
}
/** Refill passes rewrite the complete live prefix. The allocation's spare
 * capacity is not drawn and need not cross to the GPU. Clearing a prior range
 * is safe even if several refills preceded a render: the latest prefix fully
 * replaces the earlier one. Empty meshes need no transfer; becoming nonempty
 * later always writes and marks the new prefix. Initial buffer creation still
 * uploads the allocation as required by three. */
export function uploadPrefix(attribute: UploadAttribute | null, instances: number): number {
  if (!attribute || instances <= 0) return 0;
  const count = instances * attribute.itemSize;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count);
  attribute.needsUpdate = true;
  return count * 4;
}
