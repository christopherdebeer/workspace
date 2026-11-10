/**
 * A drawer over the scene: closed (its grip and a line saying what's chosen), focused, or full, each the one before with
 * more below it, so the drawer is only ever clipped to a height. Lifted from FAB's bench (client/fab/main.ts), where it
 * was first made, with what that one lacked: the keyboard, Escape, remembering, and a height callback for the scene.
 *
 *   const d = drawer(el, { persist: 'splats-drawer', onHeight: (h) => shiftScene(h) });
 *   d.set('full'); d.state; d.height;
 *
 * **The DOM it expects:** `el` sits at the bottom of the page (position fixed or absolute), its first child the grip
 * (a button; give it a `.sum` child for the closed line). Its other children are its content, top to bottom; the first
 * with `data-tier="2"` is where the focused state stops (so tier 1 is what focus shows, tier 2 what full adds). No
 * tier 2, and focus is full.
 *
 * **The heights are measured, not configured:** closed, to the foot of the grip; focus, to where tier 2 starts; full,
 * all of it, capped at `cap` of the window's height (it scrolls only then). Measured again whenever the window or the
 * content changes size.
 *
 * **The hand:** the grip drags the height as a preview, following the finger, giving a little past either end; let go
 * and it settles where it was heading (past a quarter of the way to the next state it goes there; a flick goes one
 * further). A tap steps closed → focus → full → focus.
 *
 * **The keyboard:** on the grip, ↑ opens a step and ↓ closes one, Enter or Space step as a tap does; Escape anywhere in
 * the drawer closes it a step (once whatever inside it has had its turn: an input clears first, say).
 *
 * **The scene:** the drawer lies over the scene and never resizes it. Its height is published as the CSS variable
 * `--drawer` on the page's root (for what floats just above it), and given to `onHeight`, so a scene can lift its
 * subject clear of it (`lift(h)` below gives the share to shift a projection by).
 */
import { ensureStyle } from './style';

export type DrawerState = 'closed' | 'focus' | 'full';
const ORDER: DrawerState[] = ['closed', 'focus', 'full'];
export interface Drawer { readonly el: HTMLElement; readonly state: DrawerState; readonly height: number; set(s: DrawerState): void; step(d: 1 | -1): void; measure(): void }
export interface DrawerOptions {
  /** where it starts, if nothing's remembered (default 'focus') */
  start?: DrawerState;
  /** a localStorage key to remember its state under (none: not remembered) */
  persist?: string;
  /** the most of the window's height it may take (default 0.82) */
  cap?: number;
  /** told its height, as it changes (each frame of a drag, and when it settles) */
  onHeight?: (h: number) => void;
  /** told its state when it settles */
  onState?: (s: DrawerState) => void;
}

