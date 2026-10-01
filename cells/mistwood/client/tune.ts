/**
 * The tuning overlay (development only, `?tune`): every declared flag (flags.ts), grouped, with a
 * control made from its spec — a slider for a number, a list for a choice, a box for a switch, a
 * field for text. Live flags change at once; the rest make the wood again with the new value.
 * Below, what the wood reports of itself (window.__mistwood), and any orphans in the address.
 *
 * Nothing here knows any flag by name: declare one in flags.ts and it is here.
 */
import { FLAGS, flag, onFlag, setFlag, setFlags, unknownFlags, type FlagName, type FlagSet, type Spec } from './flags';

const CSS = `
#tune { position: fixed; top: max(8px, env(safe-area-inset-top)); right: 8px; width: min(320px, calc(100vw - 16px)); max-height: 70vh; overflow: auto;
  font: 11px/1.35 ui-monospace, Menlo, monospace; color: #f2f5ee; text-shadow: 0 1px 2px rgba(0, 0, 0, .55);
  /* glass: the wood shows through, softened just enough to read over */
  background: rgba(20, 28, 24, .22); -webkit-backdrop-filter: blur(3px) saturate(1.2); backdrop-filter: blur(3px) saturate(1.2);
  border: 1px solid rgba(233, 238, 228, .22); border-radius: 8px; box-shadow: inset 0 1px 0 rgba(255, 255, 255, .08);
  z-index: 10; -webkit-user-select: text; user-select: text; touch-action: pan-y; }
/* while a control is held: only its row stays, on clear glass, so you see what it does */
#tune.adjusting { background: transparent; -webkit-backdrop-filter: none; backdrop-filter: none; border-color: transparent; box-shadow: none; }
#tune.adjusting > *:not(:has(.held)), #tune.adjusting details > *:not(.held) { opacity: 0; }
#tune .row.held { background: rgba(20, 28, 24, .35); border-radius: 4px; }
#tune summary { cursor: pointer; padding: 6px 8px; letter-spacing: 1px; }
#tune h4 { margin: 8px 8px 2px; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; opacity: .6; font-weight: normal; }
#tune .row { display: grid; grid-template-columns: 64px 1fr 52px; gap: 6px; align-items: center; padding: 2px 8px; }
#tune .row label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#tune .row.set label { color: #f2d48a; }
#tune .row .v { text-align: right; opacity: .8; }
#tune .row .x { all: unset; cursor: pointer; opacity: .5; padding: 0 2px; }
#tune .row .x[hidden] { display: none; }
#tune input[type=range] { width: 100%; }
#tune select, #tune input[type=text] { width: 100%; font: inherit; background: rgba(20, 28, 24, .45); color: inherit; border: 1px solid rgba(233, 238, 228, .25); border-radius: 3px; }
#tune .doc { padding: 0 8px 4px 78px; opacity: .5; font-size: 10px; }
#tune.nodocs .doc { display: none; }
#tune .bar { display: flex; gap: 8px; padding: 0 8px 4px; }
#tune .bar button { all: unset; cursor: pointer; opacity: .6; text-decoration: underline; }
#tune details > summary.g { padding: 6px 8px 2px; font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; opacity: .6; }
#tune .row .v { overflow: hidden; white-space: nowrap; }
#tune .warn { margin: 6px 8px; color: #f0a07a; }
#tune pre { margin: 4px 8px 8px; white-space: pre-wrap; opacity: .75; }
`;

