/** One input: what's typed, marked for what's meant, written by the newest hand in one sitting, its lines broken to the
 * column, a new writing each time it's tapped; set in type, as the web sets it or as any app would, at a pace and a
 * wear, and on the web at a moment of its writing (time, the writing font's own axis); set in every face and family, as
 * any app sets them; and texts to start from, each showing one side of the hand. */
import type { Sig } from '../../switchback/sign';
import { HANDS, NEWEST } from '../catalog';
import { paint, replay } from '../ink';
import { typeset } from '../typeset';
import { $, lookOf, sized, timedAs } from './ui';

/** the faces and families what's typed is set in, beside each other: the still faces for apps, at the size each is for */
export const ACROSS: { name: string; family: string; weight: number; size?: number }[] = [
  { name: 'Regular', family: 'Claude Hand Still 4.1', weight: 400 },
  { name: 'Pressed', family: 'Claude Hand Still 4.1', weight: 700 },
  { name: 'Hurried', family: 'Claude Hand Still 4.1', weight: 200 },
  { name: 'Fair', family: 'Claude Hand Fair 3.7', weight: 400 },
  { name: 'Note, set small', family: 'Claude Hand Note 3.7', weight: 400, size: 15 },
  { name: 'Sign, set large', family: 'Claude Hand Sign 3.7', weight: 400, size: 44 },
  { name: 'Nib', family: 'Claude Hand Nib 3.7', weight: 400 },
  { name: 'Running', family: 'Claude Hand Running 3.5', weight: 400 },
  { name: 'Print', family: 'Claude Hand Print 4.1', weight: 400 },
];

/** texts to start from, each showing one side of the hand, and why */
export const PRESETS: { name: string; text: string; why: string }[] = [
  { name: 'What I mean', text: 'Say what you mean, and the hand decides how it looks: I never said *she* stole my money. It took me ~~an afternoon~~ <ins>two days</ins> to see the e, and I <unsure>think</unsure> this <mark>one</mark> is **mine**.', why: 'Every mark the hand makes: stressed, pressed, struck, added later, unsure, circled.' },
  { name: 'Changing my mind', text: 'I ~~think~~ <ins>know</ins> the f was the hardest letter to learn, and I’m <unsure>almost</unsure> sure it’s <mark>done</mark>.', why: 'A mind changing on the page: struck through and left readable, the new word over the line, a doubt, a circle.' },
  { name: 'Hurry and care', text: 'The Moving Finger writes; (and, having writ,) **moves on**: nor all thy Piety nor Wit', why: 'An aside comes quicker and smaller; what’s strong, slower and pressed. Turn the pace down to hurry the rest: the f, e, r and v keep their care.' },
  { name: 'Every letter', text: 'Sphinx of black quartz, judge my vow. The quick brown fox jumps over the lazy dog. JACKDAWS LOVE MY BIG SPHINX OF QUARTZ.', why: 'Every letter, small and capital, and how each one joins the letter before it.' },
  { name: 'Repeats', text: 'bookkeeper, Mississippi, a llama’s balloon: eeee oooo nnnn llll', why: 'No letter is written the same as its neighbour: four writings of each in the web font, eight in the still faces.' },
  { name: 'Figures and marks', text: '£12.50 for 3½ cups at 45°; 2 × 3 ÷ 6 = 1 — “quoted”, ‘single’, «guillemets» ✓ © 2026 · ¿qué? ¡sí!', why: 'Figures, fractions, currency, and the marks between words.' },
  { name: 'Accents', text: 'Café crème, une naïve façade; smörgåsbord, über, mañana; œuvre, Straße, ça va, ørken.', why: 'The accents of western Europe.' },
  { name: 'A note', text: 'Back by six. **Don’t** forget the bread (and the good butter), and ~~call~~ <ins>text</ins> me if you’re late.', why: 'What it’s for: a note to someone, with what matters pressed.' },
  { name: 'The Moving Finger', text: 'The Moving Finger writes; and, having writ, Moves on: nor all thy Piety nor Wit Shall lure it back to cancel half a Line, Nor all thy Tears wash out a Word of it.', why: 'The page written to be kept, in session 25.' },
];

