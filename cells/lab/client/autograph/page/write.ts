/** One input: what's typed, marked for what's meant, written by the newest hand in one sitting, its lines broken to the
 * column, a new writing each time it's tapped; set in type, as the web sets it or as any app would, at a pace and a
 * wear; and (from the page's re-ordering after session 38) set in every face and family, as any app sets them. */
import type { Sig } from '../../switchback/sign';
import { HANDS, NEWEST } from '../catalog';
import { paint, replay } from '../ink';
import { typeset } from '../typeset';
import { $, lookOf, sized, timedAs } from './ui';

/** the faces and families what's typed is set in, beside each other: the still faces for apps, at the size each is for */
export const ACROSS: { name: string; family: string; weight: number; size?: number }[] = [
  { name: 'Regular', family: 'Claude Hand Still 3.8', weight: 400 },
  { name: 'Pressed', family: 'Claude Hand Still 3.8', weight: 700 },
  { name: 'Hurried', family: 'Claude Hand Still 3.8', weight: 200 },
  { name: 'Fair', family: 'Claude Hand Fair 3.7', weight: 400 },
  { name: 'Note, set small', family: 'Claude Hand Note 3.7', weight: 400, size: 15 },
  { name: 'Sign, set large', family: 'Claude Hand Sign 3.7', weight: 400, size: 44 },
  { name: 'Nib', family: 'Claude Hand Nib 3.7', weight: 400 },
  { name: 'Running', family: 'Claude Hand Running 3.5', weight: 400 },
];

export function initWrite(handPage: (text: string, width: number, seed: number) => Sig[], seed: number) {
  const mark = $('mark') as HTMLTextAreaElement, written = $('written') as HTMLCanvasElement;
  let wSeed = seed, wSigs: Sig[] = [], wWidth = 0, wTimer = 0;
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
    web: 'One step down: most of what you marked, as text. The font, its stylesheet and its script, as a web page sets them: some of it as the hand does it (pressed is the hand pressing; the underline and strike sit where the hand puts them), some drawn in its manner (the circle, the caret). And some of its time: when you stop typing, the words are written at the hand\'s pace, each letter stroke by stroke as the pen drew it, waiting where the hand waits, each word at its own weight, and then keep still. Tap them to write them again.',
    app: 'Two steps down: bold, underline and strike, as text. The font alone, as any app sets it: bold is the Pressed face, and the strike sits where the hand strikes. The font has no italic, so the app fakes one by slanting it further; everything else you mark is lost, and only its words are left.',
  };
  // (every face and family at once, as any app sets them: built only when it's opened, so its fonts load only then)
  const across = $('across') as HTMLDetailsElement, rows = $('acrossRows');
  const setAcross = () => {
    if (!across.open) return;
    const html = typeset(mark.value.replace(/\s+/g, ' ').trim(), 'app');
    rows.innerHTML = ACROSS.map((f) => `<div class="face-row"><span class="label">${f.name}</span><p class="hand-type claude-hand-app" style="font-family:'${f.family}',cursive;font-weight:${f.weight};font-size:${f.size ?? 24}px">${html}</p></div>`).join('');
  };
  across.addEventListener('toggle', setAcross);
  const setType = () => { typed.className = way === 'web' ? 'claude-hand' : 'claude-hand-app'; typed.classList.toggle('nocalt', joins.getAttribute('aria-pressed') !== 'true'); typed.innerHTML = typeset(mark.value.replace(/\s+/g, ' ').trim(), way); typed.style.fontSize = `${size.value}px`; typed.style.fontWeight = pace.value; typed.style.fontVariationSettings = `'WEAR' ${wear.value}`; $('wayNote').textContent = WAYS[way]; };
  // (from session 31: on the web, once you stop typing, the type is written in the hand's time too)
  const typeInTime = () => { if (way === 'web') timedAs('3.8')?.write(typed, { seed: wSeed }); };
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-way]')) b.addEventListener('click', () => { way = b.dataset.way as typeof way; for (const o of document.querySelectorAll('[data-way]')) o.setAttribute('aria-pressed', String(o === b)); setType(); typeInTime(); });
  size.addEventListener('input', setType);
  pace.addEventListener('input', setType);
  wear.addEventListener('input', setType);
  joins.addEventListener('click', () => { joins.setAttribute('aria-pressed', String(joins.getAttribute('aria-pressed') !== 'true')); setType(); });
  setType();
  mark.addEventListener('input', () => { setType(); setAcross(); clearTimeout(wTimer); wTimer = window.setTimeout(() => { writeOut(); typeInTime(); }, 450); });
  typed.addEventListener('click', () => { if (way === 'web') { setType(); timedAs('3.8')?.write(typed); } });
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
  // (written as it's seen; drawn at once, still, so the box is never empty if it's seen before the browser says so)
  const writtenSeen = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { writeOut(); writtenSeen.disconnect(); } }, { threshold: 0.2 });
  writtenSeen.observe(written);
  writeOut(false);
  return {
    resize: () => { if (wSigs.length) { if (lineWidth() !== wWidth) writeOut(false); else { sized(written, wSigs, 560); paint(written, wSigs, wLook()); } } },
    repaint: () => { if (wSigs.length) paint(written, wSigs, wLook()); },
    state: () => ({ lines: wSigs.length, width: wWidth, seed: wSeed }),
    typed: () => typed.innerHTML,
  };
}
