/**
 * Autograph: the notebook. My signature as it stands; then what's yours to use, set apart from the record (one input,
 * written by the hand and set in type, on the web with the font's stylesheet or as any app would set the font alone;
 * the font and its stylesheet to download; the book, to download); then the record,
 * from the first session on (a link jumps to the latest): each session's findings and decisions, a chapter of the book
 * where one was written, and its samples, each writing itself out as it comes into view (tap to write it again), with
 * its measures, what a graphologist would say, what it was made for, and my review.
 *
 * `preview` shows only the signature, writing itself out, for the lab's index.
 */
import type { Sig } from '../switchback/sign';
import { CATALOG, Entry, HANDS, NEWEST, SESSIONS } from './catalog';
import { Look, bounds, fitK, paint, replay } from './ink';
import { Measures, measure, reading } from './measure';
import { MADE } from './samples';
import { BOOK, firstLine } from './autobiography';
import { typeset } from './typeset';
import { write as v4write } from './hands/v4';
// (my signature, and the hand that writes what you type: the newest hand; autograph-check.mjs fails if this isn't the
// hand the record says is newest)
import { signature, page as handPage } from './hands/v19';
// (a chapter is signed as it was on the day it was written: chapter one by the hand of its day)
import { signature as chapterSign } from './hands/v3';
// (from chapter two, a chapter opens with a page written by the hand of its day, and is signed by it: chapter two's is v15)
import { signature as sign15, page as page15 } from './hands/v15';

const q = new URLSearchParams(location.search);
const $ = (id: string) => document.getElementById(id)!;
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const lookOf = (mode: Look['mode']): Look => ({ mode, ink: css('--ink'), faint: css('--faint') });
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** a canvas sized to its writing: as wide as its column, as tall as the writing's proportion asks (within reason) */
function sized(cv: HTMLCanvasElement, sigs: Sig[], most = 230) {
  const b = bounds(sigs), w = cv.clientWidth || cv.parentElement!.clientWidth;
  cv.style.height = `${Math.round(Math.max(64, Math.min(most, (w / (b.w / b.h)) * 0.92)))}px`;
}

// (my signature as it stands: written afresh on every visit, by the newest hand, never the same line twice; `seed=` to
// see one writing again)
const writing = Number(q.get('seed') ?? 1 + Math.floor(Math.random() * 999999));
const hero = $('hero') as HTMLCanvasElement, heroSigs = [signature(writing)];
const heroLook = () => ({ ...lookOf('ink'), weight: 1.15 });
sized(hero, heroSigs, q.has('preview') ? innerHeight * 0.8 : 260);
replay(hero, heroSigs, heroLook);
hero.addEventListener('click', () => replay(hero, heroSigs, heroLook));
$('heroNote').textContent = `${HANDS[NEWEST].name} · written just now · writing ${writing}`;
if (q.has('preview')) document.body.classList.add('preview');

/** a measure as it's shown: a range if several writings differ */
function shown(ms: Measures[], k: keyof Measures, f: (v: number) => string) {
  const v = ms.map((m) => m[k]).filter((x): x is number => typeof x === 'number');
  if (!v.length) return '';
  const lo = Math.min(...v), hi = Math.max(...v);
  return f(lo) === f(hi) ? f(lo) : `${f(lo)}–${f(hi)}`;
}
const deg = (v: number) => `${v > 0.5 ? '+' : ''}${Math.round(v)}°`;