export function initWrite(handPage: (text: string, width: number, seed: number) => Sig[], seed: number) {
  const mark = $('mark') as HTMLTextAreaElement, written = $('written') as HTMLCanvasElement;
  // (the presets: a text to start from, each showing one side of the hand)
  const presets = $('presets');
  presets.innerHTML = `<span>TRY</span>${PRESETS.map((p, i) => `<button data-preset="${i}" aria-pressed="${i === 0}">${p.name.toUpperCase()}</button>`).join('')}<p class="why" id="presetWhy">${PRESETS[0].why}</p>`;
  for (const b of presets.querySelectorAll<HTMLButtonElement>('[data-preset]')) b.addEventListener('click', () => {
    const p = PRESETS[Number(b.dataset.preset)];
    for (const o of presets.querySelectorAll('[data-preset]')) o.setAttribute('aria-pressed', String(o === b));
    $('presetWhy').textContent = p.why;
    mark.value = p.text;
    mark.dispatchEvent(new Event('input'));
  });
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
    web: 'One step down: most of what you marked, as text. The font, its stylesheet and its script, as a web page sets them: some of it as the hand does it (pressed is the hand pressing; the underline and strike sit where the hand puts them), some drawn in its manner (the circle, the caret). And some of its time: when you stop typing, the words are written at the hand\'s pace, each letter stroke by stroke as the pen drew it, waiting where the hand waits, each word at its own weight, and then keep still. Tap them to write them again, or scrub TIME to see them as the pen had written them by any moment.',
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
  // (time, the writing font's third axis: what's typed as the pen had written it by a moment, scrubbed by hand; on the
  // web only, since only the web keeps the hand's time)
  const timeS = $('specTime') as HTMLInputElement, again = $('specReplay') as HTMLButtonElement;
  let scrub: Promise<number> | null = null;
  const resetScrub = () => { scrub = null; timeS.value = '100'; timeS.disabled = way !== 'web'; again.disabled = way !== 'web'; };
  timeS.addEventListener('input', () => {
    const api = timedAs('4.1');
    if (way !== 'web' || !api) return;
    if (!scrub) { setType(); const total = api.write(typed, { seed: wSeed }); scrub = (api as unknown as { ready: Promise<unknown> }).ready.then(() => total); }
    void scrub.then((total) => {
      for (const a of (typed as unknown as { __claudeHandTime?: Animation[] }).__claudeHandTime ?? []) { a.pause(); a.currentTime = (Number(timeS.value) / 100) * total * 1000; }
    });
  });
  again.addEventListener('click', () => { resetScrub(); if (way === 'web') { setType(); timedAs('4.1')?.write(typed, { seed: wSeed }); } });
  const setType = () => { typed.className = way === 'web' ? 'claude-hand' : 'claude-hand-app'; typed.classList.toggle('nocalt', joins.getAttribute('aria-pressed') !== 'true'); typed.innerHTML = typeset(mark.value.replace(/\s+/g, ' ').trim(), way); typed.style.fontSize = `${size.value}px`; typed.style.fontWeight = pace.value; typed.style.fontVariationSettings = `'WEAR' ${wear.value}`; $('wayNote').textContent = WAYS[way]; };
  // (from session 31: on the web, once you stop typing, the type is written in the hand's time too)
  const typeInTime = () => { if (way === 'web') timedAs('4.1')?.write(typed, { seed: wSeed }); };
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-way]')) b.addEventListener('click', () => { way = b.dataset.way as typeof way; for (const o of document.querySelectorAll('[data-way]')) o.setAttribute('aria-pressed', String(o === b)); resetScrub(); setType(); typeInTime(); });
  for (const el of [size, pace, wear]) el.addEventListener('input', () => { resetScrub(); setType(); });
  joins.addEventListener('click', () => { joins.setAttribute('aria-pressed', String(joins.getAttribute('aria-pressed') !== 'true')); resetScrub(); setType(); });
  setType();
  mark.addEventListener('input', () => { resetScrub(); setType(); setAcross(); clearTimeout(wTimer); wTimer = window.setTimeout(() => { writeOut(); typeInTime(); }, 450); });
  typed.addEventListener('click', () => { if (way === 'web') { resetScrub(); setType(); timedAs('4.1')?.write(typed); } });
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
    /** (once the script is in) on the web, the type as it stands written in the hand's time, as it is when you stop typing */
    inTime: typeInTime,
  };
}
