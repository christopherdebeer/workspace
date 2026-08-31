/**
 * The menu, as DOM. It was drawn into the HUD canvas for a long time — same
 * bitmap font, same panel chrome — and that bought a look at the price of
 * everything a browser already does: scrolling (the destinations list was
 * PAGED because a canvas cannot scroll), hit targets (every tappable thing
 * was a hand-kept rect array), text layout (names were clipped by a
 * hand-measured bitmap width), and accessibility (none). The HUD stays on
 * canvas — instruments over a live world belong on the world's pixel grid —
 * but the menu is a modal PAGE, and a page is what the DOM is for.
 *
 * SHAPE: a splash HUB, not a tab strip. The screen the game opens on is the
 * screen the MENU button opens — the truck on its turntable, DRIVE as the
 * one big call to action, GPS DRIVE beside it, and the four sections below
 * as a vertical stack you enter and BACK out of: RIG (make it yours),
 * DRIVES (places to go), SURVEYS (what you have claimed), SETTINGS.
 *
 * The one thing the DOM cannot do is render the truck: the bay — on the
 * splash and the RIG page both — is a scissored studio render on the WebGL
 * canvas underneath. The scrim is therefore built from FOUR strips
 * positioned around the bay (not one sheet with a clip-path hole — Safari's
 * evenodd support is not worth betting the panel on), and `bayRect()`
 * reports where the hole is each frame so the renderer can aim at it.
 *
 * Type is Silkscreen (client/font.ts), a real pixel face on the same 5x7
 * grid as the HUD's hand-drawn glyphs — sizes stay on its 8px em grid
 * (8/16px) so the pixels land square.
 *
 * Everything stateful stays in main.ts; this module gets a context of
 * getters and actions and owns only layout and the open/closed state.
 */
import { PIXEL_FONT, PIXEL_FONT_CSS, loadPixelFont } from './font';
import { ICON, ICON_FONT, loadIcons } from './icons';

// Screen indices are the probe API (__menutab) and predate the redesign:
// 0 was the DRIVE tab and is now the splash hub; the rest keep their numbers.
export const T_DRIVE = 0, T_SURVEY = 1, T_RIG = 2, T_WORLD = 3, T_SYSTEM = 4, T_LINE = 5;
const TITLES: Record<number, string> = { [T_SURVEY]: 'SURVEYS', [T_RIG]: 'RIG', [T_WORLD]: 'DRIVES', [T_SYSTEM]: 'SETTINGS', [T_LINE]: 'THE LINE' };

export interface Rect { x: number; y: number; w: number; h: number }

/** Structurally the same object main.ts keeps in DIAL_GROUPS — the menu
 *  mutates nothing itself; `cycleDial` hands the SAME object back. */
export interface DialRef { label: string; opts: string[]; at: number; bar?: boolean }
export interface DialGroupRef { title: string; dials: DialRef[] }

type Tone = 'edge' | 'dim' | 'text' | 'soft' | 'gold' | 'hot' | 'good' | 'bad';

export interface MenuCtx {
  colors: Record<Tone, string>;
  // ── live readouts ──
  place(): string;
  situation(): string;
  /** Any interaction with the menu — the splash's idle clock resets on it,
   *  and a running attract tape stands down. Optional: older ctx builds. */
  splashPoke?(): void;
  /** Bank the last kept recording durably; resolves to the deck's status line. */
  tapeBank?(): Promise<string>;
  /** Cut the always-turning ring so the run has a fixed, known start. */
  tapeClear?(): string;
  /** The banked-run shelf, newest first — server truth from the last sync. */
  tapeShelf?(): Array<{ id: string; at: number; secs: number; lat: number; lon: number; url: string }>;
  /** A shelf row's tap: hop to the run and roll it — play mode. */
  runPlay?(id: string): void;
  /** The player's own spot, banked when the attract reel carried them away —
   *  null once spent (or never set). */
  attractRet?(): string | null;
  attractRetGo?(): void;
  driveStats(): Array<[string, string]>;
  worldRows(): Array<[string, string]>;
  systemRows(): Array<[string, string]>;
  real(): { on: boolean; err: string };
  surveyHere(): { name: string; tally: string; frac: number; state: string; tone: Tone } | null;
  surveyTotals(): { roads: number; got: number; total: number };
  surveyRoads(): Array<{ name: string; km: string; frac: number; tally: string; tone: Tone }>;
  drives(): Array<{ name: string; sub: string; mine: boolean }>;
  // ── rig ──
  views(): string[];
  vehView(): number;
  setVehView(i: number): void;
  dims(): Array<{ k: string; built: string; spec: string; ok: boolean }>;
  specText(): Array<[string, string]>;
  /** Metre-grid spacing and caption for the current elevation, or null on the
   *  3/4 turntable (no grid over a perspective view). */
  bayGrid(wCss: number, hCss: number): { pxPerM: number; caption: string } | null;
  // ── dials ──
  dialGroups(which: 'rig' | 'system'): DialGroupRef[];
  cycleDial(d: DialRef): void;
  /** The bodywork's current colour as #rrggbb, and the custom override. */
  paint(): string;
  setPaint(hex: string): void;
  // ── actions ──
  drive(): void;
  realToggle(): void;
  elsewhere(): void;
  saveSpot(): void;
  soundLabel(): string;
  soundTone(): Tone;
  soundTap(): void;
  hideHud(): void;
  /** THE RECORDER. A ring that is always turning, so the button is KEEP rather
   *  than RECORD — see the note on TAPE_RING. The deck shows what it holds and
   *  never has to know what a checkpoint is. */
  tape(): { ring: number; settled: boolean; playing: boolean; armed: boolean;
    at: number; of: number; drift: number; kept: number; kb: number };
  tapeKeep(): string;
  tapePlay(): void;
  tapeStopPlay(): void;
  /** The durable copy of your progress: where it stands, and the two taps that
   *  turn it on and off. */
  /** THE LINE — the campaign's whole surface, read by the T_LINE screen. */
  line(): {
    on: boolean;
    started: boolean;
    title: string;
    /** BEGIN / CONTINUE copy for the one CTA. */
    cta: string;
    /** Status lines: km on the line, stations, legs. */
    rows: Array<[string, string]>;
    legs: Array<{ title: string; brief: string; state: 'DONE' | 'OPEN' | 'AHEAD' }>;
    note: string;
  };
  lineGo(): void;
  /** Wipe the campaign — the run, missions, station wakes — locally and
   *  (signed in) in the durable copy. Roads and the odometer stay: the survey
   *  is a career, not a campaign. Status strings land back in the settings
   *  row via the callback; the game reloads off the line when it is done. */
  lineReset(status: (s: string, bad?: boolean) => void): void;
  syncLabel(): string;
  syncNote(): string;
  syncTone(): Tone;
  syncPhase(): 'off' | 'busy' | 'on' | 'blocked' | 'error';
  syncTap(): void;
  startDrive(i: number): void;
  deleteSpot(i: number): void;
  /** Geolocate (from this tap's gesture) and start a drive there. Status
   *  strings land back in the CURRENT row via the callback. */
  goCurrent(status: (s: string, bad?: boolean) => void): void;
  /** Take a pasted Google Maps link (or a bare "lat, lon") and drive there. */
  openGmap(link: string, status: (s: string, bad?: boolean) => void): void;
  /** Hand out where the truck is standing as a Google Maps link — the share
   *  sheet if the device has one, the clipboard otherwise. The resolved link
   *  comes back so the caller can show it when neither is available. */
  shareGmap(status: (s: string, bad?: boolean) => void): string;
}

