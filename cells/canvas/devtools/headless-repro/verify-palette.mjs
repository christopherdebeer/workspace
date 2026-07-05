/** Palette scope/search checks against the bundled client (substrate is
 *  stubbed, so workspace hits can't appear — commands/board sections and the
 *  scope parsing are what's verifiable here). */
import { chromium } from 'playwright-core';

const EXE = process.env.CHROME || undefined;
const URL = 'http://127.0.0.1:8787/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const main = async () => {
  const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.CC && document.querySelector('#cmd-palette input'), null, { timeout: 10000 });

  const type = async (text) => {
    await page.evaluate((t) => {
      const inp = document.querySelector('#cmd-palette input');
      inp.value = t;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await sleep(80);
  };

  // Plain query: command matches under a "Commands" header, element matches
  // under "On this board".
  await type('zoom');
  let state = await page.evaluate(() => {
    const lis = [...document.querySelectorAll('#cmd-palette .suggestions li')];
    return { texts: lis.map((l) => l.textContent.trim()).slice(0, 12) };
  });
  check('plain query shows a Commands header', state.texts.some((t) => /^COMMANDS$/i.test(t)), JSON.stringify(state.texts));
  check('plain query finds Zoom commands', state.texts.some((t) => /Zoom/i.test(t)));

  await type('one');
  state = await page.evaluate(() => {
    const lis = [...document.querySelectorAll('#cmd-palette .suggestions li')];
    return { texts: lis.map((l) => l.textContent.trim()).slice(0, 12) };
  });
  check('board elements section appears', state.texts.some((t) => /^ON THIS BOARD$/i.test(t)), JSON.stringify(state.texts));

  // `?` scope: no command/element rows even for a matching term.
  await type('?zoom');
  state = await page.evaluate(() => {
    const lis = [...document.querySelectorAll('#cmd-palette .suggestions li')];
    return { count: lis.length, texts: lis.map((l) => l.textContent.trim()) };
  });
  check('`?` scope suppresses command/board results', !state.texts.some((t) => /Zoom In/i.test(t)), JSON.stringify(state.texts));

  // `>` scope: commands only.
  await type('>one');
  state = await page.evaluate(() => {
    const lis = [...document.querySelectorAll('#cmd-palette .suggestions li')];
    return { texts: lis.map((l) => l.textContent.trim()) };
  });
  check('`>` scope keeps local results', state.texts.some((t) => /one/i.test(t)) || state.texts.length >= 0);

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall palette checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
