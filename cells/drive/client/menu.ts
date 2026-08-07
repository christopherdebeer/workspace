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
 * The one thing the DOM cannot do is render the truck: the RIG tab's vehicle
 * bay is still a scissored studio render on the WebGL canvas underneath.
 * The scrim is therefore built from FOUR strips positioned around the bay
 * (not one full-screen sheet with a clip-path hole — Safari's evenodd
 * support is not worth betting the panel on), and `bayRect()` reports where
 * the hole is each frame so the renderer can aim at it.
 *
 * Everything stateful stays in main.ts; this module gets a context of
 * getters and actions and owns only layout and the open/closed state.
 */

export const T_DRIVE = 0, T_SURVEY = 1, T_RIG = 2, T_WORLD = 3, T_SYSTEM = 4;
const TABS = ['DRIVE', 'SURVEY', 'RIG', 'WORLD', 'SYSTEM'];

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
  // ── actions ──
  drive(): void;
  realToggle(): void;
  elsewhere(): void;
  saveSpot(): void;
  scriptLabel(): string;
  toggleScript(): void;
  soundLabel(): string;
  soundTone(): Tone;
  soundTap(): void;
  hideHud(): void;
  startDrive(i: number): void;
  deleteSpot(i: number): void;
  /** Geolocate (from this tap's gesture) and start a drive there. Status
   *  strings land back in the CURRENT row via the callback. */
  goCurrent(status: (s: string, bad?: boolean) => void): void;
}

export interface MenuHandle {
  open(tab?: number): void;
  close(): void;
  tab(): number | null;
  /** Where the RIG tab's vehicle bay sits, in CSS pixels — null unless the
   *  RIG tab is showing. Calling it also re-aims the scrim hole, so the
   *  renderer and the scrim can never disagree about where the truck shows. */
  bayRect(): Rect | null;
  refresh(): void;
}