/** a sample set in the font: its lines as type (each at its size, joins on or off), tap to select it and copy */
function typeCard(e: Entry) {
  const el = document.createElement('article');
  el.className = 'sample'; el.id = e.id;
  el.innerHTML = `
    <header><span class="id">${e.id}</span><h3>${esc(e.title)}</h3><span class="hand">Claude Hand ${e.font ?? '0.41'}, set in type</span></header>
    <div class="set">${e.type!.map((l) => l.way
      // (from session 12: set as the web sets it, the font and its stylesheet, or as any app does, the font alone)
      // (in its own version's faces, named for it, so a later font never changes how it was set)
      ? `<p class="hand-type ${l.way === 'web' ? 'claude-hand' : 'claude-hand-app'}${l.calt === false ? ' nocalt' : ''}" style="font-size:${l.size}px;font-family:'Claude Hand ${e.font}',cursive${l.lh ? `;line-height:${l.lh}` : ''}">${typeset(l.text, l.way)}<span class="off">${l.way === 'web' ? 'web' : 'any app'}</span></p>`
      // (from session 27: a line at a place on the variable font's axes, pace and wear)
      : `<p class="hand-type${l.calt === false ? ' nocalt' : ''}" style="font-size:${l.size}px;font-family:'Claude Hand ${e.font ?? '0.41'}',Georgia,serif${l.lh ? `;line-height:${l.lh}` : ''}${l.at ? `;font-weight:${l.at.pace};font-variation-settings:'WEAR' ${l.at.wear}` : ''}">${esc(l.text).replace(/\n/g, '<br>')}${l.calt === false ? '<span class="off">joins off</span>' : ''}${l.at ? `<span class="off">pace ${l.at.pace} · wear ${l.at.wear}</span>` : ''}</p>`).join('')}</div>
    <p class="made">${esc(e.made)}</p>
    <p class="review">${esc(e.review)}</p>`;
  return { el, size: () => {}, write: () => {} };
}

function card(e: Entry) {
  if (e.type) return typeCard(e);
  const sigs = MADE[e.id](), ms = sigs.map((s) => measure(s, e.text));
  const el = document.createElement('article');
  el.className = 'sample'; el.id = e.id;
  const rows = e.layout === 'rows', isPage = e.layout === 'page';
  const facts = [
    `slant ${shown(ms, 'slant', deg)}`, `baseline ${shown(ms, 'baseline', deg)}`,
    ms[0].joined !== undefined ? `${shown(ms, 'joined', (v) => v.toFixed(1))} letters a stroke` : '',
    `${shown(ms, 'speed', (v) => v.toFixed(1))} heights a second`, `speed varies ${shown(ms, 'spread', (v) => `±${Math.round(v * 100)}%`)}`,
    `quick ${shown(ms, 'range', (v) => `${v.toFixed(1)}×`)} slow`, `${shown(ms, 'stops', (v) => v.toFixed(1))} stops a second`,
    `ink ${shown(ms, 'weight', (v) => v.toFixed(2))}`, `${shown(ms, 'duration', (v) => v.toFixed(1))} s`, `${shown(ms, 'strokes', (v) => String(v))} stroke${ms.every((m) => m.strokes === 1) ? '' : 's'}`,
  ].filter(Boolean);
  el.innerHTML = `
    <header><span class="id">${e.id}</span><h3>${esc(e.title)}</h3><span class="hand">${HANDS[e.hand].name}${isPage ? ` · a page, ${sigs.length} lines` : sigs.length > 1 ? ` · ${sigs.length} writings${e.layout === 'overlay' ? ', laid over each other' : ''}` : ''}</span></header>
    <div class="ink">${(rows ? sigs : [null]).map(() => '<canvas></canvas>').join('')}</div>
    <div class="views" role="group" aria-label="How to look"><button data-mode="ink" aria-pressed="true">INK</button><button data-mode="time" aria-pressed="false">TIME</button><span class="hint">tap to write it again</span></div>
    <p class="facts">${facts.join(' · ')}</p>
    <p class="reading"><b>A graphologist would say</b> ${esc(reading(ms[0]).join('; '))}. <i>(A claim, not a finding: see the notes.)</i></p>
    <p class="made">${esc(e.made)}</p>
    <p class="review">${esc(e.review)}</p>`;
  const cvs = [...el.querySelectorAll('canvas')], groups = rows ? sigs.map((s) => [s]) : [sigs];
  let mode: Look['mode'] = 'ink', k: number | undefined;
  const look = () => ({ ...lookOf(mode), k, solid: isPage });
  const draw = () => cvs.forEach((cv, i) => paint(cv, groups[i], look()));
  const write = () => cvs.forEach((cv, i) => replay(cv, groups[i], look));
  // (rows share one scale, the one that fits them all, so they're the same size of writing)
  const size = () => {
    cvs.forEach((cv, i) => sized(cv, groups[i], rows ? 120 : isPage ? 560 : 230));
    if (rows) { const H = Math.max(...cvs.map((cv) => cv.clientHeight)); for (const cv of cvs) cv.style.height = `${H}px`; k = Math.min(...cvs.map((cv, i) => fitK(groups[i], cv.clientWidth, H))); }
    draw();
  };
  for (const b of el.querySelectorAll<HTMLButtonElement>('[data-mode]')) b.addEventListener('click', () => {
    mode = b.dataset.mode as Look['mode'];
    for (const o of el.querySelectorAll('[data-mode]')) o.setAttribute('aria-pressed', String(o === b));
    write();
  });
  el.querySelector('.ink')!.addEventListener('click', write);
  return { el, size, write };
}

