import { createDials, type DialValues } from './lab-dials';
import {
  DEFAULT_FIXTURE_TUNE, FIXTURE_COVERS, FIXTURE_ROAD_CLASSES, FIXTURE_SURFACES,
  WORLD_FIXTURES, encodeTune, type FixtureCover, type FixtureTune,
} from './world-fixtures';

/**
 * ── THE WORLD LAB: THE ONE THAT DOES NOT ISOLATE ANYTHING ──
 *
 * Every other lab takes one module out of the world and drives it directly.
 * That works for a solver and it cannot work for a MESH: the ribbon, the
 * batter, the kerb, the junction, the sward and the façades are built by code
 * wired into main's own state, and a lab that reimplemented any of it would
 * be proving something about the copy.
 *
 * So this lab inverts the trick. It keeps the whole game and replaces the
 * PLANET — an authored fixture answers the three fetches the world arrives
 * through, and everything downstream runs exactly as it ships. What this page
 * is, then, is the chooser: the fixtures, the dials that shape them, and the
 * link that opens one.
 *
 * WHY A LINK RATHER THAN A CANVAS. The fixture is consumed at boot, by code
 * that reads the query string at import time and builds a world once; turning
 * a dial cannot re-cut a corridor that has already been carved. Making that
 * honest — dials here, a fresh boot there — is better than a live panel that
 * silently only applies half of itself. The tune persists and travels, so the
 * loop is a dial and a reload, not an edit and a build.
 */

const num = (v: DialValues, k: string, d: number): number => {
  const n = Number(v[k]);
  return Number.isFinite(n) ? n : d;
};

const tuneOf = (v: DialValues): FixtureTune => ({
  relief: num(v, 'relief', DEFAULT_FIXTURE_TUNE.relief),
  slope: num(v, 'slope', DEFAULT_FIXTURE_TUNE.slope),
  lift: num(v, 'lift', DEFAULT_FIXTURE_TUNE.lift),
  roadClass: String(v.roadClass ?? DEFAULT_FIXTURE_TUNE.roadClass),
  lanes: num(v, 'lanes', DEFAULT_FIXTURE_TUNE.lanes),
  surface: String(v.surface ?? DEFAULT_FIXTURE_TUNE.surface),
  levels: num(v, 'levels', DEFAULT_FIXTURE_TUNE.levels),
  cover: String(v.cover ?? DEFAULT_FIXTURE_TUNE.cover) as FixtureCover,
  heading: num(v, 'heading', DEFAULT_FIXTURE_TUNE.heading),
});

/** The game's own path prefix, derived the way main.ts derives it: on the
 *  apex this page is /@c15r/drive/lab/world, on the cell host it is /lab/world,
 *  and one relative link has to be right in both. */
const base = (): string => (location.pathname.match(/^\/@[^/]+\/[^/]+/) ?? [''])[0];

