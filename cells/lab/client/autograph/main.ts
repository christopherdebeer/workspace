/**
 * Autograph: the notebook, in five parts, one shown at a time (from the page's re-ordering after session 38, when it had
 * grown too long to take in, and too heavy to open, as one):
 *
 * - Autograph (home): my signature as it stands, written afresh; what this is; the family as a poster, its range at a
 *   glance, annotated in the margins in my own hand; the latest session; and a way into each of the rest.
 * - Write: one input, written by the hand and set in type, on the web with the font's stylesheet and script or as any
 *   app sets the font alone, at a pace and a wear; and set in every face and family at once.
 * - Font: Claude Hand, each face as a specimen beside its download, for the web and for any app, and how I'd like it used.
 * - Book: In My Own Hand, a chapter at a time.
 * - Record: every session, grouped by the chapter of the book that tells it; each opened on its own, its samples made by
 *   their hands only then, each writing itself out as it comes into view (tap to write it again), with its measures,
 *   what a graphologist would say, what it was made for, and my review.
 *
 * Each part is built the first time it's shown. A place in the record (`#session-12`, a sample's id) or the book
 * (`#chapter-2`) opens the part it's in. `preview` shows only the signature, writing itself out, for the lab's index.
 */
import { CATALOG, HANDS, NEWEST, SESSIONS } from './catalog';
import { paint, replay } from './ink';
// (my signature, and the hand that writes what you type: the newest hand; autograph-check.mjs fails if this isn't the
// hand the record says is newest)
import { signature, page as handPage } from './hands/v27';
import { $, esc, lookOf, sized } from './page/ui';
import { initWrite } from './page/write';
import { buildBook } from './page/book';
import { buildRecord } from './page/record';
import { buildPoster } from './page/poster';
import { timedAs } from './page/ui';

const q = new URLSearchParams(location.search);

// (my signature as it stands: written afresh on every visit, by the newest hand, never the same line twice; `seed=` to
// see one writing again)
const writing = Number(q.get('seed') ?? 1 + Math.floor(Math.random() * 999999));
const hero = $('hero') as HTMLCanvasElement, heroSigs = [signature(writing)];
const heroLook = () => ({ ...lookOf('ink'), weight: 1.15 });
const sizeHero = () => sized(hero, heroSigs, q.has('preview') ? innerHeight * 0.8 : 260);
sizeHero();
replay(hero, heroSigs, heroLook);
hero.addEventListener('click', () => replay(hero, heroSigs, heroLook));
$('heroNote').textContent = `${HANDS[NEWEST].name} · written just now · writing ${writing}`;
if (q.has('preview')) document.body.classList.add('preview');

// (the latest session, on the way in)
const latest = SESSIONS[SESSIONS.length - 1];
$('latest').innerHTML = `<b>Latest</b> <a href="#session-${latest.n}">Session ${latest.n}: ${esc(latest.title)}</a> · ${esc(latest.date)}`;
$('doorRecord').textContent = `${SESSIONS.length} sessions and ${CATALOG.length} samples, as they happened, grouped by the chapters of the book that tell them.`;

// (the font's scripts for type in time, each loaded when a part first needs it: the newest for what's typed, and for the
// record every version its samples were written with, so a later script never changes how one was written)
const base = (document.querySelector<HTMLLinkElement>('link[href*="claude-hand-3."]')?.href ?? '').replace(/[^/]*$/, '');
const loading: Record<string, Promise<void>> = {};
const script = (v: string) => (loading[v] ??= new Promise<void>((done) => { const el = document.createElement('script'); el.src = `${base}claude-hand-time-${v}.js`; el.onload = el.onerror = () => done(); document.head.append(el); }));
const SCRIPTS = ['3.1', '3.2', '3.3', '3.4', '3.8'];

// (the parts, each built when it's first shown)
type View = 'home' | 'write' | 'font' | 'book' | 'record';
const VIEWS: View[] = ['home', 'write', 'font', 'book', 'record'];
let poster: ReturnType<typeof buildPoster> | null = null, write: ReturnType<typeof initWrite> | null = null, book: ReturnType<typeof buildBook> | null = null, record: ReturnType<typeof buildRecord> | null = null;
function show(v: View) {
  for (const el of document.querySelectorAll<HTMLElement>('.view')) el.hidden = el.dataset.view !== v;
  for (const a of document.querySelectorAll<HTMLAnchorElement>('nav.tabs a')) { if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
  if (v === 'home' && !poster) {
    poster = buildPoster($('poster'), handPage, writing);
    // (the line written in time: its script and writing font only once it's nearly in view)
    const line = $('posterTime'), near = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { near.disconnect(); void script('3.8').then(() => timedAs('3.8')?.watch(line)); } }, { rootMargin: '200px' });
    near.observe(line);
  }
  if (v === 'write' && !write) { void script('3.8'); write = initWrite(handPage, writing); }
  if (v === 'book' && !book) book = buildBook($('toc'), $('chapters'));
  if (v === 'record' && !record) record = buildRecord($('catalog'), Promise.all(SCRIPTS.map(script)).then(() => {}));
}
/** where a link goes: a part by its name, or a place in one (a chapter, a session, a sample; and the old page's own
 * anchors, so links made before the re-ordering still arrive) */
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const old: Record<string, View> = { use: 'write', stillFaces: 'font' };
  let v: View = 'home', target: string | null = null;
  if ((VIEWS as string[]).includes(h)) v = h as View;
  else if (old[h]) { v = old[h]; target = h === 'stillFaces' ? h : null; }
  else if (/^chapter-\d+$/.test(h)) { v = 'book'; target = h; }
  else if (/^session-\d+$/.test(h) || CATALOG.some((e) => e.id === h)) { v = 'record'; target = h; }
  show(v);
  void (async () => {
    const el = target ? (v === 'record' ? await record!.open(target) : document.getElementById(target)) : null;
    if (el) requestAnimationFrame(() => el.scrollIntoView({ block: 'start' }));
    else if (h) $('tabs').scrollIntoView({ block: 'start' });
  })();
}
addEventListener('hashchange', route);
route();

addEventListener('resize', () => {
  sizeHero(); paint(hero, heroSigs, heroLook());
  poster?.size(); record?.size(); book?.size(); write?.resize();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paint(hero, heroSigs, heroLook()); poster?.size(); record?.size(); book?.size(); write?.repaint(); });

(window as unknown as { __autograph: unknown }).__autograph = {
  samples: CATALOG.length, sessions: SESSIONS.length,
  written: () => write?.state() ?? { lines: 0, width: 0, seed: writing }, typed: () => write?.typed() ?? '',
};
