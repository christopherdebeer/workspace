/**
 * The deer, without drawing them: one herd 40 m ahead, you walking towards it for some seconds,
 * then standing still; the herd's mode, alarm, distance and what was heard, as the game clock runs.
 *
 *   node cells/lab/devtools/deer-sim.mjs [walk seconds = 12] [seed = moss-ford-7] [hour = 18]
 */
import { Wood } from '../client/mistwood/world';
import { Deerland } from '../client/mistwood/deer';
import { seedFrom } from '../client/mistwood/rng';

const [walkFor = '12', seedArg = 'moss-ford-7', hourArg = '18'] = process.argv.slice(2);
const wood = new Wood(seedFrom(seedArg)!);
const land = new Deerland({ seed: wood.seed, place: (x, z) => wood.place(x, z), pathDist: (x, z) => wood.pathDist(x, z) });
const eye = { x: 0, z: 14, yaw: 0, speed: 0, vis: 45, hour: Number(hourArg) };
land.bring(0, 54, false, eye.hour);
const heard: string[] = [];
const ear = { rustle: () => heard.push('rustle'), snap: () => heard.push('snap'), stamp: () => heard.push('STAMP'), bark: () => heard.push('BARK') };
let last = '';
for (let t = 0; t < 240; t += 0.05) {
  eye.speed = t < Number(walkFor) ? 1.1 : 0;
  eye.z += eye.speed * 0.05;
  land.step(0.05, t, eye, ear);
  const h = land.herds.get('debug')!;
  const d = Math.hypot(h.deer[0].x - eye.x, h.deer[0].z - eye.z);
  if (h.mode !== last || Math.round(t * 20) % 200 === 0) {
    const counts = heard.splice(0).reduce((m: Record<string, number>, s) => ((m[s] = (m[s] || 0) + 1), m), {});
    console.log(t.toFixed(1).padStart(6), h.mode.padEnd(7), 'alarm', h.alarm.toFixed(2), 'dist', d.toFixed(0).padStart(3), JSON.stringify(counts));
    last = h.mode;
  }
}
