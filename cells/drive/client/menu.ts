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
import { RIG_EQUIPMENT, type RigEquipmentId } from './rig-equipment';
import { RIG_MODELS, type RigModelId, type RigLoadoutId } from './rig-model';
import { PIXEL_FONT, PIXEL_FONT_CSS, loadPixelFont } from './font';
import { ICON, ICON_FONT, loadIcons } from './icons';

// Screen indices are the probe API (__menutab) and predate the redesign:
// 0 was the DRIVE tab and is now the splash hub; the rest keep their numbers.
export const T_DRIVE = 0, T_SURVEY = 1, T_RIG = 2, T_WORLD = 3, T_SYSTEM = 4, T_LINE = 5, T_ABOUT = 6, T_PROGRESS = 7;
const TITLES: Record<number, string> = { [T_SURVEY]: 'SURVEYS', [T_RIG]: 'RIG', [T_WORLD]: 'DRIVES', [T_SYSTEM]: 'SETTINGS', [T_LINE]: 'THE LINE', [T_ABOUT]: 'ABOUT', [T_PROGRESS]: 'PROGRESS' };

export interface Rect { x: number; y: number; w: number; h: number }

/** Structurally the same object main.ts keeps in DIAL_GROUPS — the menu
 *  mutates nothing itself; `cycleDial` hands the SAME object back. */
export interface DialRef { label: string; opts: string[]; at: number; bar?: boolean }
export interface DialGroupRef { title: string; dials: DialRef[] }

type Tone = 'edge' | 'dim' | 'text' | 'soft' | 'gold' | 'hot' | 'good' | 'bad';

