/**
 * DOM overlays for the two HUD surfaces that were never instruments: the
 * mission card ("the task, as a modal" — it asks something of you, has a tap
 * target, and deserves real text layout) and the survey-claim toast; plus
 * the MENU button, whose whole purpose is to open a DOM menu. Everything
 * else on the HUD stays canvas — these are the pieces that behave like UI,
 * not like readouts pinned to the world.
 *
 * The game pushes state every frame; this module diffs and only touches the
 * DOM when the strings change. All elements carry `.ui`, so HIDE HUD (the
 * body.clean rule) strips them with the rest of the chrome.
 */
import { PIXEL_FONT } from './font';
import { ICON, ICON_FONT } from './icons';

type Tone = 'ink' | 'edge' | 'dim' | 'text' | 'soft' | 'gold' | 'hot' | 'good' | 'bad';

export interface MissionCard {
  kicker: string;
  head: string;
  body: string;
  tone: Tone;
  /** True when a tap accepts the task — the only time the card body takes taps. */
  ready: boolean;
  /** Offers can be put away; on an ACTIVE task the same X collapses to the chip. */
  dismissable?: boolean;
  /** An active task can be put back down — rendered as its own small act.
   *  SET ASIDE, not ABANDON: nothing is lost by stopping, the task is still
   *  there to take again at the giver, and a word that says otherwise makes
   *  a routine decision feel like a failure. */
  canSetAside?: boolean;
  /** Collapsed: the card stands down and this label rides the top-left chip. */
  minimized?: boolean;
  chip?: string;
  /** ARRIVED asks for an explicit OK — a finished task is yours to put down. */
  ok?: boolean;
}
export interface ToastCard { kicker: string; head: string; body: string }
/**
 * THE ROUTE, AS A THING YOU CAN PUT DOWN. A goal set from a site card drove
 * the truck with nothing on the glass that said so, and nothing to take hold
 * of to stop it — the plan was a line on the chart and a fact in a probe.
 * Now it is a chip on the same top-left row as an active task, in the plan's
 * own mint, that opens to a card with the one action a plan needs: CANCEL.
 * The chart keeps the dotted line; the seat gets the chip.
 */
export interface RouteCard {
  name: string;
  /** What is left to drive, and by what — "12.3KM BY ROAD", "800M DIRECT". */
  body: string;
  /** Collapsed to the chip (the default); expanded shows the card. */
  minimized: boolean;
  chip: string;
}

/**
 * A STATION'S TERMINAL — the one screen in the game that belongs to the world
 * rather than to the truck. It reads like the instrument it is: a name, a
 * status, a column of readings, and at most ONE action. Everything in `rows`
 * is a measurement the game actually made; the terminal never decorates.
 */
export interface TerminalCard {
  name: string;
  sub: string;
  status: string;
  tone: Tone;
  rows: Array<[string, string]>;
  /** The wake action's label — absent once the station is awake. */
  wake?: string;
}

/**
 * A SITE RECORD — what the world holds at one spot on the chart, in the same
 * instrument voice as the terminal above. THE LINE answered a double tap with
 * its field query (the pipeline's books, on a toast); free drive answers with
 * this: the GROUND's books — elevation, cover, biome, surface, what the water
 * says — and, because off the line travel is allowed, one action that takes
 * the truck there. The card is what makes the fix a decision rather than a
 * jump: dropping the mark shows the record, and the record is where the
 * relocation is offered, not the pin.
 */
export interface SiteCard {
  name: string;
  sub: string;
  status: string;
  tone: Tone;
  rows: Array<[string, string]>;
  /** The relocation's label — absent when the site is not somewhere to go. */
  go?: string;
  /** The second action: make this place the drive's goal. Absent when the
   *  site has no position worth steering to. */
  goal?: string;
  /** One line under the action: what the gesture already did for you. */
  note?: string;
}

