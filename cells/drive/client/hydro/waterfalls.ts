/** Connected drops on the fitted downstream profile; never inferred from banks. */
export interface RiverDrop {
  lipS: number; toeS: number; lipY: number; toeY: number;
  strength: number; landing: boolean;
}
export function riverDrops(profile: Float32Array, along: Float32Array): RiverDrop[] {
  const n = along.length, grade = new Float32Array(Math.max(0, n - 1));
  for (let i = 0; i + 1 < n; i++) {
    const run = along[i + 1] - along[i];
    grade[i] = run > 0.01 ? Math.max(0, profile[i * 3 + 2] - profile[i * 3 + 5]) / run : 0;
  }
  const out: RiverDrop[] = [];
  for (let i = 0; i < grade.length;) {
    if (grade[i] < 0.4) { i++; continue; }
    const start = i;
    let peak = 0;
    while (i < grade.length && grade[i] >= 0.4) { peak = Math.max(peak, grade[i]); i++; }
    const drop = profile[start * 3 + 2] - profile[i * 3 + 2];
    if (peak < 0.75 || drop < 4) continue;
    out.push({lipS: along[start], toeS: along[i], lipY: profile[start * 3 + 2],
      toeY: profile[i * 3 + 2], strength: Math.min(1, (peak - 0.4) / 0.8),
      landing: i < n - 1});
  }
  return out;
}
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / Math.max(0.001, b - a)));
  return t * t * (3 - 2 * t);
};
/** RGBA: sheet strength, fallen fraction, landing/tail strength, total drop m. */
export function sampleRiverDrop(drops: readonly RiverDrop[], s: number, level: number): [number, number, number, number] {
  let result: [number, number, number, number] = [0, 0, 0, 0], best = 0;
  for (const d of drops) {
    const height = d.lipY - d.toeY;
    const feather = Math.min(10, Math.max(2, (d.toeS - d.lipS) * 0.12));
    const face = smooth(d.lipS - feather, d.lipS + feather, s)
      * (1 - smooth(d.toeS - feather, d.toeS + feather, s)) * d.strength;
    const tailM = Math.min(100, Math.max(18, height * 0.7));
    const downstream = Math.max(0, s - d.toeS);
    const impact = d.landing ? smooth(d.toeS - feather * 2, d.toeS, s)
      * Math.exp(-downstream / (tailM * 0.35))
      * (1 - smooth(tailM * 0.7, tailM, downstream)) * d.strength : 0;
    if (face + impact > best) {
      best = face + impact;
      result = [face, Math.max(0, Math.min(1, (d.lipY - level) / height)), impact, height];
    }
  }
  return result;
}
