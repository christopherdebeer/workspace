/**
 * ── DIALS: EVERY LAB, THE SAME BARGAIN ──
 *
 * A lab is only worth opening if what you learn in it can leave. Three things
 * make that true, and every lab gets all three from here rather than
 * reinventing them:
 *
 * BE LIBERAL WITH THE DIALS. A number worth arguing about is worth a slider.
 * The cost of one more dial is a row in a panel; the cost of a missing one is
 * an edit-build-look cycle per guess, which is exactly the loop labs exist to
 * kill.
 *
 * IT SURVIVES A RELOAD. Tuning is lost the instant the page refreshes
 * otherwise, and a lab is a thing you refresh constantly. Saved per lab under
 * its own key, restored on open, and never shared between labs.
 *
 * AND IT COMES OUT AS TEXT. The point of the tuning is to end up in the
 * ENGINE, so COPY puts it on the clipboard — as a paste-ready source literal
 * when the lab knows how to write one, as JSON otherwise — and PASTE takes it
 * back, so a set of numbers can travel between a phone, a desktop and a
 * commit without being transcribed by hand.
 */

export type DialSpec =
  /** A heading. Everything after it folds under it, until the next one. Not a
   *  value: a section never appears in `values()` or on the clipboard. */
  | { id: string; label: string; kind: 'section'; open?: boolean }
  | { id: string; label: string; kind: 'range'; min: number; max: number; step: number; value: number }
  | { id: string; label: string; kind: 'number'; step?: number; value: number }
  | { id: string; label: string; kind: 'select'; options: readonly string[]; value: string }
  | { id: string; label: string; kind: 'color'; value: string }
  | { id: string; label: string; kind: 'toggle'; value: boolean };

export type DialValues = Record<string, number | string | boolean>;

export interface Dials {
  /** The panel, for a lab that wants to place it itself. */
  readonly root: HTMLElement;
  num(id: string): number;
  str(id: string): string;
  bool(id: string): boolean;
  values(): DialValues;
  /** Apply a set of values — used by PASTE and by RESET. */
  set(values: DialValues): void;
  /** Called after any change, however it arrived. */
  onChange(fn: () => void): void;
}

export interface DialsOptions {
  /** Storage key and clipboard label. One per lab. */
  slug: string;
  /** Dials this helper builds. */
  spec?: readonly DialSpec[];
  /** Ids of controls the LAB already built, adopted so they save and travel
   *  too — a lab with hand-rolled markup should not have to be rewritten to
   *  get persistence and a copy button. */
  adopt?: readonly string[];
  /** A paste-ready snippet for the engine. JSON is used when absent. */
  source?: (values: DialValues) => string;
  /** Where to put the panel. Defaults to a fixed block at the top left. */
  mount?: HTMLElement;
}

const KEY = (slug: string): string => `drive.lab.${slug}.dials`;
/** What is folded away. Separate from the VALUES key on purpose: how a panel
 *  is arranged is a property of this device and this pair of eyes, and it must
 *  never ride along on the clipboard when the tuning travels to a commit. */
const FOLD = (slug: string): string => `drive.lab.${slug}.fold`;

function styleOnce(): void {
  if (document.getElementById('lab-dials-style')) return;
  const s = document.createElement('style');
  s.id = 'lab-dials-style';
  s.textContent = `
    /* ── A COLUMN, NOT A SCROLLING BLOCK ──
       The panel was one overflowing box with the buttons at the bottom OF the
       scroll, so a liberal set of dials pushed COPY, PASTE and RESET past the
       end of it: the tuning could be turned and then not taken out, which is
       the one thing this panel must never do. Head and foot are pinned now and
       only the dials scroll. */
    .lab-dials { position: fixed; top: 0; left: 0; z-index: 40; display: flex; flex-direction: column;
      width: 272px; max-width: 78vw; max-height: 100vh;
      background: rgba(8,14,16,.93); border-right: 1px solid #24343a; border-bottom: 1px solid #24343a;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d6e2e4; }
    .lab-dials .head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
      gap: 8px; padding: 7px 11px; border-bottom: 1px solid #24343a; cursor: pointer;
      letter-spacing: 2px; color: #7fd0c4; user-select: none; }
    .lab-dials .head small { color: #4f6469; letter-spacing: 1px; }
    .lab-dials .body { flex: 1 1 auto; overflow: auto; padding: 3px 11px 2px; }
    .lab-dials .foot { flex: 0 0 auto; padding: 7px 11px 8px; border-top: 1px solid #24343a; }
    .lab-dials[data-shut="1"] .body, .lab-dials[data-shut="1"] .foot { display: none; }
    .lab-dials .sh { display: flex; align-items: center; justify-content: space-between;
      margin: 9px 0 2px; padding-bottom: 2px; border-bottom: 1px solid #1b282c;
      color: #6f8285; letter-spacing: 2px; cursor: pointer; user-select: none; }
    .lab-dials .sec[data-shut="1"] .rows { display: none; }
    .lab-dials .sec[data-shut="1"] .sh { color: #4f6469; border-bottom-style: dashed; }
    .lab-dials .d { display: flex; align-items: center; justify-content: space-between;
      gap: 10px; margin: 4px 0; letter-spacing: 1px; color: #9fb2b5; }
    .lab-dials .d > span { white-space: nowrap; }
    .lab-dials input, .lab-dials select { background: #101a1d; color: #d6e2e4;
      border: 1px solid #2b3d43; font: inherit; width: 118px; }
    .lab-dials input[type=checkbox] { width: auto; }
    .lab-dials .v { color: #7fd0c4; min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; }
    .lab-dials .bar { display: flex; gap: 6px; }
    .lab-dials button { flex: 1; background: #10201f; color: #a9dcd2; border: 1px solid #2f5a52;
      font: inherit; letter-spacing: 1px; padding: 4px 0; cursor: pointer; }
    .lab-dials button:hover { background: #16302c; }
    .lab-dials .msg { color: #6f8285; margin-top: 6px; min-height: 1.4em; letter-spacing: 1px; }`;
  document.head.appendChild(s);
}

