import { createAudio, TARGETS, type AudioSurface, type ImpactKind } from './audio';
import { createDials, type DialValues } from './lab-dials';
import { clamp } from './num';

/**
 * ── THE SOUND LAB: THE MIXER WITH NO WORLD ──
 *
 * The mixer owns no world state — every voice takes what it needs as
 * arguments, every frame — which is what made it liftable out of main.ts and
 * is what makes this lab cheap: `createAudio()` with dials where the world
 * was. It exists because the only ear this project has is the owner's, on a
 * phone, and until now that ear could judge a voice only by driving to a
 * place where it happened, with everything else playing over it. "Brook or
 * gravel" was a deploy cycle; here it is two buttons.
 *
 * WHAT IT PUTS UP: every continuous input on a dial (the world's, the
 * truck's, the room's, the drone's), every one-shot on a button, a level
 * meter per tap with a peak hold so a thud can be read after it has gone,
 * presets for the scenes the targets were written for, the gravel and the
 * rattle as an A/B against what they used to be, a mute per voice with a
 * solo mode, and the DECIBEL TARGETS as sliders — COPY puts them on the
 * clipboard as the `TARGETS` literal in audio.ts, so a number found by ear
 * here becomes the engine's by paste.
 *
 * THE RULE THAT KEEPS A LAB HONEST holds: this imports the production mixer
 * and feeds it the same derived numbers main.ts does — the bed's duck by
 * motion and engine, the rustle as wind × foliage × duck, the parked window
 * — so a level read here is the level the game would make.
 */

const TAPS = ['master', 'out', 'world', 'truck', 'eng', 'roar', 'squeal', 'grit', 'rattle', 'scrape',
  'brush', 'water', 'roof', 'wind', 'rain', 'rustle', 'sward', 'river', 'boil', 'drone'] as const;
const WORLD = new Set(['world', 'wind', 'rain', 'rustle', 'sward', 'river', 'boil', 'drone']);
const VOICES = ['eng', 'roar', 'squeal', 'grit', 'rattle', 'scrape', 'brush', 'water', 'roof',
  'wind', 'rain', 'rustle', 'sward', 'river', 'boil', 'drone', 'birds'] as const;

/** Every scene quiet — the base a preset writes over, targets untouched. */
const QUIET: DialValues = {
  wind: 12, veg: 0.5, grass: 0.5, river: 0, froth: 0, riverAt: 0, birds: 0.3, rain: 0,
  engine: 'off', throttle: 0, speed: 0, surf: 'ground', q: 0.5, slip: 0, spin: 0, grounded: 1,
  shake: 0, scrape: 0, metal: false, brush: 0, wash: 0,
  enc: 0, cab: false, spool: 0, load: 0, dist: 10, droneAt: 0, own: false,
};
const PRESETS: ReadonlyArray<[string, DialValues]> = [
  ['STILL BANK', { river: 1, froth: 0, riverAt: -0.6, veg: 0.6, grass: 0.4, birds: 0.4 }],
  ['RAPIDS', { river: 1, froth: 1, riverAt: 0.5, wind: 15 }],
  ['MEADOW BREEZE', { grass: 1, veg: 0.1, wind: 30 }],
  ['FOREST GUST', { veg: 1, grass: 0.2, wind: 40, birds: 0.6 }],
  ['OPEN GROUND 60', { engine: 'on', throttle: 0.7, speed: 60, surf: 'ground', q: 0.3, shake: 0.6 }],
  ['GRAVEL TRACK 40', { engine: 'on', throttle: 0.5, speed: 40, surf: 'track', q: 0.4, shake: 0.3 }],
  ['TARMAC 100', { engine: 'on', throttle: 0.6, speed: 100, surf: 'road', q: 0.9 }],
  ['SKID', { engine: 'on', throttle: 1, speed: 50, surf: 'road', q: 0.9, slip: 0.8, spin: 0.6 }],
  ['TUNNEL 60', { engine: 'on', throttle: 0.5, speed: 60, surf: 'road', q: 0.9, enc: 1 }],
  ['CAB PARKED', { cab: true, river: 0.6, veg: 0.5, riverAt: 0.4 }],
  ['RAIN AT 40', { rain: 1, wind: 25, cab: true, engine: 'on', throttle: 0.4, speed: 40, surf: 'road', q: 0.8 }],
  ['DRONE 10 m LEFT', { spool: 1, load: 0.3, dist: 10, droneAt: -0.7 }],
  ['DRONE ON BOARD', { spool: 1, load: 0.5, own: true }],
  ['SILENCE', {}],
];

