/**
 * Roof Jumps' palette: the dials (tune.ts) as a panel: a row of groups, the one touched open under it with its
 * sliders and switches, a mark on each slider where the house keeps it (a double tap on a name puts it back).
 */
import { DIALS, HOUSE, TUNE } from './tune';
import type { Dial } from './tune';

const shown = (d: Dial, v: number) => `${Number(v.toFixed(2))}${d.unit ? ' ' + d.unit : ''}`;

export function palette(el: HTMLElement, changed: (key: string) => void) {
  const groups = [...new Set(DIALS.map((d) => d.group))];
  const row = document.createElement('div'); row.className = 'row'; row.setAttribute('role', 'tablist');
  const tray = document.createElement('div'); tray.className = 'tray'; tray.setAttribute('role', 'tabpanel');
  el.replaceChildren(row, tray);
  let open = groups[0];
  const tabs = new Map<string, HTMLButtonElement>();
  for (const g of groups) {
    const b = document.createElement('button'); b.textContent = g; b.setAttribute('role', 'tab');
    b.addEventListener('click', () => show(g));
    row.append(b); tabs.set(g, b);
  }
  const reset = document.createElement('button'); reset.textContent = 'house'; reset.className = 'reset'; reset.title = 'every dial back where the house keeps it';
  reset.addEventListener('click', () => { for (const d of DIALS) if (TUNE[d.key] !== d.house) { TUNE[d.key] = d.house; changed(d.key); } show(open); });
  row.append(reset);
  function show(g: string) {
    open = g;
    for (const [k, b] of tabs) { b.classList.toggle('on', k === g); b.setAttribute('aria-selected', String(k === g)); b.classList.toggle('moved', DIALS.some((d) => d.group === k && TUNE[d.key] !== d.house)); }
    tray.replaceChildren(...DIALS.filter((d) => d.group === g).map(dial));
  }
  function dial(d: Dial): HTMLElement {
    const w = document.createElement('label'); w.className = d.toggle ? 'dial switch' : 'dial';
    const name = document.createElement('span'); name.textContent = d.name;
    const input = document.createElement('input'), out = document.createElement('output');
    if (d.toggle) {
      input.type = 'checkbox'; input.checked = !!TUNE[d.key];
      input.addEventListener('change', () => { TUNE[d.key] = input.checked ? 1 : 0; changed(d.key); show(open); });
      w.append(input, name);
      return w;
    }
    input.type = 'range'; input.min = String(d.min); input.max = String(d.max); input.step = String(d.step); input.setAttribute('aria-label', d.name);
    const put = (v: number) => { input.value = String(v); out.textContent = shown(d, v); w.classList.toggle('moved', v !== d.house); };
    put(TUNE[d.key]);
    input.addEventListener('input', () => { TUNE[d.key] = Number(input.value); put(TUNE[d.key]); changed(d.key); tabs.get(d.group)!.classList.toggle('moved', DIALS.some((x) => x.group === d.group && TUNE[x.key] !== x.house)); });
    name.addEventListener('dblclick', (e) => { e.preventDefault(); TUNE[d.key] = HOUSE[d.key]; put(TUNE[d.key]); changed(d.key); });
    const track = document.createElement('div'); track.className = 'track';
    const mark = document.createElement('em'); mark.style.left = `${((d.house - d.min) / (d.max - d.min)) * 100}%`;
    track.append(input, mark);
    w.append(name, track, out);
    return w;
  }
  show(open);
  return { refresh: () => show(open) };
}
