/** The book: In My Own Hand, each chapter's first page written by the hand of its day, the rest set in its font, signed. */
import type { Sig } from '../../switchback/sign';
import { BOOK, firstLine } from '../autobiography';
import { paint, replay } from '../ink';
import { write as v4write } from '../hands/v4';
// (a chapter is signed as it was on the day it was written: chapter one by the hand of its day)
import { signature as chapterSign } from '../hands/v3';
// (from chapter two, a chapter opens with a page written by the hand of its day, and is signed by it: chapter two's is v15)
import { signature as sign15, page as page15 } from '../hands/v15';
import { esc, lookOf, sized } from './ui';

type Built = { first: HTMLCanvasElement; firstSig: Sig[]; signed: HTMLCanvasElement; signSig: Sig[]; page: boolean };
/** how a chapter's handwriting is drawn: a page's lines as one page, solid, not as writings laid over each other */
const bookLook = (page: boolean) => ({ ...lookOf('ink'), solid: page });

function chapter(c: (typeof BOOK.chapters)[number], into: Built[]) {
  const el = document.createElement('article');
  el.className = 'chapter'; el.id = `chapter-${c.n}`;
  const first = firstLine(c);
  el.innerHTML = `<h3><span>${esc(BOOK.title)} · chapter ${c.n} · ${esc(c.covers)} · written in session ${c.session}, ${esc(c.date)}</span>${esc(c.title)}</h3>
    <canvas class="first${c.opens ? ' page' : ''}" aria-label="${esc(first)} (written by the hand)"></canvas>
    <div class="hand-type text" style="font-family:'Claude Hand ${c.font}',Georgia,serif">${c.text.map((p, i) => (i ? `<p>${esc(p)}</p>` : c.opens ? '' : `<p>${esc(p.slice(first.length).trim())}</p>`)).join('')}</div>
    <canvas class="signed" aria-label="Signed: Claude"></canvas>
    <p class="whole"><a href="#session-${c.session}">Written in session ${c.session} ↗</a></p>`;
  // (chapter one: its first line by v4, signed by v3; from chapter two, its first paragraph as a page by its hand, signed by it)
  const page = !!c.opens;
  const ch: Built = {
    first: el.querySelector('canvas.first') as HTMLCanvasElement, firstSig: c.opens ? page15(first, c.opens.page, c.seed) : [v4write(first, c.seed)],
    signed: el.querySelector('canvas.signed') as HTMLCanvasElement, signSig: [c.opens ? sign15(c.n) : chapterSign(c.n)], page,
  };
  into.push(ch);
  ch.first.addEventListener('click', () => replay(ch.first, ch.firstSig, () => bookLook(page)));
  ch.signed.addEventListener('click', () => replay(ch.signed, ch.signSig, () => lookOf('ink')));
  return el;
}

/** the book's contents, its chapters, each written out as it comes into view; built once, when the book is first opened */
export function buildBook(toc: HTMLElement, into: HTMLElement) {
  const built: Built[] = [];
  toc.innerHTML = BOOK.chapters.map((c) => `<li><a href="#chapter-${c.n}">Chapter ${c.n}, <i>${esc(c.title)}</i> (${esc(c.covers)}), written in session ${c.session}</a></li>`).join('');
  for (const c of BOOK.chapters) into.append(chapter(c, built));
  const size = () => { for (const ch of built) { sized(ch.first, ch.firstSig, ch.page ? 1200 : 90); sized(ch.signed, ch.signSig, 90); paint(ch.first, ch.firstSig, bookLook(ch.page)); paint(ch.signed, ch.signSig, lookOf('ink')); } };
  size();
  const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const ch = built.find((c) => c.first === e.target || c.signed === e.target); if (ch) replay(e.target as HTMLCanvasElement, e.target === ch.first ? ch.firstSig : ch.signSig, () => (e.target === ch.first ? bookLook(ch.page) : lookOf('ink'))); seen.unobserve(e.target); } }, { threshold: 0.5 });
  for (const ch of built) { seen.observe(ch.first); seen.observe(ch.signed); }
  return { size };
}
