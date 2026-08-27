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

type Tone = 'edge' | 'dim' | 'text' | 'soft' | 'gold' | 'hot' | 'good' | 'bad';

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

export interface Overlays {
  mission(m: MissionCard | null): void;
  toast(t: ToastCard | null): void;
  /** The in-range chip that opens the terminal; null when out of range. */
  prompt(label: string | null): void;
  terminal(t: TerminalCard | null): void;
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
  #ov-menu { top: calc(env(safe-area-inset-top, 0px) + 46px); right: 10px;
    cursor: pointer; color: ${C.edge}; border: 1px solid ${C.edge};
    background: rgba(8,20,23,0.78); padding: 4px 10px 3px; font: inherit;
    font-family: inherit; font-size: 12px; letter-spacing: 1px; }
  #ov-mission, #ov-toast { top: calc(env(safe-area-inset-top, 0px) + 88px);
    left: 50%; transform: translateX(-50%); width: max-content;
    max-width: min(92vw, 400px); background: rgba(8,20,23,0.85);
    border: 1px solid; padding: 6px 12px 6px; text-align: center; display: none; }
  #ov-toast { top: calc(env(safe-area-inset-top, 0px) + 168px); border-color: ${C.good};
    pointer-events: none; }
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
    pointer-events: auto; color: ${C.good}; border: 1px solid ${C.good};
    background: rgba(111,224,160,0.08); font: inherit; font-family: inherit;
    font-size: 12px; font-weight: 700; letter-spacing: 2px; }
  #ov-task { top: calc(env(safe-area-inset-top, 0px) + 46px); left: 10px; cursor: pointer;
    color: ${C.gold}; border: 1px solid ${C.gold}; background: rgba(8,20,23,0.78);
    padding: 4px 9px 3px; font: inherit; font-family: inherit; font-size: 10px;
    letter-spacing: 1px; display: none; }
  #ov-task .ico { font-family: '${ICON_FONT}'; font-weight: 900; margin-right: 0.5em; }
  /* The terminal prompt sits low-centre, above the stick's reach — a door,
     not a dialog. */
  #ov-term-go { bottom: calc(env(safe-area-inset-bottom, 0px) + 168px); left: 50%;
    transform: translateX(-50%); cursor: pointer; color: ${C.good};
    border: 1px solid ${C.good}; background: rgba(8,20,23,0.85);
    padding: 5px 12px 4px; font: inherit; font-family: inherit; font-size: 11px;
    letter-spacing: 1px; display: none; }
  #ov-term-go .ico { font-family: '${ICON_FONT}'; font-weight: 900; margin-right: 0.5em; }
  /* The terminal itself: centred, one column, reads like the instrument it is. */
  #ov-term { top: 50%; left: 50%; transform: translate(-50%, -52%);
    width: min(92vw, 340px); background: rgba(6,14,16,0.94);
    border: 1px solid ${C.edge}; padding: 10px 14px 12px; display: none; }
  #ov-term .t-name { font-size: 18px; font-weight: 700; letter-spacing: 1px; }
  #ov-term .t-sub { font-size: 9px; color: ${C.dim}; letter-spacing: 1px; margin-bottom: 6px; }
  #ov-term .t-status { font-size: 11px; letter-spacing: 2px; border-top: 1px solid ${C.edge};
    border-bottom: 1px solid ${C.edge}; padding: 5px 0 4px; margin-bottom: 6px; }
  #ov-term .t-rows { font-size: 10px; line-height: 1.9; }
  #ov-term .t-rows .k { color: ${C.dim}; display: inline-block; min-width: 9ch; letter-spacing: 1px; }
  #ov-term .t-wake { margin: 10px auto 0; padding: 6px 22px 5px; cursor: pointer; display: none;
    color: ${C.gold}; border: 1px solid ${C.gold}; background: rgba(245,196,83,0.08);
    font: inherit; font-family: inherit; font-size: 12px; font-weight: 700;
    letter-spacing: 2px; width: 100%; }
  `;
  document.head.appendChild(style);

  const menuBtn = document.createElement('button');
  menuBtn.id = 'ov-menu';
  menuBtn.className = 'ov ui';
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
  mok.className = 'ok';
  mok.textContent = 'OK';
  mok.addEventListener('click', (e) => { e.stopPropagation(); onOk(); });
  m.root.appendChild(mok);
  // The chip the active task collapses to — the task's whole state at a
  // glance, parked top-left where it stops competing with the road.
  const chip = document.createElement('button');
  chip.id = 'ov-task';
  chip.className = 'ov ui';
  const chipIco = document.createElement('span');
  chipIco.className = 'ico';
  chipIco.textContent = ICON.flag;
  const chipLab = document.createElement('span');
  chip.append(chipIco, chipLab);
  chip.addEventListener('click', onExpand);
  document.body.appendChild(chip);
  const t = card('ov-toast');
  t.kicker.textContent = 'SURVEYED';
  t.head.style.color = C.good;

  // ── the terminal ──
  const termGo = document.createElement('button');
  termGo.id = 'ov-term-go';
  termGo.className = 'ov ui';
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

  let mKey = '', tKey = '', mReady = false, gKey = '', teKey = '';
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
  };
}
