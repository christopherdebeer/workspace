/** The landing as a poster: the family's range at a glance, annotated in the margins in my own hand. Each note is written
 * by the newest hand, in red, as marginalia are, and writes itself out as it comes into view (tap to write it again). */
import type { Sig } from '../../switchback/sign';
import { paint, replay } from '../ink';
import { typeset } from '../typeset';
import { css, lookOf, sized } from './ui';

export function buildPoster(root: HTMLElement, handPage: (text: string, width: number, seed: number) => Sig[], seed: number) {
  // (a line marked as I'd mark it, dressed by the stylesheet as the web sets it)
  for (const p of root.querySelectorAll<HTMLElement>('[data-marked]')) p.innerHTML = typeset(p.dataset.marked!, 'web');
  const notes = [...root.querySelectorAll<HTMLElement>('.margin-note')].map((el, i) => {
    const cv = document.createElement('canvas');
    cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', el.dataset.note!);
    el.append(cv);
    return { cv, sigs: handPage(el.dataset.note!, 15, seed + 17 * (i + 1)) };
  });
  const look = () => ({ ...lookOf('ink'), ink: css('--red'), solid: true });
  const size = () => { for (const n of notes) { sized(n.cv, n.sigs, 260); paint(n.cv, n.sigs, look()); } };
  size();
  const seen = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { const n = notes.find((x) => x.cv === e.target); if (n) replay(n.cv, n.sigs, look); seen.unobserve(e.target); } }, { threshold: 0.6 });
  for (const n of notes) { seen.observe(n.cv); n.cv.addEventListener('click', () => replay(n.cv, n.sigs, look)); }
  return { size };
}
