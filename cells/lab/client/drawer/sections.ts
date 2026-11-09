/**
 * Sections in a drawer: `<details>` that open one at a time, each saying in a line what it's set to while it's shut,
 * the open one remembered; and a focus mode, from the home cell's tuner: tap a control's name and the drawer narrows to
 * that one control, so the scene clears while you dial it; tap the name again (or Escape) and it's all back.
 *
 *   const s = sections(root, { persist: 'splats-section', summaries: () => ({ drawing: `${look} · ${detail}%` }) });
 *   s.refresh();   // (the summaries again, after a change)
 *
 * **The DOM it expects:** inside `root`, `details.dw-sec[data-key]`, each `summary` holding `.t` (its name) and `.s`
 * (its summary line, filled from `summaries()[key]`); `details.dw-sub` nests inside a section, independently. A section
 * that doesn't apply to what's shown is `hidden`: if the open one is hidden, the first shown opens instead. For focus,
 * a control's container gets `data-focus` (its name, a `<label>` or `.lab`, is what's tapped).
 */
import { ensureStyle } from './style';

export interface Sections { refresh(): void; open(key: string): void; readonly focused: HTMLElement | null }
export interface SectionsOptions {
  /** a localStorage key for the open section */
  persist?: string;
  /** each section's line while it's shut, by key */
  summaries?: () => Record<string, string>;
}

export function sections(root: HTMLElement, o: SectionsOptions = {}): Sections {
  ensureStyle();
  const secs = () => Array.from(root.querySelectorAll<HTMLDetailsElement>('details.dw-sec'));
  // (the section you last opened, remembered; one opened for you (none of yours showing) isn't remembered, and is
  // reconsidered whenever what's shown changes: yours if it's shown again, else the first)
  let openKey: string | null = (() => { try { return o.persist ? localStorage.getItem(o.persist) : null; } catch { return null; } })(), auto: HTMLDetailsElement | null = null;
  for (const d of root.querySelectorAll<HTMLDetailsElement>('details.dw-sec')) d.addEventListener('toggle', () => {
    if (!d.open) return;
    for (const x of secs()) if (x !== d && x.open) x.open = false;
    // (one opened for you: marked, since a toggle's event comes a task later)
    if (d.dataset.dwAuto) { delete d.dataset.dwAuto; return; }
    auto = null; openKey = d.dataset.key ?? null;
    try { if (o.persist && openKey) localStorage.setItem(o.persist, openKey); } catch { /* not kept */ }
  });
  // (the others shut at once, so a toggle still queued for one of them finds it shut and does nothing)
  const openFor = (d: HTMLDetailsElement) => { for (const x of secs()) if (x !== d) x.open = false; d.dataset.dwAuto = '1'; d.open = true; auto = d; };
  const refresh = () => {
    const shown = secs().filter((d) => !d.hidden), cur = shown.find((d) => d.open), want = shown.find((x) => x.dataset.key === openKey) ?? shown[0];
    if (want && (!cur || (cur === auto && cur !== want))) openFor(want);
    const sum = o.summaries?.() ?? {};
    for (const d of secs()) { const s = d.querySelector(':scope > summary .s'), t = sum[d.dataset.key ?? '']; if (s && t !== undefined && s.textContent !== t) s.textContent = t; }
  };
  // ─── focus: one control alone ───
  let focused: HTMLElement | null = null;
  const unfocus = () => { if (!focused) return; focused.classList.remove('dw-focused'); root.classList.remove('dw-focusing'); focused = null; };
  root.addEventListener('click', (e) => {
    const name = (e.target as HTMLElement).closest('label, .lab, .dw-name'), box = name?.closest<HTMLElement>('[data-focus]');
    if (!box || !root.contains(box)) return;
    // (a tap on the slider or buttons themselves isn't a tap on the name)
    if ((e.target as HTMLElement).closest('input, button, select')) return;
    e.preventDefault();
    if (focused === box) { unfocus(); return; }
    unfocus(); focused = box; box.classList.add('dw-focused'); root.classList.add('dw-focusing');
  });
  // (Escape leaves focus first: caught on the way down, before the drawer's own Escape (closing a step) sees it)
  // (from anywhere: tapping a name leaves the keyboard's focus on the page, not in the drawer)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && focused) { e.preventDefault(); unfocus(); } }, true);
  refresh();
  return { refresh, open: (k) => { const d = secs().find((x) => x.dataset.key === k); if (d) d.open = true; }, get focused() { return focused; } };
}
