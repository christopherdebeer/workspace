/**
 * ── AUTHORED TAPES: THE ATTRACT REEL ──
 *
 * Input tapes (see the recorder in main.ts) banked into the bundle: each is a
 * real drive, re-simulated live on the player's device under the splash — the
 * trailer is rendered by the game, at the player's own hour and weather.
 *
 * A reel entry carries where to boot (lat/lon/h — an attract cycle travels the
 * way DRIVES travels, by reload, because the world origin is set at boot) and
 * the tape itself, typed-array halves as base64.
 *
 * AUTHORING: drive it, KEEP it (SETTINGS → recorder), then `__tapeexport()`
 * in the console prints this exact shape. Paste it here.
 */
export interface AttractTape {
  id: string;
  name: string;
  lat: number; lon: number; h: number;
  head: {
    v: number; build: string; at: number; lat: number; lon: number;
    hdg: number; t: string; wx: string; steps: number; secs: number;
  };
  /** Uint8Array of 4-byte steps (dt, steer, throttle, brake), base64. */
  steps: string;
  /** Float32Array of 10-float checkpoints, base64. */
  keys: string;
}
export const ATTRACT_TAPES: AttractTape[] = [];
