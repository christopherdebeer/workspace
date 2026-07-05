/* ---------------------------------------------------------------------------
 * verify-renderers.mjs — the renderer fixture harness (ADR-0056 Inc 2).
 *
 * The machine renderer drifted from its data shape and drew INVISIBLE
 * elements for weeks; nothing could catch it because no renderer ever ran
 * before it shipped. This closes that hole: every `_renderers/*` fact is
 * mounted headless against its fixtures and must paint non-empty.
 *
 * Renderer facts are fetched NODE-side via curl (proxy/CA-friendly); the
 * browser only talks to 127.0.0.1 (`npm run serve` must be up). Sources that
 * import remote modules (the @c15r/viewers re-exports) can't run offline —
 * they are classified NETWORK and skipped unless --network is passed.
 *
 * Usage:
 *   CHROME=/opt/pw-browsers/chromium node verify-renderers.mjs [--network]
 *   PARC_TOKEN_FILE=/tmp/parc-token.json   (default; or PARC_TOKEN=<raw>)
 * ------------------------------------------------------------------------- */
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EXE = process.env.CHROME || undefined;
const NETWORK = process.argv.includes('--network');
const PAGE = 'http://127.0.0.1:8787/';

/* Fallback fixtures per type — used when the renderer fact carries none.
 * A fixture is the el object a mount receives; `expect` is a substring the
 * painted host must contain (defaults to any non-empty paint). */
const FALLBACK_FIXTURES = {
  machine: [{ name: 'no-graph card', el: { id: 'fx-m1', title: 'Tending', width: 220, height: 120 }, expect: 'machine' }],
  badge: [{ name: 'label', el: { id: 'fx-b1', content: 'ALL CLEAR', width: 200, height: 60 }, expect: 'ALL CLEAR' }],
  upcase: [{ name: 'shouts', el: { id: 'fx-u1', content: 'quiet words', width: 200, height: 60 }, expect: 'QUIET WORDS' }],
  mermaid: [{ name: 'two nodes', el: { id: 'fx-mm1', content: 'graph TD;A-->B', width: 240, height: 160 } }],
  json: [{ name: 'object', el: { id: 'fx-j1', content: '{"a":1,"b":[2,3]}', width: 240, height: 160 } }],
  csv: [{ name: 'table', el: { id: 'fx-c1', content: 'a,b\n1,2', width: 240, height: 120 } }],
  repl: [{ name: 'empty repl', el: { id: 'fx-r1', content: '', width: 240, height: 120 } }],
  style: [{ name: 'css fact', el: { id: 'fx-s1', content: '.x{color:red}', width: 200, height: 80 }, allowEmpty: true }],
};

function token() {
  if (process.env.PARC_TOKEN) return process.env.PARC_TOKEN;
  const file = process.env.PARC_TOKEN_FILE || '/tmp/parc-token.json';
  const j = JSON.parse(readFileSync(file, 'utf8'));
  return j.access_token || j.token;
}

/** curl respects HTTPS_PROXY + the CA bundle — node fetch here would not. */
function mcpRead(target, input) {
  const body = JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'read', arguments: { target, input } },
  });
  const out = execFileSync('curl', [
    '-s', '-X', 'POST', 'https://parc.land/mcp',
    '-H', `Authorization: Bearer ${token()}`,
    '-H', 'Content-Type: application/json',
    '-d', body,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const j = JSON.parse(out);
  const text = j.result?.content?.[0]?.text ?? '';
  if (j.result?.isError) throw new Error(text.slice(0, 200));
  return JSON.parse(text);
}

let failures = 0, skips = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
function skip(name, why) { skips++; console.log(`SKIP  ${name} — ${why}`); }

async function main() {
  const q = mcpRead('workspace.query', { prefix: '_renderers/' });
  const facts = (q.entries ?? []).filter((e) => e.value?.type && e.value?.source);
  console.log(`renderers: ${facts.map((f) => f.value.type).join(', ')}\n`);

  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  await page.goto(PAGE);
  await page.waitForFunction(() => window.CC && window.CC.ctx, null, { timeout: 10000 });

  for (const fact of facts) {
    const { type, source, fixtures, contract } = fact.value;
    const label = `renderer ${type}`;
    // Static remote imports fail at module-load offline; DYNAMIC imports are
    // lazy (the machine renderer only reaches its CDN when a graph exists), so
    // those still run — their offline fixtures must exercise the local paths.
    if (/from\s+['"]https?:/.test(source) && !NETWORK) {
      skip(label, 'static remote import — rerun with --network on an open network');
      continue;
    }
    const fxs = (Array.isArray(fixtures) && fixtures.length ? fixtures : FALLBACK_FIXTURES[type]) ?? [
      { name: 'generic', el: { id: `fx-${type}`, content: 'fixture', width: 200, height: 80 } },
    ];
    for (const fx of fxs) {
      if (fx.network && !NETWORK) { skip(`${label} · ${fx.name}`, 'network fixture'); continue; }
      const r = await page.evaluate(async ({ source, el, reads, waitMs }) => {
        // The fixture answers the renderer's substrate reads (`reads` maps a
        // key/prefix substring → entries). This also unhangs legacy renderers
        // still on the window.__parcRead bridge — in the stubbed harness that
        // promise never settles, which is itself the drift ADR-0056 retires.
        const oldRead = window.__parcRead;
        window.__parcRead = (_t, q) => {
          const hit = Object.entries(reads ?? {}).find(([k]) => JSON.stringify(q ?? {}).includes(k));
          return Promise.resolve({ entries: hit ? hit[1] : [] });
        };
        try {
          const b64 = btoa(unescape(encodeURIComponent(source)));
          const mod = await import(`data:text/javascript;base64,${b64}`);
          const view = mod.view ?? mod.default ?? (mod.mount ? mod : null);
          if (!view?.mount) return { error: 'no mount export' };
          const host = view.mount(el, window.CC, window.CC.ctx);
          if (!host) return { error: 'mount returned nothing' };
          document.body.appendChild(host);
          await new Promise((res) => setTimeout(res, waitMs)); // async paints (machine rails path)
          const rect = host.getBoundingClientRect();
          const out = {
            text: (host.textContent || '').trim(),
            children: host.childElementCount,
            area: rect.width * rect.height,
          };
          view.unmount?.(host);
          host.remove();
          return out;
        } catch (e) { return { error: String(e?.message || e) }; }
        finally { window.__parcRead = oldRead; }
      }, { source, el: fx.el, reads: fx.reads ?? {}, waitMs: 600 });

      const name = `${label} · ${fx.name}`;
      if (r.error) { check(name, false, r.error); continue; }
      const painted = r.area > 0 && (r.text.length > 0 || r.children > 0);
      const ok = fx.allowEmpty ? r.area >= 0 : painted;
      const expected = fx.expect ? r.text.includes(fx.expect) : true;
      check(name, ok && expected, `text="${r.text.slice(0, 60)}" children=${r.children} area=${Math.round(r.area)}`);
      if (contract?.api !== undefined) check(`${label} · api pin sane`, contract.api === 1, `api=${contract.api}`);
    }
  }

  await browser.close();
  console.log(`\n${failures ? `${failures} FAILURE(S)` : 'all renderer checks passed'}${skips ? ` (${skips} network-dependent skipped)` : ''}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