export async function startSoundLab(): Promise<void> {
  document.title = 'DRIVE · SOUND LAB';
  const style = document.createElement('style');
  style.textContent = `
    html, body { margin: 0; background: #0b0f11; color: #d6e2e4;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
    #main { margin-left: var(--dials-w, 272px); padding: 12px 14px 48px; max-width: 760px; }
    /* ── ON A PHONE THE DIALS DO NOT FLOAT. The shared panel is a fixed
       column that covered the meters and the buttons on a 390 px screen —
       the thing this lab exists to show, behind the thing that drives it.
       Below 640 px the main panel comes first in the flow and the dials
       follow it as an ordinary block; the seat scrolls between them. */
    @media (max-width: 640px) {
      #main { margin-left: 0; padding: 10px 10px 24px; }
      .lab-dials { position: static !important; width: 100% !important; max-width: 100% !important;
        max-height: none !important; border-right: 0; }
      .lab-dials .body { overflow: visible; }
    }
    #main h2 { font-size: 11px; letter-spacing: 3px; color: #6f8285; margin: 18px 0 6px; }
    .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
    button { background: #10201f; color: #a9dcd2; border: 1px solid #2f5a52; font: inherit;
      letter-spacing: 1px; padding: 6px 8px; min-height: 40px; cursor: pointer; }
    button:active { background: #1d4a43; }
    button.arm { flex: 1; min-height: 48px; font-size: 13px; letter-spacing: 3px; color: #ffd08a; border-color: #8a6a2a; }
    button.on { background: #1d4a43; border-color: #7fd0c4; }
    button.off { color: #5a6b6e; border-color: #24343a; background: #0d1416; text-decoration: line-through; }
    button.ab { color: #ffd08a; border-color: #8a6a2a; }
    canvas { display: block; width: 100%; border: 1px solid #24343a; background: #080e10; touch-action: none; }
    #status { color: #6f8285; letter-spacing: 1px; white-space: pre-wrap; margin-top: 8px; min-height: 1.5em; }
    a.back { display: inline-block; margin-top: 22px; color: #6f8285; text-decoration: none; letter-spacing: 2px; }`;
  document.head.appendChild(style);

  const audio = createAudio();
  // The main panel is created BEFORE the dials so that, where the dials
  // are in the flow rather than fixed (a phone), it comes first.
  const main = document.createElement('div');
  main.id = 'main';
  document.body.appendChild(main);

  const targetsSource = (v: DialValues): string => {
    const n = (k: string): number => Number(v[k]);
    const body = `export const TARGETS = {\n  river: ${n('tRiver')}, boil: ${n('tBoil')}, wind: ${n('tWind')}, rustle: ${n('tRustle')}, `
      + `sward: ${n('tSward')}, birds: ${n('tBirds')},\n  roar: ${n('tRoar')}, grit: ${n('tGrit')}, rattle: ${n('tRattle')}, drone: ${n('tDrone')},\n};`;
    const scene: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) if (!k.startsWith('t') || k === 'throttle') scene[k] = val;
    return `${body}\n// sound lab ${new Date().toISOString().slice(0, 16)}: scene ${JSON.stringify(scene)}\n// levels ${JSON.stringify(audio.levels())}`;
  };

  const dials = createDials({
    slug: 'sound',
    source: targetsSource,
    spec: [
      { id: 'sWorld', label: 'THE WORLD', kind: 'section' },
      { id: 'wind', label: 'WIND km/h', kind: 'range', min: 0, max: 80, step: 1, value: 12 },
      { id: 'veg', label: 'FOLIAGE', kind: 'range', min: 0, max: 1, step: 0.05, value: 0.5 },
      { id: 'grass', label: 'GRASS', kind: 'range', min: 0, max: 1, step: 0.05, value: 0.5 },
      { id: 'river', label: 'RIVER', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'froth', label: 'FROTH', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'riverAt', label: 'RIVER SIDE', kind: 'range', min: -1, max: 1, step: 0.1, value: 0 },
      { id: 'birds', label: 'BIRDS', kind: 'range', min: 0, max: 1, step: 0.05, value: 0.3 },
      { id: 'rain', label: 'RAIN', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'sTruck', label: 'THE TRUCK', kind: 'section' },
      { id: 'engine', label: 'ENGINE', kind: 'select', options: ['off', 'crank', 'on'], value: 'off' },
      { id: 'throttle', label: 'THROTTLE', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'speed', label: 'SPEED km/h', kind: 'range', min: 0, max: 140, step: 1, value: 0 },
      { id: 'surf', label: 'SURFACE', kind: 'select', options: ['road', 'track', 'ground', 'water'], value: 'ground' },
      { id: 'q', label: 'QUALITY', kind: 'range', min: 0, max: 1, step: 0.05, value: 0.5 },
      { id: 'slip', label: 'SLIP', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'spin', label: 'SPIN', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'grounded', label: 'GROUNDED', kind: 'range', min: 0, max: 1, step: 0.05, value: 1 },
      { id: 'shake', label: 'SHAKE', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'scrape', label: 'SCRAPE', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'metal', label: 'ON A RAIL', kind: 'toggle', value: false },
      { id: 'brush', label: 'BRUSH', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'wash', label: 'HULL WASH', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'sRoom', label: 'THE ROOM', kind: 'section' },
      { id: 'enc', label: 'TUNNEL', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'cab', label: 'CAB VIEW', kind: 'toggle', value: false },
      { id: 'sDrone', label: 'THE DRONE', kind: 'section' },
      { id: 'spool', label: 'SPOOL', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'load', label: 'LOAD', kind: 'range', min: 0, max: 1, step: 0.05, value: 0 },
      { id: 'dist', label: 'DISTANCE m', kind: 'range', min: 0, max: 200, step: 1, value: 10 },
      { id: 'droneAt', label: 'SIDE', kind: 'range', min: -1, max: 1, step: 0.1, value: 0 },
      { id: 'own', label: 'ON BOARD', kind: 'toggle', value: false },
      { id: 'sTargets', label: 'TARGETS dBFS', kind: 'section' },
      { id: 'tRiver', label: 'RIVER', kind: 'range', min: -50, max: -10, step: 1, value: TARGETS.river },
      { id: 'tBoil', label: 'BOIL', kind: 'range', min: -50, max: -10, step: 1, value: TARGETS.boil },
      { id: 'tWind', label: 'WIND', kind: 'range', min: -50, max: -10, step: 1, value: TARGETS.wind },
      { id: 'tRustle', label: 'RUSTLE', kind: 'range', min: -50, max: -10, step: 1, value: TARGETS.rustle },
      { id: 'tSward', label: 'SWARD', kind: 'range', min: -50, max: -10, step: 1, value: TARGETS.sward },
      { id: 'tBirds', label: 'BIRDS ×', kind: 'range', min: 0, max: 3, step: 0.1, value: TARGETS.birds },
      { id: 'tRoar', label: 'ROAR', kind: 'range', min: -50, max: -10, step: 1, value: TARGETS.roar },
      { id: 'tGrit', label: 'GRIT', kind: 'range', min: -50, max: -10, step: 1, value: TARGETS.grit },
      { id: 'tRattle', label: 'RATTLE', kind: 'range', min: -50, max: -10, step: 1, value: TARGETS.rattle },
      { id: 'tDrone', label: 'DRONE', kind: 'range', min: -50, max: -10, step: 1, value: TARGETS.drone },
    ],
  });

  const h = (text: string): void => { const el = document.createElement('h2'); el.textContent = text; main.appendChild(el); };
  const btn = (label: string, fn: () => void, cls = ''): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.className = cls;
    b.addEventListener('click', fn);
    return b;
  };

  // ── ARM. The context needs a gesture; the button is the honest one and
  // any tap on the page is the convenient one, exactly as in the game. The
  // dial the game stores under drive.mute is shared with this origin, so a
  // muted game would arm to nothing: turned back on here, out loud.
  const armRow = document.createElement('div');
  armRow.className = 'row';
  const armBtn = btn('ARM AUDIO', () => arm(), 'arm');
  const state = document.createElement('span');
  armRow.append(armBtn, state);
  main.appendChild(armRow);
  const arm = (): string => {
    if (!audio.on) audio.toggle();
    audio.arm();
    return audio.state;
  };
  addEventListener('pointerdown', () => { if (audio.state !== 'running') arm(); }, { passive: true });

  // ── THE METERS: one bar per tap, −60 to 0 dBFS, with a peak that holds
  // for a second and a half so a thud can be read after it has gone.
  h('LEVELS dBFS · world teal, truck amber, buses white · peak line holds 1.5 s');
  const cv = document.createElement('canvas');
  const ROW = 15, LEFT = 58, RIGHT = 44;
  cv.height = TAPS.length * ROW + 18;
  main.appendChild(cv);
  // Sized to the panel, not to a desktop: a 720 px canvas scaled onto a
  // 360 px phone made six-pixel labels.
  const fit = (): void => { cv.width = Math.max(300, Math.min(720, main.clientWidth - 2)); };
  fit();
  addEventListener('resize', fit);
  const g2 = cv.getContext('2d')!;
  const peak: Record<string, { v: number; at: number }> = {};
  const drawMeters = (lv: Record<string, number>, now: number): void => {
    const W = cv.width, span = W - LEFT - RIGHT;
    g2.fillStyle = '#080e10'; g2.fillRect(0, 0, W, cv.height);
    g2.font = '11px ui-monospace, monospace';
    for (let d = -60; d <= 0; d += 10) {
      const x = LEFT + span * (d + 60) / 60;
      g2.fillStyle = d === 0 ? '#3a4d52' : '#1b282c'; g2.fillRect(x, 0, 1, cv.height - 14);
      g2.fillStyle = '#4f6469'; g2.textAlign = 'center'; g2.fillText(String(d), x, cv.height - 3);
    }
    TAPS.forEach((name, i) => {
      const y = i * ROW;
      const v = lv[name];
      const have = typeof v === 'number';
      const db = have ? clamp(v, -60, 0) : -60;
      const p = (peak[name] ??= { v: -60, at: 0 });
      if (db >= p.v || now - p.at > 1500) { p.v = db; p.at = now; }
      g2.fillStyle = '#9fb2b5'; g2.textAlign = 'left'; g2.fillText(name, 4, y + 11);
      const colour = name === 'master' || name === 'out' ? '#d6e2e4' : WORLD.has(name) ? '#5fb8ad' : '#d8a03f';
      g2.fillStyle = colour;
      g2.globalAlpha = 0.85;
      g2.fillRect(LEFT, y + 3, span * (db + 60) / 60, ROW - 6);
      g2.globalAlpha = 1;
      if (p.v > -60) g2.fillRect(LEFT + span * (p.v + 60) / 60 - 1, y + 2, 2, ROW - 4);
      g2.fillStyle = have && v > -119 ? '#d6e2e4' : '#4f6469'; g2.textAlign = 'right';
      g2.fillText(have && v > -119 ? v.toFixed(1) : '·', W - 4, y + 11);
    });
  };
  drawMeters({}, 0);

  // ── ONE-SHOTS: every event the world can fire, at the forces it fires at.
  h('ONE-SHOTS');
  const shots = document.createElement('div');
  shots.className = 'grid';
  const crash = (f: number, k: ImpactKind) => () => audio.crash(f, k);
  const shotList: Array<[string, () => void]> = [
    ['THUD ½', () => audio.thud(0.5)], ['THUD 1½', () => audio.thud(1.5)], ['THUD 3', () => audio.thud(3)],
    ['CREAK .4', () => audio.creak(0.4)], ['CREAK .9', () => audio.creak(0.9)],
    ['SHELL .3', crash(0.3, 'shell')], ['SHELL .8', crash(0.8, 'shell')],
    ['RAIL .6', crash(0.6, 'metal')], ['ROCK .6', crash(0.6, 'stone')],
    ['SPLASH .7', () => audio.splash(0.7)], ['WHIP WOOD', () => audio.whip(0.6, true)], ['WHIP LEAF', () => audio.whip(0.4, false)],
    ['STONE', () => audio.stone()], ['THUNDER NEAR', () => audio.thunder(0.1)], ['THUNDER FAR', () => audio.thunder(0.9)],
    ['CRANK', () => audio.crank()], ['KEY OFF', () => audio.engOff()], ['BIRD', () => audio.bird(0.6)],
  ];
  for (const [label, fn] of shotList) shots.appendChild(btn(label, () => { arm(); fn(); }));
  main.appendChild(shots);

  // ── PRESETS: the scenes the targets were written for, one tap each.
  h('SCENES');
  const scenes = document.createElement('div');
  scenes.className = 'grid';
  const preset = (name: string): void => {
    const p = PRESETS.find((x) => x[0] === name);
    if (p) dials.set({ ...QUIET, ...p[1] });
  };
  for (const [label] of PRESETS) scenes.appendChild(btn(label, () => { arm(); preset(label); }));
  main.appendChild(scenes);

  // ── THE A/B: hear the argument.
  h('A / B');
  const ab = document.createElement('div');
  ab.className = 'row';
  const abState = { grit: 'a' as 'a' | 'b', rattle: 'a' as 'a' | 'b' };
  const gritBtn = btn('GRAVEL: crackle (ships)', () => {
    arm(); abState.grit = abState.grit === 'a' ? 'b' : 'a'; audio.pattern('grit', abState.grit);
    gritBtn.textContent = abState.grit === 'a' ? 'GRAVEL: crackle (ships)' : 'GRAVEL: chirps (the brook)';
  }, 'ab');
  const rattleBtn = btn('RATTLE: buzz (ships)', () => {
    arm(); abState.rattle = abState.rattle === 'a' ? 'b' : 'a'; audio.pattern('rattle', abState.rattle);
    rattleBtn.textContent = abState.rattle === 'a' ? 'RATTLE: buzz (ships)' : 'RATTLE: tinkle (the chimes)';
  }, 'ab');
  ab.append(gritBtn, rattleBtn);
  main.appendChild(ab);

  // ── VOICES: a mute per voice; in SOLO, a tap silences everything else.
  h('VOICES · tap to mute · SOLO makes a tap isolate');
  const voices = document.createElement('div');
  voices.className = 'grid';
  let solo = false;
  const voiceBtns = new Map<string, HTMLButtonElement>();
  const paintVoices = (): void => {
    const off = new Set(audio.mutes());
    for (const [n, b] of voiceBtns) b.className = off.has(n) ? 'off' : '';
    soloBtn.className = solo ? 'on' : '';
  };
  const soloBtn = btn('SOLO', () => { solo = !solo; paintVoices(); });
  for (const n of VOICES) {
    const b = btn(n, () => {
      arm();
      if (solo) { for (const o of VOICES) audio.mute(o, o !== n); }
      else audio.mute(n, !audio.mutes().includes(n));
      paintVoices();
    });
    voiceBtns.set(n, b);
    voices.appendChild(b);
  }
  voices.appendChild(soloBtn);
  voices.appendChild(btn('ALL ON', () => { for (const o of VOICES) audio.mute(o, false); solo = false; paintVoices(); }));
  main.appendChild(voices);

  const status = document.createElement('div');
  status.id = 'status';
  main.appendChild(status);
  const back = document.createElement('a');
  back.className = 'back'; back.href = location.pathname.replace(/\/lab\/sound\/?$/, '/lab'); back.textContent = '← LABS';
  main.appendChild(back);

  // ── THE LOOP: the world, as dials, into the production mixer every frame —
  // with the same derived numbers main.ts feeds it.
  let last = performance.now();
  const frame = (now: number): void => {
    last = now;
    TARGETS.river = dials.num('tRiver'); TARGETS.boil = dials.num('tBoil'); TARGETS.wind = dials.num('tWind');
    TARGETS.rustle = dials.num('tRustle'); TARGETS.sward = dials.num('tSward'); TARGETS.birds = dials.num('tBirds');
    TARGETS.roar = dials.num('tRoar'); TARGETS.grit = dials.num('tGrit'); TARGETS.rattle = dials.num('tRattle');
    TARGETS.drone = dials.num('tDrone');
    if (audio.state === 'running') {
      const speed = dials.num('speed') / 3.6, throttle = dials.num('throttle');
      const engine = dials.str('engine');
      const engF = engine === 'on' ? 1 : engine === 'crank' ? 0.35 : 0;
      // A drivetrain of two numbers: revs climb with the pedal and the road,
      // the gear steps every 22 km/h. Enough for the pitch to move as it does.
      const rev = engine === 'on' ? clamp(0.12 + throttle * 0.55 + speed / 45, 0, 1) : 0;
      const gear = Math.min(5, Math.floor(dials.num('speed') / 22));
      const surf = dials.str('surf') as AudioSurface;
      const ambWind = clamp(dials.num('wind') / 55, 0, 1.6);
      const veg = dials.num('veg');
      // THE BED'S DUCK, as main.ts computes it: motion and the engine push
      // the world down, so a river at 60 km/h reads as it would in the game.
      const bed = clamp(1 - speed / 7, 0, 1) * (engine === 'on' ? 0.4 : 1);
      const rustle = ambWind * (0.25 + 0.75 * veg) * Math.max(bed, 0.2);
      const river = dials.num('river') * (0.35 + 0.65 * bed);
      const birds = dials.num('birds') * (1 - dials.num('rain')) * veg * bed;
      const parked = engine !== 'on' && speed < 0.5 ? 1 : 0;
      audio.update(speed, throttle, surf, dials.num('grounded'), dials.num('rain'), rev, gear, dials.num('slip'),
        surf === 'water' ? 0 : dials.num('q'), dials.num('spin'), ambWind, engF, dials.num('shake'));
      audio.ambience(rustle, river, birds, ambWind, dials.num('froth'), dials.num('riverAt'),
        dials.num('grass') * Math.max(bed, 0.2));
      audio.space(dials.num('enc'), dials.bool('cab') ? 1 : 0, parked);
      audio.drone(dials.num('spool'), dials.num('dist'), dials.num('load'), dials.num('droneAt'), dials.bool('own'));
      audio.scrape(dials.num('scrape'), dials.bool('metal') ? 1 : 0.35);
      audio.brush(dials.num('brush'));
      audio.water(dials.num('wash'));
    }
    const lv = audio.levels();
    drawMeters(lv, now);
    const mx = audio.mix() as { gust?: number; parked?: number; muffle?: number; muted?: string };
    state.textContent = audio.state === 'running' ? 'running' : audio.state === 'none' ? 'tap ARM' : audio.state;
    status.textContent = `gust ${mx.gust ?? 0}  window ${mx.parked ? 'down' : 'up'}  muffle ${mx.muffle ?? 20000} Hz`
      + `${mx.muted ? `  muted: ${mx.muted}` : ''}\nH folds the dials · COPY writes the TARGETS literal for audio.ts`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  void last;

  // For the harness: arm, scene, and the meters, without a finger.
  (window as unknown as { __soundlab?: object }).__soundlab = {
    arm, preset, audio, dials,
    levels: () => audio.levels(),
    shot: (name: string) => { const s = shotList.find((x) => x[0] === name); if (s) s[1](); return !!s; },
    peaks: () => Object.fromEntries(Object.entries(peak).map(([k, v]) => [k, +v.v.toFixed(1)])),
  };
}
