// Paint the Field Journal's mushroom clusters on a sheet, to look at them.
// node cells/lab/devtools/mushrooms-shot.mjs <out.png> [seeds, comma-separated]
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
const [out = 'mushrooms.png', seedsArg] = process.argv.slice(2);
const o = await build({ entryPoints: [new URL('../client/field/mushrooms.ts', import.meta.url).pathname], bundle: true, write: false, format: 'iife', globalName: 'M' });
const b = await chromium.launch({ executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined });
const p = await b.newPage({ viewport: { width: 1200, height: 520 } });
await p.setContent('<body style="margin:0;background:#6d7d6a;display:flex;flex-wrap:wrap;gap:16px;padding:16px;align-items:flex-end;font:12px Georgia;color:#eee"></body>');
await p.addScriptTag({ content: o.outputFiles[0].text });
await p.evaluate((seeds) => {
  const M = window.M;
  const list = seeds ?? (() => { const out = []; for (const form of M.MUSHROOM_FORMS) { let s = 1, n = 0; while (n < 2) { if (M.formOf(s) === form) { out.push(s); n++; } s++; } } return out; })();
  for (const seed of list) { const c = M.paintCluster(seed); const g = M.mushroomSpecies(seed); c.canvas.style.height = `${c.h * 1400}px`; const d = document.createElement('div'); d.append(c.canvas, Object.assign(document.createElement('div'), { textContent: `${g.form} · ${g.name} · ${(c.h * 100).toFixed(0)} cm` })); document.body.append(d); }
}, seedsArg ? seedsArg.split(',').map(Number) : null);
await p.screenshot({ path: out, fullPage: true });
await b.close();
console.log(out);
