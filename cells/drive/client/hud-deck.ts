/**
 * THE DECK — the HUD's layout switcher, and the sheets it opens.
 *
 * It replaces the CONTROL MATRIX: six canvas cells beside the minimap (drone ·
 * map-up · seat over AUTO · pause · WPT), each one a single action with no room
 * to say more, and the chart's two edge rails (TILT, BAND) that stood in for
 * the ENV/RIG gauges whenever the camera went up. That was a HUD growing by
 * accretion: every new diagnostic took a strip of the glass, and the tile
 * debug overlay — default ON from the seat's rack — made the chart the most
 * cluttered view in the game while being the one people read maps on.
 *
 * So the strait between the map and the dial is now six TABS, and a tab is one
 * of two things:
 *
 * - a LAYOUT (DRIVE, MAP, VIEW): what the glass is for right now. DRIVE is the
 *   driving HUD, MAP the chart, VIEW render inspection — and inspection is the
 *   ONLY layout the debug overlays draw in, which is what clears the chart.
 *   Tapping the layout you are already in opens its sheet.
 * - a SHEET over whichever layout is up (CAM, SYS), or a door (RIG opens the
 *   menu's own RIG screen, which is already the place the truck is tuned).
 *
 * The module owns no game state. The game hands it a description every frame
 * — which tab is lit, which sheet is open, what the sheet holds — and it
 * diffs: an unchanged description touches nothing, a change of VALUES patches
 * in place (so a slider under a thumb is never rebuilt out from under it), and
 * only a change of SHAPE rebuilds the sheet. Items are plain data with ids;
 * every tap comes back through one callback as (id, value).
 *
 * DOM, not canvas, for the same reasons the mission card and the MENU chip
 * moved (devtools/hud-catalog.md): real tap targets, real text layout, and
 * safe-area insets the browser already knows. It sits ON the canvas grid —
 * main.ts exports the strait's box in CSS px (--deck-l, --deck-w, --deck-b,
 * --deck-h, --deck-cols) from the same numbers drawHud lays the dock out with.
 * Everything carries `.ui`, so HIDE HUD strips it with the rest of the chrome.
 */
import { PIXEL_FONT, MICRO_FONT } from './font';

export type DeckTab = 'view' | 'map' | 'rig' | 'drive' | 'cam' | 'sys';
export const DECK_TABS: readonly DeckTab[] = ['view', 'map', 'rig', 'drive', 'cam', 'sys'];
type Tone = 'ink' | 'edge' | 'dim' | 'text' | 'soft' | 'gold' | 'hot' | 'good' | 'bad';

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
export interface DeckSheet { title: string; foot?: string; sections: DeckSection[] }
export interface DeckState {
  /** The layout the glass is in — its tab wears the gold bracket. */
  layout: DeckTab;
  /** The tab whose sheet is open, if any. */
  open: DeckTab | null;
  sheet: DeckSheet | null;
  /** Lines stacked under the MENU chip while a layout wants to say so. */
  tagline: string[];
}
/** The strait between the dock and the dial, in CSS px from the bottom-left. */
export interface DeckGeom { l: number; w: number; b: number; h: number; cols: 6 | 3 }
export interface HudDeck {
  render(s: DeckState): void;
  /** Seat the row on the canvas grid — main.ts owns the numbers (drawHud's). */
  place(g: DeckGeom): void;
  /** Where an item is on the glass, in client px — the probe a test taps. */
  rectOf(id: string): DOMRect | null;
}

