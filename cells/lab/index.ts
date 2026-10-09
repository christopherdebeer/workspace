import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { EXPERIMENTS, groups, type Experiment } from './experiments';
import { markdown } from './md';

/**
 * `@c15r/lab` — 3D and GL experiments, one cell.
 *
 * The Lambda answers three things and nothing else:
 *
 *   /            the index: every experiment, grouped, each running live in its card (only those
 *                in view), with its README and presets
 *   /<id>        a redirect to that experiment's page as it is now (the query kept, so a shared
 *                `/mistwood?seed=…` opens where it was left); /<id>/readme, to its README
 *   /~/…         a miss in the public namespace (ADR-0095): the file is in this package, so it is
 *                written to the namespace and returned — and never asked of this Lambda again
 *
 * Everything under `/~/` is named by its content's hash — the bundle (`/~/a/<hash>.js`), each
 * experiment's page (`/~/e/<id>/<hash>/`), each README (`/~/r/<id>/<hash>/`), an experiment's
 * assets (`static/<id>/*`, at `/~/a/<id>/<hash>/<file>`; the page gets the folder as
 * `{{assets}}`) — so it is immutable:
 * a deploy makes new names, old pages keep working, and nothing ever needs invalidating. Opening
 * an experiment costs no compute at all once its files have been asked for once.
 *
 * git truth: cells/lab/ (README.md).
 */

type Obj = { body: Buffer; type: string };

const here = (rel: string) => join(__dirname, rel);
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex').slice(0, 16);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** What this deploy publishes: each file at its hashed path, and where each experiment's page and README are. */
interface Built {
  objects: Map<string, Obj>;
  pageOf: Map<string, string>;
  readmeOf: Map<string, string>;
  index: string;
}
let built: Built | null = null;

function build(): Built {
  if (built) return built;
  const objects = new Map<string, Obj>();
  const html = (body: string) => Buffer.from(body);
  const app = readFileSync(here('app.js'));
  const appPath = `/~/a/${hash(app)}.js`;
  objects.set(appPath, { body: app, type: 'application/javascript; charset=utf-8' });
  const pageOf = new Map<string, string>();
  const readmeOf = new Map<string, string>();
  const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', woff2: 'font/woff2', json: 'application/json' };
  for (const e of EXPERIMENTS) {
    // (the experiment's assets, if it has a folder of them: one hash for the set)
    let assets = '';
    const dir = here(`static/${e.id}`);
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => TYPES[f.split('.').pop() ?? '']).sort().map((f) => [f, readFileSync(join(dir, f))] as const);
      assets = `/~/a/${e.id}/${hash(Buffer.concat(files.map(([, b]) => b)))}/`;
      for (const [f, b] of files) objects.set(assets + f, { body: b, type: TYPES[f.split('.').pop()!] });
    }
    // (its address shown as the stable `/<id>?…`, not the hashed path it was served from: a reload
    // then asks for the experiment as it is now, not this deploy's copy forever)
    const stable = `<script>history.replaceState(null, '', '/${e.id}' + location.search + location.hash)</script>`;
    const page = html(
      readFileSync(here(e.page), 'utf8')
        .replace('{{app}}', appPath)
        .replace(/\{\{assets\}\}/g, assets)
        .replace('{{readme}}', `/${e.id}/readme`)
        .replace('<head>', `<head>\n${stable}`),
    );
    const p = `/~/e/${e.id}/${hash(page)}/`;
    objects.set(p, { body: page, type: 'text/html; charset=utf-8' });
    pageOf.set(e.id, p);
  }
  for (const e of EXPERIMENTS) {
    if (!existsSync(here(e.readme))) continue;
    const doc = html(readmePage(e, readFileSync(here(e.readme), 'utf8'), pageOf.get(e.id)!));
    const p = `/~/r/${e.id}/${hash(doc)}/`;
    objects.set(p, { body: doc, type: 'text/html; charset=utf-8' });
    readmeOf.set(e.id, p);
  }
  built = { objects, pageOf, readmeOf, index: '' };
  built.index = indexPage(built);
  return built;
}