export function createDials(opts: DialsOptions): Dials {
  styleOnce();
  const root = document.createElement('div');
  root.className = 'lab-dials';
  const spec = opts.spec ?? [];
  const listeners: Array<() => void> = [];
  const readouts = new Map<string, HTMLElement>();

  // ── HOW THE PANEL IS FOLDED, REMEMBERED PER LAB ──
  //
  // Being liberal with the dials is the bargain (see the header), and the cost
  // of keeping it is that a panel can be taller than the screen — the flora
  // lab is thirty-one dials. So the answer is not fewer dials, it is FOLDING:
  // the whole panel down to its title bar, and each section down to its
  // heading. Both survive a reload, because a lab is a thing you refresh
  // constantly and re-folding it every time is its own tax.
  let fold: { shut?: boolean; secs?: Record<string, boolean> } = {};
  try { fold = JSON.parse(localStorage.getItem(FOLD(opts.slug)) ?? '{}') as typeof fold; } catch { /* fine */ }
  const saveFold = (): void => {
    try { localStorage.setItem(FOLD(opts.slug), JSON.stringify(fold)); } catch { /* private mode */ }
  };

  const head = document.createElement('div');
  head.className = 'head';
  const headName = document.createElement('b');
  headName.textContent = opts.slug.toUpperCase();
  const headHint = document.createElement('small');
  head.append(headName, headHint);
  const body = document.createElement('div');
  body.className = 'body';
  const foot = document.createElement('div');
  foot.className = 'foot';
  root.append(head, body, foot);

  const paintFold = (): void => {
    const shut = !!fold.shut;
    root.dataset.shut = shut ? '1' : '0';
    headHint.textContent = shut ? '▸ H' : '▾ H';
    // The page can lay itself out around the panel: a lab that offsets its
    // content by a hard 288px keeps that gutter after the panel is folded,
    // which is most of the reason folding it was worth doing.
    document.documentElement.style.setProperty('--dials-w', shut ? '0px' : '272px');
  };
  head.addEventListener('click', () => { fold.shut = !fold.shut; saveFold(); paintFold(); });
  // H, unless the caret is in a field — a lab with a text input should not
  // vanish because someone typed a letter into it.
  addEventListener('keydown', (e) => {
    if (e.key !== 'h' && e.key !== 'H') return;
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    fold.shut = !fold.shut;
    saveFold();
    paintFold();
  });

  /** Rows land here — the panel body, or the open section most recently
   *  declared. */
  let rows: HTMLElement = body;

  const inputOf = (id: string): HTMLInputElement | HTMLSelectElement | null =>
    document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;

  for (const d of spec) {
    if (d.kind === 'section') {
      const sec = document.createElement('div');
      sec.className = 'sec';
      const sh = document.createElement('div');
      sh.className = 'sh';
      const name = document.createElement('span');
      name.textContent = d.label;
      const chev = document.createElement('span');
      sh.append(name, chev);
      const inner = document.createElement('div');
      inner.className = 'rows';
      sec.append(sh, inner);
      const paint = (): void => {
        const shut = fold.secs?.[d.id] ?? !(d.open ?? true);
        sec.dataset.shut = shut ? '1' : '0';
        chev.textContent = shut ? '▸' : '▾';
      };
      sh.addEventListener('click', () => {
        (fold.secs ??= {})[d.id] = !(fold.secs?.[d.id] ?? !(d.open ?? true));
        saveFold();
        paint();
      });
      paint();
      body.appendChild(sec);
      rows = inner;
      continue;
    }
    const row = document.createElement('label');
    row.className = 'd';
    const name = document.createElement('span');
    name.textContent = d.label;
    row.appendChild(name);
    let input: HTMLInputElement | HTMLSelectElement;
    if (d.kind === 'select') {
      const sel = document.createElement('select');
      for (const o of d.options) {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        sel.appendChild(opt);
      }
      sel.value = d.value;
      input = sel;
    } else {
      const el = document.createElement('input');
      el.type = d.kind === 'toggle' ? 'checkbox' : d.kind === 'color' ? 'color' : d.kind;
      if (d.kind === 'range') { el.min = String(d.min); el.max = String(d.max); el.step = String(d.step); }
      if (d.kind === 'number' && d.step !== undefined) el.step = String(d.step);
      if (d.kind === 'toggle') el.checked = d.value;
      else el.value = String(d.value);
      input = el;
    }
    input.id = d.id;
    row.appendChild(input);
    // A slider with no number beside it is a guess you cannot write down.
    if (d.kind === 'range' || d.kind === 'number') {
      const v = document.createElement('span');
      v.className = 'v';
      readouts.set(d.id, v);
      row.appendChild(v);
    }
    rows.appendChild(row);
  }

  const ids = [...spec.filter((d) => d.kind !== 'section').map((d) => d.id),
    ...(opts.adopt ?? [])];

  const values = (): DialValues => {
    const out: DialValues = {};
    for (const id of ids) {
      const el = inputOf(id);
      if (!el) continue;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') out[id] = el.checked;
      else if (el instanceof HTMLInputElement && (el.type === 'range' || el.type === 'number')) out[id] = parseFloat(el.value);
      else out[id] = el.value;
    }
    return out;
  };

  const paint = (): void => {
    for (const [id, node] of readouts) {
      const el = inputOf(id);
      if (el) node.textContent = el.value;
    }
  };

  const save = (): void => {
    try { localStorage.setItem(KEY(opts.slug), JSON.stringify(values())); } catch { /* private mode */ }
  };

  const fire = (): void => { paint(); save(); for (const fn of listeners) fn(); };

  const set = (v: DialValues): void => {
    for (const [id, value] of Object.entries(v)) {
      const el = inputOf(id);
      if (!el) continue;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = !!value;
      else el.value = String(value);
    }
    fire();
  };

  const msg = document.createElement('div');
  msg.className = 'msg';
  const say = (text: string): void => {
    msg.textContent = text;
    setTimeout(() => { if (msg.textContent === text) msg.textContent = ''; }, 2600);
  };

  const bar = document.createElement('div');
  bar.className = 'bar';
  const button = (label: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', fn);
    bar.appendChild(b);
  };
  button('COPY', () => {
    const text = opts.source ? opts.source(values()) : JSON.stringify(values(), null, 2);
    // ALSO ON THE PANEL, not only on the clipboard. Reading a clipboard needs
    // a permission headless browsers do not grant, and the call HANGS rather
    // than failing — a test that checked COPY through it stalled for ten
    // minutes. The last copied text is mirrored here, where anything can read
    // it, which is also handy when the clipboard is refused on a device.
    root.dataset.lastCopy = text;
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        say('copied — paste into the engine');
      } catch {
        // Clipboard write can be refused (no gesture trust, no permission).
        // A selectable box is never refused, and losing the tuning to a
        // silent failure is the one outcome worth engineering against.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;inset:12% 8%;z-index:60;background:#080e10;color:#d6e2e4;border:1px solid #2b3d43;font:12px ui-monospace,monospace;padding:8px';
        ta.addEventListener('blur', () => ta.remove());
        document.body.appendChild(ta);
        ta.select();
        say('clipboard refused — select and copy');
      }
    })();
  });
  button('PASTE', () => {
    void (async () => {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch { text = ''; }
      if (!text) text = prompt('paste dial values (JSON)') ?? '';
      if (!text.trim()) return;
      try {
        // Tolerates a copied SOURCE snippet as well as raw JSON: the braces
        // are found and the keys unquoted-or-quoted both parse, because the
        // thing on a clipboard is whatever COPY last put there.
        const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
        const json = body.replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":').replace(/,(\s*[}\]])/g, '$1');
        set(JSON.parse(json) as DialValues);
        say('applied');
      } catch {
        say('could not read that');
      }
    })();
  });
  button('RESET', () => {
    try { localStorage.removeItem(KEY(opts.slug)); } catch { /* fine */ }
    const back: DialValues = {};
    for (const d of spec) if (d.kind !== 'section') back[d.id] = d.value;
    set(back);
    say('back to defaults');
  });
  foot.append(bar, msg);
  (opts.mount ?? document.body).appendChild(root);
  paintFold();

  // Adopted controls exist in the lab's own markup, so they are wired after
  // the panel is mounted rather than as it is built.
  for (const id of ids) inputOf(id)?.addEventListener('input', fire);
  for (const id of ids) inputOf(id)?.addEventListener('change', fire);

  // …and the saved set is applied last, over whatever the markup defaulted to.
  try {
    const saved = localStorage.getItem(KEY(opts.slug));
    if (saved) set(JSON.parse(saved) as DialValues);
  } catch { /* a corrupt entry is not worth failing a lab over */ }
  paint();

  return {
    root,
    num: (id) => parseFloat((inputOf(id) as HTMLInputElement | null)?.value ?? '0') || 0,
    str: (id) => (inputOf(id)?.value ?? ''),
    bool: (id) => !!(inputOf(id) as HTMLInputElement | null)?.checked,
    values,
    set,
    onChange: (fn) => { listeners.push(fn); },
  };
}