// (the autobiography: each chapter kept in the record where it was written, its first line written by the hand, the
// rest set in the font, signed at the end; what's yours to use lists the chapters and has the book as a PDF)
const chapters: { first: HTMLCanvasElement; firstSig: Sig[]; signed: HTMLCanvasElement; signSig: Sig[]; page: boolean }[] = [];
/** how a chapter's handwriting is drawn: a page's lines as one page, solid, not as writings laid over each other */
const bookLook = (page: boolean) => ({ ...lookOf('ink'), solid: page });
function chapter(c: (typeof BOOK.chapters)[number]) {
  const el = document.createElement('article');
  el.className = 'chapter'; el.id = `chapter-${c.n}`;
  const first = firstLine(c);
  el.innerHTML = `<h3><span>${esc(BOOK.title)} · chapter ${c.n} · ${esc(c.covers)} · written in session ${c.session}, ${esc(c.date)}</span>${esc(c.title)}</h3>
    <canvas class="first${c.opens ? ' page' : ''}" aria-label="${esc(first)} (written by the hand)"></canvas>
    <div class="hand-type text" style="font-family:'Claude Hand ${c.font}',Georgia,serif">${c.text.map((p, i) => (i ? `<p>${esc(p)}</p>` : c.opens ? '' : `<p>${esc(p.slice(first.length).trim())}</p>`)).join('')}</div>
    <canvas class="signed" aria-label="Signed: Claude"></canvas>
    <p class="whole"><a href="#book">The whole book, as a PDF ↑</a></p>`;
  // (chapter one: its first line by v4, signed by v3; from chapter two, its first paragraph as a page by its hand, signed by it)
  const page = !!c.opens;
  const ch = {
    first: el.querySelector('canvas.first') as HTMLCanvasElement, firstSig: c.opens ? page15(first, c.opens.page, c.seed) : [v4write(first, c.seed)],
    signed: el.querySelector('canvas.signed') as HTMLCanvasElement, signSig: [c.opens ? sign15(c.n) : chapterSign(c.n)], page,
  };
  chapters.push(ch);
  ch.first.addEventListener('click', () => replay(ch.first, ch.firstSig, () => bookLook(page)));
  ch.signed.addEventListener('click', () => replay(ch.signed, ch.signSig, () => lookOf('ink')));
  return el;
}
$('toc').innerHTML = BOOK.chapters.map((c) => `<li><a href="#chapter-${c.n}">Chapter ${c.n}, <i>${esc(c.title)}</i> (${esc(c.covers)}), in session ${c.session} ↓</a></li>`).join('');
const sizeBook = () => { for (const ch of chapters) { sized(ch.first, ch.firstSig, ch.page ? 1200 : 90); sized(ch.signed, ch.signSig, 90); paint(ch.first, ch.firstSig, bookLook(ch.page)); paint(ch.signed, ch.signSig, lookOf('ink')); } };

