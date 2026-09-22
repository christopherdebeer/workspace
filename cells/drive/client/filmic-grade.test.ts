import { FILMIC_DAWN, FILMIC_DEPTH, FILMIC_MIDDAY, acesFitted, filmicDawnWeight } from './filmic-grade';

const fail = (message: string): never => { throw new Error(message); };
const near = (a: number, b: number, e = 1e-6): boolean => Math.abs(a - b) <= e;

export function runFilmicGradeSelfTest(): void {
  if (JSON.stringify(FILMIC_DAWN.lift) !== JSON.stringify([0.98, 0.99, 1.04])) fail('dawn lift drifted');
  if (JSON.stringify(FILMIC_DAWN.gamma) !== JSON.stringify([1.02, 0.98, 0.96])) fail('dawn gamma drifted');
  if (JSON.stringify(FILMIC_DAWN.gain) !== JSON.stringify([1.08, 0.95, 0.92])) fail('dawn gain drifted');
  if (!near(FILMIC_DAWN.saturation, 1.15) || !near(FILMIC_MIDDAY.saturation, 1.08)) fail('saturation targets drifted');
  if (JSON.stringify(FILMIC_DEPTH.tint) !== JSON.stringify([0.85, 0.92, 1.05])
    || !near(FILMIC_DEPTH.saturation, 0.85)) fail('depth decision drifted');

  if (!near(filmicDawnWeight(1, 0), 0)) fail('open daylight must select midday');
  if (!near(filmicDawnWeight(2 / 3, 1), 1)) fail('the horizon must select dawn despite civil-daylight ramp');
  if (!near(filmicDawnWeight(0, 0), 1)) fail('night must retain the cool-toe/controlled-highlight decision');
  if (!near(filmicDawnWeight(0.75, 0.2), 0.25)) fail('interpolation must follow the stronger low-light signal');

  const black = acesFitted([0, 0, 0]);
  if (black.some((v) => v !== 0)) fail(`black moved before the authored toe: ${black}`);
  const grey = acesFitted([0.18, 0.18, 0.18]);
  if (Math.max(...grey) - Math.min(...grey) > 2e-5) fail(`neutral grey picked up a cast: ${grey}`);
  const samples = [0.02, 0.18, 1, 4].map((v) => acesFitted([v, v, v])[0]);
  for (let i = 1; i < samples.length; i++) if (!(samples[i] > samples[i - 1])) fail(`curve is not monotonic: ${samples}`);
  if (!(samples[3] > 0.9 && samples[3] < 1)) fail(`four-stop highlight should roll below clipping: ${samples[3]}`);
  if (!((samples[3] - samples[2]) < (samples[2] - samples[1]))) fail(`highlight shoulder is not compressing: ${samples}`);
}
