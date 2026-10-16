#!/usr/bin/env node
/**
 * Views: the pictures an experiment's README is written around, made by the experiment itself.
 *
 *   node cells/lab/views.mjs fab                 every view fab registers
 *   node cells/lab/views.mjs fab slash-open hand  just these (by name, or a group's name)
 *   node cells/lab/views.mjs fab --list          what's registered
 *   node cells/lab/views.mjs fab --dpr=2         sharper (and four times the bytes)
 *
 * An experiment registers its views in `client/<id>/views.mjs`:
 *
 *   export const ready = '__fab';                       // what its page sets once it's running
 *   export const helpers = (page, ctx) => ({ … });      // its own verbs, for its views (optional)
 *   export const views = [
 *     { name: 'hand-hem', group: 'The hand', title: 'Dragging the hem', caption: '…',
 *       query: 'at=table&settle=30', size: { width: 430, height: 900 },
 *       run: async (v) => { await v.drag(a, b, { at: v.shot }); } },
 *   ];
 *
 * Each view is a fresh page at its query; `run` (if any) drives it, through the page and the verbs below, and calls
 * `v.shot()` at the moment the picture's to be taken (mid-gesture, say); if it doesn't, the shot's taken when it's done.
 * Each is written to `static/<id>/v-<name>.jpg` (an experiment's assets: committed, deployed, served with its page) and
 * the README's gallery is rewritten between `<!-- views -->` and `<!-- /views -->`: every view, by group, as
 * `![title: caption](<id>/v-<name>.jpg)`. The same line embeds one anywhere else in the README's prose. (The pictures
 * are relative to the README, so they show on GitHub too; the lab's README page points them at the deployed assets.)
 *
 * The verbs every view gets: `v.page` (Playwright), `v.wait(ms)`, `v.tap([x, y])`, `v.drag(from, to, { steps, at })`
 * (`at` is called with the finger still down at `to`), `v.eval(fn, arg)`, `v.shot()`, and the experiment's helpers.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CELL = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => [a.slice(2).split('=')[0], a.split('=')[1] ?? true]));
const [id, ...only] = args.filter((a) => !a.startsWith('--'));
const reg = id && join(CELL, 'client', id, 'views.mjs');
if (!reg || !existsSync(reg)) { console.log('usage: views.mjs <experiment> [name|group …] [--list] [--dpr=2] [--quality=82]\n(an experiment registers its views in client/<id>/views.mjs)'); process.exit(1); }
const mod = await import(pathToFileURL(reg).href);
const all = mod.views;
if (opt.list) { for (const v of all) console.log(`${v.name.padEnd(20)} ${(v.group ?? '').padEnd(16)} ${v.title}`); process.exit(0); }
const want = only.length ? all.filter((v) => only.includes(v.name) || only.includes(v.group)) : all;
if (!want.length) { console.log(`no views match ${only.join(', ')}`); process.exit(1); }

process.env.EXPERIMENT = id; process.env.READY = mod.ready;
const { withWood } = await import(pathToFileURL(join(CELL, 'devtools/harness.mjs')).href);
const dir = join(CELL, 'static', id), dpr = Number(opt.dpr) || 1, quality = Number(opt.quality) || 82;
mkdirSync(dir, { recursive: true });

let failed = 0;
await withWood(async (lab) => {
  for (const view of want) {
    const t0 = Date.now(), file = join(dir, `v-${view.name}.jpg`);
    const page = await lab.open(view.query ?? '', { width: view.size?.width ?? 430, height: view.size?.height ?? 900, dpr });
    let shot = false;
    const v = {
      page,
      wait: (ms) => page.waitForTimeout(ms),
      eval: (fn, arg) => page.evaluate(fn, arg),
      tap: async ([x, y]) => { await page.mouse.click(x, y); await page.waitForTimeout(300); },
      async drag(a, b, { steps = 10, at } = {}) {
        await page.mouse.move(a[0], a[1]); await page.mouse.down();
        for (let k = 1; k <= steps; k++) { await page.mouse.move(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps); await page.waitForTimeout(30); }
        if (at) { await page.waitForTimeout(400); await at(); }
        await page.mouse.up(); await page.waitForTimeout(300);
      },
      async shot() { await page.screenshot({ path: file, type: 'jpeg', quality, timeout: 300000 }); shot = true; },
    };
    Object.assign(v, mod.helpers?.(page, v) ?? {});
    try {
      await page.waitForTimeout(view.settle ?? 3000);
      await view.run?.(v);
      if (!shot) { await page.waitForTimeout(view.after ?? 0); await v.shot(); }
      console.log(`${view.name.padEnd(20)} ${((Date.now() - t0) / 1000).toFixed(1)}s  static/${id}/v-${view.name}.jpg${page.errors.length ? `  ✗ ${page.errors.join(' | ')}` : ''}`);
      if (page.errors.length) failed++;
    } catch (e) { failed++; console.log(`${view.name.padEnd(20)} ✗ ${e.message}`); }
    await page.close();
  }
});

// (the README's gallery: every view registered, by group, whether or not this run remade it)
const readme = join(CELL, 'static', `${id}.md`);
if (existsSync(readme)) {
  const src = readFileSync(readme, 'utf8'), a = src.indexOf('<!-- views -->'), b = src.indexOf('<!-- /views -->');
  if (a >= 0 && b > a) {
    const groups = [...new Set(all.map((v) => v.group ?? ''))];
    const body = groups.map((g) => `${g ? `#### ${g}\n\n` : ''}${all.filter((v) => (v.group ?? '') === g).map((v) => `![${v.title}${v.caption ? `: ${v.caption}` : ''}](${id}/v-${v.name}.jpg)`).join('\n')}`).join('\n\n');
    writeFileSync(readme, `${src.slice(0, a)}<!-- views -->\n\n${body}\n\n${src.slice(b)}`);
    console.log(`gallery: static/${id}.md (${all.length} views)`);
  } else console.log(`(no <!-- views --> … <!-- /views --> in static/${id}.md: the gallery wasn't written)`);
}
if (failed) { console.log(`${failed} view(s) had errors`); process.exit(1); }
