/** The landing as a poster (from session 53): a typographic sheet of the family's range, written as a score as it's read.
 * Its plates each show one thing the hand does, numbered, titled in my own words, with a note in my hand in red. Each
 * plate plays when it comes into view: its steps in order, each waiting for the last, as the markup says (`data-step` is
 * a step's place, `data-do` what it does, `data-wait` how long it waits first, in seconds, and `data-hold` how long the
 * next waits for it, if not until it's done):
 *
 * - `type`: set in Claude Hand on the web, written in time by the font's script (5.7), its marks after their words;
 * - `hand`: a note written by the newest hand, in red, as marginalia are (`data-note`);
 * - `show`: brought up, set in a still face;
 * - `nums`: the circled numbers over the marked words of a line, one by one, and their legend.
 *
 * A line marked as I'd mark it (`data-marked`) is dressed by the stylesheet as the web sets it, and its marked words get
 * numbers, in order, matching the legend. With reduced motion asked for, everything is simply there. The writing font
 * the script writes with is loaded only when the first plate written in time is about to play. */
import type { Sig } from '../../switchback/sign';
import { paint, replay } from '../ink';
import { typeset } from '../typeset';
import { css, lookOf, sized, timedAs } from './ui';

const NUMS = '①②③④⑤⑥⑦⑧⑨';
/** what a marked line's numbers go over, in the order they come in the line: a strike, an addition, a pressed word, a doubt,
 * a circle, care */
const MARKED = 'del, s, ins, strong, b, unsure, mark, care';
const sleep = (s: number) => new Promise<void>((done) => setTimeout(done, s * 1000));

export function buildPoster(root: HTMLElement, handPage: (text: string, width: number, seed: number) => Sig[], seed: number, needTime: () => Promise<void>) {
  // (a line marked as I'd mark it, dressed by the stylesheet as the web sets it, and a number over each marked word,
  // kept out of the script's writing: it comes after, with the legend)
  const nums: HTMLElement[] = [];
  for (const p of root.querySelectorAll<HTMLElement>('[data-marked]')) {
    p.innerHTML = typeset(p.dataset.marked!, 'web');
    p.querySelectorAll<HTMLElement>(MARKED).forEach((el, i) => {
      const n = document.createElement('span');
      n.className = 'pnum claude-hand-still'; n.textContent = NUMS[i] ?? ''; n.setAttribute('aria-hidden', 'true');
      el.append(n); nums.push(n);
    });
  }
  // (the notes in my hand, in red)
  const notes = [...root.querySelectorAll<HTMLElement>('.margin-note')].map((el, i) => {
    const cv = document.createElement('canvas');
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', el.dataset.note!);
    el.append(cv);
    return { el, cv, sigs: handPage(el.dataset.note!, 15, seed + 17 * (i + 1)), played: false };
  });
  const look = () => ({ ...lookOf('ink'), ink: css('--red'), solid: true });
  const size = () => { for (const n of notes) { sized(n.cv, n.sigs, 260); paint(n.cv, n.sigs, n.played || !scored ? look() : { ...look(), upTo: 0 }); } };
  for (const n of notes) n.cv.addEventListener('click', () => replay(n.cv, n.sigs, look));

  // (the score: with reduced motion asked for there's none, and everything is there)
  const scored = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (scored) root.classList.add('scored');
  size();
  const typed = [...root.querySelectorAll<HTMLElement>('[data-do="type"]')];
  if (scored) for (const el of typed) el.style.visibility = 'hidden';

  let n = 0;
  const play = async (plate: HTMLElement) => {
    const steps = [...plate.querySelectorAll<HTMLElement>('[data-step]')].sort((a, b) => Number(a.dataset.step) - Number(b.dataset.step));
    for (const el of steps) {
      await sleep(Number(el.dataset.wait ?? 0.25));
      const kind = el.dataset.do;
      if (kind === 'show') { el.classList.add('on'); await sleep(0.35); }
      else if (kind === 'hand') {
        const note = notes.find((x) => x.el === el);
        if (note) { note.played = true; await new Promise<void>((done) => replay(note.cv, note.sigs, look, done)); }
      } else if (kind === 'type') {
        await needTime();
        const time = timedAs('5.7');
        const took = time ? time.write(el, { seed: seed + 101 * ++n }) : 0;
        el.style.visibility = '';
        // (the next step waits for the writing, or as long as data-hold says, if that's less: a long line needn't keep its note)
        await sleep(Math.min(took, Number(el.dataset.hold ?? Infinity)));
      } else if (kind === 'nums') {
        for (const x of nums) { x.classList.add('on'); await sleep(0.28); }
        el.classList.add('on');
      }
    }
  };
  if (scored) {
    // (each plate once, when it comes into view; the writing font asked for a little before the first that needs it)
    const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { seen.unobserve(e.target); void play(e.target as HTMLElement); } }, { threshold: 0.3 });
    const near = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { near.disconnect(); void needTime(); } }, { rootMargin: '400px' });
    for (const plate of root.querySelectorAll<HTMLElement>('.plate')) seen.observe(plate);
    if (typed[0]) near.observe(typed[0]);
  }
  return { size };
}
