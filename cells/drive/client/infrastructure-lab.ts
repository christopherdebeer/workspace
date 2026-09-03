import {
  type InfrastructureContext, pickInfrastructureRecipe, planSupportStations,
} from './infrastructure';
import { runInfrastructureChecks } from './infrastructure-checks';

const BASE: InfrastructureContext = {
  key: 'way/1001', kind: 'bridge', lengthM: 140, spanM: 34, roadWidthM: 8,
  tier: 2, lanes: 2, layer: 1, climate: [0.05, 0.05, 0.7, 0.1, 0.1],
  temperatureC: 12, moisture: 0.55, snow: 0.1, reliefM: 22, sideSlope: 0.1,
  coverM: 0, daylightM: 15, waterWidthM: 18, urbanity: 0.25,
  bedrock: 'sedimentary', regionSeed: 12345, districtSeed: 67890,
  settlementSeed: 54321, availableClearanceM: 8,
};

const CASES: Array<{ label: string; context: InfrastructureContext }> = [
  { label: 'TEMPERATE RIVER', context: BASE },
  { label: 'ALPINE GORGE', context: { ...BASE, key: 'way/1002', spanM: 68, lengthM: 210,
    climate: [0, 0, 0.08, 0.22, 0.7], snow: 0.9, reliefM: 120, daylightM: 55,
    sideSlope: 0.78, bedrock: 'metamorphic', regionSeed: 9872, districtSeed: 7761 } },
  { label: 'URBAN CROSSING', context: { ...BASE, key: 'way/1003', spanM: 22, lengthM: 85,
    urbanity: 0.95, tier: 3, districtSeed: 7711, settlementSeed: 6677 } },
  { label: 'BORED ALPINE', context: { ...BASE, key: 'way/2001', kind: 'tunnel', lengthM: 780,
    spanM: 9, coverM: 90, sideSlope: 0.7, daylightM: 0, waterWidthM: 0,
    climate: [0, 0, 0.08, 0.22, 0.7], snow: 0.8, bedrock: 'igneous' } },
  { label: 'CITY CUT + COVER', context: { ...BASE, key: 'way/2002', kind: 'tunnel', lengthM: 180,
    spanM: 12, coverM: 5, urbanity: 0.98, daylightM: 0, waterWidthM: 0, bedrock: 'soft' } },
  { label: 'WET CONDUIT', context: { ...BASE, key: 'way/3001', kind: 'conduit', lengthM: 13,
    spanM: 5, tier: 1, waterWidthM: 5.2, availableClearanceM: 1.8,
    climate: [0, 0.65, 0.25, 0.1, 0], moisture: 0.95, urbanity: 0.1 } },
];

function tests(): string[] {
  return runInfrastructureChecks().map((c) =>
    `${c.pass ? 'PASS' : 'FAIL'} ${c.name} · ${c.detail}`);
}

