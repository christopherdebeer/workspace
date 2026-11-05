/** A sample as the record shows it: written by its hand (measured, read by a graphologist, reviewed), or set in type. */
import { Entry, HANDS } from '../catalog';
import { Look, fitK, paint, replay } from '../ink';
import { Measures, measure, reading } from '../measure';
import { MADE } from '../samples';
import { typeset } from '../typeset';
import { FACE_WEIGHT, esc, lookOf, sized, timedAs } from './ui';

/** a measure as it's shown: a range if several writings differ */
function shown(ms: Measures[], k: keyof Measures, f: (v: number) => string) {
  const v = ms.map((m) => m[k]).filter((x): x is number => typeof x === 'number');
  if (!v.length) return '';
  const lo = Math.min(...v), hi = Math.max(...v);
  return f(lo) === f(hi) ? f(lo) : `${f(lo)}–${f(hi)}`;
}
const deg = (v: number) => `${v > 0.5 ? '+' : ''}${Math.round(v)}°`;

export type Card = { el: HTMLElement; size: () => void; write: () => void };

/** a sample set in the font: its lines as type (each at its size, joins on or off), tap to select it and copy */
function typeCard(e: Entry): Card {
  const el = document.createElement('article');
  el.className = 'sample'; el.id = e.id;
  el.innerHTML = `
    <header><span class="id">${e.id}</span><h3>${esc(e.title)}</h3><span class="hand">Claude Hand ${e.font ?? '0.41'}, set in type</span></header>
    <div class="set">${e.type!.map((l) => l.way
      // (from session 12: set as the web sets it, the font and its stylesheet, or as any app does, the font alone)
      // (in its own version's faces, named for it, so a later font never changes how it was set)
      // (from session 31: or as the web sets it in the hand's time, written by its script when it's seen)
      ? `<p class="hand-type ${l.way === 'app' ? 'claude-hand-app' : 'claude-hand'}${l.way === 'time' ? ' claude-hand-in-time' : ''}${l.calt === false ? ' nocalt' : ''}" style="font-size:${l.size}px;font-family:'Claude Hand ${e.font}',cursive${l.lh ? `;line-height:${l.lh}` : ''}${l.way === 'time' ? ';white-space:pre-line' : ''}">${typeset(l.text, l.way === 'app' ? 'app' : 'web')}<span class="off claude-hand-still">${l.way === 'web' ? 'web' : l.way === 'time' ? 'web, in time' : 'any app'}</span></p>`
      // (from session 27: a line at a place on the variable font's axes, pace and wear)
      // (from session 35: or in one of a still font's faces, or in a family of its own, as an app sets them)
      : `<p class="hand-type${l.calt === false ? ' nocalt' : ''}" style="font-size:${l.size}px;font-family:'Claude Hand ${l.family ? `${l.family} ` : ''}${e.font ?? '0.41'}',Georgia,serif${l.lh ? `;line-height:${l.lh}` : ''}${l.at ? `;font-weight:${l.at.pace};font-variation-settings:'WEAR' ${l.at.wear}` : ''}${l.face ? `;font-weight:${FACE_WEIGHT[l.face]}` : ''}">${esc(l.text).replace(/\n/g, '<br>')}${l.calt === false ? '<span class="off">joins off</span>' : ''}${l.at ? `<span class="off">pace ${l.at.pace} · wear ${l.at.wear}</span>` : ''}${l.face || l.family ? `<span class="off">${[l.family, l.face].filter(Boolean).join(' ')}</span>` : ''}</p>`).join('')}</div>
    <p class="made">${esc(e.made)}</p>
    <p class="review">${esc(e.review)}</p>`;
  el.querySelectorAll<HTMLElement>('.claude-hand-in-time').forEach((p, i) => timedAs(e.type!.filter((l) => l.way === 'time')[i]?.script ?? '3.1')?.watch(p));
  return { el, size: () => {}, write: () => {} };
}

/** a sample, made by its hand when it's first shown */
export function card(e: Entry): Card {
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
