// The lab index's preview toggles (node cells/lab/devtools/lab-index-check.mjs): the index rendered by the cell's own
// handler (with a stand-in for the client bundle, which only a deploy builds), opened in headless Chrome, and one card's
// presets clicked: the preview, the card's link and `open` follow the chosen preset, and choosing it again goes back to
// the card's own preview. Writes devtools/out/index-card.png.
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const out = new URL('../_idx.cjs', import.meta.url).pathname, app = new URL('../app.js', import.meta.url).pathname, stub = !existsSync(app);
if (stub) writeFileSync(app, '');
// (the stub and the bundle removed however the run ends: a stub app.js left behind would be synced into the cell)
const tidy = () => { rmSync(out, { force: true }); if (stub) rmSync(app, { force: true }); };
process.on('exit', tidy); process.on('uncaughtException', (e) => { tidy(); console.error(e); process.exit(1); });
await build({ entryPoints: [new URL('../index.ts', import.meta.url).pathname], bundle: true, platform: 'node', format: 'cjs', outfile: out, external: ['@aws-sdk/*'], logLevel: 'error' });
// (the handler resolves files from its own folder: run it as if it sat in cells/lab)
const require = createRequire(import.meta.url), mod = require(out);
const r = await mod.handler({ rawPath: '/' });
console.log('status', r.statusCode, 'html', r.body.length, r.statusCode !== 200 ? r.body : '');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }), page = await browser.newPage({ viewport: { width: 390, height: 800 } });
await page.route('**/*', (rt) => rt.request().url().startsWith('http://lab.test/') && rt.request().url().endsWith('/') ? rt.fulfill({ body: r.body, contentType: 'text/html' }) : rt.fulfill({ body: '<html><body style="background:#ddd">frame</body></html>', contentType: 'text/html' }));
await page.goto('http://lab.test/');
const card = page.locator('.card', { hasText: 'Splats' }).first();
const state = () => card.evaluate((c) => ({ src: c.querySelector('iframe').dataset.src, open: c.querySelector('.open').getAttribute('href'), live: c.querySelector('.live').getAttribute('href'), pressed: [...c.querySelectorAll('.preset[aria-pressed=true]')].map((b) => b.textContent) }));
console.log('initial', await state());
await card.locator('.preset', { hasText: 'a composed scene' }).click(); console.log('chosen', await state());
await card.locator('.preset', { hasText: 'a composed scene' }).click(); console.log('again', await state());
await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
await page.screenshot({ path: new URL('./out/index-card.png', import.meta.url).pathname, clip: await card.boundingBox() });
await browser.close();
rmSync(out, { force: true }); if (stub) rmSync(app, { force: true });