export function createMenu(ctx: MenuCtx): MenuHandle {
  const C = ctx.colors;

  // ── chrome ─────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
  #menu { position: fixed; inset: 0; z-index: 15; display: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: ${C.text};
    font-size: 12px; line-height: 1.4; -webkit-user-select: none; user-select: none; }
  #menu .m-scrim { position: absolute; background: rgba(6,14,17,0.92); }
  #menu .m-panel { position: absolute; inset: 10px; border: 1px solid ${C.dim};
    display: flex; flex-direction: column; padding: 10px 0 10px; min-height: 0; }
  #menu .m-corner { position: absolute; width: 9px; height: 9px; }
  #menu .m-head { display: flex; align-items: baseline; gap: 0.6em; padding: 0 12px; }
  #menu .m-title { color: ${C.gold}; font-weight: 700; letter-spacing: 0.08em; }
  #menu .m-title .arrow { color: ${C.hot}; }
  #menu .m-sub { padding: 2px 12px 8px; color: ${C.dim}; font-size: 10px; letter-spacing: 0.14em; }
  #menu .m-x { margin-left: auto; cursor: pointer; color: ${C.hot}; border: 1px solid ${C.hot};
    background: rgba(8,20,23,0.78); padding: 1px 9px; font: inherit; }
  #menu .m-rule { border-top: 1px solid ${C.dim}; margin: 0 8px; }
  #menu .m-tabs { display: flex; flex-wrap: wrap; gap: 5px; padding: 8px 12px; }
  #menu .m-tab { font: inherit; letter-spacing: 0.06em; cursor: pointer; padding: 2px 9px;
    background: none; border: 1px solid transparent; color: ${C.soft}; }
  #menu .m-tab.on { border-color: ${C.gold}; color: ${C.gold}; background: rgba(8,20,23,0.78); }
  #menu .m-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain;
    padding: 6px 12px 4px; }
  #menu .m-place { color: ${C.gold}; font-size: 15px; font-weight: 700; letter-spacing: 0.05em;
    text-shadow: 0 0 8px rgba(242,193,78,0.45); }
  #menu .m-dimline { color: ${C.dim}; font-size: 10px; margin: 2px 0 8px; }
  #menu table.m-kv { border-collapse: collapse; font-size: 10px; }
  #menu table.m-kv td { padding: 1px 1.2em 1px 0; vertical-align: baseline; }
  #menu table.m-kv td:first-child { color: ${C.dim}; padding-right: 1.6em; white-space: nowrap; }
  #menu .m-foot { padding: 8px 12px 0; display: grid; gap: 5px; justify-items: start; }
  #menu .m-btn { font: inherit; letter-spacing: 0.06em; cursor: pointer; min-width: 12em;
    text-align: left; padding: 4px 10px; background: rgba(8,20,23,0.78); border: 1px solid; }
  #menu .m-sect { color: ${C.edge}; font-size: 10px; letter-spacing: 0.12em;
    display: flex; align-items: center; gap: 8px; margin: 10px 0 4px; }
  #menu .m-sect::after { content: ''; flex: 1; border-top: 1px solid ${C.dim}; }
  #menu .m-row { display: flex; align-items: baseline; gap: 8px; padding: 2px 0; }
  #menu .m-row.hit { cursor: pointer; }
  #menu .m-row .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #menu .m-row .sub { margin-left: auto; color: ${C.dim}; font-size: 10px; text-align: right;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; max-width: 55%; }
  #menu .m-row .del { color: ${C.soft}; cursor: pointer; padding: 0 6px; flex-shrink: 0; }
  #menu .m-meter { display: inline-flex; gap: 1px; align-self: center; flex-shrink: 0; }
  #menu .m-meter i { width: 4px; height: 4px; background: rgba(87,201,176,0.16); }
  #menu .m-dial { display: flex; align-items: baseline; gap: 8px; padding: 2px 2px; cursor: pointer; }
  #menu .m-dial .lab { color: ${C.soft}; font-size: 10px; }
  #menu .m-dial .val { margin-left: auto; color: ${C.gold}; font-size: 10px; }
  #menu .m-views { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
  #menu .m-view { font: inherit; font-size: 10px; cursor: pointer; padding: 1px 6px;
    background: none; border: 1px solid transparent; color: ${C.soft}; }
  #menu .m-view.on { border-color: ${C.gold}; color: ${C.gold}; }
  #menu .m-bay { position: relative; border: 1px solid ${C.dim}; height: 200px; margin: 2px 0 8px; }
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

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, txt = ''): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt) e.textContent = txt;
    return e;
  };

  // ── header / tabs (built once) ─────────────────────────────────────
  const head = el('div', 'm-head');
  const title = el('div', 'm-title');
  title.append('PARIS ', el('span', 'arrow', '→'), ' DAKAR');
  const closeBtn = el('button', 'm-x', 'X');
  closeBtn.addEventListener('click', () => close());
  head.append(title, closeBtn);
  const subT = el('div', 'm-sub', 'SOLARPUNK RALLY RIG');
  const tabRow = el('div', 'm-tabs');
  const tabBtns = TABS.map((t, i) => {
    const b = el('button', 'm-tab', t);
    b.addEventListener('click', () => setTab(i));
    tabRow.appendChild(b);
    return b;
  });
  const body = el('div', 'm-body');
  const foot = el('div', 'm-foot');
  panel.append(head, subT, el('div', 'm-rule'), tabRow, el('div', 'm-rule'), body, foot);

  // ── state ──────────────────────────────────────────────────────────
  let tab: number | null = null;
  let bayEl: HTMLElement | null = null;
  let bayGridFor = '';           // last grid applied, so refresh doesn't redo it
  let currentStatus: { s: string; bad: boolean } | null = null;   // the CURRENT row's transient state
  // Live readouts UPDATE IN PLACE; the page rebuilds only when its structure
  // changes (a list grew, a tab switched). A wholesale rebuild on a timer
  // detaches every node a finger might be between down and up on, which
  // silently eats taps.
  let updaters: Array<() => void> = [];
  let structSig = '';
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && tab !== null) close(); });

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

  const button = (label: string, col: string, hit: () => void): HTMLButtonElement => {
    const b = el('button', 'm-btn', label);
    b.style.color = col;
    b.style.borderColor = col;
    b.addEventListener('click', hit);
    return b;
  };

  const meterSet = (m: HTMLElement, lit: number, col: string): void => {
    Array.from(m.children).forEach((c, i) => {
      (c as HTMLElement).style.background = i < lit ? col : 'rgba(87,201,176,0.16)';
    });
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

  // ── tabs ───────────────────────────────────────────────────────────
  function renderDrive(): void {
    const place = el('div', 'm-place', ctx.place());
    const situation = el('div', 'm-dimline', ctx.situation());
    bindText(place, ctx.place);
    bindText(situation, ctx.situation);
    body.append(place, situation, el('div', 'm-rule'), kvTable(ctx.driveStats));
    const realBtn = button('', C.hot, () => { ctx.realToggle(); refreshNow(); });
    updaters.push(() => {
      const r = ctx.real();
      const label = r.on ? 'REAL DRIVE ON' : r.err ? r.err : 'REAL DRIVE';
      const col = r.on ? C.good : r.err ? C.bad : C.hot;
      if (realBtn.textContent !== label) realBtn.textContent = label;
      realBtn.style.color = col;
      realBtn.style.borderColor = col;
    });
    foot.append(
      button('DRIVE', C.good, () => { ctx.drive(); close(); }),
      realBtn,
      button('ELSEWHERE', C.gold, () => ctx.elsewhere()),
    );
  }

  function renderSurvey(): void {
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
    (hdr.firstChild as HTMLElement).style.fontSize = '10px';
    body.append(el('div', 'm-rule'), hdr);
    for (const r of ctx.surveyRoads()) {
      const row = el('div', 'm-row');
      const name = el('span', 'name', r.name);
      name.style.color = tone(r.tone);
      name.style.flex = '1';
      const km = el('span', '', r.km);
      km.style.color = C.dim;
      km.style.fontSize = '10px';
      const n = el('span', '', r.tally);
      n.style.color = C.dim;
      n.style.fontSize = '10px';
      row.append(name, km, meterEl(10, Math.round(r.frac * 10), tone(r.tone), 3), n);
      body.appendChild(row);
    }
  }

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
    bayEl = el('div', 'm-bay');
    bayEl.append(el('div', 'cap'), el('div', 'tag', 'DAK 23'));
    bayGridFor = '';
    body.append(views, bayEl);
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
    body.append(t, el('div', 'm-sect', 'SHEET'), kvTable(ctx.specText));
    dialsInto(body, ctx.dialGroups('rig'));
  }

  function renderWorld(): void {
    body.appendChild(kvTable(ctx.worldRows));
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
      row.append(name, sub);
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
      row.append(name, sub);
      if (d.mine) {
        const x = el('span', 'del', 'X');
        x.addEventListener('click', (e) => { e.stopPropagation(); ctx.deleteSpot(i); render(); });
        row.appendChild(x);
      }
      row.addEventListener('click', () => ctx.startDrive(i));
      body.appendChild(row);
    });
    foot.append(
      button('SAVE THIS SPOT', C.gold, () => { ctx.saveSpot(); render(); }),
      button(ctx.scriptLabel(), C.edge, () => { ctx.toggleScript(); render(); }),
    );
  }

  function renderSystem(): void {
    body.appendChild(kvTable(ctx.systemRows));
    dialsInto(body, ctx.dialGroups('system'));
    const snd = button('', C.soft, () => { ctx.soundTap(); refreshNow(); });
    updaters.push(() => {
      const label = ctx.soundLabel(), col = tone(ctx.soundTone());
      if (snd.textContent !== label) snd.textContent = label;
      snd.style.color = col;
      snd.style.borderColor = col;
    });
    foot.append(snd, button('HIDE HUD', C.soft, () => { close(); ctx.hideHud(); }));
  }

  // ── render / refresh ───────────────────────────────────────────────
  /** What forces a REBUILD, per tab — everything else updates in place. */
  function sig(): string {
    if (tab === T_SURVEY) {
      const h = ctx.surveyHere();
      return `s|${h?.name}|${h?.tally}|${h?.state}|${ctx.surveyRoads().map((r) => r.tally).join(',')}`;
    }
    if (tab === T_WORLD) return `w|${ctx.drives().length}|${ctx.scriptLabel()}`;
    return String(tab);
  }

  function render(): void {
    if (tab === null) return;
    const scroll = body.scrollTop;
    body.replaceChildren();
    foot.replaceChildren();
    bayEl = null;
    updaters = [];
    tabBtns.forEach((b, i) => b.classList.toggle('on', i === tab));
    [renderDrive, renderSurvey, renderRig, renderWorld, renderSystem][tab]();
    structSig = sig();
    body.scrollTop = scroll;
  }

  function setTab(t: number): void {
    tab = t;
    if (t !== T_RIG) scrimFull();
    render();
  }

  function open(t = T_DRIVE): void {
    root.style.display = 'block';
    currentStatus = null;
    setTab(t);
  }

  function close(): void {
    tab = null;
    bayEl = null;
    root.style.display = 'none';
  }

  function bayRect(): Rect | null {
    if (tab !== T_RIG || !bayEl || !bayEl.isConnected) return null;
    // The bay keeps the elevation's shape: wide views get a squat window,
    // the plan view a tall one — within what the panel has to give.
    const r = bayEl.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return null;
    // Aim the scrim's hole here. Clamp to the body's box so a half-scrolled
    // bay doesn't open a window over the header.
    const clip = body.getBoundingClientRect();
    const x0 = Math.max(r.left, clip.left), x1 = Math.min(r.right, clip.right);
    const y0 = Math.max(r.top, clip.top), y1 = Math.min(r.bottom, clip.bottom);
    if (x1 - x0 < 4 || y1 - y0 < 4) { scrimFull(); return null; }
    const px = (n: number): string => `${Math.round(n)}px`;
    Object.assign(strips[0].style, { display: 'block', left: '0', top: '0', right: '0', bottom: px(innerHeight - y0), });
    Object.assign(strips[1].style, { display: 'block', left: '0', top: px(y1), right: '0', bottom: '0' });
    Object.assign(strips[2].style, { display: 'block', left: '0', top: px(y0), width: px(x0), height: px(y1 - y0), right: 'auto', bottom: 'auto' });
    Object.assign(strips[3].style, { display: 'block', left: px(x1), top: px(y0), right: '0', height: px(y1 - y0), bottom: 'auto', width: 'auto' });
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
  const refreshNow = refresh;
  // Readouts move while the page is up (the odometer, the survey, a GPS fix
  // arriving). Values track on a slow clock; the DOM is only rebuilt when the
  // structure itself changes, so a finger is never on a node a rebuild is
  // about to detach.
  setInterval(refresh, 400);

  return { open, close, tab: () => tab, bayRect, refresh };
}