export async function startWorldLab(): Promise<void> {
  document.title = 'DRIVE · WORLD LAB';
  const style = document.createElement('style');
  style.textContent = `
    body { margin: 0; background: #0b0f11; color: #d6e2e4;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace;
      padding: 24px 22px 40px 306px; }
    @media (max-width: 720px) { body { padding: 320px 16px 40px; } }
    h1 { font-size: 15px; letter-spacing: 3px; margin: 0 0 4px; }
    p.sub { color: #6f8285; margin: 0 0 18px; letter-spacing: 1px; max-width: 640px; }
    a.fx { display: block; color: #d6e2e4; text-decoration: none;
      border: 1px solid #24343a; padding: 11px 14px; margin-bottom: 9px; max-width: 620px; }
    a.fx:hover { border-color: #4f7f88; background: #101a1d; }
    a.fx b { letter-spacing: 2px; }
    a.fx span { display: block; color: #6f8285; font-size: 11px; margin-top: 3px; }
    a.fx em { display: block; color: #7fd0c4; font-style: normal; font-size: 11px; margin-top: 5px;
      word-break: break-all; }
    .foot { color: #6f8285; font-size: 11px; margin-top: 20px; max-width: 620px; }`;
  document.head.appendChild(style);

  const h = document.createElement('h1');
  h.textContent = 'DRIVE · WORLD LAB';
  const sub = document.createElement('p');
  sub.className = 'sub';
  sub.textContent = 'the whole engine, over ground you authored — no network, no upstream, same every time';
  document.body.append(h, sub);

  const cards = document.createElement('div');
  document.body.appendChild(cards);

  const foot = document.createElement('div');
  foot.className = 'foot';
  foot.textContent = 'The fixture is read at boot, so a dial takes effect on the next open. '
    + 'FACING at -1 keeps each fixture\u2019s own heading. '
    + 'COPY writes a FixtureTune literal — paste it over DEFAULT_FIXTURE_TUNE in '
    + 'world-fixtures.ts to make a set of numbers the way the fixtures ship.';
  document.body.appendChild(foot);

  const dials = createDials({
    slug: 'world',
    spec: [
      { id: 'relief', label: 'RELIEF', kind: 'range', min: 0, max: 3, step: 0.05, value: DEFAULT_FIXTURE_TUNE.relief },
      { id: 'slope', label: 'SLOPE', kind: 'range', min: 0, max: 3, step: 0.05, value: DEFAULT_FIXTURE_TUNE.slope },
      { id: 'lift', label: 'LIFT m', kind: 'range', min: -200, max: 2600, step: 10, value: DEFAULT_FIXTURE_TUNE.lift },
      { id: 'roadClass', label: 'CLASS', kind: 'select', options: FIXTURE_ROAD_CLASSES, value: DEFAULT_FIXTURE_TUNE.roadClass },
      { id: 'lanes', label: 'LANES', kind: 'range', min: 1, max: 6, step: 1, value: DEFAULT_FIXTURE_TUNE.lanes },
      { id: 'surface', label: 'SURFACE', kind: 'select', options: FIXTURE_SURFACES, value: DEFAULT_FIXTURE_TUNE.surface },
      { id: 'levels', label: 'STOREYS', kind: 'range', min: 1, max: 9, step: 1, value: DEFAULT_FIXTURE_TUNE.levels },
      { id: 'cover', label: 'COVER', kind: 'select', options: FIXTURE_COVERS, value: DEFAULT_FIXTURE_TUNE.cover },
      { id: 'heading', label: 'FACING', kind: 'range', min: -1, max: 359, step: 1, value: DEFAULT_FIXTURE_TUNE.heading },
      // The game's own vocabularies, not near-misses: `?time=DAY` is not a
      // TIME_MODE, so it silently selected CYCLE and every fixture opened at
      // half past five in the morning.
      { id: 'time', label: 'TIME', kind: 'select',
        options: ['auto', 'DAWN', 'MORNING', 'NOON', 'AFTERNOON', 'DUSK', 'NIGHT', 'LIVE'], value: 'MORNING' },
      { id: 'cam', label: 'CAM', kind: 'select', options: ['chase', 'cab', 'top'], value: 'chase' },
      { id: 'wx', label: 'WEATHER', kind: 'select',
        options: ['auto', 'clear', 'haze', 'rain', 'storm'], value: 'auto' },
    ],
    source: (v) => {
      const t = tuneOf(v);
      return `export const DEFAULT_FIXTURE_TUNE: FixtureTune = {\n`
        + `  relief: ${t.relief},\n  slope: ${t.slope},\n  lift: ${t.lift},\n`
        + `  roadClass: '${t.roadClass}',\n  lanes: ${t.lanes},\n  surface: '${t.surface}',\n`
        + `  levels: ${t.levels},\n  cover: '${t.cover}',\n  heading: ${t.heading},\n};`;
    },
  });

  const links = new Map<string, { a: HTMLAnchorElement; em: HTMLElement }>();
  for (const f of WORLD_FIXTURES) {
    const a = document.createElement('a');
    a.className = 'fx';
    const b = document.createElement('b');
    b.textContent = f.label;
    const s = document.createElement('span');
    s.textContent = f.note;
    const em = document.createElement('em');
    a.append(b, s, em);
    cards.appendChild(a);
    links.set(f.id, { a, em });
  }

  const refresh = (): void => {
    const v = dials.values();
    const ft = encodeTune(tuneOf(v));
    const extra: string[] = [];
    if (v.time && v.time !== 'auto') extra.push(`time=${String(v.time)}`);
    if (v.cam && v.cam !== 'chase') extra.push(`cam=${String(v.cam)}`);
    if (v.wx && v.wx !== 'auto') extra.push(`wx=${String(v.wx)}`);
    for (const f of WORLD_FIXTURES) {
      const q = [`fixture=${f.id}`, ...(ft ? [`ft=${encodeURIComponent(ft)}`] : []), ...extra];
      const href = `${base()}/?${q.join('&')}`;
      const row = links.get(f.id)!;
      row.a.href = href;
      row.em.textContent = href;
    }
  };
  dials.onChange(refresh);
  refresh();
}
