import type { EditableRasterTile, RasterEditResult } from './world-authoring-raster';

export interface AuthoringPoint {
  x: number;
  z: number;
}

export interface AuthoringPreview {
  kind: 'cursor' | 'polyline';
  points: readonly AuthoringPoint[];
  radiusM: number;
  state: 'cursor' | 'draft' | 'pending' | 'settled' | 'failed';
}

export interface AuthoringEditResult extends RasterEditResult {
  pending?: number;
}

export interface AuthoringChoice {
  value: string;
  label: string;
}

export interface AuthoringStrength {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
}

export interface AuthoringLayer {
  id: string;
  label: string;
  kind: 'raster' | 'vector';
  editable: boolean;
  gesture: 'brush' | 'polyline';
  choices: readonly AuthoringChoice[];
  radius?: AuthoringStrength;
  strength?: AuthoringStrength;
  beginGesture(at: AuthoringPoint, radiusM: number, value: string, strength: number): AuthoringEditResult;
  updateGesture(at: AuthoringPoint, radiusM: number, value: string, strength: number): AuthoringEditResult;
  endGesture(): AuthoringEditResult;
  cancelGesture(): void;
  previews(cursor: AuthoringPoint | null, radiusM: number): readonly AuthoringPreview[];
  undo(): AuthoringEditResult;
  reset(): AuthoringEditResult;
  setDataView(on: boolean): void;
  report(): Record<string, unknown>;
}

export interface WorldAuthoringRuntime {
  canvas: HTMLCanvasElement;
  worldAt(clientX: number, clientY: number): [number, number] | null;
  focus(): [number, number];
  setInputCaptured(captured: boolean): void;
  setPreviews(previews: readonly AuthoringPreview[]): void;
  layers: readonly AuthoringLayer[];
  /** The chart (the game's top camera, a 2D map) or the seat you drive from.
   *  Painting a raster is a map job; looking at the result is a seat job. */
  setChart?(on: boolean): void;
  isChart?(): boolean;
  /** The game's own DOM chrome — menu, dock, HUD — off while the lab is up,
   *  so a phone's viewport is the world and the bar. */
  setChrome?(on: boolean): void;
  /** Hand a pointer to the chart's own pan/pinch while the lab still owns
   *  input: a second finger on the map is a pan, not a second brush. */
  chartGrab?(pointerId: number, clientX: number, clientY: number): void;
  setPanning?(on: boolean): void;
  /** File the layer's work in the authored store. Resolves to a line for the
   *  bar; a layer with no store kind yet says so. */
  bank?(layerId: string, dry: boolean): Promise<string>;
}

interface WorldAuthoringWindow extends Window {
  __worldedit?: () => Record<string, unknown>;
  __worldeditPaint?: (
    x?: number,
    z?: number,
    value?: string | number,
    radiusM?: number,
    strength?: number,
  ) => Record<string, unknown>;
  __worldeditLine?: (
    points?: Array<[number, number]>,
    value?: string,
    widthM?: number,
  ) => Record<string, unknown>;
}

const button = (label: string): HTMLButtonElement => {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  return el;
};

/**
 * The authoring lab is an overlay, not a substitute renderer. Everything under
 * this panel is the shipping game; the layer adapter is the only bridge.
 */