export async function startInfrastructureLab(): Promise<void> {
  document.title = 'DRIVE · INFRASTRUCTURE LAB';
  const style = document.createElement('style');
  style.textContent = `
    html,body{margin:0;min-height:100%;background:#0b0f11;color:#d6e2e4;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
    main{max-width:1100px;margin:auto;padding:26px 22px 60px} h1{font-size:16px;letter-spacing:3px;margin:0}
    .sub{color:#6f8285;margin:4px 0 20px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
    button{font:inherit;text-align:left;color:inherit;background:#10171a;border:1px solid #24343a;padding:12px;cursor:pointer}
    button:hover,button.on{border-color:#62a99d;background:#132024}.family{color:#7fd0c4;font-size:16px;letter-spacing:2px}
    .meta{color:#87999c;margin-top:6px}.tests{margin:18px 0;color:#8fc7a0;white-space:pre-line}
    canvas{width:100%;height:auto;border:1px solid #24343a;background:#10171a}
    a{color:#6f8285;text-decoration:none;float:right;letter-spacing:2px}
  `;
  document.head.appendChild(style);
  const main = document.createElement('main');
  main.innerHTML = '<a href="../lab">ALL LABS</a><h1>INFRASTRUCTURE GRAMMAR</h1><p class="sub">same production planner · stable scopes · feasibility before style</p>';
  const grid = document.createElement('div'); grid.className = 'grid';
  const cv = document.createElement('canvas'); cv.width = 1100; cv.height = 310;
  const testEl = document.createElement('div'); testEl.className = 'tests'; testEl.textContent = tests().join('\n');
  main.append(grid, testEl, cv); document.body.appendChild(main);
  const ctx = cv.getContext('2d')!;

  const draw = (index: number): void => {
    const c = CASES[index].context;
    const r = pickInfrastructureRecipe(c);
    for (const [i, child] of Array.from(grid.children).entries()) child.classList.toggle('on', i === index);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#152124'; ctx.fillRect(0, 220, cv.width, 90);
    ctx.fillStyle = '#718184'; ctx.fillRect(60, 105, 980, 18);
    ctx.fillStyle = '#343c3f'; ctx.fillRect(60, 100, 980, 8);
    ctx.strokeStyle = r.material === 'steel' ? '#879ba0' : r.material === 'stone' || r.material === 'brick' ? '#9a876d' : '#899194';
    ctx.lineWidth = r.family === 'truss' ? 8 : 5;
    if (c.kind === 'bridge') {
      const support = planSupportStations({ key: c.key, lengthM: c.lengthM,
        spacingM: r.supportSpacingM || c.lengthM + 1, endClearanceM: 8,
        clearAt: (s) => Math.abs(s - c.lengthM * 0.5) > 12 });
      for (const s of support.accepted) {
        const x = 60 + s.stationM / c.lengthM * 980;
        ctx.beginPath(); ctx.moveTo(x, 123); ctx.lineTo(x, 220); ctx.stroke();
      }
      if (r.family === 'arch') {
        ctx.beginPath(); ctx.arc(550, 220, 210, Math.PI, 2 * Math.PI); ctx.stroke();
      } else if (r.family === 'truss' || r.family === 'cable') {
        ctx.beginPath(); ctx.moveTo(60, 100); ctx.lineTo(260, 45); ctx.lineTo(550, 100);
        ctx.lineTo(840, 45); ctx.lineTo(1040, 100); ctx.stroke();
      }
    } else if (c.kind === 'tunnel') {
      ctx.fillStyle = '#2a3032'; ctx.fillRect(80, 20, 940, 205);
      ctx.fillStyle = '#0b0f11'; ctx.beginPath(); ctx.roundRect(130, 70, 840, 155, 55); ctx.fill();
      ctx.strokeRect(130, 70, 840, 155);
    } else {
      ctx.fillStyle = r.feasible ? '#27383c' : '#542d2d';
      const cells = r.family === 'twin-cell' ? 2 : 1;
      for (let i = 0; i < cells; i++) ctx.fillRect(430 + i * 125, 155, 110, 65);
    }
    ctx.fillStyle = '#d6e2e4'; ctx.font = '15px ui-monospace,monospace';
    ctx.fillText(`${CASES[index].label} · ${String(r.family).toUpperCase()} · ${r.material.toUpperCase()}`, 28, 28);
    ctx.fillStyle = '#7f9296'; ctx.font = '12px ui-monospace,monospace';
    ctx.fillText(`${r.geometry.silhouette} · ${r.geometry.support} · repeat ${r.geometry.repeatM.toFixed(1)}m · detail ${r.geometry.detail.toFixed(2)}`, 28, 49);
    ctx.fillText(`${r.era} · ${r.maintenance} · moss ${r.finish.moss.toFixed(2)} · rust ${r.finish.rust.toFixed(2)} · soot ${r.finish.soot.toFixed(2)}`, 28, 68);
  };

  CASES.forEach((item, i) => {
    const r = pickInfrastructureRecipe(item.context);
    const b = document.createElement('button');
    b.innerHTML = `<b>${item.label}</b><div class="family">${String(r.family).toUpperCase()}</div><div class="meta">${r.material} · ${r.era} · ${r.maintenance}<br>${r.geometry.silhouette} · ${r.geometry.support} · ${r.geometry.repeatM.toFixed(1)}m rhythm<br>${r.reason}</div>`;
    b.onclick = () => draw(i); grid.appendChild(b);
  });
  draw(0);
}