export interface Overlays {
  mission(m: MissionCard | null): void;
  route(r: RouteCard | null): void;
  toast(t: ToastCard | null): void;
  /** The in-range chip that opens the terminal; null when out of range. */
  prompt(label: string | null): void;
  terminal(t: TerminalCard | null): void;
  site(s: SiteCard | null): void;
  /** The top-right chip's word: MENU while driving, the layout's name in the
   *  others (the HUD deck's layouts), so the glass says which HUD it is. The
   *  chip still opens the menu whatever it reads. */
  menuLabel(label: string): void;
}

export function createOverlays(
  colors: Record<Tone, string>,
  onMenu: () => void,
  onAccept: () => void,
  onDismiss: () => void,
  onExpand: () => void,
  onSetAside: () => void,
  onOk: () => void,
  onTerminal: () => void,
  onTerminalClose: () => void,
  onWake: () => void,
  onSiteGo: () => void,
  onSiteClose: () => void,
  onSiteGoal: () => void,
  onRouteExpand: () => void,
  onRouteCollapse: () => void,
  onRouteCancel: () => void,
): Overlays {
  const C = colors;
  const style = document.createElement('style');
  style.textContent = `
  .ov { position: fixed; z-index: 11; font-family: '${PIXEL_FONT}', ui-monospace, monospace;
    color: ${C.text}; -webkit-user-select: none; user-select: none;
    -webkit-touch-callout: none; touch-action: manipulation; }
  /* The menu's scrim is translucent by design — anything ghosting through it
     reads as a defect, so the overlays stand down while the menu is up. */
  body.menu-open .ov { display: none !important; }
  /* THE BRACKET IS THE AFFORDANCE MARK — the canvas panel idiom (dim rule,
     accent corner ticks) carried onto the DOM buttons, so "press me" reads
     the same in both technologies (the audit's finding 3). The gradients ARE
     the ticks; --bk is each control's accent colour. Elements wearing this
     class declare background-color, never the background shorthand — the
     shorthand would reset these images. */
  .bkt { background-repeat: no-repeat;
    background-image:
      linear-gradient(var(--bk), var(--bk)), linear-gradient(var(--bk), var(--bk)),
      linear-gradient(var(--bk), var(--bk)), linear-gradient(var(--bk), var(--bk)),
      linear-gradient(var(--bk), var(--bk)), linear-gradient(var(--bk), var(--bk)),
      linear-gradient(var(--bk), var(--bk)), linear-gradient(var(--bk), var(--bk));
    background-size: 8px 2px, 2px 8px, 8px 2px, 2px 8px, 8px 2px, 2px 8px, 8px 2px, 2px 8px;
    background-position: 0 0, 0 0, 100% 0, 100% 0, 0 100%, 0 100%, 100% 100%, 100% 100%; }
  /* ON the heading row: --top-y is exported from hudResize (main.ts) so the
     chip's text sits on the same baseline as the clock and the heading digits
     at any HUD scale — one justified row under the compass. At a fixed 46px
     it only lined up when hudS happened to be 2. */
  /* Corner marks only (Glass spec §5.5): an action is text plus detached
     corners — no fill, no border. The top row gets no background strip. */
  #ov-menu { top: calc(env(safe-area-inset-top, 0px) + var(--top-y, 44px)); right: 10px;
    cursor: pointer; color: ${C.edge}; border: 1px solid transparent; --bk: ${C.edge};
    background-color: transparent; padding: 4px 10px 3px; font: inherit;
    font-family: inherit; font-size: 12px; letter-spacing: 1px;
    text-shadow: 1px 0 ${C.ink}, -1px 0 ${C.ink}, 0 1px ${C.ink}, 0 -1px ${C.ink}; }
  /* ON the message rail: --msg-y is exported from hudResize (main.ts) as the
     row under the canvas rail's transient text, in CSS px. The card and toast
     used to hold two more fixed verticals (88/168px) of their own — four
     heights for one voice channel, the audit's finding 8. */
  #ov-mission, #ov-toast { top: calc(env(safe-area-inset-top, 0px) + var(--msg-y, 88px));
    left: 50%; transform: translateX(-50%); width: max-content;
    max-width: min(92vw, 400px); background: rgba(8,20,23,0.85);
    border: 1px solid; padding: 6px 12px 6px; text-align: center; display: none; }
  #ov-toast { top: calc(env(safe-area-inset-top, 0px) + var(--msg-y, 88px) + 76px);
    border-color: ${C.good}; pointer-events: none; }
  .ov .kicker { font-size: 10px; color: ${C.dim}; letter-spacing: 1px; }
  .ov .head { font-size: 16px; font-weight: 700; margin: 1px 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ov .body { font-size: 10px; }
  .ov .x { position: absolute; top: -1px; right: -1px; padding: 3px 7px 2px; cursor: pointer;
    color: ${C.soft}; border: 1px solid ${C.dim}; background: rgba(8,20,23,0.9);
    font-size: 10px; line-height: 1; display: none; pointer-events: auto; }
  .ov .aside { margin-top: 3px; font-size: 10px; color: ${C.dim}; cursor: pointer;
    display: none; pointer-events: auto; text-decoration: underline; text-underline-offset: 2px; }
  .ov .ok { margin: 5px auto 1px; padding: 4px 26px 3px; cursor: pointer; display: none;
    pointer-events: auto; color: ${C.good}; border: 1px solid ${C.dim}; --bk: ${C.good};
    background-color: rgba(111,224,160,0.08); font: inherit; font-family: inherit;
    font-size: 12px; font-weight: 700; letter-spacing: 2px; }
  /* BELOW the canvas rail, not on top of it: --rail-b is exported from
     hudResize in CSS pixels (the rail lives in HUD px, this chip in CSS px,
     and only that function knows the scale). At a fixed 46px this chip lay
     straight across the clock and the rewind handle. */
  #ov-task { top: calc(env(safe-area-inset-top, 0px) + var(--rail-b, 160px)); left: 10px; cursor: pointer;
    color: ${C.gold}; border: 1px solid ${C.dim}; --bk: ${C.gold};
    background-color: rgba(8,20,23,0.78);
    padding: 4px 9px 3px; font: inherit; font-family: inherit; font-size: 10px;
    letter-spacing: 1px; display: none; }
  #ov-task .ico { font-family: '${ICON_FONT}'; font-weight: 900; margin-right: 0.5em; }
  /* THE ROUTE'S CHIP shares the task's row and sits under it when both are
     up: --route-dy is set by the renderer, not the stylesheet, because only
     it knows whether the task chip is showing. Mint, the plan's colour. */
  #ov-route { top: calc(env(safe-area-inset-top, 0px) + var(--rail-b, 160px) + var(--route-dy, 0px));
    left: 10px; cursor: pointer;
    color: ${C.good}; border: 1px solid ${C.dim}; --bk: ${C.good};
    background-color: rgba(8,20,23,0.78);
    padding: 4px 9px 3px; font: inherit; font-family: inherit; font-size: 10px;
    letter-spacing: 1px; display: none; }
  #ov-route .ico { font-family: '${ICON_FONT}'; font-weight: 900; margin-right: 0.5em; }
  /* THE GOAL'S BANNER SITS IN THE TOP THIRD, on the message rail's own line —
     a compact centred plate, not a full-width slab that grows down into the
     middle of the road. With the rail free it hangs UPWARD off that line, so
     it occupies roughly the 22-33% band and leaves the road clear; with the
     task card already on the rail it drops below it instead. Either way the
     offset is --rcard-dy, set by the renderer, because only it knows what
     else is up and how tall the two plates measure. */
  #ov-routecard { top: calc(env(safe-area-inset-top, 0px) + var(--msg-y, 88px) + var(--rcard-dy, 0px));
    left: 50%; transform: translateX(-50%); width: max-content;
    max-width: min(92vw, 400px); text-align: center;
    padding: 6px 12px 8px; border: 1px solid ${C.good}; background: rgba(8,20,23,0.86); display: none; }
  #ov-routecard .cancel { margin: 7px auto 0; padding: 4px 18px 3px; cursor: pointer; display: block;
    color: ${C.bad}; border: 1px solid ${C.bad}; background-color: rgba(220,90,80,0.08);
    font: inherit; font-family: inherit; font-size: 11px; font-weight: 700;
    letter-spacing: 2px; width: 100%; }
  /* The terminal prompt sits low-centre, above the stick's reach — a door,
     not a dialog. */
  #ov-term-go { bottom: calc(env(safe-area-inset-bottom, 0px) + 168px); left: 50%;
    transform: translateX(-50%); cursor: pointer; color: ${C.good};
    border: 1px solid ${C.dim}; --bk: ${C.good}; background-color: rgba(8,20,23,0.85);
    padding: 5px 12px 4px; font: inherit; font-family: inherit; font-size: 11px;
    letter-spacing: 1px; display: none; }
  #ov-term-go .ico { font-family: '${ICON_FONT}'; font-weight: 900; margin-right: 0.5em; }
  /* The terminal itself: centred, one column, reads like the instrument it is.
     The SITE card is the same instrument pointed at the ground, so it shares
     the shell and differs only in its action. */
  #ov-term, #ov-site { top: 50%; left: 50%; transform: translate(-50%, -52%);
    width: min(92vw, 340px); background: rgba(6,14,16,0.94);
    border: 1px solid ${C.edge}; padding: 10px 14px 12px; display: none; }
  #ov-term .t-name, #ov-site .t-name { font-size: 18px; font-weight: 700; letter-spacing: 1px; }
  #ov-term .t-sub, #ov-site .t-sub { font-size: 9px; color: ${C.dim}; letter-spacing: 1px; margin-bottom: 6px; }
  #ov-term .t-status, #ov-site .t-status { font-size: 11px; letter-spacing: 2px; border-top: 1px solid ${C.edge};
    border-bottom: 1px solid ${C.edge}; padding: 5px 0 4px; margin-bottom: 6px; }
  #ov-term .t-rows, #ov-site .t-rows { font-size: 10px; line-height: 1.9; }
  #ov-term .t-rows .k, #ov-site .t-rows .k { color: ${C.dim}; display: inline-block; min-width: 9ch; letter-spacing: 1px; }
  #ov-term .t-wake { margin: 10px auto 0; padding: 6px 22px 5px; cursor: pointer; display: none;
    color: ${C.gold}; border: 1px solid ${C.gold}; background: rgba(245,196,83,0.08);
    font: inherit; font-family: inherit; font-size: 12px; font-weight: 700;
    letter-spacing: 2px; width: 100%; }
  /* GOOD, not gold: relocation is a safe, ordinary act off the line, and the
     gold reads as the station's one irreversible switch. */
  #ov-site .t-go { margin: 10px auto 0; padding: 6px 22px 5px; cursor: pointer; display: none;
    color: ${C.good}; border: 1px solid ${C.good}; background: rgba(120,220,180,0.08);
    font: inherit; font-family: inherit; font-size: 12px; font-weight: 700;
    letter-spacing: 2px; width: 100%; }
  #ov-site .t-note { margin-top: 7px; font-size: 9px; color: ${C.dim}; letter-spacing: 1px;
    text-align: center; }
  `;
  document.head.appendChild(style);

  const menuBtn = document.createElement('button');
  menuBtn.id = 'ov-menu';
  menuBtn.className = 'ov ui bkt';
  menuBtn.textContent = 'MENU';
  menuBtn.addEventListener('click', onMenu);
  document.body.appendChild(menuBtn);

  const card = (id: string): { root: HTMLElement; kicker: HTMLElement; head: HTMLElement; body: HTMLElement } => {
    const root = document.createElement('div');
    root.id = id;
    root.className = 'ov ui';
    const kicker = document.createElement('div');
    kicker.className = 'kicker';
    const head = document.createElement('div');
    head.className = 'head';
    const body = document.createElement('div');
    body.className = 'body';
    root.append(kicker, head, body);
    document.body.appendChild(root);
    return { root, kicker, head, body };
  };
  const m = card('ov-mission');
  m.root.addEventListener('click', () => { if (mReady) onAccept(); });
  // The X sits on the card's corner and keeps its own pointer-events, so an
  // offer that is not yet takeable (card inert) can still be put away.
  const mx = document.createElement('div');
  mx.className = 'x';
  mx.textContent = 'X';
  mx.addEventListener('click', (e) => { e.stopPropagation(); onDismiss(); });
  m.root.appendChild(mx);
  const mab = document.createElement('div');
  mab.className = 'aside';
  mab.textContent = 'SET ASIDE';
  mab.addEventListener('click', (e) => { e.stopPropagation(); onSetAside(); });
  m.root.appendChild(mab);
  const mok = document.createElement('button');
  mok.className = 'ok bkt';
  mok.textContent = 'OK';
  mok.addEventListener('click', (e) => { e.stopPropagation(); onOk(); });
  m.root.appendChild(mok);
  // The chip the active task collapses to — the task's whole state at a
  // glance, parked top-left where it stops competing with the road.
  const chip = document.createElement('button');
  chip.id = 'ov-task';
  chip.className = 'ov ui bkt';
  const chipIco = document.createElement('span');
  chipIco.className = 'ico';
  chipIco.textContent = ICON.flag;
  const chipLab = document.createElement('span');
  chip.append(chipIco, chipLab);
  chip.addEventListener('click', onExpand);
  document.body.appendChild(chip);
  // THE ROUTE: its chip and its card, the same two states as the task.
  const rchip = document.createElement('button');
  rchip.id = 'ov-route';
  rchip.className = 'ov ui bkt';
  const rchipIco = document.createElement('span');
  rchipIco.className = 'ico';
  rchipIco.textContent = ICON.road;
  const rchipLab = document.createElement('span');
  rchip.append(rchipIco, rchipLab);
  rchip.addEventListener('click', onRouteExpand);
  document.body.appendChild(rchip);
  const rc = card('ov-routecard');
  rc.kicker.textContent = 'ROUTE';
  rc.head.style.color = C.good;
  const rx = document.createElement('div');
  rx.className = 'x';
  rx.textContent = 'X';
  rx.addEventListener('click', (e) => { e.stopPropagation(); onRouteCollapse(); });
  rc.root.appendChild(rx);
  const rcancel = document.createElement('button');
  rcancel.className = 'cancel bkt';
  rcancel.style.setProperty('--bk', C.bad);
  rcancel.textContent = 'CANCEL ROUTE';
  rcancel.addEventListener('click', (e) => { e.stopPropagation(); onRouteCancel(); });
  rc.root.appendChild(rcancel);
  let rKey = '';
  const t = card('ov-toast');
  t.kicker.textContent = 'SURVEYED';
  t.head.style.color = C.good;

  // ── the terminal ──
  const termGo = document.createElement('button');
  termGo.id = 'ov-term-go';
  termGo.className = 'ov ui bkt';
  const tgIco = document.createElement('span');
  tgIco.className = 'ico';
  tgIco.textContent = ICON.gps;
  const tgLab = document.createElement('span');
  termGo.append(tgIco, tgLab);
  termGo.addEventListener('click', onTerminal);
  document.body.appendChild(termGo);

  const term = document.createElement('div');
  term.id = 'ov-term';
  term.className = 'ov ui';
  const tName = document.createElement('div'); tName.className = 't-name';
  const tSub = document.createElement('div'); tSub.className = 't-sub';
  const tStatus = document.createElement('div'); tStatus.className = 't-status';
  const tRows = document.createElement('div'); tRows.className = 't-rows';
  const tWake = document.createElement('button'); tWake.className = 't-wake';
  tWake.addEventListener('click', (e) => { e.stopPropagation(); onWake(); });
  const tx2 = document.createElement('div');
  tx2.className = 'x';
  tx2.style.display = 'block';
  tx2.textContent = 'X';
  tx2.addEventListener('click', (e) => { e.stopPropagation(); onTerminalClose(); });
  term.append(tName, tSub, tStatus, tRows, tWake, tx2);
  document.body.appendChild(term);

  // ── the site record ──
  // Its own element rather than the terminal's: a station terminal and a
  // chart fix can both be live, and two panels sharing one node would have
  // them overwrite each other's text on alternate frames.
  const site = document.createElement('div');
  site.id = 'ov-site';
  site.className = 'ov ui';
  const sName = document.createElement('div'); sName.className = 't-name';
  const sSub = document.createElement('div'); sSub.className = 't-sub';
  const sStatus = document.createElement('div'); sStatus.className = 't-status';
  const sRows = document.createElement('div'); sRows.className = 't-rows';
  const sGo = document.createElement('button'); sGo.className = 't-go';
  sGo.addEventListener('click', (e) => { e.stopPropagation(); onSiteGo(); });
  // The second action, under the first: RELOCATE puts you there, DRIVE TO
  // makes it the thing the road is chosen for. Same button treatment, so
  // neither reads as the safer one.
  const sGoal = document.createElement('button'); sGoal.className = 't-go';
  sGoal.addEventListener('click', (e) => { e.stopPropagation(); onSiteGoal(); });
  const sNote = document.createElement('div'); sNote.className = 't-note';
  const sx = document.createElement('div');
  sx.className = 'x';
  sx.style.display = 'block';
  sx.textContent = 'X';
  sx.addEventListener('click', (e) => { e.stopPropagation(); onSiteClose(); });
  site.append(sName, sSub, sStatus, sRows, sGo, sGoal, sNote, sx);
  document.body.appendChild(site);

  let mKey = '', tKey = '', mReady = false, gKey = '', teKey = '', siKey = '';
  return {
    mission(mc) {
      const key = mc ? `${mc.kicker}|${mc.head}|${mc.body}|${mc.tone}|${mc.ready}|${mc.minimized}|${mc.chip}|${mc.ok}` : '';
      if (key === mKey) return;
      mKey = key;
      mReady = !!mc?.ready;
      if (!mc) { m.root.style.display = 'none'; chip.style.display = 'none'; return; }
      if (mc.minimized && mc.chip) {
        m.root.style.display = 'none';
        chipLab.textContent = mc.chip;
        chip.style.display = 'block';
        return;
      }
      chip.style.display = 'none';
      m.kicker.textContent = mc.kicker;
      m.head.textContent = mc.head;
      m.head.style.color = C[mc.tone];
      m.body.textContent = mc.body;
      m.body.style.color = mc.ready ? C[mc.tone] : C.text;
      m.root.style.borderColor = C[mc.tone];
      m.root.style.cursor = mc.ready ? 'pointer' : 'default';
      m.root.style.pointerEvents = mc.ready ? 'auto' : 'none';
      mx.style.display = mc.dismissable ? 'block' : 'none';
      mab.style.display = mc.canSetAside ? 'block' : 'none';
      mok.style.display = mc.ok ? 'block' : 'none';
      m.root.style.display = 'block';
    },
    route(r) {
      const taskUp = chip.style.display === 'block';
      const cardUp = m.root.style.display === 'block';
      const key = r ? `${r.name}|${r.body}|${r.minimized}|${r.chip}|${taskUp}|${cardUp}` : '';
      if (key === rKey) return;
      rKey = key;
      if (!r) { rc.root.style.display = 'none'; rchip.style.display = 'none'; return; }
      // Under the task's chip when that is up, on its row when it is not.
      rchip.style.setProperty('--route-dy', taskUp ? '30px' : '0px');
      if (r.minimized) {
        rc.root.style.display = 'none';
        rchipLab.textContent = r.chip;
        rchip.style.display = 'block';
        return;
      }
      rchip.style.display = 'none';
      rc.head.textContent = r.name;
      rc.body.textContent = r.body;
      // THE X HAS TO BE TURNED ON. `.ov .x` ships hidden and each card opts in
      // — the task card does it through `dismissable` — so this one was built,
      // wired and invisible: the banner could be cancelled and not put away,
      // which is the opposite of the two actions' weights.
      rx.style.display = 'block';
      // Measured after it is shown, because a plate has no height until it is
      // drawn: hang it off the rail (its own height up) when the rail is free,
      // and below the task card when that owns the line.
      rc.root.style.setProperty('--rcard-dy', '0px');
      rc.root.style.display = 'block';
      rc.root.style.setProperty('--rcard-dy',
        cardUp ? `${m.root.offsetHeight + 8}px` : `${-rc.root.offsetHeight}px`);
    },
    toast(tc) {
      const key = tc ? `${tc.head}|${tc.body}` : '';
      if (key === tKey) return;
      tKey = key;
      if (!tc) { t.root.style.display = 'none'; return; }
      t.head.textContent = tc.head;
      t.body.textContent = tc.body;
      t.root.style.display = 'block';
    },
    prompt(label) {
      const key = label ?? '';
      if (key === gKey) return;
      gKey = key;
      if (!label) { termGo.style.display = 'none'; return; }
      tgLab.textContent = label;
      termGo.style.display = 'block';
    },
    terminal(tc) {
      const key = tc
        ? `${tc.name}|${tc.status}|${tc.wake}|${tc.rows.map((r) => r.join('=')).join('|')}`
        : '';
      if (key === teKey) return;
      teKey = key;
      if (!tc) { term.style.display = 'none'; return; }
      tName.textContent = tc.name;
      tSub.textContent = tc.sub;
      tStatus.textContent = tc.status;
      tStatus.style.color = C[tc.tone];
      term.style.borderColor = C[tc.tone];
      tRows.replaceChildren(...tc.rows.map(([k, v]) => {
        const row = document.createElement('div');
        const kk = document.createElement('span');
        kk.className = 'k';
        kk.textContent = k;
        row.append(kk, document.createTextNode(v));
        return row;
      }));
      tWake.textContent = tc.wake ?? '';
      tWake.style.display = tc.wake ? 'block' : 'none';
      term.style.display = 'block';
    },
    site(sc) {
      const key = sc
        ? `${sc.name}|${sc.status}|${sc.go}|${sc.goal}|${sc.note}|${sc.rows.map((r) => r.join('=')).join('|')}`
        : '';
      if (key === siKey) return;
      siKey = key;
      if (!sc) { site.style.display = 'none'; return; }
      sName.textContent = sc.name;
      sSub.textContent = sc.sub;
      sStatus.textContent = sc.status;
      sStatus.style.color = C[sc.tone];
      site.style.borderColor = C[sc.tone];
      sRows.replaceChildren(...sc.rows.map(([k, v]) => {
        const row = document.createElement('div');
        const kk = document.createElement('span');
        kk.className = 'k';
        kk.textContent = k;
        row.append(kk, document.createTextNode(v));
        return row;
      }));
      sGo.textContent = sc.go ?? '';
      sGo.style.display = sc.go ? 'block' : 'none';
      sGoal.textContent = sc.goal ?? '';
      sGoal.style.display = sc.goal ? 'block' : 'none';
      sNote.textContent = sc.note ?? '';
      sNote.style.display = sc.note ? 'block' : 'none';
      site.style.display = 'block';
    },
    menuLabel(label) {
      if (menuBtn.textContent !== label) menuBtn.textContent = label;
    },
  };
}