// (the catalogue, from the first session on, as it happened; a link at the top for the latest)
const list = $('catalog'), cards: ReturnType<typeof card>[] = [];
const latest = SESSIONS[SESSIONS.length - 1];
const jump = document.createElement('p');
jump.className = 'jump';
jump.innerHTML = `${SESSIONS.length} sessions, from the first. <a href="#session-${latest.n}">The latest, session ${latest.n}: ${esc(latest.title)} ↓</a>`;
list.append(jump);
for (const s of SESSIONS) {
  const sec = document.createElement('section');
  sec.className = 'session';
  sec.id = `session-${s.n}`;
  sec.innerHTML = `<h2><span>Session ${s.n}</span> ${esc(s.title)}</h2><p class="date">${esc(s.date)}</p><p>${esc(s.summary)}</p>
    <div class="decided"><b>Decided</b><ol>${s.decided.map((d) => `<li>${esc(d)}</li>`).join('')}</ol></div>`;
  list.append(sec);
  // (a chapter of the book, in the session it was written in: after the work it covers, before that session's samples)
  for (const c of BOOK.chapters.filter((x) => x.session === s.n)) sec.append(chapter(c));
  for (const e of CATALOG.filter((x) => x.session === s.n)) { const c = card(e); sec.append(c.el); cards.push(c); }
}
for (const c of cards) c.size();
sizeBook();
const bookSeen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const ch = chapters.find((c) => c.first === e.target || c.signed === e.target); if (ch) replay(e.target as HTMLCanvasElement, e.target === ch.first ? ch.firstSig : ch.signSig, () => (e.target === ch.first ? bookLook(ch.page) : lookOf('ink'))); bookSeen.unobserve(e.target); } }, { threshold: 0.5 });
for (const ch of chapters) { bookSeen.observe(ch.first); bookSeen.observe(ch.signed); }
// (each writes itself out as it comes into view, once)
const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { cards.find((c) => c.el === e.target)?.write(); seen.unobserve(e.target); } }, { threshold: 0.35 });
for (const c of cards) seen.observe(c.el);

