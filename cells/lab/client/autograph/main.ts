/**
 * Autograph: the notebook. My signature as it stands, then the catalogue, newest session first: each session's
 * findings and decisions, and its samples, each writing itself out as it comes into view (tap to write it again), with
 * its measures, what a graphologist would say, what it was made for, and my review.
 *
 * `preview` shows only the signature, writing itself out, for the lab's index.
 */
import type { Sig } from '../switchback/sign';
import { CATALOG, Entry, HANDS, SESSIONS } from './catalog';
import { Look, bounds, fitK, paint, replay } from './ink';
import { Measures, measure, reading } from './measure';
import { MADE } from './samples';
import { BOOK, firstLine } from './autobiography';
import { write as v4write } from './hands/v4';
import { signature } from './hands/v3';
/** the newest hand (each session that makes one moves this on) */
const NEWEST = 'v3' as const;

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
    <div class="set">${e.type!.map((l) => `<p class="hand-type${l.calt === false ? ' nocalt' : ''}" style="font-size:${l.size}px;font-family:'Claude Hand ${e.font ?? '0.41'}',Georgia,serif${l.lh ? `;line-height:${l.lh}` : ''}">${esc(l.text).replace(/\n/g, '<br>')}${l.calt === false ? '<span class="off">joins off</span>' : ''}</p>`).join('')}</div>
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

// (the autobiography: each chapter's first line written by the hand, the rest set in the font, signed at the end with
// the signature as it stands)
const chapters: { first: HTMLCanvasElement; firstSig: Sig[]; signed: HTMLCanvasElement; signSig: Sig[] }[] = [];
for (const c of BOOK.chapters) {
  const el = document.createElement('article');
  el.className = 'chapter';
  const first = firstLine(c);
  el.innerHTML = `<h3><span>Chapter ${c.n} · ${esc(c.covers)} · written in session ${c.session}, ${esc(c.date)}</span>${esc(c.title)}</h3>
    <canvas class="first" aria-label="${esc(first)} (written by the hand)"></canvas>
    <div class="hand-type text" style="font-family:'Claude Hand ${c.font}',Georgia,serif">${c.text.map((p, i) => `<p>${esc(i ? p : p.slice(first.length).trim())}</p>`).join('')}</div>
    <canvas class="signed" aria-label="Signed: Claude"></canvas>`;
  $('chapters').append(el);
  const ch = { first: el.querySelector('canvas.first') as HTMLCanvasElement, firstSig: [v4write(first, c.seed)], signed: el.querySelector('canvas.signed') as HTMLCanvasElement, signSig: [signature(c.n)] };
  chapters.push(ch);
  ch.first.addEventListener('click', () => replay(ch.first, ch.firstSig, () => lookOf('ink')));
  ch.signed.addEventListener('click', () => replay(ch.signed, ch.signSig, () => lookOf('ink')));
}
const sizeBook = () => { for (const ch of chapters) { sized(ch.first, ch.firstSig, 90); sized(ch.signed, ch.signSig, 90); paint(ch.first, ch.firstSig, lookOf('ink')); paint(ch.signed, ch.signSig, lookOf('ink')); } };
sizeBook();
const bookSeen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const ch = chapters.find((c) => c.first === e.target || c.signed === e.target); if (ch) replay(e.target as HTMLCanvasElement, e.target === ch.first ? ch.firstSig : ch.signSig, () => lookOf('ink')); bookSeen.unobserve(e.target); } }, { threshold: 0.5 });
for (const ch of chapters) { bookSeen.observe(ch.first); bookSeen.observe(ch.signed); }

// (the catalogue, newest session first)
const list = $('catalog'), cards: ReturnType<typeof card>[] = [];
for (const s of [...SESSIONS].reverse()) {
  const sec = document.createElement('section');
  sec.className = 'session';
  sec.innerHTML = `<h2><span>Session ${s.n}</span> ${esc(s.title)}</h2><p class="date">${esc(s.date)}</p><p>${esc(s.summary)}</p>
    <div class="decided"><b>Decided</b><ol>${s.decided.map((d) => `<li>${esc(d)}</li>`).join('')}</ol></div>`;
  list.append(sec);
  for (const e of CATALOG.filter((x) => x.session === s.n)) { const c = card(e); sec.append(c.el); cards.push(c); }
}
for (const c of cards) c.size();
// (each writes itself out as it comes into view, once)
const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { cards.find((c) => c.el === e.target)?.write(); seen.unobserve(e.target); } }, { threshold: 0.35 });
for (const c of cards) seen.observe(c.el);
addEventListener('resize', () => { sized(hero, heroSigs, q.has('preview') ? innerHeight * 0.8 : 260); paint(hero, heroSigs, heroLook()); for (const c of cards) c.size(); sizeBook(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { paint(hero, heroSigs, heroLook()); for (const c of cards) c.size(); });

// (the font: a specimen to type into, its size and its joins to try)
const spec = $('specimen') as HTMLTextAreaElement, size = $('specSize') as HTMLInputElement, joins = $('specJoins') as HTMLButtonElement;
const setSize = () => { spec.style.fontSize = `${size.value}px`; };
size.addEventListener('input', setSize); setSize();
joins.addEventListener('click', () => { const on = joins.getAttribute('aria-pressed') !== 'true'; joins.setAttribute('aria-pressed', String(on)); spec.classList.toggle('nocalt', !on); });

(window as unknown as { __autograph: unknown }).__autograph = { samples: CATALOG.length, sessions: SESSIONS.length };
