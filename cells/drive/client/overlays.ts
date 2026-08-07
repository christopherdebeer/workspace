/**
 * DOM overlays for the two HUD surfaces that were never instruments: the
 * mission card ("the job, as a modal" — it asks something of you, has a tap
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
  /** True when a tap accepts the job — the only time the card body takes taps. */
  ready: boolean;
  /** Offers can be put away; on an ACTIVE job the same X collapses to the chip. */
  dismissable?: boolean;
  /** An active job can be walked away from — rendered as its own small act. */
  abandonable?: boolean;
  /** Collapsed: the card stands down and this label rides the top-left chip. */
  minimized?: boolean;
  chip?: string;
  /** ARRIVED asks for an explicit OK — a finished job is yours to put down. */
  ok?: boolean;
}
export interface ToastCard { kicker: string; head: string; body: string }

export interface Overlays {
  mission(m: MissionCard | null): void;
  toast(t: ToastCard | null): void;
}

export function createOverlays(
  colors: Record<Tone, string>,
  onMenu: () => void,
  onAccept: () => void,
  onDismiss: () => void,
  onExpand: () => void,
  onAbandon: () => void,
  onOk: () => void,
): Overlays {
  const C = colors;
  const style = document.createElement('style');
  style.textContent = `
  .ov { position: fixed; z-index: 11; font-family: '${PIXEL_FONT}', ui-monospace, monospace;
    color: ${C.text}; -webkit-user-select: none; user-select: none; }
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
  .ov .abandon { margin-top: 3px; font-size: 10px; color: ${C.dim}; cursor: pointer;
    display: none; pointer-events: auto; text-decoration: underline; text-underline-offset: 2px; }
  .ov .ok { margin: 5px auto 1px; padding: 4px 26px 3px; cursor: pointer; display: none;
    pointer-events: auto; color: ${C.good}; border: 1px solid ${C.good};
    background: rgba(111,224,160,0.08); font: inherit; font-family: inherit;
    font-size: 12px; font-weight: 700; letter-spacing: 2px; }
  #ov-job { top: calc(env(safe-area-inset-top, 0px) + 46px); left: 10px; cursor: pointer;
    color: ${C.gold}; border: 1px solid ${C.gold}; background: rgba(8,20,23,0.78);
    padding: 4px 9px 3px; font: inherit; font-family: inherit; font-size: 10px;
    letter-spacing: 1px; display: none; }
  #ov-job .ico { font-family: '${ICON_FONT}'; font-weight: 900; margin-right: 0.5em; }
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
  mab.className = 'abandon';
  mab.textContent = 'ABANDON JOB';
  mab.addEventListener('click', (e) => { e.stopPropagation(); onAbandon(); });
  m.root.appendChild(mab);
  const mok = document.createElement('button');
  mok.className = 'ok';
  mok.textContent = 'OK';
  mok.addEventListener('click', (e) => { e.stopPropagation(); onOk(); });
  m.root.appendChild(mok);
  // The chip the active job collapses to — the job's whole state at a glance,
  // parked top-left where it stops competing with the road.
  const chip = document.createElement('button');
  chip.id = 'ov-job';
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

  let mKey = '', tKey = '', mReady = false;
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
      mab.style.display = mc.abandonable ? 'block' : 'none';
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
  };
}
