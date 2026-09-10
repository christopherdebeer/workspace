/**
 * HOW FAR THE SEA IS — the one climate input that cannot be computed.
 *
 * Continentality is the difference between Reykjavik and Irkutsk: twelve
 * degrees of latitude apart, thirty degrees of annual range apart, and the
 * site model gets both wrong without it. It has to be answered at four hundred
 * kilometres, which is the one scale nothing the game streams can reach — the
 * fine ring stops at five and the chart's overview at forty-seven.
 *
 * So it is baked (devtools/bake-coast.mjs) and BUNDLED rather than fetched.
 * The cost is 55KB gzipped on a 618KB bundle; what it buys is an answer at
 * module load. A fetched asset would leave every climate verdict unevidenced
 * for the first seconds of a session and then CHANGE it once the file landed,
 * which is the failure this codebase has recorded from the seat more than once
 * — a thing that alters while you watch reads worse than either state.
 */
import { COAST_B64, COAST_W, COAST_H, COAST_STEP, COAST_MAX_KM } from './coast-baked';

let grid: Uint8Array | null = null;
function load(): Uint8Array {
  if (grid) return grid;
  const bin = atob(COAST_B64);
  const g = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) g[i] = bin.charCodeAt(i);
  grid = g;
  return g;
}

/**
 * Kilometres from this lat/lon to salt water, 0 at sea and on the shore.
 *
 * COARSE ON PURPOSE, and the caller has to know it: a half-degree cell is 55km
 * across, so Cape Town reads 0 and Singapore 57. That is exactly right for a
 * 400km e-folding and useless for anything local — see the note on `salt` in
 * climate.ts, which is why that term takes a different input entirely.
 */
export function coastKm(lat: number, lon: number): number {
  const g = load();
  const i = Math.min(COAST_W - 1, Math.max(0, Math.floor(((lon + 180) % 360) / COAST_STEP)));
  const j = Math.min(COAST_H - 1, Math.max(0, Math.floor((90 - lat) / COAST_STEP)));
  // Stored square-rooted, so the resolution is half a kilometre at the coast
  // and twelve in the far interior — fine where the number is small, which is
  // where it matters.
  const v = g[j * COAST_W + i] / 255;
  return v * v * COAST_MAX_KM;
}

/** Is this point on land at all, by the same 110m coastline? */
export const onLand = (lat: number, lon: number): boolean => coastKm(lat, lon) > 0;
