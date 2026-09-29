// The canopy's crown hash on the GPU (GLSL ES 3.00, integer pcg4d) against the
// same hash in JS (canopy-seed.ts): the skeleton geometry is only the same
// forest as the ray-marched crowns if these agree to the bit. A WebGL2 program
// writes canH4 for a grid of cells, negative and far, into a float target.
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
const here = new URL('.', import.meta.url).pathname;
execSync(`npx esbuild ${here}../client/canopy-seed.ts --format=esm --outfile=${here}../node_modules/.cache/canopy-seed.mjs --log-level=error`);
const { canH4, CAN_HASH_GLSL } = await import(`${here}../node_modules/.cache/canopy-seed.mjs`);
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/tmp/claude-0/hydro-ab/node_modules/playwright')); }
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }).catch(() => chromium.launch());
const page = await browser.newPage();
const N = 64, X0 = -2100, Y0 = 1837;
const out = await page.evaluate(({ glsl, N, X0, Y0 }) => {
  const c = document.createElement('canvas'); c.width = N; c.height = N;
  const gl = c.getContext('webgl2'); if (!gl) return { err: 'no webgl2' };
  gl.getExtension('EXT_color_buffer_float');
  const vs = `#version 300 es\nin vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;
  const fs = `#version 300 es\nprecision highp float; precision highp int;\n${glsl}\nout vec4 o; void main(){ vec2 cell = floor(gl_FragCoord.xy) + vec2(${X0}.0, ${Y0}.0); o = canH4(cell); }`;
  const sh = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h); if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(h)); return h; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(pr); gl.useProgram(pr);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, N, N, 0, gl.RGBA, gl.FLOAT, null);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, N, N); gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Float32Array(N * N * 4); gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, px);
  return { px: Array.from(px) };
}, { glsl: CAN_HASH_GLSL, N, X0, Y0 });
await browser.close();
if (out.err) { console.log('SKIP', out.err); process.exit(0); }
let bad = 0, worst = 0;
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const h = canH4(x + X0, y + Y0);
  for (let c = 0; c < 4; c++) { const d = Math.abs(h[c] - out.px[(y * N + x) * 4 + c]); worst = Math.max(worst, d); if (d > 0) bad++; }
}
console.log(`cells ${N * N} · channels differing ${bad} · worst ${worst}`);
if (bad) { console.log('FAIL gpu and js canH4 disagree'); process.exit(1); }
console.log('canopy-hash: all ok');
