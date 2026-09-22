/**
 * THE DECK — the HUD's layout tabs, and the controls a layout owns.
 *
 * It replaced the CONTROL MATRIX (six canvas cells beside the minimap) and the
 * chart's two edge rails. The first cut made the tabs a launcher — some moved
 * the camera, some opened sheets of settings, one opened the menu — and the
 * seat's review of it set the rules this version is built on:
 *
 * - TWO KINDS OF TAB. Four are LAYOUTS — VIEW (render inspection and the
 *   readout layers), MAP (layers, orientation, waypoints), RIG (the vehicle's
 *   gauges), CAM (seat and lens). One is up at a time: a tap raises it, a tap
 *   on the lit tab lowers it, and with none up you are driving. Two are MODES
 *   — DRONE and AUTO — which run beside whatever layout is up: a tap starts
 *   the mode, a tap again ends it (RECALL, YOU HAVE IT), and neither stops you
 *   raising a layout to tweak the camera, the layers or the view meanwhile.
 * - A TAB IS AN ICON, ITS STATE AND ONE SUPPLEMENTARY SIGNAL — no words. A
 *   gold bracket is the layout that is up; a green face is a mode that is
 *   running; a bar along the foot is a level (the drone's pack); a dot in the
 *   corner is either an effect still in force (gold) or a warning (red, the
 *   rig's condition, an autopilot that cannot find its road).
 * - CONTROLS ARE EXCLUSIVE; EFFECTS PERSIST — a layer, the lens, a readout.
 *   VIEW's render inspection is the exception and stands down on leave.
 * - EVERY CONTROL HAS ONE HOME AND NONE IS A SETTING; the camera's place is the
 *   dock's. A tray is compact: small checkboxes and radios, a word each.
 *
 * The module owns no game state. The game hands it a description every frame
 * and it diffs: an unchanged description touches nothing, a change of VALUES
 * patches in place (so a slider under a thumb is never rebuilt out from under
 * it), and only a change of SHAPE rebuilds a panel. Items are plain data with
 * ids; every tap comes back through one callback as (id, value).
 *
 * DOM, not canvas, for the reasons the mission card and the MENU chip moved:
 * real tap targets, real text layout, and safe-area insets the browser already
 * knows. It sits ON the canvas grid — main.ts exports the strait's box in CSS
 * px (--deck-l, --deck-w, --deck-b, --deck-h, --deck-cols). Everything carries
 * `.ui`, so HIDE HUD strips it with the rest of the chrome.
 */
import { PIXEL_FONT, MICRO_FONT } from './font';

export type DeckTab = 'view' | 'map' | 'rig' | 'cam' | 'drone' | 'auto';
export const DECK_TABS: readonly DeckTab[] = ['view', 'map', 'rig', 'cam', 'drone', 'auto'];
/** The tabs that start a MODE rather than raise a layout. */
export const DECK_MODES: readonly DeckTab[] = ['drone', 'auto'];
/** One tab's supplementary signal: a level along its foot, a dot in its
 *  corner. */
export interface DeckSup { bar?: number; barTone?: Tone; dot?: Tone }
export type Tone = 'ink' | 'edge' | 'dim' | 'text' | 'soft' | 'gold' | 'hot' | 'good' | 'bad';

/**
 * One control in a sheet. Four shapes, because a sheet asks four kinds of
 * question: which ONE of these (`choice`, a bracketed button in a radio row),
 * is this ON (`check`, a box and a word), DO this (`action`), and how MUCH
 * (`slider`, 0..1 with the reading beside it). `note` is one dim word after
 * the label — why a control is disabled, or which camera it needs.
 */
export type DeckItem =
  | { kind: 'choice'; id: string; label: string; on: boolean; disabled?: boolean }
  | { kind: 'check'; id: string; label: string; on: boolean; disabled?: boolean; note?: string }
  | { kind: 'action'; id: string; label: string; tone?: Tone; disabled?: boolean; note?: string }
  | { kind: 'slider'; id: string; label: string; value: number; text: string; disabled?: boolean };