export interface MenuHandle {
  open(tab?: number): void;
  close(): void;
  tab(): number | null;
  /** Where the studio bay sits, in CSS pixels — null unless a screen with a
   *  bay (the splash, or RIG) is showing. Calling it also re-aims the scrim
   *  hole, so the renderer and the scrim can never disagree. */
  bayRect(): Rect | null;
  refresh(): void;
}

export function createMenu(ctx: MenuCtx): MenuHandle {
  const C = ctx.colors;
  loadPixelFont();
  loadIcons();

  // ── chrome ─────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `${PIXEL_FONT_CSS}
  /* touch-action manipulation keeps the scroll of .m-body and drops
     double-tap-to-zoom, which on a list of chips is only ever an accident.
     NO BACKTICKS IN HERE: this block is a template literal and one closes it. */
  #menu { position: fixed; inset: 0; z-index: 15; display: none; touch-action: manipulation;
    font-family: '${PIXEL_FONT}', ui-monospace, Menlo, monospace; color: ${C.text};
    font-size: 12px; line-height: 1.5; -webkit-user-select: none; user-select: none; }
  #menu .m-scrim { position: absolute; background: rgba(6,14,17,0.92); }
  #menu .m-panel { position: absolute;
    top: calc(10px + env(safe-area-inset-top, 0px));
    right: calc(10px + env(safe-area-inset-right, 0px));
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    left: calc(10px + env(safe-area-inset-left, 0px));
    border: 1px solid ${C.dim};
    display: flex; flex-direction: column; padding: 10px 0 10px; min-height: 0; }
  #menu .m-corner { position: absolute; width: 9px; height: 9px; }
  #menu button { font: inherit; }
  #menu .m-head { display: flex; align-items: center; gap: 8px; padding: 0 12px; min-height: 44px; }
  #menu .m-back { cursor: pointer; color: ${C.soft}; border: 1px solid ${C.dim};
    background: rgba(8,20,23,0.78); padding: 3px 8px 2px; font-size: 10px;
    min-width: 44px; min-height: 44px; }
  #menu .m-title { color: ${C.gold}; font-weight: 700; font-size: 16px; }
  #menu .m-title .arrow { color: ${C.hot}; }
  #menu .m-sub { padding: 2px 12px 6px; color: ${C.dim}; font-size: 10px; letter-spacing: 2px; }
  #menu .m-x { margin-left: auto; cursor: pointer; color: ${C.hot}; border: 1px solid ${C.hot};
    background: rgba(8,20,23,0.78); padding: 3px 8px 2px; font-size: 10px;
    min-width: 44px; min-height: 44px; }
  #menu .m-rule { border-top: 1px solid ${C.dim}; margin: 4px 8px; }
  #menu .m-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
    padding: 6px 12px 4px; display: flex; flex-direction: column; }
  #menu .m-place { color: ${C.gold}; font-size: 16px; font-weight: 700;
    text-shadow: 0 0 8px rgba(242,193,78,0.45); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #menu .m-dimline { color: ${C.dim}; font-size: 10px; margin: 2px 0 6px; }
  #menu table.m-kv { border-collapse: collapse; font-size: 11px; }
  #menu table.m-kv td { padding: 1px 1.2em 1px 0; vertical-align: baseline; }
  #menu table.m-kv td:first-child { color: ${C.dim}; padding-right: 1.6em; white-space: nowrap; }
  #menu .m-foot { padding: 8px 12px 0; display: grid; gap: 5px; justify-items: start; }
  #menu .m-btn { letter-spacing: 1px; cursor: pointer; min-width: 14em;
    text-align: left; padding: 5px 10px 4px; background: rgba(8,20,23,0.78); border: 1px solid; font-size: 12px; }
  /* The paste field. A real input, because a link is far too long to retype
     and the clipboard read permission is not offered on every phone — so the
     honest control is a box you can paste into. Sized and coloured like the
     buttons it sits with; 16px on the input itself stops iOS Safari zooming
     the whole page in the moment it takes focus. */
  #menu .m-paste { display: grid; gap: 5px; width: 100%; max-width: 34em; }
  #menu .m-paste input { font-family: inherit; font-size: 16px; letter-spacing: 0;
    color: ${C.text}; background: rgba(8,20,23,0.9); border: 1px solid ${C.gold};
    padding: 6px 8px 5px; width: 100%; box-sizing: border-box; -webkit-user-select: text; user-select: text; }
  #menu .m-paste .note { font-size: 11px; color: ${C.dim}; letter-spacing: 1px; }
  #menu .m-cta { display: block; width: 100%; cursor: pointer; text-align: center; letter-spacing: 2px;
    font-size: 16px; font-weight: 700; padding: 9px 10px 7px; margin: 8px 0 0;
    color: ${C.good}; border: 1px solid ${C.good}; background: rgba(111,224,160,0.08); }
  #menu .m-cta.alt { font-size: 12px; font-weight: 400; padding: 6px 10px 5px;
    color: ${C.hot}; border-color: ${C.hot}; background: rgba(8,20,23,0.5); }
  #menu .m-nav { margin-top: 10px; display: grid; gap: 5px; }
  #menu .m-navrow { display: flex; align-items: baseline; gap: 8px; cursor: pointer;
    border: 1px solid ${C.dim}; background: rgba(8,20,23,0.5); padding: 7px 10px 6px; }
  #menu .m-navrow .name { font-size: 16px; color: ${C.text}; white-space: nowrap; }
  #menu .m-navrow .sub { margin-left: auto; color: ${C.dim}; font-size: 10px; text-align: right; }
  #menu .m-navrow .chev { color: ${C.gold}; font-size: 16px; }
  #menu .m-sect { color: ${C.edge}; font-size: 10px; letter-spacing: 2px;
    display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; }
  #menu .m-sect::after { content: ''; flex: 1; border-top: 1px solid ${C.dim}; }
  #menu .m-row { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; }
  #menu .m-row.hit { cursor: pointer; }
  #menu .m-row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #menu .m-row .sub { margin-left: auto; color: ${C.dim}; font-size: 10px; text-align: right;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; max-width: 55%; }
  #menu .m-row .del { color: ${C.soft}; cursor: pointer; padding: 0 6px; flex-shrink: 0; }
  #menu .m-meter { display: inline-flex; gap: 1px; align-self: center; flex-shrink: 0; }
  #menu .m-meter i { width: 4px; height: 4px; background: rgba(87,201,176,0.16); }
  #menu .m-dial { display: flex; align-items: baseline; gap: 8px; padding: 3px 2px; cursor: pointer; }
  #menu .m-dial .lab { color: ${C.soft}; font-size: 12px; }
  #menu .m-dial .val { margin-left: auto; color: ${C.gold}; font-size: 12px; }
  #menu input[type=color] { margin-left: auto; width: 38px; height: 20px; padding: 1px;
    border: 1px solid ${C.dim}; background: rgba(8,20,23,0.78); cursor: pointer; }
  #menu .ico { font-family: '${ICON_FONT}'; font-weight: 900; font-style: normal;
    font-size: 12px; width: 1.3em; display: inline-block; text-align: center; flex-shrink: 0; }
  #menu .m-navrow .ico { font-size: 15px; color: ${C.edge}; align-self: center; }
  #menu .m-btn .ico, #menu .m-cta .ico { margin-right: 0.5em; font-size: 11px; }
  #menu .m-row .ico { font-size: 10px; align-self: center; }
  #menu .m-views { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  #menu .m-view { font-size: 10px; cursor: pointer; padding: 3px 6px 2px;
    background: none; border: 1px solid transparent; color: ${C.soft}; }
  #menu .m-view.on { border-color: ${C.gold}; color: ${C.gold}; }
  #menu .m-bay { position: relative; border: 1px solid ${C.dim}; height: 200px; margin: 2px 0 8px; flex-shrink: 0; }
  #menu .m-bay.hero { height: auto; flex: 1; min-height: 130px; margin: 6px 0 0; }
  /* The hub: the live scene is the background, so the scrim stands down and
     every floating word carries its own ink. */
  #menu.hub .m-scrim { display: none !important; }
  /* The hub's top shade is GONE (owner-caught: it muddied both the words and
     the world; the pixel strokes below already carry the ink). The class stays
     as a no-op so an old cached shell can't render an unstyled div. */
  #menu .m-hubshade { display: none; pointer-events: none; }
  /* The hub floats over the LIVE SCENE, which can be any country at any hour
     — a soft drop shadow loses to a bright sky and the dim teal loses to
     everything (reported from the seat). So: ACCENT AND WHITE ONLY up here,
     and every word wears a real 1px pixel stroke — eight hard offsets in the
     panel ink — plus one soft drop for ground. */
  #menu.hub .m-title, #menu.hub .m-sub, #menu.hub .m-place, #menu.hub .m-dimline,
  #menu.hub .m-statline, #menu.hub table.m-kv { text-shadow:
    -1px 0 0 rgba(4,10,11,0.98), 1px 0 0 rgba(4,10,11,0.98),
    0 -1px 0 rgba(4,10,11,0.98), 0 1px 0 rgba(4,10,11,0.98),
    -1px -1px 0 rgba(4,10,11,0.98), 1px 1px 0 rgba(4,10,11,0.98),
    -1px 1px 0 rgba(4,10,11,0.98), 1px -1px 0 rgba(4,10,11,0.98),
    0 2px 6px rgba(4,10,11,0.85); }
  #menu.hub .m-sub, #menu.hub .m-dimline, #menu.hub table.m-kv td { color: ${C.text}; }
  #menu.hub table.m-kv td:first-child { color: ${C.gold}; }
  #menu .m-title .at { color: ${C.text}; }
  #menu.hub .m-navrow { background: rgba(8,20,23,0.74); }
  #menu.hub .m-cta { background: rgba(8,20,23,0.74); }
  #menu.hub .m-cta:first-child { background: rgba(24,52,40,0.8); }
  /* THE HUB'S NAV IS TILES, NOT ROWS. Seven full-width rows with taglines
     filled a phone screen and buried the one thing no other game has — the
     live world behind the menu. A tile carries the icon and the name; the
     taglines belong to the pages themselves. RETURN keeps a full-width row:
     it is a ticket, not a section. */
  #menu.hub .m-nav { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
  #menu.hub .m-navrow { flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; padding: 9px 2px 7px; text-align: center; }
  #menu.hub .m-navrow .sub, #menu.hub .m-navrow .chev { display: none; }
  #menu.hub .m-navrow .name { font-size: 11px; letter-spacing: 0.5px; white-space: normal; }
  #menu.hub .m-navrow .ico { font-size: 17px; align-self: center; }
  #menu.hub .m-navrow.ret { grid-column: 1 / -1; flex-direction: row; padding: 6px 10px;
    justify-content: flex-start; text-align: left; }
  #menu.hub .m-navrow.ret .sub, #menu.hub .m-navrow.ret .chev { display: inline; }
  #menu.hub .m-navrow.ret .sub { margin-left: auto; }
  /* Wider viewports can afford six across — the tiles become a single rank. */
  @media (min-width: 700px) { #menu.hub .m-nav { grid-template-columns: repeat(6, 1fr); } }
  /* GPS DRIVE is the second thought, and dresses like one. */
  #menu.hub .m-cta.alt { font-size: 10px; padding: 4px 10px 3px; min-width: 0; }
  /* The hub's stats are ONE line of facts, not a ledger. */
  #menu.hub .m-statline { color: ${C.text}; font-size: 10px; margin: 2px 0 4px;
    letter-spacing: 0.5px; }
  #menu .m-bay .cap { position: absolute; top: 3px; left: 5px; color: ${C.dim}; font-size: 10px; }
  #menu .m-bay .tag { position: absolute; bottom: 3px; left: 5px; color: ${C.gold}; font-size: 10px; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'menu';
  // The scrim, in four strips around a hole that is usually closed.
  const strips = Array.from({ length: 4 }, () => {
    const s = document.createElement('div');
    s.className = 'm-scrim';
    root.appendChild(s);
    return s;
  });
  const panel = document.createElement('div');
  panel.className = 'm-panel';
  root.appendChild(panel);
  // Gold corner brackets, the reference's chrome vocabulary.
  for (const [v, h] of [['top', 'left'], ['top', 'right'], ['bottom', 'left'], ['bottom', 'right']]) {
    const c = document.createElement('div');
    c.className = 'm-corner';
    c.style[v as 'top'] = '-1px';
    c.style[h as 'left'] = '-1px';
    c.style[`border${v[0].toUpperCase()}${v.slice(1)}` as 'borderTop'] = `1px solid ${C.gold}`;
    c.style[`border${h[0].toUpperCase()}${h.slice(1)}` as 'borderLeft'] = `1px solid ${C.gold}`;
    panel.appendChild(c);
  }
  document.body.appendChild(root);
  root.addEventListener('pointerdown', () => { try { ctx.splashPoke?.(); } catch { /* optional */ } });

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, txt = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    return e;
  };

  // ── header (rebuilt per screen: hub shows the rally plate, pages a back) ──
  const head = el('div', 'm-head');
  const subT = el('div', 'm-sub', 'SOLAR PUNK OPEN WORLD DRIVING SIM');
  const body = el('div', 'm-body');
  const foot = el('div', 'm-foot');
  panel.append(head, subT, el('div', 'm-rule'), body, foot);

  function renderHead(): void {
    head.replaceChildren();
    const x = el('button', 'm-x', 'X');
    x.addEventListener('click', () => close());
    if (tab === T_DRIVE || tab === null) {
      const t = el('div', 'm-title');
      t.append(el('span', 'at', '@c15r/'), 'drive');
      head.append(t, x);
      subT.style.display = 'block';
    } else {
      const back = el('button', 'm-back', '< BACK');
      back.addEventListener('click', () => setTab(T_DRIVE));
      head.append(back, el('div', 'm-title', TITLES[tab] ?? ''), x);
      subT.style.display = 'none';
    }
  }

  // ── state ──────────────────────────────────────────────────────────
  let tab: number | null = null;
  let bayEl: HTMLElement | null = null;
  let bayGridFor = '';           // last grid applied, so refresh doesn't redo it
  let currentStatus: { s: string; bad: boolean } | null = null;   // the CURRENT row's transient state
  // Live readouts UPDATE IN PLACE; the page rebuilds only when its structure
  // changes (a list grew, a screen switched). A wholesale rebuild on a timer
  // detaches every node a finger might be between down and up on, which
  // silently eats taps.
  let updaters: Array<() => void> = [];
  let structSig = '';
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || tab === null) return;
    if (tab === T_DRIVE) close(); else setTab(T_DRIVE);   // back first, out second
  });

  const scrimFull = (): void => {
    Object.assign(strips[0].style, { left: '0', top: '0', right: '0', bottom: '0', display: 'block' });
    for (const s of strips.slice(1)) s.style.display = 'none';
  };
  scrimFull();

  const tone = (t: Tone): string => C[t];

  const meterEl = (n: number, lit: number, col: string, cell = 4): HTMLElement => {
    const m = el('span', 'm-meter');
    for (let i = 0; i < n; i++) {
      const c = el('i', '');
      c.style.width = c.style.height = `${cell}px`;
      if (i < lit) c.style.background = col;
      m.appendChild(c);
    }
    return m;
  };

  const meterSet = (m: HTMLElement, lit: number, col: string): void => {
    Array.from(m.children).forEach((c, i) => {
      (c as HTMLElement).style.background = i < lit ? col : 'rgba(87,201,176,0.16)';
    });
  };

  const bindText = (node: HTMLElement, get: () => string): void => {
    updaters.push(() => { const v = get(); if (node.textContent !== v) node.textContent = v; });
  };

  /** A key/value table whose values track `get()` — same row count each call. */
  const kvTable = (get: () => Array<[string, string]>): HTMLElement => {
    const t = el('table', 'm-kv');
    const cells: HTMLElement[] = [];
    for (const [k, v] of get()) {
      const tr = el('tr', '');
      const td = el('td', '', v);
      tr.append(el('td', '', k), td);
      t.appendChild(tr);
      cells.push(td);
    }
    updaters.push(() => {
      get().forEach(([, v], i) => { if (cells[i] && cells[i].textContent !== v) cells[i].textContent = v; });
    });
    return t;
  };

  const ico = (ch: string, col = ''): HTMLElement => {
    const i = el('span', 'ico', ch);
    if (col) i.style.color = col;
    return i;
  };

  /** Buttons carry their label in a `.lab` span so updaters can rewrite the
   *  words without wiping an icon sitting beside them. */
  const button = (label: string, col: string, hit: () => void, icon = ''): HTMLButtonElement => {
    const b = el('button', 'm-btn');
    if (icon) b.appendChild(ico(icon));
    b.appendChild(el('span', 'lab', label));
    b.style.color = col;
    b.style.borderColor = col;
    b.addEventListener('click', hit);
    return b;
  };
  const setLab = (b: HTMLElement, s: string): void => {
    const lab = b.querySelector('.lab') as HTMLElement | null;
    if (lab && lab.textContent !== s) lab.textContent = s;
  };

  const mkBay = (hero = false): HTMLElement => {
    const bay = el('div', `m-bay${hero ? ' hero' : ''}`);
    bay.appendChild(el('div', 'cap'));
    // The splash hero is a WINDOW, not a studio: the hole shows the live
    // scene — the rig in chase cam against wherever it stands — so no tag.
    if (!hero) bay.appendChild(el('div', 'tag', 'DAK 23'));
    bayGridFor = '';
    return bay;
  };

  const dialsInto = (parent: HTMLElement, groups: DialGroupRef[]): void => {
    for (const g of groups) {
      parent.appendChild(el('div', 'm-sect', g.title));
      for (const d of g.dials) {
        const row = el('div', 'm-dial');
        row.append(el('span', 'lab', d.label));
        const val = el('span', 'val', d.opts[d.at]);
        const bar = d.bar ? meterEl(d.opts.length, d.at + 1, C.gold, 3) : null;
        if (bar) row.append(bar);
        row.append(val);
        // In place, not a rebuild — the row under the finger stays the row.
        row.addEventListener('click', () => {
          ctx.cycleDial(d);
          val.textContent = d.opts[d.at];
          if (bar) meterSet(bar, d.at + 1, C.gold);
        });
        parent.appendChild(row);
      }
    }
  };

  // ── the splash hub ─────────────────────────────────────────────────
  // The truck on its turntable, one big DRIVE, GPS DRIVE beside it, and the
  // four sections below as a stack. Closing the menu IS starting — there is
  // nothing behind DRIVE that has not already begun.
  function renderHome(): void {
    const place = el('div', 'm-place', ctx.place());
    const situation = el('div', 'm-dimline', ctx.situation());
    bindText(place, ctx.place);
    bindText(situation, ctx.situation);
    // One line of facts. The four-row ledger was a screen's worth of chrome
    // on a phone; the VALUES carry everything the labels were saying.
    const kv = el('div', 'm-statline');
    bindText(kv, () => ctx.driveStats().map(([, v]) => v).join(' · '));
    const cta = el('button', 'm-cta');
    cta.append(ico(ICON.car), el('span', 'lab', 'DRIVE'));
    cta.addEventListener('click', () => { ctx.drive(); close(); });
    const gps = el('button', 'm-cta alt');
    gps.append(ico(ICON.gps), el('span', 'lab', ''));
    gps.addEventListener('click', () => { ctx.realToggle(); refresh(); });
    updaters.push(() => {
      const r = ctx.real();
      setLab(gps, r.on ? 'GPS DRIVE ON - TAP TO END' : r.err ? r.err : 'GPS DRIVE - THE DEVICE IS THE CAR');
      const col = r.on ? C.good : r.err ? C.bad : C.hot;
      gps.style.color = col;
      gps.style.borderColor = col;
    });
    const nav = el('div', 'm-nav');
    // THE LINE leads the stack: the campaign is the game's spine, and the row
    // says where you stand on it without demanding anything.
    const lineRow = el('div', 'm-navrow');
    const lnIco = ico(ICON.road), lnName = el('span', 'name', 'THE LINE'),
      lnSub = el('span', 'sub', ''), lnChev = el('span', 'chev', '>');
    lineRow.append(lnIco, lnName, lnSub, lnChev);
    lineRow.addEventListener('click', () => setTab(T_LINE));
    updaters.push(() => {
      const ln = ctx.line();
      lnSub.textContent = ln.on ? ln.rows[0]?.[1] ?? 'ON THE LINE' : ln.cta;
      lnName.style.color = ln.on ? C.good : C.text;
      lnChev.style.color = ln.on ? C.good : C.gold;
    });
    nav.appendChild(lineRow);
    for (const [t, name, sub, icon] of [
      [T_RIG, 'RIG', 'TUNE AND DRESS THE TRUCK', ICON.truck],
      [T_WORLD, 'DRIVES', 'DESTINATIONS · SPOTS · ELSEWHERE', ICON.map],
      [T_SURVEY, 'SURVEYS', 'ROADS DRIVEN AND CLAIMED', ICON.flag],
      [T_SYSTEM, 'SETTINGS', 'RENDER · WORLD · SOUND', ICON.gear],
    ] as Array<[number, string, string, string]>) {
      const row = el('div', 'm-navrow');
      row.append(ico(icon), el('span', 'name', name), el('span', 'sub', sub), el('span', 'chev', '>'));
      row.addEventListener('click', () => setTab(t));
      nav.appendChild(row);
    }
    // …and PROGRESS, in the same stack rather than shouting above it. A player
    // who never taps it loses nothing, so it reads as one more section — but it
    // is ON THE SPLASH, because a sign-in buried three screens down is a sign-in
    // nobody finds until after they have driven a thousand kilometres.
    //
    // SIGNED OUT it is the only place that starts the redirect; SIGNED IN it
    // reports and hands off to SETTINGS. Signing out is a destructive tap and
    // does not belong on the screen you land on.
    const signRow = el('div', 'm-navrow');
    const signIco = ico(ICON.save), signName = el('span', 'name', ''),
      signSub = el('span', 'sub', ''), signChev = el('span', 'chev', '>');
    signRow.append(signIco, signName, signSub, signChev);
    signRow.addEventListener('click', () => {
      if (ctx.syncPhase() === 'off') ctx.syncTap();      // …which navigates to the apex
      else setTab(T_SYSTEM);
    });
    updaters.push(() => {
      const p = ctx.syncPhase();
      const out = p === 'off';
      signName.textContent = out ? 'SIGN IN' : 'PROGRESS';
      signName.style.color = out ? C.gold : C.text;
      signSub.textContent = out ? 'PROGRESS ON EVERY DEVICE' : ctx.syncNote();
      signSub.style.color = ctx.syncTone() === 'bad' ? C.bad : C.dim;
      signChev.style.color = out ? C.gold : C.edge;
    });
    nav.appendChild(signRow);
    // The way home: the attract reel carried this session somewhere else, and
    // the ticket back sits in the stack until it is spent. Hidden otherwise.
    const retRow = el('div', 'm-navrow ret');
    retRow.append(ico(ICON.gps), el('span', 'name', 'RETURN'),
      el('span', 'sub', 'BACK TO WHERE YOU WERE'), el('span', 'chev', '>'));
    retRow.addEventListener('click', () => ctx.attractRetGo?.());
    nav.appendChild(retRow);
    updaters.push(() => { retRow.style.display = ctx.attractRet?.() ? 'flex' : 'none'; });
    // The scene IS the splash's background — no scrim, no window (the .hub
    // class kills the strips): the rig stands in the live world behind
    // everything, and the spacer holds the sections down where the chase
    // camera keeps the truck visible between the stats and the buttons.
    const spacer = el('div', '');
    spacer.style.flex = '1';
    body.append(place, situation, kv, spacer, nav);
    // DRIVE anchors the BOTTOM of the page — pinned in the foot, under the
    // sections, always reachable without scrolling past it.
    foot.append(cta, gps);
  }

  function renderSurveys(): void {
    body.appendChild(el('div', 'm-sect', 'UNDER THE WHEELS'));
    const here = ctx.surveyHere();
    if (here) {
      const row = el('div', 'm-row');
      const name = el('span', 'name', here.name);
      name.style.color = C.text;
      const tally = el('span', 'sub', here.tally);
      tally.style.color = tone(here.tone);
      row.append(name, tally);
      body.append(row, meterEl(24, Math.round(here.frac * 24), tone(here.tone)));
      const state = el('div', 'm-dimline', here.state);
      state.style.color = tone(here.tone);
      body.appendChild(state);
    } else {
      body.appendChild(el('div', 'm-dimline', 'NO NAMED ROAD NEARBY'));
    }
    const t = ctx.surveyTotals();
    const hdr = el('div', 'm-row');
    hdr.append(el('span', 'name', `ROADS ${t.roads}`), el('span', 'sub', `${t.got}/${t.total} CHECKPOINTS`));
    (hdr.firstChild as HTMLElement).style.color = C.dim;
    body.append(el('div', 'm-rule'), hdr);
    for (const r of ctx.surveyRoads()) {
      const row = el('div', 'm-row');
      const name = el('span', 'name', r.name);
      name.style.color = tone(r.tone);
      name.style.flex = '1';
      const km = el('span', '', r.km);
      km.style.color = C.dim;
      const n = el('span', '', r.tally);
      n.style.color = C.dim;
      row.append(name, km, meterEl(10, Math.round(r.frac * 10), tone(r.tone), 3), n);
      body.appendChild(row);
    }
  }

  // RIG leads with what you can CHANGE — the dials — then the drawings that
  // prove what you built against the sheet.
  function renderRig(): void {
    const views = el('div', 'm-views');
    const chips: HTMLButtonElement[] = [];
    ctx.views().forEach((id, i) => {
      const b = el('button', `m-view${ctx.vehView() === i ? ' on' : ''}`, id);
      b.addEventListener('click', () => {
        ctx.setVehView(i);
        chips.forEach((c, j) => c.classList.toggle('on', j === i));
      });
      chips.push(b);
      views.appendChild(b);
    });
    bayEl = mkBay();
    body.append(views, bayEl);
    for (const g of ctx.dialGroups('rig')) {
      dialsInto(body, [g]);
      if (g.title !== 'VEHICLE') continue;
      // The custom swatch lives WITH the paint dial it overrides: any hex,
      // native picker, persisted — and the preset dial clears it when cycled,
      // so the updater keeps the swatch honest about what the truck wears.
      const row = el('div', 'm-dial');
      row.style.cursor = 'default';
      row.append(el('span', 'lab', 'PAINT · CUSTOM'));
      const input = el('input', '');
      input.type = 'color';
      input.value = ctx.paint();
      input.addEventListener('input', () => ctx.setPaint(input.value));
      updaters.push(() => {
        if (document.activeElement !== input && input.value !== ctx.paint()) input.value = ctx.paint();
      });
      row.appendChild(input);
      body.appendChild(row);
    }
    const t = el('table', 'm-kv');
    {
      const tr = el('tr', '');
      for (const h of ['DIMENSIONS', 'BUILT', 'SPEC']) tr.append(el('td', '', h));
      t.appendChild(tr);
      for (const d of ctx.dims()) {
        const tr2 = el('tr', '');
        const built = el('td', '', d.built);
        built.style.color = d.ok ? C.good : C.hot;
        const spec = el('td', '', d.spec);
        spec.style.color = C.dim;
        tr2.append(el('td', '', d.k), built, spec);
        t.appendChild(tr2);
      }
    }
    body.append(el('div', 'm-sect', 'MEASURED'), t, el('div', 'm-sect', 'SHEET'), kvTable(ctx.specText));
  }

  function renderDrives(): void {
    body.appendChild(el('div', 'm-sect', 'DESTINATIONS'));
    // CURRENT leads the list: the one destination that is always true. It
    // geolocates on the tap — the gesture the permission prompt needs — and
    // reports its progress where its subtitle was.
    {
      const row = el('div', 'm-row hit');
      const name = el('span', 'name', 'CURRENT');
      name.style.color = C.hot;
      const sub = el('span', 'sub', currentStatus?.s ?? 'WHERE THE DEVICE IS');
      if (currentStatus?.bad) sub.style.color = C.bad;
      row.append(ico(ICON.here, C.hot), name, sub);
      row.addEventListener('click', () => {
        ctx.goCurrent((s, bad) => { currentStatus = { s, bad: !!bad }; sub.textContent = s; sub.style.color = bad ? C.bad : C.dim; });
      });
      body.appendChild(row);
    }
    ctx.drives().forEach((d, i) => {
      const row = el('div', 'm-row hit');
      const name = el('span', 'name', d.name);
      name.style.color = d.mine ? C.gold : C.text;
      const sub = el('span', 'sub', d.sub);
      row.append(ico(d.mine ? ICON.tack : ICON.pin, d.mine ? C.gold : C.dim), name, sub);
      if (d.mine) {
        const x = el('span', 'del', 'X');
        x.addEventListener('click', (e) => { e.stopPropagation(); ctx.deleteSpot(i); render(); });
        row.appendChild(x);
      }
      row.addEventListener('click', () => ctx.startDrive(i));
      body.appendChild(row);
    });
    foot.append(
      button('SAVE THIS SPOT', C.gold, () => { ctx.saveSpot(); render(); }, ICON.save),
      button('ELSEWHERE - ANYWHERE ON EARTH', C.gold, () => ctx.elsewhere(), ICON.dice),
    );
    // ── google maps, both directions ──
    // The paste field is built once and only SHOWN on the tap, so the common
    // case (browsing the list) is not a screen with a text box on it.
    const paste = el('div', 'm-paste');
    paste.style.display = 'none';
    const field = el('input', '');
    field.type = 'text';
    field.placeholder = 'PASTE LINK, OR LAT, LON';
    // Every autocorrect a phone offers will damage a URL.
    field.autocapitalize = 'off'; field.autocomplete = 'off'; field.spellcheck = false;
    const note = el('div', 'note', 'SHORT LINKS FOLLOWED FOR YOU');
    const say = (s: string, bad?: boolean): void => { note.textContent = s; note.style.color = bad ? C.bad : C.dim; };
    const go = (): void => ctx.openGmap(field.value, say);
    field.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') go(); });
    // A pasted link is the whole intent — waiting for a second tap on GO is a
    // step with nothing in it. The timeout lets the value land first.
    field.addEventListener('paste', () => setTimeout(go, 0));
    paste.append(field, button('GO THERE', C.good, go, ICON.here), note);
    const open = button('FROM A GOOGLE MAPS LINK', C.gold, () => {
      const showing = paste.style.display !== 'none';
      paste.style.display = showing ? 'none' : 'grid';
      if (!showing) field.focus();
    }, ICON.map);
    const share = button('THIS SPOT AS A GOOGLE MAPS LINK', C.gold, () => {
      const link = ctx.shareGmap((s, bad) => {
        const lab = share.querySelector('.lab') as HTMLElement | null;
        if (lab) lab.textContent = s;
        share.style.color = bad ? C.bad : C.good;
        share.style.borderColor = bad ? C.bad : C.good;
      });
      // Wherever it went, show it too: a link you can see is one you can copy
      // by hand when the share sheet and the clipboard are both unavailable.
      paste.style.display = 'grid';
      field.value = link;
      field.select();
    }, ICON.pin);
    foot.append(open, share, paste);
    // ── banked runs ──
    // The shelf lives HERE, on the primary screen, because a banked drive is a
    // place as much as a recording. A tap drives its spot; the link glyph puts
    // the run's public URL in the paste field, selected, ready to share or to
    // hand to the reel. (BANK KEPT RUN itself stays in SETTINGS with the
    // recorder it banks from.)
    const shelf = ctx.tapeShelf?.() ?? [];
    if (shelf.length) {
      body.appendChild(el('div', 'm-sect', 'BANKED RUNS'));
      for (const t of shelf) {
        const row = el('div', 'm-row hit');
        const d = new Date(t.at);
        const mm = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
        const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        const name = el('span', 'name', `${mm}-${dd} ${hhmm}`);
        const sub = el('span', 'sub', `${Math.round(t.secs)}S · ${t.lat.toFixed(2)} ${t.lon.toFixed(2)}`);
        const link = el('span', 'del', '⧉');
        link.addEventListener('click', (e) => {
          e.stopPropagation();
          paste.style.display = 'grid';
          field.value = t.url;
          field.select();
          say('THE RUN’S LINK — OPENS THE GAME AT THE RUN, WITH PLAY');
        });
        row.append(ico(ICON.gps, C.dim), name, sub, link);
        // Tapping a RUN means PLAY IT (owner-asked) — the hop and the rolling
        // card, not merely a drive to its coordinates.
        row.addEventListener('click', () => {
          if (ctx.runPlay) ctx.runPlay(t.id);
          else ctx.openGmap(`${t.lat}, ${t.lon}`, say);
        });
        body.appendChild(row);
      }
    }
  }

  function renderLine(): void {
    const ln = ctx.line();
    body.append(el('div', 'm-place', ln.title));
    body.append(el('div', 'm-dimline', ln.on
      ? 'ON THE LINE · POSITION AND DISTANCE PERSIST'
      : ln.started ? 'OFF THE LINE · THE RUN IS SAVED WHERE YOU LEFT IT' : 'THE SERVICE HAS A DOCKET FOR YOU'));
    const kv = kvTable(() => ctx.line().rows);
    body.append(kv);
    body.append(el('div', 'm-sect', 'LEGS'));
    for (const leg of ln.legs) {
      const row = el('div', 'm-row');
      const name = el('span', 'name', leg.title);
      const tally = el('span', 'sub', leg.state);
      name.style.color = leg.state === 'DONE' ? C.good : leg.state === 'OPEN' ? C.text : C.dim;
      tally.style.color = leg.state === 'DONE' ? C.good : leg.state === 'OPEN' ? C.gold : C.dim;
      row.append(name, tally);
      body.append(row);
      const brief = el('div', 'm-dimline', leg.brief);
      brief.style.color = leg.state === 'AHEAD' ? C.edge : C.dim;
      body.append(brief);
    }
    body.append(el('div', 'm-dimline', ln.note));
    // One CTA, pinned in the foot. On the line already: nothing to press —
    // close the menu and drive.
    if (!ln.on) {
      const cta = el('button', 'm-cta');
      cta.append(ico(ICON.road), el('span', 'lab', ln.cta));
      cta.addEventListener('click', () => { ctx.lineGo(); });
      foot.append(cta);
    } else {
      const back = el('button', 'm-cta');
      back.append(ico(ICON.car), el('span', 'lab', 'DRIVE'));
      back.addEventListener('click', () => close());
      foot.append(back);
    }
  }

  function renderSettings(): void {
    body.appendChild(kvTable(ctx.systemRows));
    // SIGNING IN IS OPTIONAL AND SAYS SO. A player who never touches this keeps
    // playing exactly as before, with progress on the device — so the row leads
    // with what it does rather than with a demand.
    body.append(el('div', 'm-sect', 'PROGRESS'));
    const syncNote = el('div', 'm-dimline', ctx.syncNote());
    const sync = button('', C.soft, () => { ctx.syncTap(); refresh(); }, ICON.save);
    updaters.push(() => {
      const col = tone(ctx.syncTone());
      setLab(sync, ctx.syncLabel());
      sync.style.color = col;
      sync.style.borderColor = col;
      syncNote.textContent = ctx.syncNote();
      // The note is where a failure actually reads — the button says what you
      // can do, the line under it says what happened.
      syncNote.style.color = ctx.syncTone() === 'bad' ? C.bad : C.dim;
    });
    body.append(sync, syncNote);
    // THE CAMPAIGN RESET. Destructive, so deliberately two-tap: the first
    // arms, the second wipes — and the armed state stands down on its own if
    // the second tap never comes. It hands the docket back (run, missions,
    // station wakes, here and in the durable copy when signed in) and leaves
    // the career alone: roads, claims and the odometer are not the
    // campaign's to take.
    const resetNote = el('div', 'm-dimline',
      'HANDS THE DOCKET BACK — RUN, LEGS, STATION ACTIVATIONS. ROADS AND ODOMETER KEEP.');
    let armedAt = 0;
    const disarm = (): void => {
      armedAt = 0;
      setLab(reset, 'RESET THE LINE');
      reset.style.color = C.soft;
      reset.style.borderColor = C.soft;
    };
    const reset = button('RESET THE LINE', C.soft, () => {
      if (Date.now() - armedAt > 4000) {
        armedAt = Date.now();
        setLab(reset, 'TAP AGAIN TO WIPE THE RUN');
        reset.style.color = C.bad;
        reset.style.borderColor = C.bad;
        setTimeout(() => { if (armedAt && Date.now() - armedAt >= 4000) disarm(); }, 4200);
        return;
      }
      disarm();
      ctx.lineReset((s, bad) => {
        resetNote.textContent = s;
        resetNote.style.color = bad ? C.bad : C.dim;
      });
    }, ICON.flag);
    body.append(reset, resetNote);
    // ── the recorder ──
    // A DEV INSTRUMENT FIRST. It sits under the dials rather than in the deck
    // because nothing here is wanted mid-corner: you notice something, you
    // stop, you keep the last two minutes and play them back.
    const tapeNote = el('div', 'm-dimline', '');
    const keep = button('KEEP LAST RUN', C.soft, () => {
      tapeNote.textContent = ctx.tapeKeep();
      refresh();
    }, ICON.save);
    // CUT: the ring is always turning, so a run KEPT off it starts wherever
    // the trimming left it. This says "start here" — the deck's RING clock
    // drops to 0:00 and the next KEEP holds exactly what you drove after it.
    const cut = button('CUT RING - START HERE', C.soft, () => {
      bankNote.style.display = '';
      bankNote.textContent = ctx.tapeClear?.() ?? '';
      refresh();
    }, ICON.flag);
    // BANK: the kept run, made durable and shareable. Its OWN note line: the
    // recorder's status updater rewrites tapeNote every tick, so the BANKED
    // line (with the public URL in it) survived less than a second there —
    // which read as the bank not working at all (owner-caught).
    const bankNote = el('div', 'm-dimline', '');
    bankNote.style.display = 'none';
    const bank = button('BANK KEPT RUN', C.soft, () => {
      bankNote.style.display = '';
      bankNote.textContent = 'BANKING…';
      void ctx.tapeBank?.().then((s) => { bankNote.textContent = s; });
    }, ICON.gps);
    const play = button('PLAY LAST RUN', C.soft, () => {
      const t = ctx.tape();
      if (t.playing || t.armed) { ctx.tapeStopPlay(); } else { ctx.tapePlay(); close(); }
      refresh();
    }, ICON.gps);
    updaters.push(() => {
      const t = ctx.tape();
      const mm = Math.floor(t.ring / 60), ss = String(Math.round(t.ring % 60)).padStart(2, '0');
      // The status says what it HOLDS and whether it is worth keeping, which is
      // the one thing a tape of moving ground cannot tell you afterwards.
      tapeNote.textContent = t.playing
        ? `PLAYING ${t.at}/${t.of} · DRIFT ${t.drift}M`
        : `RING ${mm}:${ss} · ${t.kb}KB${t.settled ? '' : ' · GROUND STILL ARRIVING'}`;
      tapeNote.style.color = t.settled || t.playing ? C.dim : C.bad;
      setLab(play, t.playing || t.armed ? 'STOP PLAYBACK' : 'PLAY LAST RUN');
      setLab(keep, t.kept ? `KEEP LAST RUN (${t.kept})` : 'KEEP LAST RUN');
    });
    body.append(cut, keep, bank, play, tapeNote, bankNote);
    dialsInto(body, ctx.dialGroups('system'));
    const snd = button('', C.soft, () => { ctx.soundTap(); refresh(); }, ICON.sound);
    updaters.push(() => {
      const col = tone(ctx.soundTone());
      setLab(snd, ctx.soundLabel());
      snd.style.color = col;
      snd.style.borderColor = col;
    });
    foot.append(snd, button('HIDE HUD', C.soft, () => { close(); ctx.hideHud(); }, ICON.hide));
  }

  // ── render / refresh ───────────────────────────────────────────────
  /** What forces a REBUILD, per screen — everything else updates in place. */
  function sig(): string {
    if (tab === T_SURVEY) {
      const h = ctx.surveyHere();
      return `s|${h?.name}|${h?.tally}|${h?.state}|${ctx.surveyRoads().map((r) => r.tally).join(',')}`;
    }
    if (tab === T_WORLD) return `w|${ctx.drives().length}`;
    if (tab === T_LINE) { const ln = ctx.line(); return `l|${ln.on}|${ln.cta}|${ln.legs.map((g) => g.state).join(',')}`; }
    return String(tab);
  }

  function render(): void {
    if (tab === null) return;
    const scroll = body.scrollTop;
    body.replaceChildren();
    foot.replaceChildren();
    bayEl = null;
    updaters = [];
    renderHead();
    ([
      renderHome, renderSurveys, renderRig, renderDrives, renderSettings, renderLine,
    ][tab] ?? renderHome)();
    // FILL THE VALUES BEFORE THE SCREEN IS SEEN. Everything dynamic here is
    // created empty and written by an updater, and the updaters only ran on the
    // 400ms tick — so every build showed blank labels for up to that long. Most
    // visible on the splash, which is the first screen anybody ever looks at,
    // and which now has a row that is nothing BUT its updater.
    for (const u of updaters) u();
    structSig = sig();
    body.scrollTop = scroll;
  }

  function setTab(t: number): void {
    tab = t;
    body.scrollTop = 0;
    // The hub is CLEAR — the live scene is its background; the pages keep
    // the scrim (RIG punches its studio hole through it via bayRect).
    root.classList.toggle('hub', t === T_DRIVE);
    if (t !== T_RIG && t !== T_DRIVE) scrimFull();
    render();
  }

  function open(t = T_DRIVE): void {
    root.style.display = 'block';
    document.body.classList.add('menu-open');   // overlays.ts hides the HUD's DOM behind the scrim
    currentStatus = null;
    setTab(t);
  }

  function close(): void {
    tab = null;
    bayEl = null;
    root.style.display = 'none';
    document.body.classList.remove('menu-open');
  }

  function bayRect(): Rect | null {
    if ((tab !== T_RIG && tab !== T_DRIVE) || !bayEl || !bayEl.isConnected) return null;
    const r = bayEl.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    // Aim the scrim's hole here. Clamp to the body's box so a half-scrolled
    // bay doesn't open a window over the header.
    const clip = body.getBoundingClientRect();
    const x0 = Math.max(r.left, clip.left), x1 = Math.min(r.right, clip.right);
    const y0 = Math.max(r.top, clip.top), y1 = Math.min(r.bottom, clip.bottom);
    if (x1 - x0 < 4 || y1 - y0 < 4) { scrimFull(); return null; }
    const px = (n: number): string => `${Math.round(n)}px`;
    Object.assign(strips[0].style, { display: 'block', left: '0', top: '0', right: '0', bottom: px(innerHeight - y0) });
    Object.assign(strips[1].style, { display: 'block', left: '0', top: px(y1), right: '0', bottom: '0' });
    Object.assign(strips[2].style, { display: 'block', left: '0', top: px(y0), width: px(x0), height: px(y1 - y0), right: 'auto', bottom: 'auto' });
    Object.assign(strips[3].style, { display: 'block', left: px(x1), top: px(y0), right: '0', height: px(y1 - y0), bottom: 'auto', width: 'auto' });
    // The SPLASH hole is a window onto the live scene — the rig in chase cam
    // against its vista. Only the RIG page wants the studio render aimed in.
    if (tab !== T_RIG) return null;
    // The metre grid, from the same extents the renderer frames with.
    const grid = ctx.bayGrid(r.width, r.height);
    const key = grid ? `${ctx.vehView()}:${Math.round(r.width)}x${Math.round(r.height)}` : `plain:${ctx.vehView()}`;
    if (key !== bayGridFor) {
      bayGridFor = key;
      const cap = bayEl.querySelector('.cap') as HTMLElement;
      if (grid) {
        cap.textContent = grid.caption;
        const g = 'rgba(87,201,176,0.13)';
        bayEl.style.backgroundImage =
          `repeating-linear-gradient(to right, ${g} 0 1px, transparent 1px ${grid.pxPerM}px),` +
          `repeating-linear-gradient(to bottom, ${g} 0 1px, transparent 1px ${grid.pxPerM}px)`;
        bayEl.style.backgroundPosition = `${(r.width / 2) % grid.pxPerM}px ${(r.height / 2) % grid.pxPerM}px`;
      } else {
        cap.textContent = '';
        bayEl.style.backgroundImage = 'none';
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function refresh(): void {
    if (tab === null) return;
    if (sig() !== structSig) { render(); return; }
    for (const u of updaters) u();
  }
  // Readouts move while the page is up (the odometer, the survey, a GPS fix
  // arriving). Values track on a slow clock; the DOM is only rebuilt when the
  // structure itself changes, so a finger is never on a node a rebuild is
  // about to detach.
  setInterval(refresh, 400);

  return { open, close, tab: () => tab, bayRect, refresh };
}