export function drawer(el: HTMLElement, o: DrawerOptions = {}): Drawer {
  ensureStyle();
  el.classList.add('dw-drawer');
  const grip = el.firstElementChild as HTMLElement;
  grip.classList.add('dw-grip');
  if (!grip.hasAttribute('aria-label')) grip.setAttribute('aria-label', 'the drawer: tap or press ↑ and ↓ to open and close it');
  const cap = o.cap ?? 0.82;
  const remembered = (() => { try { return o.persist ? (localStorage.getItem(o.persist) as DrawerState | null) : null; } catch { return null; } })();
  let state: DrawerState = remembered && ORDER.includes(remembered) ? remembered : o.start ?? 'focus', held = false, height = 0;

  const heights = (): Record<DrawerState, number> => {
    const pad = parseFloat(getComputedStyle(el).paddingBottom) || 10;
    const kids = (Array.from(el.children) as HTMLElement[]).filter((k) => k !== grip && k.offsetParent !== null && !k.hidden);
    const closed = grip.offsetTop + grip.offsetHeight + pad;
    const end = kids.length ? Math.max(...kids.map((k) => k.offsetTop + k.offsetHeight)) + pad : closed;
    const t2 = kids.find((k) => k.dataset.tier === '2');
    const full = Math.min(end, innerHeight * cap);
    const focus = t2 ? t2.offsetTop + Math.min(pad, 6) : end;
    return { closed, focus: Math.max(closed, Math.min(focus, full)), full: Math.max(closed, full) };
  };
  const publish = (h: number) => { height = h; document.documentElement.style.setProperty('--drawer', `${Math.round(h)}px`); o.onHeight?.(h); };
  const layout = () => {
    if (held) return;
    // (the state first: what shows in it (the closed line, say) is part of its height)
    el.dataset.drawer = state; document.documentElement.dataset.drawer = state;
    const h = heights()[state];
    el.style.height = `${h}px`;
    if (state !== 'full') el.scrollTop = 0;
    grip.setAttribute('aria-expanded', String(state !== 'closed'));
    publish(h);
  };
  const set = (s: DrawerState) => {
    state = s; layout(); o.onState?.(s);
    try { if (o.persist) localStorage.setItem(o.persist, s); } catch { /* not kept */ }
  };
  const step = (d: 1 | -1) => set(ORDER[Math.max(0, Math.min(2, ORDER.indexOf(state) + d))]);
  const tap = () => set(state === 'closed' ? 'focus' : state === 'focus' ? 'full' : 'focus');

  // ─── the hand ───
  let y0 = 0, h0 = 0, lastY = 0, lastT = 0, v = 0, moved = false, H = heights();
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId); H = heights();
    y0 = lastY = e.clientY; lastT = performance.now(); v = 0; moved = false; h0 = el.getBoundingClientRect().height;
    held = true; el.classList.add('held'); el.scrollTop = 0;
  });
  grip.addEventListener('pointermove', (e) => {
    if (!grip.hasPointerCapture(e.pointerId)) return;
    if (Math.abs(e.clientY - y0) > 6) moved = true;
    const t = performance.now(); v = v * 0.6 + (-(e.clientY - lastY) / Math.max(1, t - lastT)) * 0.4; lastY = e.clientY; lastT = t;
    let h = h0 - (e.clientY - y0);
    if (h > H.full) h = H.full + (h - H.full) * 0.25;
    if (h < H.closed) h = H.closed - (H.closed - h) * 0.25;
    el.style.height = `${h}px`; publish(h);
  });
  const up = () => {
    if (!held) return;
    held = false; el.classList.remove('held');
    if (!moved) { tap(); return; }
    const hs = ORDER.map((s) => H[s]), h = el.getBoundingClientRect().height, i0 = ORDER.indexOf(state);
    let i = i0;
    if (h >= hs[i0]) { while (i < 2 && h > hs[i] + (hs[i + 1] - hs[i]) * 0.25) i++; if (v > 0.35 && i < 2 && i === i0) i++; }
    else { while (i > 0 && h < hs[i] - (hs[i] - hs[i - 1]) * 0.25) i--; if (v < -0.35 && i > 0 && i === i0) i--; }
    set(ORDER[i]);
  };
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
  // (a pointer tap is handled above; a click with no pointer before it is the keyboard's, or assistive tech's)
  let pointerSeen = false;
  grip.addEventListener('pointerdown', () => { pointerSeen = true; });
  grip.addEventListener('click', (e) => { if (pointerSeen) { pointerSeen = false; return; } e.preventDefault(); tap(); });

  // ─── the keyboard ───
  grip.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && state !== 'closed') { e.preventDefault(); step(-1); grip.focus(); } });

  // ─── measured again when the window or the content changes ───
  addEventListener('resize', layout);
  new ResizeObserver(() => { if (!held) layout(); }).observe(el);
  const mo = new MutationObserver(() => requestAnimationFrame(layout));
  mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'open', 'class'] });
  layout();
  return { el, get state() { return state; }, get height() { return height; }, set, step, measure: layout };
}

/**
 * How far to lift a scene's subject clear of the drawer: the drawer's share of the canvas, held to at most `most` (so
 * a full drawer doesn't push the subject off the top). Shift a perspective projection's centre by it (in a column-major
 * 4×4, `proj[9] = -lift * k` moves the image up; see splats/main.ts), easing toward it each frame.
 */
export function lift(drawerHeight: number, canvasHeight: number, most = 0.6): number {
  return Math.min(most * canvasHeight, drawerHeight) / Math.max(1, canvasHeight);
}