export interface DeckSection { title: string; items: DeckItem[] }
export interface DeckSheet { title?: string; foot?: string; sections: DeckSection[] }
export interface DeckState {
  /** The layout that is up — its tab wears the gold bracket. Null is the
   *  baseline: driving, with nothing raised. */
  active: DeckTab | null;
  /** Modes that are running (a drone in the air, the autopilot driving). */
  modes: DeckTab[];
  /** Each tab's supplementary signal. */
  sup: Partial<Record<DeckTab, DeckSup>>;
  /** The active layout's own controls, in the tray over the row. */
  tray: DeckSheet | null;
  /** The baseline's controls, on the strip over the row — only with no
   *  layout up. */
  base: DeckSheet | null;
  /** Lines stacked under the MENU chip while a layout wants to say so. */
  tagline: string[];
}
/** The strait between the dock and the dial, in CSS px from the bottom-left. */
export interface DeckGeom {
  l: number; w: number; b: number; h: number; cols: 6 | 3;
  /** Where the tray's bottom sits, in CSS px from the screen's foot: over the
   *  dock and its hint, not over the row, because the dock is the camera
   *  switch and a tray lying on its corner took the seat chip's taps. */
  trayB: number;
  /** Half the width the edge rails need, so a tray never lies across one. */
  edge: number;
}
export interface HudDeck {
  render(s: DeckState): void;
  /** Seat the row on the canvas grid — main.ts owns the numbers (drawHud's). */
  place(g: DeckGeom): void;
  /** Where an item is on the glass, in client px — the probe a test taps. */
  rectOf(id: string): DOMRect | null;
}

/** Tab faces, left to right as the mock sets them. */
const LABEL: Record<DeckTab, string> = {
  view: 'VIEW', map: 'MAP', rig: 'RIG', cam: 'CAM', drone: 'DRONE', auto: 'AUTOPILOT',
};
/**
 * PIXEL ICONS, NOT THE ICON FONT. The Font Awesome subset (icons.ts) has a
 * map, a wrench, a car and a gear, but no eye and no camera — and adding two
 * glyphs means re-running the subsetter. A 9×9 bitmap as `#` and `.` is also
 * simply closer to the mock, which draws these as pixel art, and it renders
 * with hard edges at any scale where the vector face antialiases soft.
 */
const ICONS: Record<DeckTab, string[]> = {
  view: [                       // a peak — the world, looked at
    '.........',
    '....#....',
    '...###...',
    '..##.##..',
    '..#...#..',
    '.##...##.',
    '.#.....#.',
    '##.....##',
    '#########',
  ],
  map: [                        // a folded sheet
    '.........',
    '##..##...',
    '#.##.###.',
    '#.#..#.##',
    '#.#..#..#',
    '#.#..#..#',
    '##.#.#..#',
    '...##.###',
    '......##.',
  ],
  rig: [                        // crossed spanners
    '##.....##',
    '#.#...#.#',
    '.#.#.#.#.',
    '..#.#.#..',
    '...#.#...',
    '..#.#.#..',
    '.#.#.#.#.',
    '#.#...#.#',
    '##.....##',
  ],
  drone: [                      // a quad from above: four rotors on an X
    '###...###',
    '#.#...#.#',
    '###...###',
    '...#.#...',
    '....#....',
    '...#.#...',
    '###...###',
    '#.#...#.#',
    '###...###',
  ],
  cam: [                        // a camera body
    '.........',
    '...###...',
    '#########',
    '#...#...#',
    '#..#.#..#',
    '#...#...#',
    '#.......#',
    '#########',
    '.........',
  ],
  auto: [                       // a steering wheel
    '..#####..',
    '.#.....#.',
    '#.......#',
    '#...#...#',
    '#########',
    '#..#.#..#',
    '#.#...#.#',
    '.#.....#.',
    '..#####..',
  ],
};
function iconSvg(rows: string[]): string {
  let rects = '';
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) if (r[x] === '#') rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
  });
  return `<svg viewBox="0 0 9 9" width="18" height="18" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">${rects}</svg>`;
}