// ─── the look: raw, pixel, minimal — a monospace page, a pixel face for names, hairlines, no
// rounding, no shadow; the experiments themselves the only images
const HEAD = (title: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Silkscreen&display=swap" rel="stylesheet">
<style>
  :root { --paper: #f1f0eb; --ink: #121211; --soft: #6e6d67; --rule: #121211; --faint: #d9d8d1; }
  @media (prefers-color-scheme: dark) { :root { --paper: #0f0f0e; --ink: #e9e7e0; --soft: #8d8b84; --rule: #e9e7e0; --faint: #262624; } }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 13px/1.6 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    padding: max(18px, env(safe-area-inset-top)) 16px max(32px, env(safe-area-inset-bottom)); }
  a { color: inherit; text-underline-offset: 3px; }
  .px { font-family: "Silkscreen", ui-monospace, monospace; font-weight: normal; letter-spacing: .02em; }
  .bar { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; border-bottom: 1px solid var(--rule); padding-bottom: 8px; }
  .bar a { text-decoration: none; }
  .bar a:hover { background: var(--ink); color: var(--paper); }
  .muted { color: var(--soft); }
</style>`;

function card(e: Experiment, b: Built): string {
  const page = b.pageOf.get(e.id)!;
  const readme = b.readmeOf.get(e.id);
  const presets = e.presets.map((s) => `<a href="${page}${s.query ? `?${esc(s.query)}` : ''}">[${esc(s.label)}]</a>`).join(' ') + (readme ? ` <a href="${readme}">[readme]</a>` : '');
  return `<article class="card">
  <a class="live" href="${page}" aria-label="${esc(e.title)}"><iframe data-src="${page}?${esc(e.preview)}" title="${esc(e.title)} (preview)" tabindex="-1" aria-hidden="true"></iframe><span class="idle px">${esc(e.title)}</span></a>
  <div class="meta">
    <div class="name"><a class="px" href="${page}">${esc(e.title)}</a>${readme ? `<a href="${readme}">readme</a>` : ''}</div>
    <p class="muted">${esc(e.blurb)}</p>
    <nav>${presets}</nav>
  </div>
</article>`;
}

function indexPage(b: Built): string {
  const body = groups()
    .map((g) => `<section><h2 class="px">${esc(g.name)} <span class="muted">${g.experiments.length}</span></h2><div class="grid">${g.experiments.map((e) => card(e, b)).join('')}</div></section>`)
    .join('');
  return `${HEAD('Lab')}
<style>
  header, section { max-width: 1180px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0; }
  section { margin-top: 26px; }
  h2 { font-size: 13px; margin: 0 0 12px; text-transform: uppercase; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); }
  .card { border: 1px solid var(--rule); display: flex; flex-direction: column; }
  .live { position: relative; display: block; aspect-ratio: 4 / 5; overflow: hidden; background: var(--faint); border-bottom: 1px solid var(--rule); }
  .live iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; pointer-events: none; image-rendering: pixelated; }
  .live .idle { position: absolute; inset: 0; display: grid; place-items: center; color: var(--soft); font-size: 12px; }
  .live.on .idle { display: none; }
  .meta { padding: 10px 10px 12px; }
  .name { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .name .px { font-size: 15px; text-decoration: none; }
  .meta p { margin: 4px 0 8px; }
  nav a { text-decoration: none; white-space: nowrap; }
  nav a:hover, .name a:hover { background: var(--ink); color: var(--paper); }
</style>
</head>
<body>
<header class="bar"><h1 class="px">Lab</h1><span class="muted">3d / gl experiments · ${EXPERIMENTS.length}</span></header>
${body}
<script>
  // each preview is the experiment itself, running — so only those in view run (a phone allows
  // only a few GL contexts at once): started as one comes into view, stopped a little after it goes
  const frames = [...document.querySelectorAll('.live iframe')];
  const stop = new Map();
  const io = new IntersectionObserver((seen) => {
    for (const s of seen) {
      const f = s.target;
      clearTimeout(stop.get(f));
      if (s.isIntersecting) {
        if (!f.src) { f.src = f.dataset.src; f.parentElement.classList.add('on'); }
      } else if (f.src) {
        stop.set(f, setTimeout(() => { f.removeAttribute('src'); f.parentElement.classList.remove('on'); }, 3000));
      }
    }
  }, { rootMargin: '120px' });
  frames.forEach((f) => io.observe(f));
</script>
</body>
</html>`;
}

function readmePage(e: Experiment, src: string, page: string): string {
  const doc = markdown(src);
  const toc = doc.headings.filter((h) => h.level === 2).map((h) => `<a href="#${h.id}">${esc(h.text.replace(/`/g, ''))}</a>`).join('');
  return `${HEAD(`${doc.title || e.title} — readme`)}
<style>
  .bar, main { max-width: 74ch; margin: 0 auto; }
  main { padding-top: 6px; }
  h1 { font-size: 26px; margin: 22px 0 6px; }
  h2 { font-family: "Silkscreen", ui-monospace, monospace; font-weight: normal; font-size: 15px; margin: 34px 0 8px; padding-top: 10px; border-top: 1px solid var(--rule); }
  h2::before { content: "§ "; color: var(--soft); }
  h3, h4 { font-size: 13px; margin: 22px 0 6px; text-transform: uppercase; letter-spacing: .06em; }
  p, li { max-width: 74ch; }
  ul, ol { padding-left: 2.2ch; }
  li { margin: 2px 0; }
  li::marker { color: var(--soft); }
  code { background: var(--faint); padding: 0 .3ch; }
  pre { border: 1px solid var(--rule); padding: 10px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; margin: 10px 0; display: block; overflow-x: auto; }
  th, td { border: 1px solid var(--rule); padding: 3px 8px; text-align: left; vertical-align: top; }
  hr { border: 0; border-top: 1px dashed var(--soft); margin: 24px 0; }
  nav.toc { display: flex; flex-wrap: wrap; gap: 2px 14px; margin: 10px 0 0; }
  nav.toc a { color: var(--soft); text-decoration: none; }
  nav.toc a:hover { color: var(--ink); }
</style>
</head>
<body>
<header class="bar"><a class="px" href="/">&larr; lab</a><a href="/${e.id}">open ${esc(e.title.toLowerCase())} &rarr;</a></header>
<main>
${toc ? `<nav class="toc">${toc}</nav>` : ''}
${doc.html}
</main>
</body>
</html>`;
}

/** Write a file into this cell's public namespace (the key is the request path; ADR-0095). */
async function publish(path: string, o: Obj): Promise<void> {
  const bucket = process.env.CELL_PUBLIC_BUCKET;
  if (!bucket) return; // no namespace: serve, don't store
  try {
    // @ts-expect-error resolved at runtime by the Lambda image, not at build
    const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
    await new S3Client({}).send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${process.env.CELL_PUBLIC_PREFIX ?? ''}${path.slice(2)}`,
        Body: o.body,
        ContentType: o.type,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  } catch {
    // (unstored is only slower: the next ask comes here again)
  }
}

const text = (statusCode: number, type: string, body: string, cache: string) => ({
  statusCode,
  headers: { 'content-type': type, 'cache-control': cache },
  body,
});

export const handler = async (event: { rawPath?: string; rawQueryString?: string }) => {
  const path = (event.rawPath ?? '/').replace(/^\/@[^/]+\/lab(?=\/|$)/, '') || '/';
  try {
    const b = build();
    if (path === '/' || path === '/index.html') return text(200, 'text/html; charset=utf-8', b.index, 'no-cache');
    if (path.startsWith('/~/')) {
      const o = b.objects.get(path);
      if (!o) return text(404, 'text/plain; charset=utf-8', 'not in this lab', 'no-store');
      await publish(path, o);
      const binary = !o.type.startsWith('text/') && !o.type.startsWith('application/javascript');
      return {
        statusCode: 200,
        headers: { 'content-type': o.type, 'cache-control': 'public, max-age=31536000, immutable' },
        body: binary ? o.body.toString('base64') : o.body.toString('utf8'),
        ...(binary ? { isBase64Encoded: true } : {}),
      };
    }
    // (/<id>/readme: its README as it is now)
    const rd = /^\/([^/]+)\/readme\/?$/.exec(path);
    if (rd && b.readmeOf.has(rd[1])) return { statusCode: 302, headers: { location: b.readmeOf.get(rd[1])!, 'cache-control': 'no-store' }, body: '' };
    const id = path.replace(/^\/|\/$/g, '');
    const page = b.pageOf.get(id);
    if (page) {
      const q = event.rawQueryString ? `?${event.rawQueryString}` : '';
      return { statusCode: 302, headers: { location: `${page}${q}`, 'cache-control': 'no-store' }, body: '' };
    }
  } catch (err) {
    return text(500, 'text/plain; charset=utf-8', `lab: ${(err as Error).message}`, 'no-store');
  }
  return text(404, 'text/plain; charset=utf-8', 'not in this lab — the experiments are at /', 'no-store');
};
