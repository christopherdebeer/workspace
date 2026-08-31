import { createDials } from './lab-dials';
import {
  BENCH_OFFS, WEIGHTS, benchFlat, chosenOffsets, latCands, solveChain,
} from './roadprofile';

/**
 * ── THE ROADS LAB: A SECTION THROUGH THE DECISION ──
 *
 * Every complaint about roads in this game has been about the same thing seen
 * from different angles: the deck sits too high, the batter is a cliff, the
 * junction hangs in the air. All of them come out of ONE solver — the bench
 * search that picks, for each station, which lateral offset to sit on and how
 * high, under a maximum grade. In the world you only ever see its output, from
 * a truck, after four tiles have streamed.
 *
 * Here it is a section: the ground under the corridor, the candidates the
 * search could have taken, the profile it chose, and the CUT AND FILL between
 * them — which is exactly the batter, drawn as the thing it is rather than
 * inferred from a hillside. Every weight in the cost function is a dial, and
 * COPY writes the ProfileWeights literal.
 *
 * Drives roadprofile.ts — the module the game solves with.
 */

const el = (id: string): HTMLElement => document.getElementById(id)!;

export async function startRoadsLab(): Promise<void> {
  document.title = 'DRIVE · ROADS LAB';
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0b0f11; color: #d6e2e4; overflow: hidden;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    #wrap { position: fixed; inset: 0 0 96px 0; display: grid; place-items: center; }
    canvas { border: 1px solid #24343a; max-width: 94vw; }
    #status { position: fixed; left: var(--dials-w, 272px); bottom: 0;
      padding: 8px 12px; white-space: pre;
      background: rgba(8,14,16,.9); border-top: 1px solid #24343a; letter-spacing: 1px; }
    a.back { position: fixed; right: 8px; bottom: 8px; color: #6f8285; text-decoration: none;
      letter-spacing: 2px; }`;
  document.head.appendChild(style);
  const wrap = document.createElement('div');
  wrap.id = 'wrap';
  const cv = document.createElement('canvas');
  cv.width = 1100; cv.height = 560;
  wrap.appendChild(cv);
  document.body.appendChild(wrap);
  const status = document.createElement('div');
  status.id = 'status';
  document.body.appendChild(status);
  const back = document.createElement('a');
  back.className = 'back'; back.href = '/lab'; back.textContent = 'ALL LABS';
  document.body.appendChild(back);

  const dials = createDials({
    slug: 'roads',
    spec: [
      { id: 'sGround', label: 'THE GROUND', kind: 'section' },
      { id: 'grade', label: 'MAX GRADE', kind: 'range', min: 0.02, max: 0.3, step: 0.005, value: 0.15 },
      { id: 'relief', label: 'RELIEF m', kind: 'range', min: 0, max: 300, step: 5, value: 90 },
      { id: 'rough', label: 'ROUGHNESS', kind: 'range', min: 0, max: 30, step: 0.5, value: 7 },
      { id: 'across', label: 'CROSS-SLOPE', kind: 'range', min: 0, max: 1.2, step: 0.02, value: 0.35 },
      { id: 'len', label: 'LENGTH m', kind: 'range', min: 200, max: 3000, step: 50, value: 1200 },
      { id: 'seed', label: 'SEED', kind: 'range', min: 0, max: 99, step: 1, value: 3 },
      { id: 'sCost', label: 'COST WEIGHTS', kind: 'section' },
      { id: 'wOff', label: 'W OFF', kind: 'range', min: 0, max: 4, step: 0.05, value: WEIGHTS.off },
      { id: 'wFlat', label: 'W FLAT', kind: 'range', min: 0, max: 4, step: 0.05, value: WEIGHTS.flat },
      { id: 'wGrade', label: 'W GRADE', kind: 'range', min: 0, max: 120, step: 1, value: WEIGHTS.grade },
      { id: 'wPin', label: 'W PIN', kind: 'range', min: 0, max: 400, step: 5, value: WEIGHTS.pin },
      { id: 'wLat', label: 'W LAT', kind: 'range', min: 0, max: 4, step: 0.02, value: WEIGHTS.lat },
      { id: 'wLatC', label: 'W LAT CURVE', kind: 'range', min: 0, max: 8, step: 0.05, value: WEIGHTS.latCurve },
      { id: 'wCurve', label: 'W CURVE', kind: 'range', min: 0, max: 60, step: 0.5, value: WEIGHTS.curve },
      { id: 'sDraw', label: 'DRAWING', kind: 'section' },
      { id: 'pins', label: 'END PINS', kind: 'toggle', value: false },
      { id: 'cands', label: 'SHOW CANDIDATES', kind: 'toggle', value: true },
    ],
    source: (v) => [
      '// tuned in /lab/roads',
      'export const WEIGHTS: ProfileWeights = {',
      `  off: ${v.wOff}, flat: ${v.wFlat}, grade: ${v.wGrade}, pin: ${v.wPin},`,
      `  lat: ${v.wLat}, latCurve: ${v.wLatC}, curve: ${v.wCurve},`,
      '};',
    ].join('\n'),
  });

  /** A hillside with a cross-slope, so the bench search has a reason to move
   *  sideways: a corridor over a symmetric ridge never exercises the choice. */
  const ground = (x: number, z: number): number => {
    const s = dials.num('seed') * 13.7;
    const relief = dials.num('relief');
    const rough = dials.num('rough');
    return Math.sin((x + s) / 260) * relief * 0.5
      + Math.cos((x - s) / 90) * relief * 0.18
      + z * dials.num('across')
      + Math.sin((x * 1.7 + z * 2.3 + s) / 23) * rough * 0.5;
  };

  const ctx = cv.getContext('2d')!;
  const draw = (): void => {
    const L = dials.num('len');
    // Stations every 12m — the spacing the road builder densifies to.
    const dense: Array<[number, number]> = [];
    for (let m = 0; m <= L; m += 12) dense.push([m, 0]);
    const cand = dense.map((_: [number, number], i: number) => latCands(dense, i, ground));
    const W = {
      off: dials.num('wOff'), flat: dials.num('wFlat'), grade: dials.num('wGrade'),
      pin: dials.num('wPin'), lat: dials.num('wLat'),
      latCurve: dials.num('wLatC'), curve: dials.num('wCurve'),
    };
    const centre = dense.map(([x, z]) => ground(x, z));
    const p0 = dials.bool('pins') ? centre[0] : null;
    const p1 = dials.bool('pins') ? centre[centre.length - 1] : null;
    const alg = solveChain(dense, cand, dials.num('grade'), p0, p1, undefined, W);
    const offs = chosenOffsets(cand, alg);

    // ── THE FRAME ──
    const lo = Math.min(...centre, ...alg) - 12, hi = Math.max(...centre, ...alg) + 12;
    const px = (i: number): number => 40 + (i / (dense.length - 1)) * (cv.width - 70);
    const py = (v: number): number => cv.height - 40 - ((v - lo) / Math.max(1, hi - lo)) * (cv.height - 80);
    ctx.fillStyle = '#0b0f11';
    ctx.fillRect(0, 0, cv.width, cv.height);

    // Every candidate the search could have sat on — the shape of the choice.
    if (dials.bool('cands')) {
      ctx.strokeStyle = 'rgba(90,120,130,.22)';
      ctx.lineWidth = 1;
      for (let k = 0; k < BENCH_OFFS.length; k++) {
        ctx.beginPath();
        for (let i = 0; i < dense.length; i++) {
          const y = py(cand[i][k]);
          if (i === 0) ctx.moveTo(px(i), y); else ctx.lineTo(px(i), y);
        }
        ctx.stroke();
      }
    }
    // CUT AND FILL — the batter, as the vertical difference it actually is.
    let cut = 0, fill = 0, worst = 0;
    for (let i = 0; i < dense.length; i++) {
      const g = centre[i], d = alg[i];
      const h = py(g) - py(d);
      ctx.fillStyle = d > g ? 'rgba(216,150,80,.5)' : 'rgba(90,170,200,.45)';
      ctx.fillRect(px(i) - 1, py(d), 2, h);
      if (d > g) fill += d - g; else cut += g - d;
      worst = Math.max(worst, Math.abs(d - g));
    }
    // The ground under the centreline, then the deck the solver chose.
    const line = (vals: number[], colour: string, width: number): void => {
      ctx.strokeStyle = colour; ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < vals.length; i++) {
        const y = py(vals[i]);
        if (i === 0) ctx.moveTo(px(i), y); else ctx.lineTo(px(i), y);
      }
      ctx.stroke();
    };
    line(centre, '#6f8285', 1.5);
    line(alg, '#7fd0c4', 2.5);

    let steepest = 0;
    for (let i = 1; i < alg.length; i++) {
      const run = Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]) || 1;
      steepest = Math.max(steepest, Math.abs(alg[i] - alg[i - 1]) / run);
    }
    const spread = offs.reduce((a, b) => a + Math.abs(b), 0) / offs.length;
    status.textContent =
      `${dense.length} STATIONS · ${(L / 1000).toFixed(2)}km · BENCH ${BENCH_OFFS.length} OFFSETS\n`
      + `steepest ${(steepest * 100).toFixed(1)}% against a ${(dials.num('grade') * 100).toFixed(0)}% cap\n`
      + `CUT ${(cut / dense.length).toFixed(2)}m mean · FILL ${(fill / dense.length).toFixed(2)}m mean`
      + ` · worst batter ${worst.toFixed(1)}m · mean lateral ${spread.toFixed(1)}m`
      + ` · flattest-in-section ${benchFlat(cand[Math.floor(cand.length / 2)]).toFixed(1)}m`;
  };
  dials.onChange(draw);
  draw();
  void el;
}
