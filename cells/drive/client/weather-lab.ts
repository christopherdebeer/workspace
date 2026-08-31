import { createDials } from './lab-dials';
import {
  WXF_M, WXF_N, WXF_SPAN, buildField, mkField, puddleAt, seedWet, wxAt,
} from './weatherfield';

/**
 * ── THE WEATHER LAB: TWELVE KILOMETRES OF SKY, FLAT ON A TABLE ──
 *
 * The weather field is four channels over a 48×48 lattice — cover, rain, fog
 * and a WET channel that remembers. In the game you meet it one windscreen at
 * a time, at whatever the sky happened to be doing, which makes "does rain
 * actually move" and "does the ground dry at a sensible rate" almost
 * impossible to answer. Here the whole field is a picture and time is a dial.
 *
 * THE WET CHANNEL IS THE ONE WORTH WATCHING. It is the only channel with
 * state: a cell soaks under its own rain and dries slowly afterwards, so a
 * shower leaves a dark patch that outlives it and drifts with nothing. RUN
 * integrates it, so a squall can be watched crossing and draining rather than
 * inferred from a wet road.
 *
 * Drives weatherfield.ts directly — the same module the game builds from.
 */

const CH = ['cover', 'rain', 'fog', 'wet'] as const;
type Channel = typeof CH[number];

/** Cheap ramps that keep the four channels visually distinct. A single grey
 *  ramp for all four made rain and fog impossible to tell apart at a glance. */
const RAMP: Record<Channel, (v: number) => [number, number, number]> = {
  cover: (v) => [40 + v * 150, 46 + v * 150, 52 + v * 150],
  rain: (v) => [20 + v * 40, 60 + v * 90, 90 + v * 150],
  fog: (v) => [60 + v * 150, 70 + v * 150, 70 + v * 140],
  wet: (v) => [30 + v * 60, 40 + v * 80, 55 + v * 130],
};

export async function startWeatherLab(): Promise<void> {
  document.title = 'DRIVE · WEATHER LAB';
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0b0f11; color: #d6e2e4; overflow: hidden;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    #wrap { position: fixed; inset: 0; display: grid; place-items: center; }
    canvas { image-rendering: pixelated; border: 1px solid #24343a; }
    #status { position: fixed; left: var(--dials-w, 272px); bottom: 0;
      padding: 8px 12px; white-space: pre;
      background: rgba(8,14,16,.9); border-top: 1px solid #24343a; letter-spacing: 1px; }
    a.back { position: fixed; right: 8px; bottom: 8px; color: #6f8285; text-decoration: none;
      letter-spacing: 2px; }`;
  document.head.appendChild(style);
  const wrap = document.createElement('div');
  wrap.id = 'wrap';
  const cv = document.createElement('canvas');
  cv.width = cv.height = WXF_N;
  cv.style.width = cv.style.height = 'min(78vw, 78vh)';
  wrap.appendChild(cv);
  document.body.appendChild(wrap);
  const status = document.createElement('div');
  status.id = 'status';
  document.body.appendChild(status);
  const back = document.createElement('a');
  back.className = 'back'; back.href = '/lab'; back.textContent = 'ALL LABS';
  document.body.appendChild(back);

  const dials = createDials({
    slug: 'weather',
    spec: [
      { id: 'sField', label: 'THE FIELD', kind: 'section' },
      { id: 'view', label: 'CHANNEL', kind: 'select', value: 'wet', options: CH },
      { id: 'cover', label: 'COVER', kind: 'range', min: 0, max: 1, step: 0.02, value: 0.55 },
      { id: 'rain', label: 'RAIN', kind: 'range', min: 0, max: 1, step: 0.02, value: 0.45 },
      { id: 'fog', label: 'FOG', kind: 'range', min: 0, max: 1, step: 0.02, value: 0.2 },
      { id: 'sWind', label: 'WIND AND SKY', kind: 'section' },
      { id: 'wind', label: 'WIND m/s', kind: 'range', min: 0, max: 30, step: 0.5, value: 8 },
      { id: 'dir', label: 'WIND °', kind: 'range', min: 0, max: 359, step: 1, value: 45 },
      { id: 'day', label: 'DAYLIGHT', kind: 'range', min: 0, max: 1, step: 0.05, value: 1 },
      { id: 'sTime', label: 'TIME', kind: 'section' },
      { id: 'dt', label: 'STEP s', kind: 'range', min: 0.05, max: 4, step: 0.05, value: 1 },
      { id: 'run', label: 'RUN', kind: 'toggle', value: true },
      { id: 'relief', label: 'HILLS m', kind: 'range', min: 0, max: 900, step: 10, value: 220 },
    ],
    source: (v) => [
      '// tuned in /lab/weather — the targets stepWeather drives toward',
      `const WX_TARGETS = { cover: ${v.cover}, rain: ${v.rain}, fog: ${v.fog},`,
      `  windMps: ${v.wind}, windDeg: ${v.dir}, dayF: ${v.day} };`,
    ].join('\n'),
  });

  const field = mkField(0, 0);
  seedWet(field, 0);
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(WXF_N, WXF_N);

  // A synthetic hillside, so the field's height-dependent terms (fog pools in
  // valleys) have something to pool in.
  const heightAt = (x: number, z: number): number => {
    const k = dials.num('relief');
    return Math.sin(x / 1800) * k * 0.5 + Math.cos(z / 2400) * k * 0.5 + k * 0.5;
  };

  // The field advects its noise off a clock; the STEP dial is how fast that
  // clock runs, so a squall can be watched in a few seconds instead of an hour.
  let clock = 0;
  let last = performance.now();
  const frame = (now: number): void => {
    const wall = Math.min(0.25, (now - last) / 1000);
    last = now;
    const deg = dials.num('dir') * Math.PI / 180;
    if (dials.bool('run')) {
      // Wind is a VECTOR in m/s here, as the field wants it — the speed dial
      // scales the direction rather than riding alongside it.
      const mps = dials.num('wind');
      clock += wall * dials.num('dt');
      buildField(field, {
        t: clock,
        cover: dials.num('cover'), rain: dials.num('rain'), fog: dials.num('fog'),
        windX: Math.cos(deg) * mps, windZ: Math.sin(deg) * mps,
        dt: wall * dials.num('dt'), dayF: dials.num('day'),
      }, heightAt);
    }
    const view = dials.str('view') as Channel;
    const ramp = RAMP[view];
    for (let iz = 0; iz < WXF_N; iz++) {
      for (let ix = 0; ix < WXF_N; ix++) {
        const x = (ix - WXF_N / 2) * WXF_M, z = (iz - WXF_N / 2) * WXF_M;
        const s = wxAt(field, x, z);
        const [r, g, b] = ramp(s[view]);
        const o = (iz * WXF_N + ix) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const here = wxAt(field, 0, 0);
    status.textContent =
      `${WXF_N}² CELLS · ${WXF_M}m EACH · ${(WXF_SPAN / 1000).toFixed(1)}km ACROSS · ${view.toUpperCase()}\n`
      + `at the centre — cover ${here.cover.toFixed(2)} rain ${here.rain.toFixed(2)} `
      + `fog ${here.fog.toFixed(2)} wet ${here.wet.toFixed(2)}\n`
      + `puddle here ${puddleAt(0, 0, here.wet).toFixed(2)} · mean wet ${field.wetMean.toFixed(3)}`
      + `${dials.bool('run') ? '' : ' · PAUSED'}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
