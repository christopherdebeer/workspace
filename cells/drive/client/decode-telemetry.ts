/** Async bitmap latency is elapsed time, NOT main-thread CPU time. Keep it
 * outside the additive frame ledger: concurrent requests overlap. */
export const bitmapStats = { pending: 0, peak: 0, completed: 0, failed: 0, closed: 0, settled: 0,
  latencyMs: 0, maxLatencyMs: 0 };
export async function withDecodedBitmap<T>(blob: Blob, options: ImageBitmapOptions,
  consume: (bitmap: ImageBitmap) => T): Promise<T> {
  const start = performance.now();
  bitmapStats.pending++;
  bitmapStats.peak = Math.max(bitmapStats.peak, bitmapStats.pending);
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(blob, options);
    bitmapStats.completed++;
    return consume(bitmap);
  } catch (error) {
    bitmapStats.failed++;
    throw error;
  } finally {
    bitmapStats.pending--;
    bitmapStats.settled++;
    const elapsed = performance.now() - start;
    bitmapStats.latencyMs += elapsed;
    bitmapStats.maxLatencyMs = Math.max(bitmapStats.maxLatencyMs, elapsed);
    if (bitmap) { bitmap.close(); bitmapStats.closed++; }
  }
}