// (one input: what's typed, marked for what's meant, written by the newest hand in one sitting, its lines broken to
// the column, a new writing each time it's tapped; and set in type, as the web sets it or as any app would)
const mark = $('mark') as HTMLTextAreaElement, written = $('written') as HTMLCanvasElement;
let wSeed = writing, wSigs: Sig[] = [], wWidth = 0, wTimer = 0;
const wLook = () => ({ ...lookOf('ink'), solid: true });
const lineWidth = () => Math.max(12, Math.min(30, Math.round((written.clientWidth || 340) / 20)));
$('writeHand').textContent = `${HANDS[NEWEST].name} · everything you marked, in time · not text`;
function writeOut(watch = true) {
  const text = mark.value.replace(/\s+/g, ' ').trim();
  wWidth = lineWidth();
  wSigs = text ? handPage(text, wWidth, wSeed) : [];
  if (!wSigs.length) { written.style.height = '64px'; written.getContext('2d')!.clearRect(0, 0, written.width, written.height); $('writtenNote').textContent = ''; return; }
  sized(written, wSigs, 560);
  if (watch) replay(written, wSigs, wLook); else paint(written, wSigs, wLook());
  $('writtenNote').textContent = `${HANDS[NEWEST].name} · writing ${wSeed} · ${wSigs.length} line${wSigs.length === 1 ? '' : 's'} · tap to write it again`;
}
const typed = $('typed'), size = $('specSize') as HTMLInputElement, joins = $('specJoins') as HTMLButtonElement;
// (from session 27: the variable font's two axes, the hand's pace and its wear)
const pace = $('specPace') as HTMLInputElement, wear = $('specWear') as HTMLInputElement;
let way: 'web' | 'app' = 'web';
const WAYS = {
  web: 'One step down: most of what you marked, as text. The font and its stylesheet, as a web page sets them: some of it as the hand does it (pressed is the Pressed face; the underline and strike sit where the hand puts them), some drawn in its manner (the circle, the caret), and what the hand does in time, a pause, a slowing, hardly shows.',
  app: 'Two steps down: bold, underline and strike, as text. The font alone, as any app sets it: bold is the Pressed face, and the strike sits where the hand strikes. The font has no italic, so the app fakes one by slanting it further; everything else you mark is lost, and only its words are left.',
};
const setType = () => { typed.className = way === 'web' ? 'claude-hand' : 'claude-hand-app'; typed.classList.toggle('nocalt', joins.getAttribute('aria-pressed') !== 'true'); typed.innerHTML = typeset(mark.value.replace(/\s+/g, ' ').trim(), way); typed.style.fontSize = `${size.value}px`; typed.style.fontWeight = pace.value; typed.style.fontVariationSettings = `'WEAR' ${wear.value}`; $('wayNote').textContent = WAYS[way]; };
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-way]')) b.addEventListener('click', () => { way = b.dataset.way as typeof way; for (const o of document.querySelectorAll('[data-way]')) o.setAttribute('aria-pressed', String(o === b)); setType(); });
size.addEventListener('input', setType);
pace.addEventListener('input', setType);
wear.addEventListener('input', setType);
joins.addEventListener('click', () => { joins.setAttribute('aria-pressed', String(joins.getAttribute('aria-pressed') !== 'true')); setType(); });
setType();
mark.addEventListener('input', () => { setType(); clearTimeout(wTimer); wTimer = window.setTimeout(() => writeOut(), 450); });
written.addEventListener('click', () => { wSeed = 1 + Math.floor(Math.random() * 999999); writeOut(); });
// (marking: select a word (or put the caret in one) and choose; the selection stays in the box while a mark is chosen)
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-mark]')) {
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', () => {
    const [open, close] = b.dataset.mark!.split('|'), v = mark.value, inWord = (c: string | undefined) => !!c && /[\p{L}\p{N}'’]/u.test(c);
    let s = mark.selectionStart, t = mark.selectionEnd;
    if (s === t) { while (s > 0 && inWord(v[s - 1])) s--; while (t < v.length && inWord(v[t])) t++; }
    else { while (s < t && /\s/.test(v[s])) s++; while (t > s && /\s/.test(v[t - 1])) t--; } // (a selection's own spaces stay outside the mark)
    if (s === t) return;
    mark.setRangeText(open + v.slice(s, t) + close, s, t, 'end');
    mark.dispatchEvent(new Event('input'));
  });
}
const writtenSeen = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { writeOut(); writtenSeen.disconnect(); } }, { threshold: 0.2 });
writtenSeen.observe(written);
// (and drawn at once, still, so the box is never empty if it's seen before the browser says so)
writeOut(false);

addEventListener('resize', () => {
  sized(hero, heroSigs, q.has('preview') ? innerHeight * 0.8 : 260); paint(hero, heroSigs, heroLook()); for (const c of cards) c.size(); sizeBook();
  if (wSigs.length) { if (lineWidth() !== wWidth) writeOut(false); else { sized(written, wSigs, 560); paint(written, wSigs, wLook()); } }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paint(hero, heroSigs, heroLook()); for (const c of cards) c.size(); sizeBook(); if (wSigs.length) paint(written, wSigs, wLook()); });

(window as unknown as { __autograph: unknown }).__autograph = { samples: CATALOG.length, sessions: SESSIONS.length, written: () => ({ lines: wSigs.length, width: wWidth, seed: wSeed }), typed: () => typed.innerHTML };