export function startWorldAuthoringLab(runtime: WorldAuthoringRuntime): void {
  if (!runtime.layers.length || document.getElementById('world-authoring')) return;
  let layer = runtime.layers[0];
  let dataView = false;
  let armed = false;
  let painting = false;
  let pointer = -1;
  let changed = 0;
  let rebuilds = 0;
  let cursor: AuthoringPoint | null = null;
  let lastAt = { x: 0, y: 0 };

  let chart = false;
  let panning = false;
  const pointers = new Set<number>();
  const style = document.createElement('style');
  // MOBILE FIRST. The old panel was 330 px wide and seven rows tall — on a
  // 390 px phone it covered the top half of the world it was there to edit,
  // over the game's own menu. The lab is now a BAR along the bottom, one row
  // of thumb-sized chips, and a SHEET that slides up over it for the rest:
  // the sliders, the selects, undo, reset, bank, and the report. The world
  // is the viewport; the bar is 56 px of it.
  style.textContent = `
    #world-authoring { position: fixed; z-index: 120; left: 0; right: 0; bottom: 0;
      color: #dce8e6; font: 11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace; pointer-events: none; }
    #world-authoring * { box-sizing: border-box; }
    #world-authoring .bar { pointer-events: auto; display: grid; grid-template-columns: 1fr auto auto 1fr auto; gap: 6px;
      padding: 6px 8px calc(6px + env(safe-area-inset-bottom, 0px)); background: rgba(7,12,13,.92);
      border-top: 1px solid #496267; }
    #world-authoring .chip { min-height: 44px; min-width: 44px; padding: 0 10px; color: inherit; background: #111b1d;
      border: 1px solid #344a4f; font: inherit; letter-spacing: 1px; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis; touch-action: manipulation; }
    #world-authoring .chip.on { border-color: #d6aa4d; color: #ffe09a; background: #302714; }
    #world-authoring .chip.arm.on { border-color: #6fe0c0; color: #bffbe8; background: #123028; }
    #world-authoring .hint { pointer-events: none; padding: 4px 10px; color: #9db2b5; background: rgba(7,12,13,.7);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #world-authoring .sheet { pointer-events: auto; display: none; max-height: 48vh; overflow: auto;
      padding: 10px 12px; background: rgba(7,12,13,.95); border-top: 1px solid #496267; }
    #world-authoring.open .sheet { display: block; }
    #world-authoring h1 { margin: 0 0 6px; font-size: 12px; letter-spacing: 2px; }
    #world-authoring label { display: grid; grid-template-columns: 78px 1fr 46px; align-items: center; gap: 7px; margin: 6px 0; }
    #world-authoring select, #world-authoring input, #world-authoring .sheet button {
      min-width: 0; min-height: 36px; color: inherit; background: #111b1d; border: 1px solid #344a4f; font: inherit; padding: 5px 6px; }
    #world-authoring input[type=range] { padding: 0; min-height: 36px; }
    #world-authoring .buttons { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; margin-top: 8px; }
    #world-authoring .sheet button.on { border-color: #d6aa4d; color: #ffe09a; background: #302714; }
    #world-authoring output { color: #9db2b5; text-align: right; }
    #world-authoring .status { margin-top: 8px; color: #91a5a8; white-space: pre-wrap; word-break: break-all; font-size: 10px; }
    #world-authoring.fold .bar { display: none; }
    #world-authoring.fold .sheet { display: none; }
    #world-authoring .unfold { pointer-events: auto; display: none; position: fixed; right: 8px;
      bottom: calc(8px + env(safe-area-inset-bottom, 0px)); }
    #world-authoring.fold .unfold { display: block; }
    body.world-authoring-paint, body.world-authoring-paint canvas { cursor: crosshair !important; }`;
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.id = 'world-authoring';

  // ── THE BAR ──
  const bar = document.createElement('div');
  bar.className = 'bar';
  const layerChip = button('LAYER');
  layerChip.id = 'world-authoring-layer-chip';
  layerChip.className = 'chip';
  const camChip = button('2D');
  camChip.id = 'world-authoring-cam';
  camChip.className = 'chip';
  const armChip = button('PAINT');
  armChip.id = 'world-authoring-arm';
  armChip.className = 'chip arm';
  const brushChip = button('BRUSH');
  brushChip.id = 'world-authoring-brush';
  brushChip.className = 'chip';
  const moreChip = button('⋯');
  moreChip.id = 'world-authoring-more';
  moreChip.className = 'chip';
  bar.append(layerChip, camChip, armChip, brushChip, moreChip);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.id = 'world-authoring-hint';
  const unfold = button('AUTHOR');
  unfold.className = 'chip unfold';
  unfold.id = 'world-authoring-unfold';

  // ── THE SHEET: the same controls the panel had, by the same ids ──
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.innerHTML = `<h1>WORLD · AUTHOR</h1>`;

  const layerRow = document.createElement('label');
  layerRow.innerHTML = '<span>LAYER</span>';
  const layerSelect = document.createElement('select');
  layerSelect.id = 'world-authoring-layer';
  for (const l of runtime.layers) {
    const option = document.createElement('option');
    option.value = l.id;
    option.textContent = `${l.label} · ${l.kind.toUpperCase()}${l.editable ? '' : ' · VIEW'}`;
    layerSelect.appendChild(option);
  }
  layerSelect.disabled = runtime.layers.length === 1;
  layerRow.append(layerSelect, document.createElement('output'));

  const modeRow = document.createElement('label');
  modeRow.innerHTML = '<span>MODE</span>';
  const mode = document.createElement('select');
  mode.id = 'world-authoring-mode';
  for (const [value, label] of [['interact', 'INTERACT · GAME'], ['paint', 'PAINT · LAYER']]) {
    const option = document.createElement('option');
    option.value = value; option.textContent = label; mode.appendChild(option);
  }
  modeRow.append(mode, document.createElement('output'));

  const viewRow = document.createElement('label');
  viewRow.innerHTML = '<span>VIEW</span>';
  const view = document.createElement('select');
  view.id = 'world-authoring-view';
  for (const value of ['GAME', 'DATA']) {
    const option = document.createElement('option');
    option.value = value.toLowerCase(); option.textContent = value; view.appendChild(option);
  }
  viewRow.append(view, document.createElement('output'));

  const classRow = document.createElement('label');
  classRow.innerHTML = '<span>PAINT</span>';
  const cls = document.createElement('select');
  cls.id = 'world-authoring-class';
  const fillChoices = (): void => {
    cls.replaceChildren();
    for (const choice of layer.choices) {
      const option = document.createElement('option');
      option.value = choice.value; option.textContent = choice.label;
      cls.appendChild(option);
    }
    cls.value = layer.choices.some((choice) => choice.value === '30')
      ? '30'
      : (layer.choices[0]?.value ?? '');
    classRow.hidden = layer.choices.length === 0;
  };
  fillChoices();
  classRow.append(cls, document.createElement('output'));

  const radiusRow = document.createElement('label');
  radiusRow.innerHTML = '<span>RADIUS</span>';
  const radius = document.createElement('input');
  radius.id = 'world-authoring-radius';
  radius.type = 'range';
  const radiusOut = document.createElement('output');
  radiusRow.append(radius, radiusOut);
  const fillRadius = (): void => {
    const spec = layer.radius ?? {
      label: layer.gesture === 'polyline' ? 'WIDTH' : 'RADIUS',
      min: layer.gesture === 'polyline' ? 2 : 0,
      max: layer.gesture === 'polyline' ? 20 : 240,
      step: layer.gesture === 'polyline' ? .5 : 5,
      value: layer.gesture === 'polyline' ? 7.5 : 45,
      unit: 'm',
    };
    radiusRow.querySelector('span')!.textContent = spec.label;
    radius.min = String(spec.min);
    radius.max = String(spec.max);
    radius.step = String(spec.step);
    radius.value = String(spec.value);
  };
  fillRadius();

  const strengthRow = document.createElement('label');
  strengthRow.innerHTML = '<span>STRENGTH</span>';
  const strength = document.createElement('input');
  strength.id = 'world-authoring-strength';
  strength.type = 'range';
  const strengthOut = document.createElement('output');
  strengthRow.append(strength, strengthOut);
  const fillStrength = (): void => {
    const spec = layer.strength;
    strengthRow.hidden = !spec;
    if (!spec) {
      strength.min = '0'; strength.max = '1'; strength.step = '1'; strength.value = '1';
      return;
    }
    strengthRow.querySelector('span')!.textContent = spec.label;
    strength.min = String(spec.min);
    strength.max = String(spec.max);
    strength.step = String(spec.step);
    strength.value = String(spec.value);
  };
  fillStrength();

  const buttons = document.createElement('div');
  buttons.className = 'buttons';
  const undo = button('UNDO');
  const reset = button('RESET');
  const bank = button('BANK');
  bank.id = 'world-authoring-bank';
  const fold = button('FOLD');
  fold.id = 'world-authoring-fold';
  buttons.append(undo, reset, bank, fold);
  const status = document.createElement('div');
  status.className = 'status';
  status.id = 'world-authoring-status';
  sheet.append(layerRow, modeRow, viewRow, classRow, radiusRow, strengthRow, buttons, status);
  panel.append(hint, sheet, bar, unfold);
  document.body.appendChild(panel);

  const report = (): Record<string, unknown> => ({
    active: true, layer: layer.id, kind: layer.kind, view: dataView ? 'data' : 'game',
    armed, chart: runtime.isChart ? runtime.isChart() : chart, panning, changed, rebuilds, ...layer.report(),
  });
  const publishPreviews = (): void => {
    runtime.setPreviews(armed ? layer.previews(cursor, Number(radius.value)) : []);
  };
  const brushLabel = (): string => layer.choices.find((c) => c.value === cls.value)?.label.split(' · ').pop() ?? '';
  const repaint = (): void => {
    radiusOut.value = `${radius.value}${layer.radius?.unit ?? 'm'}`;
    strengthOut.value = layer.strength
      ? `${strength.value}${layer.strength.unit ?? ''}`
      : '';
    mode.value = armed ? 'paint' : 'interact';
    chart = runtime.isChart ? runtime.isChart() : chart;
    // A chip is a word, not a label: LAND COVER does not fit beside PAINTING.
    layerChip.textContent = ({ cover: 'COVER', dem: 'ELEV', road: 'ROADS' } as Record<string, string>)[layer.id] ?? layer.label.split(' ')[0];
    camChip.textContent = chart ? '2D' : '3D';
    camChip.classList.toggle('on', chart);
    armChip.textContent = armed ? 'PAINTING' : 'PAINT';
    armChip.classList.toggle('on', armed);
    armChip.disabled = !layer.editable;
    brushChip.textContent = layer.choices.length ? brushLabel() : '—';
    brushChip.disabled = !layer.choices.length;
    const r = layer.report() as Record<string, unknown>;
    hint.textContent = armed
      ? `${layer.kind === 'vector' ? 'TAP A LINE' : 'ONE FINGER PAINTS'} · TWO PAN · ${brushLabel()} ${radius.value}${layer.radius?.unit ?? 'm'}`
        + `${layer.strength ? ` · ${strength.value}${layer.strength.unit ?? ''}` : ''} · ${changed} CHANGES`
      : `${chart ? 'THE CHART' : 'THE SEAT'} · ${layer.label} · ${String(r.editedCells ?? r.features ?? 0)} AUTHORED · ${dataView ? 'DATA' : 'GAME'} VIEW`;
    status.textContent = `${armed ? 'PAINT OWNS INPUT' : 'GAME OWNS INPUT'} · ${layer.label} · ${layer.kind.toUpperCase()}\n`
      + `${changed} SOURCE CHANGES · ${rebuilds} INVALIDATIONS\n`
      + `${JSON.stringify(r)}`;
    publishPreviews();
  };
  const setMode = (next: 'interact' | 'paint'): void => {
    armed = next === 'paint' && layer.editable;
    if (!armed) { stop(); setPanning(false); }
    runtime.setInputCaptured(armed);
    document.body.classList.toggle('world-authoring-paint', armed);
    repaint();
  };
  const setPanning = (on: boolean): void => {
    if (panning === on) return;
    panning = on;
    runtime.setPanning?.(on);
  };
  /** The chart for a raster, its DATA view on: what you paint is what you
   *  see. Back in the seat the game view returns, so the result is judged
   *  as the player will see it. */
  const setChart = (on: boolean): void => {
    chart = on;
    runtime.setChart?.(on);
    if (layer.kind === 'raster') {
      dataView = on;
      view.value = on ? 'data' : 'game';
      layer.setDataView(on);
    }
    repaint();
  };
  const setSheet = (open: boolean): void => { panel.classList.toggle('open', open); moreChip.classList.toggle('on', open); };
  const commit = (result: AuthoringEditResult): void => {
    if (result.changed) {
      changed += result.changed;
      rebuilds++;
    }
    repaint();
  };
  const pointAt = (clientX: number, clientY: number): AuthoringPoint | null => {
    const at = runtime.worldAt(clientX, clientY);
    return at ? { x: at[0], z: at[1] } : null;
  };
  const stop = (): void => {
    if (!painting) return;
    painting = false;
    pointer = -1;
    commit(layer.endGesture());
  };
  const cancel = (): void => {
    if (!painting) return;
    painting = false;
    pointer = -1;
    layer.cancelGesture();
    repaint();
  };

  view.addEventListener('change', () => {
    dataView = view.value === 'data';
    layer.setDataView(dataView);
    repaint();
  });
  layerSelect.addEventListener('change', () => {
    if (painting) stop();
    layer.setDataView(false);
    layer = runtime.layers.find((candidate) => candidate.id === layerSelect.value)
      ?? runtime.layers[0];
    if (!layer.editable) setMode('interact');
    fillChoices();
    fillRadius();
    fillStrength();
    layer.setDataView(dataView);
    repaint();
  });
  mode.addEventListener('change', () => setMode(mode.value === 'paint' ? 'paint' : 'interact'));
  radius.addEventListener('input', repaint);
  strength.addEventListener('input', repaint);
  undo.addEventListener('click', () => commit(layer.undo()));
  reset.addEventListener('click', () => commit(layer.reset()));
  const setFolded = (folded: boolean): void => {
    panel.classList.toggle('fold', folded);
    fold.textContent = folded ? 'OPEN' : 'FOLD';
    if (folded) { setMode('interact'); setSheet(false); runtime.setChrome?.(true); }
    else runtime.setChrome?.(false);
  };
  fold.addEventListener('click', () => setFolded(!panel.classList.contains('fold')));
  unfold.addEventListener('click', () => setFolded(false));
  layerChip.addEventListener('click', () => {
    const i = runtime.layers.indexOf(layer);
    layerSelect.value = runtime.layers[(i + 1) % runtime.layers.length].id;
    layerSelect.dispatchEvent(new Event('change'));
  });
  camChip.addEventListener('click', () => setChart(!chart));
  armChip.addEventListener('click', () => setMode(armed ? 'interact' : 'paint'));
  brushChip.addEventListener('click', () => {
    const i = [...cls.options].findIndex((o) => o.value === cls.value);
    if (cls.options.length) { cls.selectedIndex = (i + 1) % cls.options.length; repaint(); }
  });
  cls.addEventListener('change', repaint);
  moreChip.addEventListener('click', () => setSheet(!panel.classList.contains('open')));
  bank.addEventListener('click', () => {
    if (!runtime.bank) { hint.textContent = 'NO STORE ON THIS PAGE'; return; }
    bank.disabled = true;
    hint.textContent = 'BANKING…';
    runtime.bank(layer.id, false).then((line) => { hint.textContent = line; })
      .catch((err: Error) => { hint.textContent = `BANK FAILED: ${err.message}`; })
      .finally(() => { bank.disabled = false; });
  });

  // ── GESTURES. One finger paints; a second finger turns the gesture into
  // the chart's own pan or pinch — the stroke in flight is cancelled, both
  // pointers are handed to the chart, and nothing paints until every finger
  // is up. On a phone that is the difference between a map you can edit and
  // one you can only scribble on.
  runtime.canvas.addEventListener('pointerdown', (event) => {
    if (!armed || panel.contains(event.target as Node)) return;
    pointers.add(event.pointerId);
    if (pointers.size >= 2 || panning) {
      if (painting) { const first = pointer; cancel(); runtime.chartGrab?.(first, lastAt.x, lastAt.y); }
      setPanning(true);
      runtime.chartGrab?.(event.pointerId, event.clientX, event.clientY);
      return;                        // the chart's own handlers see this pointer
    }
    if (event.button !== 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    painting = true; pointer = event.pointerId;
    lastAt = { x: event.clientX, y: event.clientY };
    try { runtime.canvas.setPointerCapture(event.pointerId); } catch { /* synthetic pointer in a test */ }
    cursor = pointAt(event.clientX, event.clientY);
    if (!cursor) { painting = false; pointer = -1; return; }
    commit(layer.beginGesture(cursor, Number(radius.value), cls.value, Number(strength.value)));
  }, true);
  runtime.canvas.addEventListener('pointermove', (event) => {
    if (!armed || panning) return;
    cursor = pointAt(event.clientX, event.clientY);
    if (painting && event.pointerId === pointer && cursor) {
      lastAt = { x: event.clientX, y: event.clientY };
      event.preventDefault(); event.stopImmediatePropagation();
      commit(layer.updateGesture(cursor, Number(radius.value), cls.value, Number(strength.value)));
    } else publishPreviews();
  }, true);
  const lift = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (panning) { if (!pointers.size) setPanning(false); return; }
    if (!painting || event.pointerId !== pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    stop();
  };
  runtime.canvas.addEventListener('pointerup', lift, true);
  runtime.canvas.addEventListener('pointercancel', (event) => {
    pointers.delete(event.pointerId);
    if (panning) { if (!pointers.size) setPanning(false); return; }
    cancel();
  }, true);
  runtime.canvas.addEventListener('pointerleave', () => {
    if (!painting) { cursor = null; publishPreviews(); }
  }, true);

  const win = window as WorldAuthoringWindow;
  win.__worldedit = report;
  win.__worldeditPaint = (
    x?: number,
    z?: number,
    value?: string | number,
    radiusM?: number,
    amount?: number,
  ) => {
    const at = x === undefined || z === undefined ? runtime.focus() : [x, z] as [number, number];
    const selected = value === undefined ? cls.value : String(value);
    const point = { x: at[0], z: at[1] };
    commit(layer.beginGesture(point, radiusM ?? Number(radius.value), selected,
      amount ?? Number(strength.value)));
    commit(layer.endGesture());
    repaint();
    return report();
  };
  win.__worldeditLine = (
    points?: Array<[number, number]>,
    value?: string,
    widthM?: number,
  ) => {
    const road = runtime.layers.find((candidate) => candidate.gesture === 'polyline');
    if (!road) return report();
    if (layer !== road) {
      layer.setDataView(false);
      layer = road;
      layerSelect.value = road.id;
      fillChoices(); fillRadius(); fillStrength();
    }
    const [fx, fz] = runtime.focus();
    const samples = points?.length ? points : [[fx - 35, fz], [fx + 35, fz + 8]];
    const selected = value ?? road.choices[0]?.value ?? 'residential';
    const width = widthM ?? road.radius?.value ?? 7.5;
    commit(road.beginGesture({ x: samples[0][0], z: samples[0][1] }, width, selected, 1));
    for (let i = 1; i < samples.length; i++) {
      commit(road.updateGesture({ x: samples[i][0], z: samples[i][1] }, width, selected, 1));
    }
    commit(road.endGesture());
    repaint();
    return report();
  };
  runtime.setInputCaptured(false);
  runtime.setPreviews([]);
  // THE GAME'S BOOT HAS THE LAST WORD ON THE CAMERA AND THE MENU, and it
  // finishes after this overlay is up: the URL's `cam=` is applied and the
  // hub opens on `#boot.ready`. So the lab's own opening — chrome off, the
  // chart with the raster's data showing, 3D one tap away — waits for that
  // signal and asserts itself once, after it. Measured: asked before it, the
  // lab reported `chart: false` and `menu-open` on its first frame.
  const opening = (): void => {
    runtime.setChrome?.(false);
    if (layer.kind === 'raster') setChart(true);
    repaint();
  };
  const boot = document.getElementById('boot');
  if (!boot || boot.classList.contains('ready')) opening();
  else {
    const mo = new MutationObserver(() => {
      if (!boot.classList.contains('ready')) return;
      mo.disconnect();
      setTimeout(opening, 0);
    });
    mo.observe(boot, { attributes: true, attributeFilter: ['class'] });
  }
  repaint();
  /** The BANK button from a harness: what the layer would file (dry) or did. */
  (win as unknown as { __worldeditBank?: object }).__worldeditBank = (dry = true, layerId?: string): Promise<string> =>
    runtime.bank ? runtime.bank(layerId ?? layer.id, dry) : Promise.resolve('NO STORE ON THIS PAGE');
  (win as unknown as { __worldeditChart?: object }).__worldeditChart = (on?: boolean): Record<string, unknown> => {
    if (on !== undefined) setChart(on);
    return report();
  };
  window.setInterval(() => {
    if (armed || layer.kind === 'vector') repaint();
  }, 250);
}

// Kept in this module's public surface so future raster adapters share the
// exact tile contract rather than inventing a near-copy.
export type { EditableRasterTile };
