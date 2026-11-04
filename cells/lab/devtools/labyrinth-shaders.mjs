// The labyrinth's shaders compile (node cells/lab/devtools/labyrinth-shaders.mjs): the renderer made in a bare page, so
// a shader that won't compile says why at once, rather than leaving the page (and the views, and the smoke test)
// waiting for it.
import { build } from 'esbuild';
import { chromium } from 'playwright';
const o = await build({ entryPoints: [new URL('../client/labyrinth/render.ts', import.meta.url).pathname], bundle: true, write: false, format: 'iife', globalName: 'R', platform: 'browser', logLevel: 'error' });
const b = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.setContent('<canvas id=c></canvas>');
await p.addScriptTag({ content: o.outputFiles[0].text });
const said = await p.evaluate(() => { try { new R.Renderer(document.getElementById('c')); return ''; } catch (e) { return String(e.message || e); } });
await b.close();
console.log(said ? `FAIL  the shaders don't compile:\n${said}` : 'ok    the shaders compile');
process.exitCode = said ? 1 : 0;
