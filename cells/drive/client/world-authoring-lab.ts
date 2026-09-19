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

  const style = document.createElement('style');
  style.textContent = `
    #world-authoring { position: fixed; z-index: 120; top: 12px; left: 12px; width: min(330px, calc(100vw - 24px));
      box-sizing: border-box; padding: 12px; color: #dce8e6; background: rgba(7,12,13,.92);
      border: 1px solid #496267; font: 11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;
      box-shadow: 0 8px 30px #0009; pointer-events: auto; }
    #world-authoring h1 { margin: 0 0 3px; font-size: 12px; letter-spacing: 2px; }
    #world-authoring .sub { color: #789096; margin-bottom: 10px; }
    #world-authoring label { display: grid; grid-template-columns: 78px 1fr 42px; align-items: center;
      gap: 7px; margin: 7px 0; }
    #world-authoring select, #world-authoring input, #world-authoring button {
      min-width: 0; color: inherit; background: #111b1d; border: 1px solid #344a4f;
      font: inherit; padding: 5px 6px; }
    #world-authoring input { padding: 0; }
    #world-authoring .buttons { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; margin-top: 10px; }
    #world-authoring button.on { border-color: #d6aa4d; color: #ffe09a; background: #302714; }
    #world-authoring output { color: #9db2b5; text-align: right; }
    #world-authoring .status { margin-top: 9px; color: #91a5a8; white-space: pre-wrap; }
    #world-authoring.fold { width: auto; }
    #world-authoring.fold label, #world-authoring.fold .status,
    #world-authoring.fold button:not(#world-authoring-fold) { display: none; }
    #world-authoring.fold .buttons { grid-template-columns: 1fr; margin-top: 6px; }
    body.world-authoring-paint #world-authoring { border-color: #d6aa4d; }
    body.world-authoring-paint, body.world-authoring-paint canvas { cursor: crosshair !important; }`;
  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.id = 'world-authoring';
  panel.innerHTML = `<h1>WORLD · AUTHOR</h1>
    <div class="sub">shipping game · live input authority</div>`;

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
  const fold = button('FOLD');
  fold.id = 'world-authoring-fold';
  buttons.append(undo, reset, fold);
  const status = document.createElement('div');
  status.className = 'status';
  status.id = 'world-authoring-status';
  panel.append(layerRow, modeRow, viewRow, classRow, radiusRow, strengthRow, buttons, status);
  document.body.appendChild(panel);

  const report = (): Record<string, unknown> => ({
    active: true, layer: layer.id, kind: layer.kind, view: dataView ? 'data' : 'game',
    armed, changed, rebuilds, ...layer.report(),
  });
  const publishPreviews = (): void => {
    runtime.setPreviews(armed ? layer.previews(cursor, Number(radius.value)) : []);
  };
  const repaint = (): void => {
    radiusOut.value = `${radius.value}${layer.radius?.unit ?? 'm'}`;
    strengthOut.value = layer.strength
      ? `${strength.value}${layer.strength.unit ?? ''}`
      : '';
    mode.value = armed ? 'paint' : 'interact';
    status.textContent = `${armed ? 'PAINT OWNS INPUT' : 'GAME OWNS INPUT'} · ${layer.label} · ${layer.kind.toUpperCase()}\n`
      + `${changed} SOURCE CHANGES · ${rebuilds} INVALIDATIONS\n`
      + `${JSON.stringify(layer.report())}`;
    publishPreviews();
  };
  const setMode = (next: 'interact' | 'paint'): void => {
    armed = next === 'paint' && layer.editable;
    if (!armed) stop();
    runtime.setInputCaptured(armed);
    document.body.classList.toggle('world-authoring-paint', armed);
    repaint();
  };
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
    if (folded) setMode('interact');
  };
  fold.addEventListener('click', () => setFolded(!panel.classList.contains('fold')));

  runtime.canvas.addEventListener('pointerdown', (event) => {
    if (!armed || event.button !== 0 || panel.contains(event.target as Node)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    painting = true; pointer = event.pointerId;
    try { runtime.canvas.setPointerCapture(event.pointerId); } catch { /* synthetic pointer in a test */ }
    cursor = pointAt(event.clientX, event.clientY);
    if (!cursor) { painting = false; pointer = -1; return; }
    commit(layer.beginGesture(cursor, Number(radius.value), cls.value, Number(strength.value)));
  }, true);
  runtime.canvas.addEventListener('pointermove', (event) => {
    if (!armed) return;
    cursor = pointAt(event.clientX, event.clientY);
    if (painting && event.pointerId === pointer && cursor) {
      event.preventDefault(); event.stopImmediatePropagation();
      commit(layer.updateGesture(cursor, Number(radius.value), cls.value, Number(strength.value)));
    } else publishPreviews();
  }, true);
  runtime.canvas.addEventListener('pointerup', (event) => {
    if (!painting || event.pointerId !== pointer) return;
    event.preventDefault(); event.stopImmediatePropagation();
    stop();
  }, true);
  runtime.canvas.addEventListener('pointercancel', cancel, true);
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
  repaint();
  window.setInterval(() => {
    if (armed || layer.kind === 'vector') repaint();
  }, 250);
}

// Kept in this module's public surface so future raster adapters share the
// exact tile contract rather than inventing a near-copy.
export type { EditableRasterTile };