export function mountTune(state: () => unknown) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const root = document.createElement('details');
  root.id = 'tune';
  root.open = true;
  root.innerHTML = '<summary>TUNE</summary>';
  root.classList.add('nodocs');
  // what each does: hidden until asked (also on each name, as its title)
  const bar = document.createElement('div');
  bar.className = 'bar';
  const docs = document.createElement('button');
  docs.textContent = 'help';
  docs.addEventListener('click', () => root.classList.toggle('nodocs'));
  // reset: every flag back to its default — but this wood, where you stand, and this panel kept
  const reset = document.createElement('button');
  reset.textContent = 'reset';
  reset.title = 'every flag to its default (keeps the seed, where you stand, and this panel)';
  reset.addEventListener('click', () => {
    const keep = new Set<FlagName>(['seed', 'x', 'y', 'heading', 'tune']);
    const clear: FlagSet = {};
    for (const n of Object.keys(FLAGS) as FlagName[]) {
      const v = flag(n) as unknown;
      if (!keep.has(n) && v !== null && v !== false) (clear as Record<string, null>)[n] = null;
    }
    if (Object.keys(clear).length) setFlags(clear);
  });
  // copy: the address as it stands (the wood, where you are, every flag) — to share or come back to
  const copy = document.createElement('button');
  copy.textContent = 'copy';
  copy.title = 'copy the link: this wood, where you stand, and every flag';
  copy.addEventListener('click', async () => {
    const text = location.href;
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = 'copied';
    } catch {
      // (no clipboard: show it, selected, to copy by hand)
      window.prompt('copy this link', text);
    }
    setTimeout(() => (copy.textContent = 'copy'), 1500);
  });
  bar.append(docs, reset, copy);
  root.append(bar);
  // nothing in the panel reaches the wood (walking, looking, the keys)
  for (const ev of ['pointerdown', 'keydown', 'keyup', 'wheel'] as const) root.addEventListener(ev, (e) => e.stopPropagation());
  if (unknownFlags.length) {
    const w = document.createElement('div');
    w.className = 'warn';
    w.textContent = `not flags (ignored): ${unknownFlags.join(', ')}`;
    root.append(w);
  }
  const refresh = new Map<FlagName, () => void>();
  const groups = new Map<string, FlagName[]>();
  for (const name of Object.keys(FLAGS) as FlagName[]) {
    const g = FLAGS[name].group;
    groups.set(g, [...(groups.get(g) ?? []), name]);
  }
  for (const [group, names] of groups) {
    const section = document.createElement('details');
    // open: the groups with a flag set (and the sky, the one most often turned)
    section.open = group === 'sky' || names.some((n) => { const v = flag(n) as unknown; return v !== null && v !== false && n !== 'seed' && n !== 'tune'; });
    section.innerHTML = `<summary class="g">${group}</summary>`;
    root.append(section);
    for (const name of names) {
      const spec: Spec = FLAGS[name];
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('label');
      label.textContent = name;
      label.title = spec.doc;
      const out = document.createElement('span');
      out.className = 'v';
      let control: HTMLInputElement | HTMLSelectElement;
      const put = (v: unknown) => setFlag(name, v as never);
      if (spec.kind === 'number' && (spec.max - spec.min) / spec.step > 5000) {
        // too wide for a slider (a place in the wood): type it
        const i = document.createElement('input');
        i.type = 'text';
        i.inputMode = 'decimal';
        i.addEventListener('change', () => put(i.value === '' ? null : Number(i.value)));
        control = i;
      } else if (spec.kind === 'number') {
        const i = document.createElement('input');
        i.type = 'range';
        i.min = String(spec.min);
        i.max = String(spec.max);
        i.step = String(spec.step);
        // live: as it moves; otherwise once let go (each change makes the wood again)
        i.addEventListener(spec.live ? 'input' : 'change', () => put(Number(i.value)));
        control = i;
      } else if (spec.kind === 'enum') {
        const s = document.createElement('select');
        s.innerHTML = `<option value="">—</option>` + spec.values.map((v) => `<option>${v}</option>`).join('');
        s.addEventListener('change', () => put(s.value || null));
        control = s;
      } else if (spec.kind === 'bool') {
        const i = document.createElement('input');
        i.type = 'checkbox';
        i.addEventListener('change', () => put(i.checked));
        control = i;
      } else {
        const i = document.createElement('input');
        i.type = 'text';
        i.addEventListener('change', () => put(i.value || null));
        control = i;
      }
      control.setAttribute('aria-label', `${name}: ${spec.doc}`);
      if (control instanceof HTMLInputElement && control.type === 'range') {
        // holding a slider: the rest of the panel steps aside
        const hold = (on: boolean) => { row.classList.toggle('held', on); root.classList.toggle('adjusting', on); };
        control.addEventListener('pointerdown', () => hold(true));
        for (const ev of ['pointerup', 'pointercancel', 'change', 'blur'] as const) control.addEventListener(ev, () => hold(false));
      }
      // clear: back to the default
      const clear = document.createElement('button');
      clear.className = 'x';
      clear.textContent = '×';
      clear.title = 'clear (the default)';
      clear.addEventListener('click', () => setFlag(name, null));
      const sync = () => {
        const v = flag(name) as unknown;
        const set = v !== null && v !== false;
        row.classList.toggle('set', set);
        if (control instanceof HTMLInputElement && control.type === 'checkbox') control.checked = v === true;
        else if (control instanceof HTMLInputElement && control.type === 'range') control.value = set ? String(v) : String((spec as { min: number }).min);
        else if (document.activeElement !== control) control.value = set ? String(v) : '';
        out.textContent = set ? `${typeof v === 'number' ? Math.round(v * 100) / 100 : v === true ? 'on' : String(v).slice(0, 8)}${spec.kind === 'number' && spec.unit ? spec.unit : ''}` : '';
        out.append(clear);
        clear.hidden = !set;
      };
      refresh.set(name, sync);
      sync();
      row.append(label, control, out);
      const doc = document.createElement('div');
      doc.className = 'doc';
      doc.textContent = spec.doc + (spec.live ? '' : ' · reloads');
      section.append(row, doc);
    }
  }
  onFlag((name) => refresh.get(name)?.());
  const pre = document.createElement('pre');
  root.append(pre);
  setInterval(() => {
    if (root.open) pre.textContent = JSON.stringify(state(), null, 1).replace(/[{}"]/g, '').trim();
  }, 500);
  document.body.append(root);
}