/** Tab faces, left to right as the mock sets them. */
const LABEL: Record<DeckTab, string> = {
  view: 'VIEW', map: 'MAP', rig: 'RIG', drive: 'DRIVE', cam: 'CAM', sys: 'SYS',
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
  drive: [                      // the truck, nose on
    '.........',
    '..#####..',
    '.#.....#.',
    '#########',
    '#.#####.#',
    '#########',
    '##.....##',
    '##.....##',
    '.........',
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
  sys: [                        // a cog
    '....#....',
    '.#.###.#.',
    '..#####..',
    '.##...##.',
    '###...###',
    '.##...##.',
    '..#####..',
    '.#.###.#.',
    '....#....',
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
  /* The strait, in CSS px from main.ts (hudResize/stepDeck). The row is laid
     out as a grid so 6 across and 3x2 are the same element: a phone too narrow
     for six legible cells gets the old matrix's two rows instead. */
  #deck-row { position: fixed; z-index: 11; left: var(--deck-l, 70px); width: var(--deck-w, 200px);
    bottom: var(--deck-b, 60px); height: var(--deck-h, 60px);
    display: grid; grid-template-columns: repeat(var(--deck-cols, 6), 1fr); grid-auto-rows: 1fr;
    gap: 3px; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
  body.menu-open #deck-row, body.menu-open #deck-sheet, body.menu-open #deck-tag { display: none !important; }
  .deck-tab { position: relative; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 3px; min-width: 0; padding: 0; cursor: pointer;
    color: ${C.edge}; background-color: rgba(8,20,23,0.55); border: 1px solid rgba(114,189,178,0.28);
    --bk: ${C.edge}; font-family: '${MICRO_FONT}', ui-monospace, monospace; font-size: 11px;
    line-height: 1; letter-spacing: 1px;
    text-shadow: 1px 0 ${C.ink}, -1px 0 ${C.ink}, 0 1px ${C.ink}, 0 -1px ${C.ink}; }
  .deck-tab svg { filter: drop-shadow(1px 0 ${C.ink}) drop-shadow(-1px 0 ${C.ink}) drop-shadow(0 1px ${C.ink}); }
  /* Two rows: the icon rides beside its word, since the cell is short. */
  #deck-row.two .deck-tab { flex-direction: row; gap: 4px; }
  #deck-row.two .deck-tab svg { width: 12px; height: 12px; }
  .deck-tab.layout { color: ${C.gold}; --bk: ${C.gold}; border-color: rgba(245,196,83,0.45); }
  .deck-tab.open { color: ${C.text}; background-color: rgba(8,20,23,0.85); }
  /* THE SHEET: centred over the lower road, bottom edge just above the row.
     Its sections flow into as many columns as the width holds — four on the
     mock's phone, two on a narrow one. */
  #deck-sheet { position: fixed; z-index: 11; display: none; left: 50%; transform: translateX(-50%);
    bottom: calc(var(--deck-b, 60px) + var(--deck-h, 60px) + 6px);
    /* A FIXED width, not max-content: the sections are an auto-fit grid, and
       a grid inside a shrink-to-fit box collapses to its narrowest layout —
       two columns in landscape where four fit. */
    width: min(440px, calc(100vw - 20px - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px)));
    max-height: 52vh; overflow-y: auto;
    padding: 7px 10px 6px; background-color: rgba(6,14,16,0.9); border: 1px solid ${C.edge}; --bk: ${C.edge};
    font-family: '${PIXEL_FONT}', ui-monospace, monospace; color: ${C.text};
    -webkit-user-select: none; user-select: none; touch-action: manipulation; }
  #deck-sheet .d-title { font-size: 10px; letter-spacing: 1px; color: ${C.gold};
    border-bottom: 1px solid rgba(114,189,178,0.35); padding-bottom: 5px; margin-bottom: 6px; }
  #deck-sheet .d-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(92px, 1fr)); gap: 8px 10px; }
  #deck-sheet .d-sec { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  #deck-sheet .d-sec + .d-sec { border-left: 1px solid rgba(114,189,178,0.18); padding-left: 8px; }
  #deck-sheet .d-h { font-size: 8px; letter-spacing: 1px; color: ${C.dim}; margin-bottom: 1px; }
  #deck-sheet button { font: inherit; font-family: inherit; font-size: 8px; letter-spacing: 1px;
    cursor: pointer; background-color: transparent; color: ${C.edge}; text-align: left; }
  #deck-sheet button:disabled { cursor: default; opacity: 0.4; }
  #deck-sheet .d-choice, #deck-sheet .d-action { padding: 5px 8px 4px; text-align: center;
    border: 1px solid rgba(114,189,178,0.35); --bk: ${C.edge}; background-color: rgba(8,20,23,0.6); }
  #deck-sheet .d-choice.on { color: ${C.gold}; --bk: ${C.gold}; border-color: ${C.gold}; }
  #deck-sheet .d-check { display: flex; align-items: center; gap: 6px; padding: 3px 0; border: 0; }
  #deck-sheet .d-check .box { width: 8px; height: 8px; flex: none; border: 1px solid ${C.edge};
    box-sizing: border-box; }
  #deck-sheet .d-check.on { color: ${C.text}; }
  #deck-sheet .d-check.on .box { background: ${C.gold}; border-color: ${C.gold}; }
  #deck-sheet .note { color: ${C.dim}; margin-left: 4px; }
  #deck-sheet .d-slider { display: flex; flex-direction: column; gap: 2px; font-size: 8px; letter-spacing: 1px; }
  #deck-sheet .d-slider .row { display: flex; justify-content: space-between; color: ${C.edge}; }
  #deck-sheet .d-slider .row .v { color: ${C.dim}; }
  #deck-sheet .d-slider.off { opacity: 0.4; }
  #deck-sheet input[type=range] { width: 100%; margin: 3px 0 4px; height: 18px; accent-color: ${C.gold};
    background: transparent; touch-action: none; }
  #deck-sheet .d-foot { margin-top: 7px; padding-top: 5px; border-top: 1px solid rgba(114,189,178,0.35);
    font-size: 8px; letter-spacing: 2px; color: ${C.edge}; text-align: center; }
  /* Under the MENU chip: the layout saying it is on, the way the mock's
     "RENDER INSPECTION MODE ACTIVE" does. Never a control. */
  #deck-tag { position: fixed; z-index: 10; display: none; pointer-events: none;
    right: calc(10px + env(safe-area-inset-right, 0px));
    top: calc(env(safe-area-inset-top, 0px) + var(--top-y, 44px) + 30px);
    font-family: '${PIXEL_FONT}', ui-monospace, monospace; font-size: 8px; letter-spacing: 3px;
    line-height: 2.1; color: ${C.edge}; text-align: left;
    text-shadow: 1px 0 ${C.ink}, -1px 0 ${C.ink}, 0 1px ${C.ink}, 0 -1px ${C.ink}; }
  #deck-tag::after { content: ''; display: block; width: 14px; height: 1px; margin-top: 4px; background: ${C.edge}; }
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
    b.innerHTML = `${iconSvg(ICONS[t])}<span>${LABEL[t]}</span>`;
    b.addEventListener('click', () => onTab(t));
    tabEls.set(t, b);
    row.appendChild(b);
  }
  document.body.appendChild(row);

  // ── the sheet ──
  const sheet = document.createElement('div');
  sheet.id = 'deck-sheet';
  sheet.className = 'ui bkt';
  document.body.appendChild(sheet);
  // Taps inside the sheet must never reach the canvas under it (the stick, a
  // pin): the canvas listens on itself, so stopping here is belt and braces
  // for a finger that slides off a slider onto the glass.
  sheet.addEventListener('pointerdown', (e) => e.stopPropagation());

  const tag = document.createElement('div');
  tag.id = 'deck-tag';
  tag.className = 'ui';
  document.body.appendChild(tag);

  /** Elements by item id, from the last build — what a value patch writes. */
  let itemEls = new Map<string, HTMLElement>();
  let shapeKey = '';
  let lastKey = '';
  let tagKey = '';
  let geomKey = '';
  /** The slider a thumb is on — never written to from outside mid-drag. */
  let dragging: string | null = null;

  const shapeOf = (s: DeckSheet): string =>
    JSON.stringify([s.title, s.sections.map((sec) => [sec.title, sec.items.map((i) => [i.kind, i.id])])]);

  function build(s: DeckSheet): void {
    itemEls = new Map();
    sheet.textContent = '';
    const title = document.createElement('div');
    title.className = 'd-title';
    sheet.appendChild(title);
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
        let el: HTMLElement;
        if (it.kind === 'slider') {
          el = document.createElement('label');
          el.className = 'd-slider';
          el.innerHTML = '<span class="row"><span class="k"></span><span class="v"></span></span>';
          const inp = document.createElement('input');
          inp.type = 'range'; inp.min = '0'; inp.max = '1000'; inp.step = '1';
          inp.addEventListener('pointerdown', () => { dragging = it.id; });
          inp.addEventListener('input', () => onItem(it.id, Number(inp.value) / 1000));
          // `change` fires once on release for pointer AND keyboard, which is
          // the commit a rewind scrub needs; pointerup alone misses the keys.
          inp.addEventListener('change', () => { dragging = null; onRelease(it.id); });
          inp.addEventListener('pointercancel', () => { dragging = null; });
          el.appendChild(inp);
        } else {
          el = document.createElement('button');
          el.className = it.kind === 'check' ? 'd-check' : it.kind === 'choice' ? 'd-choice bkt' : 'd-action bkt';
          el.innerHTML = it.kind === 'check'
            ? '<span class="box"></span><span class="k"></span><span class="note"></span>'
            : '<span class="k"></span><span class="note"></span>';
          el.addEventListener('click', () => onItem(it.id));
        }
        el.dataset.deckItem = it.id;
        itemEls.set(it.id, el);
        col.appendChild(el);
      }
      cols.appendChild(col);
    }
    sheet.appendChild(cols);
    const foot = document.createElement('div');
    foot.className = 'd-foot';
    sheet.appendChild(foot);
  }

  function patch(s: DeckSheet): void {
    (sheet.querySelector('.d-title') as HTMLElement).textContent = s.title;
    const foot = sheet.querySelector('.d-foot') as HTMLElement;
    foot.textContent = s.foot ?? '';
    foot.style.display = s.foot ? '' : 'none';
    for (const sec of s.sections) {
      for (const it of sec.items) {
        const el = itemEls.get(it.id);
        if (!el) continue;
        (el.querySelector('.k') as HTMLElement).textContent = it.label;
        if (it.kind === 'slider') {
          (el.querySelector('.v') as HTMLElement).textContent = it.text;
          el.classList.toggle('off', !!it.disabled);
          const inp = el.querySelector('input') as HTMLInputElement;
          inp.disabled = !!it.disabled;
          if (dragging !== it.id) inp.value = String(Math.round(Math.max(0, Math.min(1, it.value)) * 1000));
          continue;
        }
        const b = el as HTMLButtonElement;
        b.disabled = !!it.disabled;
        if (it.kind !== 'action') b.classList.toggle('on', it.on);
        if (it.kind === 'action' && it.tone) { b.style.color = C[it.tone]; b.style.setProperty('--bk', C[it.tone]); }
        const note = el.querySelector('.note') as HTMLElement | null;
        if (note) note.textContent = 'note' in it && it.note ? it.note : '';
      }
    }
  }

  return {
    render(s: DeckState): void {
      const key = JSON.stringify(s);
      if (key === lastKey) return;
      lastKey = key;
      for (const [t, el] of tabEls) {
        el.classList.toggle('layout', t === s.layout);
        el.classList.toggle('open', t === s.open);
        el.setAttribute('aria-pressed', String(t === s.layout || t === s.open));
      }
      const tk = s.tagline.join('\n');
      if (tk !== tagKey) {
        tagKey = tk;
        tag.textContent = '';
        for (const line of s.tagline) { const d = document.createElement('div'); d.textContent = line; tag.appendChild(d); }
        tag.style.display = s.tagline.length ? 'block' : 'none';
      }
      if (!s.sheet) {
        sheet.style.display = 'none';
        shapeKey = '';
        dragging = null;
        return;
      }
      const sk = shapeOf(s.sheet);
      if (sk !== shapeKey) { shapeKey = sk; dragging = null; build(s.sheet); }
      patch(s.sheet);
      sheet.style.display = 'block';
    },
    place(g: DeckGeom): void {
      const k = `${g.l}|${g.w}|${g.b}|${g.h}|${g.cols}`;
      if (k === geomKey) return;
      geomKey = k;
      // The sheet reads --deck-b/--deck-h too, so these go on the body.
      const st = document.body.style;
      st.setProperty('--deck-l', `${g.l}px`);
      st.setProperty('--deck-w', `${g.w}px`);
      st.setProperty('--deck-b', `${g.b}px`);
      st.setProperty('--deck-h', `${g.h}px`);
      st.setProperty('--deck-cols', String(g.cols));
      row.classList.toggle('two', g.cols === 3);
    },
    rectOf(id: string): DOMRect | null {
      const el = itemEls.get(id) ?? (DECK_TABS.includes(id as DeckTab) ? tabEls.get(id as DeckTab) : undefined);
      if (!el || !el.isConnected || el.offsetParent === null) return null;
      return el.getBoundingClientRect();
    },
  };
}

/** Two rows when six cells would each be narrower than this, in CSS px. */
export const DECK_MIN_CELL = 26;
