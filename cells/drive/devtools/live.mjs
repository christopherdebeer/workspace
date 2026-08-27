/**
 * A TAB THAT STAYS OPEN, AND A WAY TO ASK IT THINGS.
 *
 * Every other tool here is a script: it opens the world, asks its one question,
 * prints a number and closes. That is the right shape for a measurement you
 * already know you want. It is the wrong shape for the other half of the work —
 * looking around, following a hunch, asking the next question BECAUSE of the
 * last answer — because each question pays the boot again (a cold world is
 * minutes) and, worse, each one gets a DIFFERENT world: a fresh spawn, a fresh
 * stream, none of the state the previous answer was about.
 *
 * The cell already has the right idea in `serveProbe`: a tab polls, answers
 * come back, the session is never disturbed. But that channel needs DynamoDB
 * and a deployed cell, and it exists because a PHONE cannot be driven any other
 * way. Locally the whole apparatus is one function call away.
 *
 * So this is the interactive end of the same idea. It boots the world through
 * the shared rig — same bundle, same page shell, same relay and its disk cache
 * — and then just sits there with a control server on localhost:
 *
 *   POST /eval   body = a JS expression, evaluated IN THE PAGE  → its value
 *   GET  /shot?name=x                                          → a PNG on disk
 *   GET  /errors                                               → page + GLSL errors
 *   GET  /health                                               → is it up, how long
 *   POST /close                                                → tear it down
 *
 * The point is that the tab between two questions is the SAME tab: drive
 * somewhere, then ask about where you drove.
 *
 *   node cells/drive/devtools/live.mjs [--spot=…] [--control=9111] [--settle=ms]
 *   curl -s -XPOST localhost:9111/eval --data-binary '__drive.x'
 *
 * NOT A TEST. It reports nothing and asserts nothing; `report()` is deliberately
 * not called, because this process's exit code is about the harness, not about
 * the world. And the relay's CSP blindness (see harness.mjs, TRAP TWO) applies
 * here exactly as it does everywhere else in this folder.
 */
import http from 'node:http';
import { join } from 'node:path';
import { openDrive, WORK } from './harness.mjs';

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

const control = Number(arg('control', '9111'));
const spot = arg('spot', 'lat=-34.09905&lon=18.37835&h=0&cam=chase');
const settle = Number(arg('settle', '0'));

console.log(`[live] booting: ?${spot}`);
const t0 = Date.now();
const d = await openDrive({
  spot,
  settle,
  tag: 'live',
  menu: arg('menu', '') !== '1',
  viewport: { width: Number(arg('w', '390')), height: Number(arg('h', '844')) },
  // --headed puts it on the real GPU, --dpr=2 gives it a phone's framebuffer.
  // Both off by default so this stays runnable without a display; see the note
  // by chromium.launch in harness.mjs for why a timing question needs them.
  headed: arg('headed', '') === '1',
  dpr: Number(arg('dpr', '1')) || 1,
  novsync: arg('novsync', '') === '1',
});
console.log(`[live] world up in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (d.errors.length) console.log(`[live] ${d.errors.length} error(s) already:`, d.errors.slice(0, 3));

const body = (req) => new Promise((res) => {
  let s = '';
  req.on('data', (c) => { s += c; });
  req.on('end', () => res(s));
});

/**
 * An EXPRESSION, or a block. Playwright hands a string straight to
 * Runtime.evaluate, which wants one expression — but the questions worth asking
 * interactively are routinely three statements long ("hide this, sample that,
 * put it back"). So an expression is tried first and a block is the fallback,
 * rather than making every caller remember which they wrote.
 *
 * Runtime.evaluate is also why this works at all under a policy that forbids
 * eval: the string is never evaluated BY the page, it is evaluated in the page's
 * context by the debugger. The cell's own probe channel cannot take that
 * shortcut, which is why it walks a path from `window` instead.
 */
const ask = async (src) => {
  try {
    return { ok: true, v: await d.page.evaluate(`(async () => (${src}))()`) };
  } catch (e) {
    const first = String(e.message ?? e);
    if (!/SyntaxError|Unexpected/i.test(first)) return { ok: false, error: first.slice(0, 2000) };
    try {
      return { ok: true, v: await d.page.evaluate(`(async () => { ${src} })()`) };
    } catch (e2) {
      return { ok: false, error: String(e2.message ?? e2).slice(0, 2000) };
    }
  }
};

let closing = false;
const srv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const j = (code, o) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  try {
    if (url.pathname === '/health') {
      return j(200, { up: true, upSecs: Math.round((Date.now() - t0) / 1000), errors: d.errors.length });
    }
    if (url.pathname === '/errors') return j(200, { errors: d.errors });
    if (url.pathname === '/eval') {
      const src = req.method === 'POST' ? await body(req) : (url.searchParams.get('js') ?? '');
      if (!src.trim()) return j(400, { ok: false, error: 'no js' });
      const out = await ask(src);
      return j(out.ok ? 200 : 400, out);
    }
    if (url.pathname === '/shot') {
      const name = (url.searchParams.get('name') ?? 'live').replace(/[^\w.-]/g, '');
      await d.shot(name);
      return j(200, { ok: true, path: join(WORK, `${name}.png`) });
    }
    if (url.pathname === '/close') {
      closing = true;
      j(200, { ok: true });
      console.log('[live] closing on request');
      await d.close();
      srv.close();
      return process.exit(0);
    }
    return j(404, { error: 'GET /health /errors /shot, POST /eval /close' });
  } catch (e) {
    if (!closing) return j(500, { error: String(e.message ?? e).slice(0, 500) });
  }
});
await new Promise((r) => srv.listen(control, r));
console.log(`[live] control on http://localhost:${control}  (POST /eval)`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { closing = true; await d.close().catch(() => {}); process.exit(0); });
}