export interface MenuCtx {
  rigChoice(): { model: RigModelId; loadout: RigLoadoutId; equipment: RigEquipmentId[] };
  rigChoose(model: RigModelId, loadout: RigLoadoutId, equipment?: RigEquipmentId[]): void;
  registration(): string;
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
  /** The reel as a programme: how many stops it has, which is showing
   *  (-1 = the player's own spot), and whether there is a home to go back to. */
  reel?(): { n: number; at: number; home: boolean };
  /** -1 is home; 0..n-1 are the reel's stops. */
  reelGo?(i: number): void;
  driveStats(): Array<[string, string]>;
  worldRows(): Array<[string, string]>;
  systemRows(): Array<[string, string]>;
  /** Every switch this build has, from `switches.ts`, with what THIS session is
   *  running. Rendered whole and not filtered: the panel exists so that a
   *  switch cannot be forgotten, and a list that hides the ones nobody set
   *  hides exactly the ones nobody remembers. Optional: older ctx builds. */
  switches?(): Array<{ id: string; note: string; kind: string; value: string; raw: string | null;
    set: boolean; marks: readonly string[] }>;
  /** This page's URL with a staged set of switch changes applied and
   *  everything else preserved — what RELOAD spends. Built in `switches.ts`
   *  so the preservation rule lives beside the table it preserves. */
  switchUrl?(changes: Record<string, string | null>): string;
  /** The build's own identity, for the foot of ABOUT — a page that credits
   *  everyone and cannot say WHICH build the reader is looking at is half a
   *  page, and the first question of any report is which version it was. */
  aboutRows(): Array<[string, string]>;
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
  /** What this device is holding — tile counts and the origin's quota use.
   *  Synchronous by contract: the measurement is async, so this answers with
   *  the last one and asks for a fresh one on its own schedule. */
  storageNote(): string;
  /** Empty the world cache — OSM ways and raster tiles — without a reload and
   *  without touching settings, progress or sign-in. */
  cacheClear(status: (s: string, bad?: boolean) => void): void;
  /** Hand the whole device back: every key, every database, every cache, and
   *  the service worker. Signs out; the durable copy is not touched. Reloads
   *  when it is done, for the same reason lineReset does. */
  deviceReset(status: (s: string, bad?: boolean) => void): void;
  /** Load the eruda console onto the page — a devtools panel for a phone —
   *  and report through `status` whether it came. */
  devConsole(status: (s: string, bad?: boolean) => void): void;
  /** Reload this page with `?eruda=1`, the one kind of load the cell serves
   *  under a policy that lets the console's prompt run code. */
  devReload(status: (s: string, bad?: boolean) => void): void;
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
  rigLive(): boolean;
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
    font-size: 12px; line-height: 1.5; -webkit-user-select: none; user-select: none;
    --m-ink: rgba(4,10,11,0.98);
    --m-pixel-outline:
      -1px 0 0 var(--m-ink), 1px 0 0 var(--m-ink),
      0 -1px 0 var(--m-ink), 0 1px 0 var(--m-ink),
      -1px -1px 0 var(--m-ink), 1px 1px 0 var(--m-ink),
      -1px 1px 0 var(--m-ink), 1px -1px 0 var(--m-ink),
      0 2px 6px rgba(4,10,11,0.85); }
  #menu .m-scrim { position: absolute; }
  #menu .m-panel { position: absolute;
    top: calc(10px + env(safe-area-inset-top, 0px));
    right: calc(10px + env(safe-area-inset-right, 0px));
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    left: calc(10px + env(safe-area-inset-left, 0px));
    border: 1px solid ${C.dim};
    display: flex; flex-direction: column; padding: 10px 0 10px; min-height: 0;
    text-shadow: var(--m-pixel-outline); }
  #menu .m-corner { position: absolute; width: 9px; height: 9px; }
  #menu button { font: inherit; }
  #menu .m-head { display: flex; align-items: center; gap: 8px; padding: 0 12px; min-height: 44px; }
  #menu .m-back { cursor: pointer; color: ${C.soft}; border: 1px solid ${C.dim};
    background: rgba(8,20,23,0.78); padding: 3px 8px 2px; font-size: 10px;
    min-width: 44px; min-height: 44px; }
  #menu .m-title { color: ${C.gold}; font-weight: 700; font-size: 16px; }
  #menu .m-title .arrow { color: ${C.hot};  }
  #menu .m-sub { padding: 2px 12px 6px; color: ${C.dim}; font-size: 10px; letter-spacing: 2px; }
  #menu .m-x { margin-left: auto; cursor: pointer; color: ${C.hot}; border: 1px solid ${C.hot};
    background: transparent; padding: 3px 8px 2px; font-size: 10px;
    min-width: 44px; min-height: 44px; }
  #menu .m-rule { border-top: 1px solid ${C.dim}; margin: 4px 8px; }
  #menu .m-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
    padding: 6px 12px 4px; display: flex; flex-direction: column; }
  #menu .m-place { color: ${C.gold}; font-size: 16px; font-weight: 700;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #menu .m-dimline { color: ${C.dim}; font-size: 10px; margin: 2px 0 6px; }
  /* The carousel. Hit boxes are 32px tall with the ink drawn small inside —
     a 6px dot is a 6px target otherwise, and this strip sits where a thumb
     rests on a phone. */
  #menu .m-dots { display: flex; gap: 2px; justify-content: center;
    align-items: center; padding: 2px 8px 0; flex-wrap: wrap; }
  #menu .m-dot { -webkit-appearance: none; appearance: none; background: none;
    border: 0; cursor: pointer; padding: 0; width: 22px; height: 32px;
    position: relative; }
  /* THE UNVISITED DOTS HAVE TO BE VISIBLE — they are the "how many" half of
     the affordance, and at dim-grey-on-a-live-sunset they read as dirt on the
     screen. Photographed: the strip was there and could not be found. Soft
     ink, a size that survives the pixel grid, and the same near-black ring
     every glyph in this menu wears so they hold over any scene behind them. */
  #menu .m-dot::after { content: ''; position: absolute; left: 50%; top: 50%;
    width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%;
    background: ${C.soft}; box-shadow: 0 0 0 2px rgba(4,10,11,0.92); }
  /* HOME is a SQUARE. The one stop that is not a recording should not look
     like one, and shape reads before colour at this size. */
  #menu .m-dot.home::after { border-radius: 0; width: 9px; height: 9px;
    margin: -4.5px 0 0 -4.5px; background: ${C.good}; }
  #menu .m-dot.home.off::after { background: ${C.dim}; }
  #menu .m-dot.on::after { background: ${C.gold}; width: 12px; height: 12px;
    margin: -6px 0 0 -6px; box-shadow: 0 0 0 2px rgba(4,10,11,0.92); }
  #menu .m-dot.home.on::after { background: ${C.good}; }
  #menu .m-dotlab { text-align: center; font-size: 10px; letter-spacing: 2px;
    padding: 0 8px 4px; }
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
  /* A CREDIT MUST NOT BE ELLIPSISED. Every other name in this menu is a road
     or a rig and fits; an attribution is a sentence with a licence in it, and
     .m-row's clip turned "contains modified Copernicus Sentinel data" into
     "CONTAINS MODI…". The DOM test could not see it — textContent is whole
     however the box clips — and it took the screenshot to catch, which is the
     argument for taking one. */
  #menu .m-credit { white-space: normal; overflow-wrap: anywhere; padding: 1px 0; }
  #menu .m-row .sub { margin-left: auto; color: ${C.dim}; font-size: 10px; text-align: right;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; max-width: 55%; }
  #menu .m-row .del { color: ${C.soft}; cursor: pointer; padding: 0 6px; flex-shrink: 0; }
  #menu .m-meter { display: inline-flex; gap: 1px; align-self: center; flex-shrink: 0; }
  #menu .m-meter i { width: 4px; height: 4px; background: rgba(87,201,176,0.16); }
  /* ── A ROW YOU CAN TAP IS 44px, AND ONLY A ROW YOU CAN TAP ──
     The panel already sized its back, close, carousel and chip controls to 44
     and then laid the bulk of its actual surface — every dial, every list row
     — out at 3px of padding, which is most of SETTINGS, DRIVES and SURVEYS.
     The fix is on .hit and .m-dial rather than on .m-row flat, because
     the rows that are NOT tappable (a credit, a spec line, a dimensions
     table) do not need a thumb's worth of height and blowing those up would
     add a screen of scrolling to pages nobody taps. */
  #menu .m-row.hit { min-height: 44px; align-items: center; }
  #menu .m-switches { display: flex; flex-direction: column; }
  #menu .m-switch { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 8px;
    align-items: center; min-height: 44px; padding: 4px 2px; cursor: pointer;
    border-bottom: 1px solid rgba(87,201,176,0.08); }
  #menu .m-switch:focus-visible { outline: 1px solid ${C.gold}; outline-offset: -1px; }
  #menu .m-switch .sw-id { color: ${C.soft}; font-size: 12px; }
  #menu .m-switch .sw-val { grid-column: 3; color: ${C.gold}; font-size: 12px; text-align: right;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40vw; }
  #menu .m-switch .sw-val.unset { color: ${C.dim}; }
  #menu .m-switch .sw-note { grid-column: 1 / -1; color: ${C.dim}; font-size: 9px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #menu .m-switch .sw-marks { display: flex; gap: 4px; flex-wrap: wrap; }
  #menu .m-switch .tag { font-style: normal; font-size: 8px; letter-spacing: 1px;
    padding: 1px 3px; border: 1px solid ${C.dim}; color: ${C.dim}; }
  /* The marks that change what you are looking at read warm; the ones that
     only matter to a bench stay quiet; legacy is the retirement list and is
     the one worth spotting from across the page. */
  #menu .m-switch .tag.look, #menu .m-switch .tag.world { color: ${C.soft}; border-color: ${C.soft}; }
  #menu .m-switch .tag.legacy { color: ${C.hot}; border-color: ${C.hot}; }
  #menu .m-switch.staged { background: rgba(190,152,77,0.10); }
  #menu .m-switch.staged .sw-id { color: ${C.gold}; }
  #menu .m-dial { display: flex; align-items: center; gap: 8px; padding: 3px 2px; cursor: pointer; min-height: 44px; }
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
  /* The live scene can be any country at any hour, so every menu word carries
     the panel's inherited 1px pixel ink rather than relying on a soft shadow. */
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

  /* The hub belongs to the glass: generous invisible hit areas, a small
     amount of drawn ink. Keep the world and the truck as the hero. */
  #menu button { text-shadow: inherit; border-radius: 0; touch-action: manipulation; }
  #menu button:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 3px; }
  #menu.hub .m-nav { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 6px; }
  #menu.hub .m-navrow { position: relative; border: 0; background: transparent;
    min-height: 52px; padding: 8px 3px; gap: 4px; color: ${C.text}; }
  #menu.hub .m-navrow::before, #menu.hub .m-navrow::after {
    content: ''; position: absolute; width: 7px; height: 7px; pointer-events: none; }
  #menu.hub .m-navrow::before { top: 0; left: 0; border-top: 1px solid ${C.edge}; border-left: 1px solid ${C.edge}; }
  #menu.hub .m-navrow::after { bottom: 0; right: 0; border-bottom: 1px solid ${C.edge}; border-right: 1px solid ${C.edge}; }
  #menu.hub .m-navrow .name { font-size: 10px; letter-spacing: 0.3px; }
  #menu.hub .m-navrow .ico { font-size: 12px; color: ${C.gold}; }
  #menu.hub .m-utilities { display: flex; justify-content: center; flex-wrap: wrap;
    gap: 4px 16px; margin-top: 6px; border-top: 1px solid ${C.dim}; }
  #menu.hub .m-utilities .m-navrow { flex-direction: row; min-height: 44px;
    padding: 4px; gap: 6px; }
  #menu.hub .m-utilities .m-navrow::before, #menu.hub .m-utilities .m-navrow::after { display: none; }
  #menu.hub .m-utilities .name { font-size: 9px; color: ${C.soft}; }
  #menu.hub .m-utilities .ico { font-size: 10px; color: ${C.soft}; }
  #menu.hub .m-cta:first-child { position: relative; background: rgba(8,20,23,0.36);
    border: 0; border-top: 1px solid ${C.gold}; border-bottom: 1px solid ${C.dim};
    min-height: 56px; font-size: 20px; letter-spacing: 4px; text-align: left; padding: 10px 16px; }
  #menu.hub .m-cta:first-child::after { content: '→'; float: right; color: ${C.gold}; }
  #menu.hub .m-cta.alt { min-height: 44px; background: transparent; border: 0;
    color: ${C.soft}; letter-spacing: 0.5px; }
  #menu.hub button:active { background: rgba(190,152,77,0.22); transform: translateY(1px); }
  @media (hover: hover) { #menu.hub button:hover { background-color: rgba(190,152,77,0.12); } }
  #menu.hub[data-treatment=instrument] .m-nav { gap: 1px; border-block: 1px solid ${C.dim}; background: rgba(6,17,19,0.82); }
  #menu.hub[data-treatment=instrument] .m-navrow::before { width: 3px; height: 3px; border: 0; background: ${C.gold}; top: 7px; left: 7px; }
  #menu.hub[data-treatment=instrument] .m-navrow::after { display: none; }
  #menu.hub[data-treatment=instrument] .m-navrow { border-right: 1px solid ${C.dim}; }
  #menu.hub[data-treatment=instrument] .m-cta:first-child { background: rgba(6,17,19,0.9); border-left: 4px solid ${C.gold}; }
  #menu.hub[data-treatment=docket] .m-nav { gap: 0; border-top: 1px dashed ${C.soft}; }
  #menu.hub[data-treatment=docket] .m-navrow { align-items: flex-start; text-align: left; padding-left: 8px; }
  #menu.hub[data-treatment=docket] .m-navrow::before { content: attr(data-index); border: 0; position: static; width: auto; height: auto; font-size: 9px; color: ${C.gold}; }
  #menu.hub[data-treatment=docket] .m-navrow::after, #menu.hub[data-treatment=docket] .m-nav > .m-navrow > .ico { display: none; }
  #menu.hub[data-treatment=docket] .m-cta:first-child { border-top-style: dashed; background: rgba(43,36,23,0.62); }
  #menu .m-choice { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 10px; }
  #menu .m-choice button { min-height: 44px; padding: 6px 10px; color: ${C.soft};
    border: 1px solid ${C.dim}; background: transparent; cursor: pointer; font-size: 10px; }
  #menu .m-choice button[aria-pressed=true] { color: ${C.gold}; border-color: ${C.gold}; background: rgba(190,152,77,0.12); }
  @media (max-width: 370px) { #menu.hub .m-nav { gap: 3px; } #menu.hub .m-navrow .name { font-size: 9px; } }

  /* Composition, not skins. These share semantic controls but reserve their
     space differently: floating glass, a console, and an asymmetric docket. */
  #menu.hub .m-panel { border: 0; padding-top: 0; }
  #menu.hub .m-corner, #menu.hub .m-panel > .m-rule, #menu.hub .m-foot { display: none; }
  #menu.hub .m-head { min-height: 44px; padding: 0 12px; }
  #menu.hub .m-title { font-size: 11px; letter-spacing: 1px; }
  #menu.hub .m-x { border: 0; color: ${C.soft}; }
  #menu.hub .m-body { padding-top: 12px; }
  #menu.hub .m-hero-head { max-width: 32em; flex-shrink: 0; }
  #menu.hub .m-place { font-size: clamp(18px, 4.8vw, 30px); line-height: 1.35;
    white-space: normal; text-wrap: balance; letter-spacing: 0.5px; }
  #menu.hub .m-dimline { font-size: 9px; margin-top: 10px; color: ${C.soft}; }
  #menu.hub .m-launch { display: grid; gap: 8px; flex-shrink: 0; margin-top: 8px; }
  #menu.hub .m-actions { display: grid; gap: 0; }
  #menu.hub .m-actions .m-cta { margin: 0; }
  #menu.hub .m-dotlab { font-size: 9px; }
  #menu.hub .m-utilities { margin: 0; gap: 0 10px; border: 0; }
  #menu.hub .m-utilities .m-navrow { border: 0; }
  #menu.hub .m-utilities .ico { display: none; }
  #menu.hub .m-utilities .name { font-size: 8px; }
  #menu.hub .m-actions .m-cta.alt { font-size: 8px; letter-spacing: 0; min-height: 44px; }
  #menu.hub[data-treatment=glass] .m-launch { grid-template-areas: 'actions' 'nav' 'utilities'; gap: 8px; }
  #menu.hub[data-treatment=glass] .m-actions { grid-area: actions; }
  #menu.hub[data-treatment=glass] .m-nav { grid-area: nav; }
  #menu.hub[data-treatment=glass] .m-utilities { grid-area: utilities; }
  #menu.hub[data-treatment=glass] .m-actions .m-cta:first-child { background: none; border: 0;
    padding: 4px 0; font-size: 32px; min-height: 56px; letter-spacing: 7px; }
  #menu.hub[data-treatment=glass] .m-actions .m-cta:first-child .ico { display: none; }
  #menu.hub[data-treatment=glass] .m-navrow { min-height: 44px; }
  #menu.hub[data-treatment=glass] .m-navrow .ico { display: none; }
  #menu.hub[data-treatment=instrument] .m-launch { grid-template-columns: 1.15fr 1fr;
    padding: 12px; gap: 10px; background: rgba(6,17,19,0.88); border-top: 2px solid ${C.gold}; }
  #menu.hub[data-treatment=instrument] .m-nav { grid-column: 1; grid-row: 1;
    grid-template-columns: repeat(2,minmax(0,1fr)); border: 0; margin: 0; background: none; gap: 5px; }
  #menu.hub[data-treatment=instrument] .m-nav > .m-navrow { border: 1px solid ${C.dim}; min-height: 57px; }
  #menu.hub[data-treatment=instrument] .m-actions { grid-column: 2; grid-row: 1; align-content: stretch; }
  #menu.hub[data-treatment=instrument] .m-actions .m-cta:first-child { display: flex; flex-direction: column;
    justify-content: center; align-items: center; padding: 8px; border: 1px solid ${C.gold};
    font-size: 20px; letter-spacing: 2px; background: rgba(190,152,77,0.10); }
  #menu.hub[data-treatment=instrument] .m-actions .m-cta:first-child .ico { display: none; }
  #menu.hub[data-treatment=instrument] .m-actions .m-cta.alt { line-height: 1.7; }
  #menu.hub[data-treatment=instrument] .m-utilities { grid-column: 1 / -1; border-top: 1px solid ${C.dim}; }
  #menu.hub[data-treatment=docket] .m-hero-head { border-left: 2px solid ${C.gold}; padding-left: 12px; }
  #menu.hub[data-treatment=docket] .m-launch { grid-template-columns: 1fr 1.1fr; gap: 8px 18px;
    border-top: 1px dashed ${C.gold}; padding-top: 8px; }
  #menu.hub[data-treatment=docket] .m-nav { grid-column: 1; grid-row: 1;
    display: flex; flex-direction: column; border: 0; margin: 0; }
  #menu.hub[data-treatment=docket] .m-nav > .m-navrow { flex-direction: row; align-items: center;
    justify-content: flex-start; min-height: 44px; gap: 12px; padding-left: 0; border-bottom: 1px solid ${C.dim}; }
  #menu.hub[data-treatment=docket] .m-navrow .name { font-size: 11px; }
  #menu.hub[data-treatment=docket] .m-actions { grid-column: 2; grid-row: 1; align-content: end; }
  #menu.hub[data-treatment=docket] .m-actions .m-cta:first-child { border: 0;
    background: none; font-size: 23px; padding: 12px 0; letter-spacing: 1px; }
  #menu.hub[data-treatment=docket] .m-actions .m-cta:first-child .ico { display: none; }
  #menu.hub[data-treatment=docket] .m-actions::before { content: 'DEPARTURE / READY WHEN YOU ARE';
    color: ${C.soft}; font-size: 8px; line-height: 1.7; letter-spacing: 1px; margin-bottom: 20px; }
  #menu.hub[data-treatment=docket] .m-utilities { grid-column: 1 / -1; justify-content: flex-start; }
  @media (min-width: 760px) {
    #menu.hub .m-launch { width: min(620px, 100%); }
    #menu.hub[data-treatment=glass] .m-launch { align-self: center; }
    #menu.hub[data-treatment=instrument] .m-launch { width: min(720px,100%); align-self: center; }
    #menu.hub[data-treatment=docket] .m-launch { align-self: flex-start; }
  }
  @media (max-height: 580px) and (min-width: 600px) {
    #menu.hub .m-hero-head { max-width: 48%; }
    #menu.hub .m-launch { width: 48%; align-self: flex-end !important; }
    #menu.hub .m-dots, #menu.hub .m-dotlab { display: none !important; }
  }

  /* The live rig stays above a scrollable fitting sheet. Scrolling thirteen
     choices must never scroll the vehicle out of sight. Studio/elevations
     remain available for measurement rather than replacing the world. */
  #menu.rig-live .m-scrim { display: none !important; }
  #menu.rig-live .m-panel { border: 0; }
  #menu.rig-live .m-corner, #menu.rig-live .m-panel > .m-rule, #menu.rig-live .m-foot { display: none; }
  #menu.rig-live .m-body { overflow: hidden; }
  #menu .m-rig-plate { display: inline-block; align-self: flex-start; background: #ded1a3; color: #14221d;
    padding: 2px 9px; text-shadow: none; letter-spacing: 2px; font-size: 11px; margin: 5px 0 0; }
  #menu .m-rig-viewbar { margin: 4px 0; flex-shrink: 0; }
  #menu .m-rig-viewbar button { font-size: 8px; padding: 4px 8px; }
  #menu .m-rig-window { flex: 1 1 auto; min-height: 100px; pointer-events: none; }
  #menu .m-rig-controls { padding: 8px 10px; border-top: 1px solid ${C.gold}; background: rgba(7,20,20,.85); }
  #menu.rig-live .m-rig-controls { flex: 0 1 45%; min-height: 100px; overflow-y: auto; overscroll-behavior: contain; }
  #menu .m-equipment-head { display: flex; align-items: center; gap: 8px; font-size: 9px; color: ${C.soft}; }
  #menu .m-equipment-head span { margin-right: auto; }
  #menu .m-equipment-head button { min-height: 44px; padding: 4px 10px; border: 1px solid ${C.dim};
    color: ${C.gold}; background: transparent; cursor: pointer; }
  #menu .m-equipment { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 2px 8px; margin: 6px 0 14px; }
  #menu .m-fitting { display: flex; align-items: center; gap: 8px; min-height: 44px; font-size: 9px; cursor: pointer; }
  #menu .m-fitting input { width: 18px; height: 18px; accent-color: ${C.gold}; margin: 0; flex-shrink: 0; }
  #menu .m-fitting:has(input:checked) { color: ${C.gold}; }
  #menu .m-measured { margin-top: 12px; }
  #menu .m-measured summary { cursor: pointer; min-height: 44px; color: ${C.soft}; font-size: 10px; }
  @media (min-width: 760px) { #menu.rig-live .m-rig-controls { align-self: flex-end; width: 360px; flex-basis: 50%; } }
  @media (max-height: 550px) { #menu.rig-live .m-rig-controls { flex-basis: 40%; } #menu .m-rig-window { min-height: 45px; } }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'menu';
  const treatments = ['glass', 'instrument', 'docket'] as const;
  let treatment: string = 'glass';
  try { const saved = localStorage.getItem('drive.menu-treatment'); if (treatments.some(t => t === saved)) treatment = saved!; } catch { /* default */ }
  root.dataset.treatment = treatment;
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
      subT.style.display = 'none';
    } else {
      const back = el('button', 'm-back', '< BACK');
      back.addEventListener('click', () => setTab(T_DRIVE));
      head.append(back, el('div', 'm-title', TITLES[tab] ?? ''), x);
      subT.style.display = 'none';
    }
  }

  // ── state ──────────────────────────────────────────────────────────
  let tab: number | null = null;
  let rigLive = true;
  /** Which marks the SWITCHES list is showing, and what a tap has staged but
   *  not yet reloaded. Both live here rather than in renderSettings because a
   *  re-render rebuilds that function's whole DOM tree and would otherwise
   *  throw away the filter mid-scroll and the staged set mid-edit. */
  let swMark: string = 'all';
  let swStaged: Record<string, string | null> = {};
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
    if (!hero) { const tag = el('div', 'tag'); bindText(tag, ctx.registration); bay.appendChild(tag); }
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
    const heroHead = el('div', 'm-hero-head');
    heroHead.append(place, situation);
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
    const nav = el('nav', 'm-nav');
    nav.setAttribute('aria-label', 'Explore Drive');
    const utilities = el('div', 'm-utilities');
    // THE LINE is an optional journey alongside the free-drive destinations.
    const lineRow = el('button', 'm-navrow');
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

    for (const [t, name, sub, icon] of [
      [T_RIG, 'RIG', 'TUNE AND DRESS THE TRUCK', ICON.truck],
      [T_WORLD, 'DRIVES', 'DESTINATIONS · SPOTS · ELSEWHERE', ICON.map],
      [T_SURVEY, 'SURVEYS', 'ROADS DRIVEN AND CLAIMED', ICON.flag],
      [T_SYSTEM, 'SETTINGS', 'RENDER · WORLD · SOUND', ICON.gear],
    ] as Array<[number, string, string, string]>) {
      const row = el('button', 'm-navrow');
      row.append(ico(icon), el('span', 'name', name), el('span', 'sub', sub), el('span', 'chev', '>'));
      row.addEventListener('click', () => setTab(t));
      if (t === T_SYSTEM) utilities.appendChild(row); else nav.appendChild(row);
    }
    // …and SIGN IN, in the same stack rather than shouting above it. A player
    // who never taps it loses nothing, so it reads as one more section — but it
    // is ON THE SPLASH, because a sign-in buried three screens down is a sign-in
    // nobody finds until after they have driven a thousand kilometres.
    //
    // ONLY WHEN IT IS A SIGN-IN. Signed in, this row said PROGRESS and did
    // nothing but hop to SETTINGS — a whole line of the first screen anyone
    // sees, spent on a redirect to a page already one row above it. The sync
    // state it reported lives in SETTINGS beside the button that changes it,
    // which is where a status belongs. Signing out is a destructive tap and
    // does not belong on the screen you land on either.
    const signRow = el('button', 'm-navrow');
    const signIco = ico(ICON.save), signName = el('span', 'name', ''),
      signSub = el('span', 'sub', ''), signChev = el('span', 'chev', '>');
    signRow.append(signIco, signName, signSub, signChev);
    signRow.addEventListener('click', () => {
      if (ctx.syncPhase() === 'off') ctx.syncTap();      // …which navigates to the apex
      else setTab(T_SYSTEM);
    });
    updaters.push(() => {
      const out = ctx.syncPhase() === 'off';
      signRow.style.display = out ? 'flex' : 'none';
      signName.textContent = 'SIGN IN';
      signName.style.color = C.gold;
      signSub.textContent = 'PROGRESS ON EVERY DEVICE';
      signSub.style.color = C.dim;
      signChev.style.color = C.gold;
    });
    utilities.appendChild(signRow);
    // ABOUT, and it is not decoration: this world is built out of other
    // people's surveys — OpenStreetMap's roads, a dozen nations' elevation
    // data, ESA's land cover — and most of those are given on terms that ASK
    // to be credited. A game that ships them with no visible attribution is
    // taking something. It sits on the splash rather than three screens down
    // for the same reason the sign-in does.
    const aboutRow = el('button', 'm-navrow');
    aboutRow.append(ico(ICON.map), el('span', 'name', 'ABOUT'),
      el('span', 'sub', 'WHOSE MAPS THIS IS BUILT FROM'), el('span', 'chev', '>'));
    aboutRow.addEventListener('click', () => setTab(T_ABOUT));
    utilities.appendChild(aboutRow);
    const progress = el('button', 'm-navrow');
    progress.append(el('span', 'name', 'PROGRESS'));
    progress.addEventListener('click', () => setTab(T_PROGRESS));
    utilities.appendChild(progress);
    nav.appendChild(lineRow);
    Array.from(nav.children).forEach((row, i) => (row as HTMLElement).dataset.index = `0${i + 1}`);
    for (const b of [...Array.from(nav.children), ...Array.from(utilities.children)]) (b as HTMLButtonElement).type = 'button';
    // ── THE REEL, AS A CAROUSEL ──
    //
    // What stood here was a RETURN row that appeared only after the reel had
    // already carried the session away: a one-way door with no map. You could
    // not see how many places there were, which one you were looking at, or
    // reach a particular one deliberately.
    //
    // A dot strip says all three at a glance, and it goes ABOVE the stack
    // because it describes WHERE YOU ARE rather than offering somewhere to go
    // — the nav below it is the going. HOME is the first stop and drawn as a
    // square against the reel's dots, so "am I at my own place or in the
    // programme" is answerable without reading a word. That is what retires
    // RETURN: home stops being a special escape hatch and becomes the first
    // thing on the strip.
    const dots = el('div', 'm-dots');
    const dotAt = el('div', 'm-dotlab', '');
    updaters.push(() => {
      const r = ctx.reel?.() ?? { n: 0, at: -1, home: false };
      // Nothing to page through until the programme exists.
      dots.style.display = r.n ? 'flex' : 'none';
      dotAt.style.display = r.n ? 'block' : 'none';
      const want = `${r.n}|${r.at}|${r.home}`;
      if (dots.dataset.sig !== want) {
        dots.dataset.sig = want;
        dots.replaceChildren();
        for (let i = -1; i < r.n; i++) {
          const d = el('button', `m-dot${i < 0 ? ' home' : ''}${i === r.at ? ' on' : ''}`);
          d.type = 'button';
          d.setAttribute('aria-label', i < 0 ? 'HOME' : `DRIVE ${i + 1}`);
          // Home is only reachable once there is somewhere to come back FROM.
          if (i < 0 && !r.home) d.classList.add('off');
          d.addEventListener('click', () => ctx.reelGo?.(i));
          dots.appendChild(d);
        }
      }
      dotAt.textContent = r.at < 0 ? 'YOUR OWN ROAD' : `DRIVE ${r.at + 1} OF ${r.n}`;
      dotAt.style.color = r.at < 0 ? C.good : C.gold;
    });
    // The scene IS the splash's background — no scrim, no window (the .hub
    // class kills the strips): the rig stands in the live world behind
    // everything, and the spacer holds the sections down where the chase
    // camera keeps the truck visible between the stats and the buttons.
    const spacer = el('div', '');
    spacer.style.flex = '1';
    const launch = el('div', 'm-launch');
    const actions = el('div', 'm-actions');
    actions.append(cta, gps);
    launch.append(nav, actions, utilities);
    // One semantic order, three spatial compositions. The live camera reads
    // the hero header and navigation bounds instead of guessing screen thirds.
    body.append(heroHead, spacer, dots, dotAt, launch);
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
    root.classList.toggle('rig-live', rigLive);
    const choice = ctx.rigChoice();
    const heading = el('div', 'm-hero-head');
    const name = el('div', 'm-place', choice.model.toUpperCase());
    const plate = el('div', 'm-rig-plate'); bindText(plate, ctx.registration);
    heading.append(name, plate); body.appendChild(heading);
    const viewbar = el('div', 'm-choice m-rig-viewbar');
    for (const live of [true, false]) {
      const b = el('button', '', live ? 'IN THE WORLD' : 'STUDIO / VIEWS'); b.type = 'button';
      b.setAttribute('aria-pressed', String(rigLive === live));
      b.addEventListener('click', () => { rigLive = live; render(); }); viewbar.appendChild(b);
    }
    body.appendChild(viewbar);
    if (rigLive) { body.appendChild(el('div', 'm-rig-window')); }
    else {
      const views = el('div', 'm-views');
      ctx.views().forEach((label, i) => {
        const b = el('button', `m-view${ctx.vehView() === i ? ' on' : ''}`, label); b.type = 'button';
        b.addEventListener('click', () => { ctx.setVehView(i); render(); }); views.appendChild(b);
      });
      bayEl = mkBay(); body.append(views, bayEl);
    }
    const controls = el('div', 'm-rig-controls'); body.appendChild(controls);
    const models = el('div', 'm-choice');
    for (const model of RIG_MODELS) {
      const b = el('button', '', model.toUpperCase()); b.type = 'button';
      b.setAttribute('aria-pressed', String(choice.model === model));
      b.addEventListener('click', () => { const current = ctx.rigChoice(); ctx.rigChoose(model, current.loadout, current.equipment); render(); });
      models.appendChild(b);
    }
    controls.append(el('div', 'm-sect', 'MODEL'), models);
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
      controls.appendChild(row);
    const equipmentHead = el('div', 'm-equipment-head');
    const count = el('span', '', '');
    const updateCount = () => count.textContent = `${ctx.rigChoice().equipment.length} / ${RIG_EQUIPMENT.length} FITTED`;
    updateCount(); equipmentHead.appendChild(count);
    const boxes: HTMLInputElement[] = [];
    const apply = (ids: RigEquipmentId[]) => {
      const current = ctx.rigChoice(); ctx.rigChoose(current.model, current.loadout, ids);
      const selected = ctx.rigChoice().equipment;
      boxes.forEach((box,i) => box.checked = selected.includes(RIG_EQUIPMENT[i][0])); updateCount();
    };
    for (const all of [false, true]) {
      const b = el('button', '', all ? 'ALL' : 'NONE'); b.type = 'button';
      b.addEventListener('click', () => apply(all ? RIG_EQUIPMENT.map(([id])=>id) : [])); equipmentHead.appendChild(b);
    }
    const equipment = el('div', 'm-equipment');
    for (const [id,label] of RIG_EQUIPMENT) {
      const row = el('label', 'm-fitting');
      const box = el('input', ''); box.type = 'checkbox'; box.checked = choice.equipment.includes(id);
      box.addEventListener('change', () => {
        const current = ctx.rigChoice().equipment;
        apply(box.checked ? [...current,id] : current.filter(value=>value!==id));
      });
      boxes.push(box); row.append(box, el('span', '', label.toUpperCase())); equipment.appendChild(row);
    }
    controls.append(el('div', 'm-sect', 'EQUIPMENT'), equipmentHead, equipment);
    for (const g of ctx.dialGroups('rig')) {
      dialsInto(body, [g]);
      if (g.title !== 'VEHICLE') continue;

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
        updaters.push(() => {
          const current = ctx.dims().find(value => value.k === d.k);
          if (current) { built.textContent = current.built; built.style.color = current.ok ? C.good : C.hot; }
        });
        const spec = el('td', '', d.spec);
        spec.style.color = C.dim;
        tr2.append(el('td', '', d.k), built, spec);
        t.appendChild(tr2);
      }
    }
    const measured = el('details', 'm-measured');
    measured.append(el('summary', '', 'DIMENSIONS & SPECIFICATION'), t, kvTable(ctx.specText));
    controls.appendChild(measured);
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

  /**
   * ── ABOUT: WHOSE MAPS THIS IS BUILT FROM ──
   *
   * Almost nothing in this world is invented. The roads are OpenStreetMap's,
   * surveyed by people on bicycles with GPS units; the ground is a dozen
   * nations' elevation programmes; the land cover is ESA's; the weather is
   * whatever the national forecasters published this morning. Most of it is
   * given on terms that ASK for credit, and several of those terms are
   * licences rather than requests. A game that ships them with no visible
   * attribution is taking something.
   *
   * So the list is the real one, and it is kept honest by being derived from
   * what the code actually calls: every host here appears in the cell's
   * `connect-src` or is fetched by a devtool that bakes an asset into the
   * bundle. If a source is added and this page is not, the CSP line is the
   * place the omission shows.
   */
  const CREDITS: Array<[string, string, string, string]> = [
    // what it gives, who made it, the terms, where to look
    ['ROADS · PLACES · WATER · BUILDINGS',
      'OpenStreetMap contributors',
      'Open Database Licence (ODbL) 1.0',
      'openstreetmap.org/copyright'],
    ['THE SAME, QUERIED',
      'Overpass API — overpass-api.de, kumi.systems, osm.jp, private.coffee',
      'volunteer infrastructure, used sparingly and cached',
      'overpass-api.de'],
    ['PLACE SEARCH',
      'Nominatim, by the OpenStreetMap Foundation',
      'ODbL 1.0',
      'nominatim.openstreetmap.org'],
    ['ELEVATION — every hill you drive',
      '© Mapterhorn, aggregating national elevation surveys',
      'per the sources listed by Mapterhorn',
      'mapterhorn.com/attribution'],
    ['LAND COVER — what grows where',
      'ESA WorldCover 2021 v200 · contains modified Copernicus Sentinel data',
      'CC BY 4.0',
      'esa-worldcover.org'],
    ['WEATHER — cloud, rain, wind',
      'Open-Meteo, relaying the national weather services',
      'CC BY 4.0',
      'open-meteo.com'],
    ['ECOREGIONS — why the Cape is fynbos',
      'RESOLVE Ecoregions 2017 · Dinerstein et al., BioScience 67(6)',
      'CC BY 4.0',
      'ecoregions.appspot.com'],
    ['COASTLINES — distance to the sea',
      'Natural Earth, 110m land',
      'public domain',
      'naturalearthdata.com'],
    ['TREE SKELETONS',
      'EZ-Tree, by Daniel Greenheck',
      'MIT',
      'github.com/dgreenheck/ez-tree'],
    ['RENDERING',
      'three.js',
      'MIT',
      'threejs.org'],
    ['THE PIXEL FACE',
      'Silkscreen, by Jason Kottke',
      'SIL Open Font Licence 1.1',
      'kottke.org/plus/type/silkscreen'],
  ];

  function renderProgress(): void {
    body.append(el('div', 'm-sect', 'YOUR ROAD'), kvTable(ctx.driveStats));
    body.append(el('div', 'm-sect', 'PROGRESS SYNC'), el('div', 'm-dimline', ctx.syncNote()));
  }

  function renderAbout(): void {
    body.appendChild(el('div', 'm-place', 'SOLARPUNK OPEN WORLD DRIVING SIM'));
    body.append(el('div', 'm-dimline',
      'A driving sim over the real world. The world is not ours — it is '
      + 'surveyed, measured and published by the people and institutions below, '
      + 'and most of it is given on terms that ask to be credited.'));
    for (const [what, who, terms, where] of CREDITS) {
      body.append(el('div', 'm-sect', what));
      body.append(el('div', 'm-credit', who));
      const t = el('div', 'm-dimline', `${terms} · ${where}`);
      body.append(t);
    }
    body.append(el('div', 'm-sect', 'AND THE REST'));
    body.append(el('div', 'm-dimline',
      'Everything else — the terrain mesh, the roads as they are drawn, the '
      + 'water, the flora, the weather model, the truck and how it drives — is '
      + 'built here from those inputs.'));
    // WHERE A BUG REPORT GOES. An about page that credits everyone and gives
    // the reader nowhere to push back is only half a page.
    body.append(el('div', 'm-sect', 'THIS BUILD'));
    body.appendChild(kvTable(ctx.aboutRows));
  }

  function renderSettings(): void {
    body.appendChild(el('div', 'm-sect', 'SPLASH TREATMENT'));
    const variants = el('div', 'm-choice');
    const names = ['GLASS BRACKETS', 'INSTRUMENT PANEL', 'ROUTE DOCKET'];
    treatments.forEach((value, i) => {
      const b = el('button', '', names[i]); b.type = 'button';
      b.setAttribute('aria-pressed', String(value === treatment));
      b.addEventListener('click', () => {
        treatment = value; root.dataset.treatment = value;
        try { localStorage.setItem('drive.menu-treatment', value); } catch { /* session choice survives */ }
        setTab(T_DRIVE);
      });
      variants.appendChild(b);
    });
    body.appendChild(variants);
    body.appendChild(kvTable(ctx.systemRows));
    // ── EVERY SWITCH, WHETHER OR NOT IT IS ON ──
    //
    // Fifty-three query-string switches had grown up one at a time and nothing
    // listed them: ten appeared in no note, no test and no devtool. They are
    // declared in one table now and this is that table, so the surface cannot
    // drift out of a reader's reach again. A `•` is one this URL set; LEGACY
    // marks a switch whose other position keeps a superseded path alive, which
    // is the list to read when asking what can be retired.
    const sw = ctx.switches?.() ?? [];
    if (sw.length) {
      // ── EVERY SWITCH, AND NOW REACHABLE ──
      //
      // This was a kvTable: sixty-seven rows of text with no click handler, so
      // the one thing a player could not do on the SETTINGS panel was set a
      // setting. The list was honest about WHAT EXISTS and silent about how to
      // reach any of it, and the answer — edit the query string by hand and
      // reload — is not one a phone can carry out at all.
      //
      // Three things fix that, and the third is the one that makes the other
      // two safe:
      //
      //   FILTER BY MARK. Sixty-seven rows in one scroll is a list nobody
      //   reads. The marks were already carried on every row and rendered on
      //   none of them except `legacy`, so a bench probe and the spawn
      //   latitude looked identical. They are chips now, and the count beside
      //   each says how many it would show.
      //
      //   TAP TO STAGE, NOT TO APPLY. A switch is read once into a `const`
      //   while the module initialises — see `urlWithSwitches` — so a control
      //   that flipped one live would be lying about when it takes effect. A
      //   tap stages; the foot says what is staged; one RELOAD spends the lot.
      //   Staging also means a set of changes arrives together, which is what
      //   an A/B usually needs and what hand-editing a URL made tedious.
      //
      //   AND THE STAGED SET IS SHOWN AS THE DIFF IT IS. `?id` in gold with
      //   its new value beside the old one, so the reload is never a surprise.
      const marks = ['all', 'set', 'world', 'look', 'bench', 'legacy'] as const;
      const showing = (x: { set: boolean; marks: readonly string[] }): boolean =>
        swMark === 'all' ? true : swMark === 'set' ? x.set : x.marks.includes(swMark);
      const staged = (): number => Object.keys(swStaged).length;

      body.append(el('div', 'm-sect', 'SWITCHES'));
      body.append(el('div', 'm-dimline',
        `${sw.length} in this build · ${sw.filter((x) => x.marks.includes('legacy')).length} keep an older path alive · ${sw.filter((x) => x.set).length} set by this link`));

      const chips = el('div', 'm-choice m-swfilter');
      for (const m of marks) {
        const n = m === 'all' ? sw.length
          : m === 'set' ? sw.filter((x) => x.set).length
            : sw.filter((x) => x.marks.includes(m)).length;
        const b = el('button', '', `${m.toUpperCase()} ${n}`);
        b.setAttribute('aria-pressed', String(swMark === m));
        b.addEventListener('click', () => { swMark = m; render(); });
        chips.appendChild(b);
      }
      body.appendChild(chips);

      const list = el('div', 'm-switches');
      for (const x of sw) {
        if (!showing(x)) continue;
        const row = el('div', 'm-switch');
        const has = Object.prototype.hasOwnProperty.call(swStaged, x.id);
        const now = has ? swStaged[x.id] : x.raw;
        if (has) row.classList.add('staged');
        const name = el('div', 'sw-id', `?${x.id}`);
        // A mark is what KIND of switch this is, and the row says so rather
        // than leaving it to be inferred from the id.
        const tags = el('div', 'sw-marks');
        for (const m of x.marks) tags.appendChild(el('i', `tag ${m}`, m));
        const val = el('div', 'sw-val', now === null ? x.value : (now === '' ? 'on' : now));
        if (now === null) val.classList.add('unset');
        const note = el('div', 'sw-note', x.note);
        row.append(name, tags, val, note);

        // A toggle cycles through the three states it really has — the URL
        // says on, the URL says off, the URL says nothing — because "unset"
        // is not the same as "set to the default" and the reader (`qsOn`)
        // already draws that distinction.
        const cycle = (): void => {
          if (x.kind === 'toggle') {
            const next = now === null ? '1' : now === '1' ? '0' : null;
            if (next === x.raw) delete swStaged[x.id]; else swStaged[x.id] = next;
            render();
            return;
          }
          // Anything with a value is typed, because six named steps do not
          // cover a latitude. An empty box clears the switch.
          const typed = prompt(`?${x.id} — ${x.note}\n\nwithout it: ${x.value}`, now ?? '');
          if (typed === null) return;
          const next = typed.trim() === '' ? null : typed.trim();
          if (next === x.raw) delete swStaged[x.id]; else swStaged[x.id] = next;
          render();
        };
        row.addEventListener('click', cycle);
        row.tabIndex = 0;
        row.addEventListener('keydown', (e) => {
          if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); cycle(); }
        });
        list.appendChild(row);
      }
      body.appendChild(list);
      if (!list.childElementCount) body.append(el('div', 'm-dimline', 'NONE WITH THIS MARK'));

      if (staged()) {
        const diff = Object.entries(swStaged)
          .map(([id, v]) => (v === null ? `?${id} CLEARED` : `?${id}=${v === '' ? 'on' : v}`)).join(' · ');
        body.append(el('div', 'm-sect', 'STAGED'));
        body.append(el('div', 'm-dimline', diff));
        const bar = el('div', 'm-choice');
        // NOT "RELOAD WITH n" — STORAGE already offers RELOAD WITH CONSOLE a
        // screen further down, and two buttons on one page that begin with the
        // same two words are a misread waiting to happen.
        bar.appendChild(button(`RELOAD · ${staged()} STAGED`, C.gold, () => {
          // An EMPTY query is a real answer — it is what clearing the last
          // switch produces — so the guard is on the method being absent, not
          // on the string being falsy, and the path is put back in front of
          // it. `location.href = ''` reloads the URL you are already on, which
          // would have made "clear the only switch set" do nothing at all.
          const q = ctx.switchUrl?.(swStaged);
          if (q === undefined) return;
          swStaged = {};
          location.href = location.pathname + q;
        }, ICON.gear));
        bar.appendChild(button('CLEAR', C.soft, () => { swStaged = {}; render(); }));
        body.appendChild(bar);
      }
    }
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

    // ── storage ──
    //
    // Drive keeps things in four places and the player should not have to know
    // that, so this is one readout and two buttons: the cheap one that gives
    // the space back, and the one that hands the whole device over.
    body.append(el('div', 'm-sect', 'STORAGE'));
    const storeNote = el('div', 'm-dimline', ctx.storageNote());
    updaters.push(() => { storeNote.textContent = ctx.storageNote(); });
    body.append(storeNote);

    // NOT destructive in the way the two below it are — the world cache is
    // re-fetchable by definition, so this is one tap. It is also the one people
    // will actually want: it is where the space is.
    const cacheNote = el('div', 'm-dimline',
      'FREES THE GROUND AND ROADS THIS DEVICE HAS DRIVEN OVER. THEY COME BACK OFF THE WIRE. SETTINGS, PROGRESS AND SIGN-IN KEEP.');
    const clear = button('CLEAR THE WORLD CACHE', C.soft, () => {
      ctx.cacheClear((s, bad) => {
        cacheNote.textContent = s;
        cacheNote.style.color = bad ? C.bad : C.dim;
      });
    }, ICON.drop);
    body.append(clear, cacheNote);

    // THE WHOLE DEVICE. Two-tap armed like the campaign reset above, and for
    // more reason: this one takes the survey and the sign-in with it.
    const wipeNote = el('div', 'm-dimline',
      'EVERY SETTING, THE SURVEY, THE DOCKET, THE TAPES, THE CACHES AND THE OFFLINE COPY. SIGNS YOU OUT. IF YOU ARE SIGNED IN THE SERVER COPY IS UNTOUCHED AND COMES BACK WHEN YOU SIGN IN AGAIN.');
    let wipeArmed = 0;
    const disarmWipe = (): void => {
      wipeArmed = 0;
      setLab(wipe, 'RESET THIS DEVICE');
      wipe.style.color = C.soft;
      wipe.style.borderColor = C.soft;
    };
    const wipe = button('RESET THIS DEVICE', C.soft, () => {
      if (Date.now() - wipeArmed > 4000) {
        wipeArmed = Date.now();
        setLab(wipe, 'TAP AGAIN TO CLEAR EVERYTHING');
        wipe.style.color = C.bad;
        wipe.style.borderColor = C.bad;
        setTimeout(() => { if (wipeArmed && Date.now() - wipeArmed >= 4000) disarmWipe(); }, 4200);
        return;
      }
      disarmWipe();
      ctx.deviceReset((s, bad) => {
        wipeNote.textContent = s;
        wipeNote.style.color = bad ? C.bad : C.dim;
      });
    }, ICON.warn);
    body.append(wipe, wipeNote);

    // ── the dev console ──
    // A devtools panel ON the page, for the phone, which has no other. Loaded
    // only when asked, from a pinned build; `?eruda=1` does the same at boot.
    // Reading is the point — the page forbids eval, so its prompt cannot run
    // code here; the probe module in index.ts is how that is done without a
    // CSP hole.
    const devNote = el('div', 'm-dimline',
      'CONSOLE, NETWORK, ELEMENTS AND STORAGE, ON THE PAGE — FOR READING WHAT THE GAME DID ON THIS PHONE. ON AN ORDINARY LOAD ITS PROMPT CANNOT RUN CODE; RELOAD WITH CONSOLE SERVES THIS PAGE UNDER A POLICY THAT LETS IT.');
    const dev = button('DEV CONSOLE', C.soft, () => {
      ctx.devConsole((s, bad) => {
        devNote.textContent = s;
        devNote.style.color = bad ? C.bad : C.dim;
      });
    }, ICON.gear);
    // THE SAME PLACE, RELOADED WITH `?eruda=1`: the only load the cell serves
    // with eval allowed, so the prompt works. A reload costs the streamed
    // world and not the record — pagehide flushes the survey, the marks and
    // the docket first.
    const devReload = button('RELOAD WITH CONSOLE', C.soft, () => {
      ctx.devReload((s, bad) => {
        devNote.textContent = s;
        devNote.style.color = bad ? C.bad : C.dim;
      });
    }, ICON.gear);
    body.append(dev, devReload, devNote);

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
      renderHome, renderSurveys, renderRig, renderDrives, renderSettings, renderLine, renderAbout, renderProgress,
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
    root.classList.toggle('rig-live', t === T_RIG && rigLive);
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
    if ((tab === T_RIG && rigLive) || (tab !== T_RIG && tab !== T_DRIVE) || !bayEl || !bayEl.isConnected) return null;
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

  return { open, close, tab: () => tab, bayRect, refresh, rigLive: () => tab === T_RIG && rigLive };
}