export function createHudDeck(
  colors: Record<Tone, string>,
  onTab: (t: DeckTab) => void,
  onItem: (id: string, value?: number) => void,
  /** A slider let go — the gesture's COMMIT, distinct from each input step. */
  onRelease: (id: string) => void,
): HudDeck {
  const C = colors;
  const style = document.createElement('style');
  style.textContent = `
  /* The strait, in CSS px from main.ts (stepDeck). The row is laid out as a
     grid so 6 across and 3x2 are the same element: a phone too narrow for six
     legible cells gets two rows instead. */
  #deck-row { position: fixed; z-index: 11; left: var(--deck-l, 70px); width: var(--deck-w, 200px);
    bottom: var(--deck-b, 60px); height: var(--deck-h, 60px);
    display: grid; grid-template-columns: repeat(var(--deck-cols, 6), 1fr); grid-auto-rows: 1fr;
    gap: 3px; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
  body.menu-open #deck-row, body.menu-open #deck-sheet, body.menu-open #deck-base,
  body.menu-open #deck-tag { display: none !important; }
  .deck-tab { position: relative; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 3px; min-width: 0; padding: 0; cursor: pointer;
    color: ${C.edge}; background-color: rgba(8,20,23,0.55); border: 1px solid rgba(114,189,178,0.28);
    --bk: ${C.edge}; font-family: '${MICRO_FONT}', ui-monospace, monospace; font-size: 11px;
    line-height: 1; letter-spacing: 1px;
    text-shadow: 1px 0 ${C.ink}, -1px 0 ${C.ink}, 0 1px ${C.ink}, 0 -1px ${C.ink}; }
  .deck-tab svg { filter: drop-shadow(1px 0 ${C.ink}) drop-shadow(-1px 0 ${C.ink}) drop-shadow(0 1px ${C.ink}); }
  /* Two rows: the icon rides beside its word, since the cell is short. */
  #deck-row.two .deck-tab { flex-direction: row; gap: 4px; }
  #deck-row.two .deck-tab svg { width: 16px; height: 16px; }
  .deck-tab.active { color: ${C.gold}; --bk: ${C.gold}; border-color: rgba(245,196,83,0.6);
    background-color: rgba(8,20,23,0.85); }
  /* A MODE THAT IS RUNNING: a green face, so it reads as "on" beside a layout's
     gold "up" and never as a second layout. */
  .deck-tab.mode { color: ${C.good}; --bk: ${C.good}; border-color: rgba(122,220,140,0.6);
    background-color: rgba(10,34,20,0.85); }
  .deck-tab svg { width: 20px; height: 20px; }
  .deck-tab .sup-dot { position: absolute; top: 3px; right: 3px; width: 4px; height: 4px; display: none;
    box-shadow: 0 0 0 1px ${C.ink}; }
  .deck-tab .sup-bar { position: absolute; left: 5px; right: 5px; bottom: 4px; height: 3px; display: none;
    background: rgba(114,189,178,0.25); }
  .deck-tab .sup-bar i { display: block; height: 100%; }
  /* THE TRAY: the active layout's controls, centred over the lower road,
     bottom edge just above the row. Its sections flow into as many columns as
     the width holds. A FIXED width, not max-content: the sections are an
     auto-fit grid, and a grid inside a shrink-to-fit box collapses to its
     narrowest layout. */
  #deck-sheet { position: fixed; z-index: 11; display: none; left: 50%; transform: translateX(-50%);
    bottom: var(--deck-tray-b, 140px);
    width: min(400px, calc(100vw - 2 * var(--deck-edge, 10px) - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
    max-height: min(40vh, calc(100vh - var(--deck-tray-b, 140px) - 64px)); overflow-y: auto;
    padding: 6px 9px 5px; background-color: rgba(6,14,16,0.88); border: 1px solid ${C.edge}; --bk: ${C.edge};
    font-family: '${PIXEL_FONT}', ui-monospace, monospace; color: ${C.text};
    -webkit-user-select: none; user-select: none; touch-action: manipulation; }
  /* THE BASE STRIP: the baseline's own controls, a row of chips seated on the
     row's left edge — small, because driving is what the glass is for. */
  #deck-base { position: fixed; z-index: 11; display: none; left: var(--deck-l, 70px);
    bottom: calc(var(--deck-b, 60px) + var(--deck-h, 60px) + 16px);
    font-family: '${PIXEL_FONT}', ui-monospace, monospace; color: ${C.text};
    -webkit-user-select: none; user-select: none; touch-action: manipulation; }
  #deck-base .d-cols { display: flex; gap: 4px; align-items: flex-end; }
  #deck-base .d-sec { display: flex; gap: 4px; align-items: flex-end; }
  #deck-base .d-h { display: none; }
  #deck-base .d-slider { width: 118px; background-color: rgba(6,14,16,0.8); padding: 3px 5px 0;
    border: 1px solid rgba(114,189,178,0.35); }
  .deck-panel .d-title { font-size: 10px; letter-spacing: 1px; color: ${C.gold};
    border-bottom: 1px solid rgba(114,189,178,0.35); padding-bottom: 5px; margin-bottom: 6px; }
  /* COMPACT: sections flow into as many columns as the width holds, each a
     column of small checkboxes and radios — the overlays' own form, which is
     what every tray wears. */
  #deck-sheet .d-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px 10px; }
  #deck-sheet .d-sec { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  #deck-sheet .d-sec + .d-sec { border-left: 1px solid rgba(114,189,178,0.18); padding-left: 8px; }
  .deck-panel .d-h { font-size: 8px; letter-spacing: 1px; color: ${C.dim}; margin-bottom: 1px; }
  .deck-panel button { font: inherit; font-family: inherit; font-size: 8px; letter-spacing: 1px;
    cursor: pointer; background-color: transparent; color: ${C.edge}; text-align: left; }
  .deck-panel button:disabled { cursor: default; opacity: 0.4; }
  /* A radio and a checkbox are one row each: a small mark and a word. The
     radio's mark is a hollow diamond, lit solid; the checkbox's a square. */
  .deck-panel .d-choice, .deck-panel .d-check { display: flex; align-items: center; gap: 6px;
    padding: 3px 0; min-height: 18px; border: 0; background: transparent; text-align: left; }
  .deck-panel .d-choice .box, .deck-panel .d-check .box { width: 7px; height: 7px; flex: none;
    border: 1px solid ${C.edge}; box-sizing: border-box; }
  .deck-panel .d-choice .box { transform: rotate(45deg) scale(0.85); }
  .deck-panel .d-choice.on, .deck-panel .d-check.on { color: ${C.text}; }
  .deck-panel .d-choice.on .box, .deck-panel .d-check.on .box { background: ${C.gold}; border-color: ${C.gold}; }
  .deck-panel .d-action { padding: 3px 0; min-height: 18px; border: 0; background: transparent; }
  /* On the base strip the rows sit in a line and wear a plate, since there is
     no tray behind them. */
  #deck-base .d-choice, #deck-base .d-check { padding: 3px 6px; background-color: rgba(6,14,16,0.8);
    border: 1px solid rgba(114,189,178,0.35); }
  .deck-panel .note { color: ${C.dim}; margin-left: 4px; }
  .deck-panel .d-slider { display: flex; flex-direction: column; gap: 2px; font-size: 8px; letter-spacing: 1px; }
  .deck-panel .d-slider .row { display: flex; justify-content: space-between; color: ${C.edge}; }
  .deck-panel .d-slider .row .v { color: ${C.dim}; }
  .deck-panel .d-slider.off { opacity: 0.4; }
  .deck-panel input[type=range] { width: 100%; margin: 3px 0 4px; height: 18px; accent-color: ${C.gold};
    background: transparent; touch-action: none; }
  .deck-panel .d-foot { margin-top: 6px; padding-top: 5px; border-top: 1px solid rgba(114,189,178,0.35);
    font-size: 8px; letter-spacing: 2px; color: ${C.edge}; text-align: center; }
  /* Under the MENU chip: the layout saying it is up, and SYS's readout. Never
     a control. */
  #deck-tag { position: fixed; z-index: 10; display: none; pointer-events: none;
    right: calc(10px + env(safe-area-inset-right, 0px));
    top: calc(env(safe-area-inset-top, 0px) + var(--top-y, 44px) + 30px);
    font-family: '${PIXEL_FONT}', ui-monospace, monospace; font-size: 8px; letter-spacing: 2px;
    line-height: 2.1; color: ${C.edge}; text-align: right;
    text-shadow: 1px 0 ${C.ink}, -1px 0 ${C.ink}, 0 1px ${C.ink}, 0 -1px ${C.ink}; }
  #deck-tag div:first-child { color: ${C.gold}; }
  #deck-tag::after { content: ''; display: block; width: 14px; height: 1px; margin: 4px 0 0 auto; background: ${C.edge}; }
  `;
  document.head.appendChild(style);

  // ── the row ──
  const row = document.createElement('div');
  row.id = 'deck-row';
  row.className = 'ui';
  const tabEls = new Map<DeckTab, HTMLButtonElement>();
  for (const t of DECK_TABS) {
    const b = document.createElement('button');
    b.className = 'deck-tab bkt';
    b.dataset.deckTab = t;
    // NO WORDS ON THE FACE: the icon, its state, and one supplementary signal.
    // The name rides as the accessible label and the tooltip.
    b.innerHTML = `${iconSvg(ICONS[t])}<span class="sup-dot"></span><span class="sup-bar"><i></i></span>`;
    b.setAttribute('aria-label', LABEL[t]);
    b.title = LABEL[t];
    b.addEventListener('click', () => onTab(t));
    tabEls.set(t, b);
    row.appendChild(b);
  }
  document.body.appendChild(row);

  const tag = document.createElement('div');
  tag.id = 'deck-tag';
  tag.className = 'ui';
  document.body.appendChild(tag);

  /** Elements by item id, from every panel's last build — what rectOf reads. */
  const allEls = new Map<string, HTMLElement>();

  /**
   * A PANEL: one element holding a DeckSheet, with its own diff. The tray and
   * the base strip are two of them and share the item vocabulary, so a chip on
   * the strip and a chip in the tray are the same control drawn in two places
   * — never the same control drawn twice, which is what the ids guarantee.
   */
  function panel(id: string, cls: string) {
    const el = document.createElement('div');
    el.id = id;
    el.className = `ui deck-panel ${cls}`;
    document.body.appendChild(el);
    // Taps inside a panel must never reach the canvas under it (the stick, a
    // pin): stopping here is belt and braces for a finger that slides off a
    // slider onto the glass.
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    let itemEls = new Map<string, HTMLElement>();
    let shapeKey = '';
    let dragging: string | null = null;
    const shapeOf = (s: DeckSheet): string =>
      JSON.stringify([s.title ?? '', s.sections.map((sec) => [sec.title, sec.items.map((i) => [i.kind, i.id])])]);
    function build(s: DeckSheet): void {
      for (const k of itemEls.keys()) allEls.delete(k);
      itemEls = new Map();
      el.textContent = '';
      if (s.title !== undefined) {
        const title = document.createElement('div');
        title.className = 'd-title';
        el.appendChild(title);
      }
      const cols = document.createElement('div');
      cols.className = 'd-cols';
      for (const sec of s.sections) {
        const col = document.createElement('div');
        col.className = 'd-sec';
        const h = document.createElement('div');
        h.className = 'd-h';
        h.textContent = sec.title;
        col.appendChild(h);
        for (const it of sec.items) {
          let ie: HTMLElement;
          if (it.kind === 'slider') {
            ie = document.createElement('label');
            ie.className = 'd-slider';
            ie.innerHTML = '<span class="row"><span class="k"></span><span class="v"></span></span>';
            const inp = document.createElement('input');
            inp.type = 'range'; inp.min = '0'; inp.max = '1000'; inp.step = '1';
            inp.addEventListener('pointerdown', () => { dragging = it.id; });
            inp.addEventListener('input', () => onItem(it.id, Number(inp.value) / 1000));
            // `change` fires once on release for pointer AND keyboard, which is
            // the commit a rewind scrub needs; pointerup alone misses the keys.
            inp.addEventListener('change', () => { dragging = null; onRelease(it.id); });
            inp.addEventListener('pointercancel', () => { dragging = null; });
            ie.appendChild(inp);
          } else {
            ie = document.createElement('button');
            ie.className = it.kind === 'check' ? 'd-check' : it.kind === 'choice' ? 'd-choice' : 'd-action';
            ie.innerHTML = it.kind !== 'action'
              ? '<span class="box"></span><span class="k"></span><span class="note"></span>'
              : '<span class="k"></span><span class="note"></span>';
            ie.addEventListener('click', () => onItem(it.id));
          }
          ie.dataset.deckItem = it.id;
          itemEls.set(it.id, ie);
          allEls.set(it.id, ie);
          col.appendChild(ie);
        }
        cols.appendChild(col);
      }
      el.appendChild(cols);
      const foot = document.createElement('div');
      foot.className = 'd-foot';
      el.appendChild(foot);
    }
    function patch(s: DeckSheet): void {
      const title = el.querySelector('.d-title') as HTMLElement | null;
      if (title) title.textContent = s.title ?? '';
      const foot = el.querySelector('.d-foot') as HTMLElement;
      foot.textContent = s.foot ?? '';
      foot.style.display = s.foot ? '' : 'none';
      for (const sec of s.sections) {
        for (const it of sec.items) {
          const ie = itemEls.get(it.id);
          if (!ie) continue;
          (ie.querySelector('.k') as HTMLElement).textContent = it.label;
          if (it.kind === 'slider') {
            (ie.querySelector('.v') as HTMLElement).textContent = it.text;
            ie.classList.toggle('off', !!it.disabled);
            const inp = ie.querySelector('input') as HTMLInputElement;
            inp.disabled = !!it.disabled;
            if (dragging !== it.id) inp.value = String(Math.round(Math.max(0, Math.min(1, it.value)) * 1000));
            continue;
          }
          const b = ie as HTMLButtonElement;
          b.disabled = !!it.disabled;
          if (it.kind !== 'action') b.classList.toggle('on', it.on);
          if (it.kind === 'action') {
            b.style.color = it.tone ? C[it.tone] : '';
            b.style.setProperty('--bk', it.tone ? C[it.tone] : C.edge);
          }
          const note = ie.querySelector('.note') as HTMLElement | null;
          if (note) note.textContent = 'note' in it && it.note ? it.note : '';
        }
      }
    }
    return {
      set(s: DeckSheet | null): void {
        if (!s) {
          el.style.display = 'none';
          if (shapeKey) { for (const k of itemEls.keys()) allEls.delete(k); itemEls = new Map(); }
          shapeKey = '';
          dragging = null;
          return;
        }
        const sk = shapeOf(s);
        if (sk !== shapeKey) { shapeKey = sk; dragging = null; build(s); }
        patch(s);
        el.style.display = 'block';
      },
    };
  }
  const tray = panel('deck-sheet', 'tray');
  const base = panel('deck-base', 'base');

  let lastKey = '';
  let tagKey = '';
  let geomKey = '';

  return {
    render(s: DeckState): void {
      const key = JSON.stringify(s);
      if (key === lastKey) return;
      lastKey = key;
      for (const [t, el] of tabEls) {
        const on = t === s.active || s.modes.includes(t);
        el.classList.toggle('active', t === s.active);
        el.classList.toggle('mode', s.modes.includes(t));
        el.setAttribute('aria-pressed', String(on));
        const sup = s.sup[t] ?? {};
        const dot = el.querySelector('.sup-dot') as HTMLElement;
        dot.style.display = sup.dot ? 'block' : 'none';
        if (sup.dot) dot.style.background = C[sup.dot];
        const bar = el.querySelector('.sup-bar') as HTMLElement;
        bar.style.display = sup.bar !== undefined ? 'block' : 'none';
        if (sup.bar !== undefined) {
          const fill = bar.firstElementChild as HTMLElement;
          fill.style.width = `${Math.round(Math.max(0, Math.min(1, sup.bar)) * 100)}%`;
          fill.style.background = C[sup.barTone ?? 'edge'];
        }
      }
      const tk = s.tagline.join('\n');
      if (tk !== tagKey) {
        tagKey = tk;
        tag.textContent = '';
        for (const line of s.tagline) { const d = document.createElement('div'); d.textContent = line; tag.appendChild(d); }
        tag.style.display = s.tagline.length ? 'block' : 'none';
      }
      tray.set(s.tray);
      base.set(s.base);
    },
    place(g: DeckGeom): void {
      const k = `${g.l}|${g.w}|${g.b}|${g.h}|${g.cols}|${g.trayB}|${g.edge}`;
      if (k === geomKey) return;
      geomKey = k;
      // The panels read --deck-b/--deck-h too, so these go on the body.
      const st = document.body.style;
      st.setProperty('--deck-l', `${g.l}px`);
      st.setProperty('--deck-w', `${g.w}px`);
      st.setProperty('--deck-b', `${g.b}px`);
      st.setProperty('--deck-h', `${g.h}px`);
      st.setProperty('--deck-cols', String(g.cols));
      st.setProperty('--deck-tray-b', `${g.trayB}px`);
      st.setProperty('--deck-edge', `${g.edge}px`);
      row.classList.toggle('two', g.cols === 3);
    },
    rectOf(id: string): DOMRect | null {
      const el = allEls.get(id) ?? (DECK_TABS.includes(id as DeckTab) ? tabEls.get(id as DeckTab) : undefined);
      if (!el || !el.isConnected || el.offsetParent === null) return null;
      return el.getBoundingClientRect();
    },
  };
}

/** Two rows when six cells would each be narrower than this, in CSS px. */
export const DECK_MIN_CELL = 26;
