import { createDials } from './lab-dials';
import {
  ALT_BAND_NAMES, BIOME_ORDER, LAPSE, altBandAt, climCompute, krummholz,
  seaTempAt, swardLift, treelineAt,
} from './climate';

/**
 * ── THE FLORA LAB: WHAT WOULD GROW HERE ──
 *
 * The climate field decides everything standing on the ground — which trees,
 * how dense, how high the sward reaches, where the treeline is and what
 * happens above it. In the world you learn all of that by driving somewhere
 * and looking, which means a change to the curve is judged against one
 * hillside at one altitude in one biome.
 *
 * This puts the whole ladder on one screen: the biome mix at a point, and a
 * COLUMN through the altitudes above it showing where each band takes over.
 * Turning the latitude and watching the treeline walk down the column is the
 * fastest check there is that the model is behaving.
 *
 * Drives climate.ts — the module the world grows from. The instancing is
 * still main's, so this answers WHAT and WHERE, not how it is drawn.
 */

const BAND_COLOUR = ['#4a6b3a', '#5b7a44', '#6d7a52', '#8a8f6a', '#8f8f92', '#d8dee2'];

export async function startFloraLab(): Promise<void> {
  document.title = 'DRIVE · FLORA LAB';
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; height: 100%; background: #0b0f11; color: #d6e2e4; overflow: hidden;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    #wrap { position: fixed; inset: 0 0 104px 0; display: grid; place-items: center; }
    canvas { border: 1px solid #24343a; max-width: 94vw; }
    #status { position: fixed; left: 0; bottom: 0; padding: 8px 12px; white-space: pre;
      background: rgba(8,14,16,.9); border-top: 1px solid #24343a; letter-spacing: 1px; }
    a.back { position: fixed; right: 8px; bottom: 8px; color: #6f8285; text-decoration: none;
      letter-spacing: 2px; }`;
  document.head.appendChild(style);
  const wrap = document.createElement('div');
  wrap.id = 'wrap';
  const cv = document.createElement('canvas');
  cv.width = 1000; cv.height = 520;
  wrap.appendChild(cv);
  document.body.appendChild(wrap);
  const status = document.createElement('div');
  status.id = 'status';
  document.body.appendChild(status);
  const back = document.createElement('a');
  back.className = 'back'; back.href = '/lab'; back.textContent = 'ALL LABS';
  document.body.appendChild(back);

  const dials = createDials({
    slug: 'flora',
    spec: [
      { id: 'lat', label: 'LATITUDE', kind: 'range', min: 0, max: 78, step: 0.5, value: 46 },
      { id: 'elev', label: 'ELEV m', kind: 'range', min: -50, max: 4500, step: 25, value: 700 },
      { id: 'moist', label: 'MOISTURE', kind: 'range', min: 0, max: 1, step: 0.02, value: 0.5 },
      { id: 'aspect', label: 'ASPECT m', kind: 'range', min: -300, max: 300, step: 10, value: 0 },
      { id: 'cover', label: 'COVER CLASS', kind: 'select', value: '10',
        options: ['10', '20', '30', '40', '50', '60', '70', '90', '100'] },
      { id: 'top', label: 'COLUMN TOP m', kind: 'range', min: 800, max: 6000, step: 100, value: 4000 },
    ],
    source: (v) => JSON.stringify(v, null, 2),
  });

  const ctx = cv.getContext('2d')!;
  const draw = (): void => {
    const lat = dials.num('lat');
    const elev = dials.num('elev');
    const moist = dials.num('moist');
    const cover = parseInt(dials.str('cover'), 10);
    // The real climate computation, over a stand-in world whose cover and
    // height answer exactly what the dials say — so the sample is the game's,
    // taken at a place the dials describe.
    const env = {
      coverAt: () => cover,
      latAbsAt: () => lat,
      groundAt: () => elev,
    };
    const s = climCompute(env, 0, 0, 1);
    const treeline = treelineAt(lat, moist);

    ctx.fillStyle = '#0b0f11';
    ctx.fillRect(0, 0, cv.width, cv.height);

    // ── THE BIOME MIX, AS BARS ──
    const barX = 40, barW = 300;
    ctx.font = '12px ui-monospace, monospace';
    for (let i = 0; i < BIOME_ORDER.length; i++) {
      const y = 46 + i * 30;
      ctx.fillStyle = '#6f8285';
      ctx.fillText(BIOME_ORDER[i].toUpperCase(), barX, y - 4);
      ctx.fillStyle = '#12202400';
      ctx.strokeStyle = '#24343a';
      ctx.strokeRect(barX + 96, y - 14, barW, 12);
      ctx.fillStyle = i === s.domIdx ? '#7fd0c4' : '#3f6f6a';
      ctx.fillRect(barX + 96, y - 14, barW * s.w[i], 12);
      ctx.fillStyle = '#9fb2b5';
      ctx.fillText(s.w[i].toFixed(3), barX + 96 + barW + 10, y - 3);
    }
    ctx.fillStyle = '#6f8285';
    ctx.fillText('BIOME MIX AT THE POINT', barX, 28);

    // ── THE COLUMN: EVERY ALTITUDE ABOVE THIS SPOT ──
    // The one picture that makes the band model legible — where montane gives
    // way to treeline, krummholz, meadow, scree and snow, and how far the
    // sward still reaches into each.
    const colX = 520, colW = 300, colTop = 40, colH = cv.height - 110;
    const top = dials.num('top');
    ctx.fillStyle = '#6f8285';
    ctx.fillText('THE COLUMN ABOVE IT', colX, 28);
    const yOf = (m: number): number => colTop + colH - (m / top) * colH;
    for (let m = 0; m <= top; m += 20) {
      const eff = m + dials.num('aspect');
      const band = altBandAt(eff, treeline);
      ctx.fillStyle = BAND_COLOUR[band] ?? '#555';
      ctx.fillRect(colX, yOf(m + 20), colW * 0.55, Math.max(1, yOf(m) - yOf(m + 20) + 1));
      // Sward lift and krummholz, as widths — how much ground cover survives.
      const sw = swardLift(eff, treeline);
      const kz = krummholz(eff, treeline);
      ctx.fillStyle = 'rgba(160,210,150,.75)';
      ctx.fillRect(colX + colW * 0.58, yOf(m + 20), colW * 0.18 * sw, Math.max(1, yOf(m) - yOf(m + 20) + 1));
      ctx.fillStyle = 'rgba(200,170,110,.75)';
      ctx.fillRect(colX + colW * 0.79, yOf(m + 20), colW * 0.18 * kz, Math.max(1, yOf(m) - yOf(m + 20) + 1));
    }
    // The treeline itself, and where the dials put the truck.
    ctx.strokeStyle = '#d8c23a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(colX - 8, yOf(treeline)); ctx.lineTo(colX + colW, yOf(treeline)); ctx.stroke();
    ctx.fillStyle = '#d8c23a';
    ctx.fillText(`treeline ${Math.round(treeline)}m`, colX + colW + 8, yOf(treeline) + 4);
    ctx.strokeStyle = '#7fd0c4';
    ctx.beginPath(); ctx.moveTo(colX - 8, yOf(elev)); ctx.lineTo(colX + colW, yOf(elev)); ctx.stroke();
    ctx.fillStyle = '#7fd0c4';
    ctx.fillText(`here ${Math.round(elev)}m`, colX + colW + 8, yOf(elev) + 4);
    ctx.fillStyle = '#6f8285';
    ctx.fillText('BAND', colX, cv.height - 76);
    ctx.fillText('SWARD', colX + colW * 0.58, cv.height - 76);
    ctx.fillText('KRUMM', colX + colW * 0.79, cv.height - 76);

    const eff = elev + dials.num('aspect');
    const band = altBandAt(eff, treeline);
    status.textContent =
      `${BIOME_ORDER[s.domIdx].toUpperCase()} · ${s.tempC.toFixed(1)}°C · MOISTURE ${s.moisture.toFixed(2)}`
      + ` · SEA TEMP AT THIS LATITUDE ${seaTempAt(lat).toFixed(1)}°C\n`
      + `band ${ALT_BAND_NAMES[band].toUpperCase()} · sward ${swardLift(eff, treeline).toFixed(2)}`
      + ` · krummholz ${krummholz(eff, treeline).toFixed(2)} · lapse ${(LAPSE * 1000).toFixed(1)}°C/km\n`
      + `effective elevation ${Math.round(eff)}m (aspect is worth ${dials.num('aspect')}m here)`;
  };
  dials.onChange(draw);
  draw();
}
