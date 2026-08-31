/**
 * ── THE LABS: LOOKING AT ONE THING WITHOUT THE WORLD ──
 *
 * The hydro lab earned its keep the first week it existed, and then the same
 * need arrived for something else and there was nowhere to put it. This is
 * that lab generalised: a registry of isolated surfaces, one per engine
 * feature, each reachable at /lab/<name>.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. Verifying the wall marks in the game
 * meant finding a town, waiting for OSM to serve four tiles through an
 * upstream that was failing, and hoping the camera came to rest facing a
 * wall's lower two metres. When nothing appeared there was no way to tell a
 * placement bug from a streaming failure from a shader that had silently
 * failed to compile — three very different faults with one symptom. A lab
 * removes the world from the question: a wall, the production shader, and a
 * row of dials.
 *
 * THE RULE THAT KEEPS A LAB HONEST: it imports the SAME modules the game
 * runs. A lab that reimplements what it is inspecting proves nothing, which
 * is why the façade shader moved into its own module rather than being
 * copied into here.
 */

export interface LabEntry {
  slug: string;
  label: string;
  note: string;
  /** A lab that renders nothing itself. The world lab is the only one: it
   *  cannot draw a mesh in a panel, because the mesh is built by the game at
   *  boot from the query string — so what it puts up is the CHOICE, and the
   *  looking happens in the game. Declared rather than inferred so the lab
   *  test can hold everything else to "it put a canvas up". */
  chooser?: boolean;
  start: () => Promise<void>;
}

export const LABS: readonly LabEntry[] = [
  {
    slug: 'hydro',
    label: 'HYDRO',
    note: 'Water fields, coastlines and river profiles over authored terrain fixtures.',
    start: () => import('./hydro/lab').then((m) => m.startHydroLab()),
  },
  {
    slug: 'marks',
    label: 'MARKS',
    note: 'Graffiti on a wall: the production façade shader, with the culture, the density and the reachable band on dials.',
    start: () => import('./marks-lab').then((m) => m.startMarksLab()),
  },
  {
    slug: 'roads',
    label: 'ROADS',
    note: 'A section through the bench search: the ground, the candidate offsets, the chosen profile and the cut and fill between them.',
    start: () => import('./roads-lab').then((m) => m.startRoadsLab()),
  },
  {
    slug: 'flora',
    label: 'FLORA',
    note: 'The climate ladder on one screen — biome mix at a point and a column through the altitudes, with the treeline walking as you turn the latitude.',
    start: () => import('./flora-lab').then((m) => m.startFloraLab()),
  },
  {
    slug: 'weather',
    label: 'WEATHER',
    note: 'Twelve kilometres of sky flat on a table: cover, rain, fog and the wet channel that remembers, with time on a dial.',
    start: () => import('./weather-lab').then((m) => m.startWeatherLab()),
  },
  {
    slug: 'world',
    label: 'WORLD',
    chooser: true,
    note: 'The one that isolates nothing: the whole engine over an authored planet, so the MESHES — ribbon, batter, kerb, junction, sward, facade — can be looked at without an upstream.',
    start: () => import('./world-lab').then((m) => m.startWorldLab()),
  },
];

/** The slug this URL asks for: /lab/marks, /lab (the index), or null when
 *  this is the game. `/hydro` stays valid — it is written down in notes and
 *  in at least one commit message, and breaking a documented URL to tidy a
 *  route is not a trade worth making. */
export function labRoute(pathname: string): { slug: string | null } | null {
  const p = pathname.replace(/\/+$/, '');
  if (p === '/hydro') return { slug: 'hydro' };
  if (p === '/lab') return { slug: null };
  const m = /^\/lab\/([a-z0-9-]+)$/.exec(p);
  return m ? { slug: m[1] } : null;
}

/** The index: every lab, as a page you can reach without knowing the slugs. */
function renderIndex(unknown?: string): void {
  const style = document.createElement('style');
  style.textContent = `
    body { margin: 0; background: #0b0f11; color: #d6e2e4;
      font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 28px 22px; }
    h1 { font-size: 15px; letter-spacing: 3px; margin: 0 0 4px; }
    p.sub { color: #6f8285; margin: 0 0 22px; letter-spacing: 1px; }
    a { display: block; color: #d6e2e4; text-decoration: none; border: 1px solid #24343a;
      padding: 11px 14px; margin-bottom: 9px; max-width: 560px; }
    a:hover { border-color: #4f7f88; background: #101a1d; }
    a b { letter-spacing: 2px; }
    a span { display: block; color: #6f8285; font-size: 11px; margin-top: 3px; }
    .miss { color: #d8703f; margin-bottom: 16px; }`;
  document.head.appendChild(style);
  const h = document.createElement('h1');
  h.textContent = 'DRIVE · LABS';
  const sub = document.createElement('p');
  sub.className = 'sub';
  sub.textContent = 'one feature, no world';
  document.body.append(h, sub);
  if (unknown) {
    const miss = document.createElement('div');
    miss.className = 'miss';
    miss.textContent = `no lab called "${unknown}"`;
    document.body.append(miss);
  }
  for (const lab of LABS) {
    const a = document.createElement('a');
    a.href = `/lab/${lab.slug}`;
    const b = document.createElement('b');
    b.textContent = lab.label;
    const s = document.createElement('span');
    s.textContent = lab.note;
    a.append(b, s);
    document.body.append(a);
  }
}

/**
 * THE SHELL BELONGS TO THE GAME. index.html ships a canvas and a boot splash
 * that only the game's bootstrap ever takes down — so a lab rendered
 * perfectly and was completely hidden behind "warming up…", which is exactly
 * the class of failure labs exist to stop. Cleared before any lab starts.
 */
function clearShell(): void {
  document.getElementById('boot')?.remove();
  document.getElementById('scene')?.remove();
}

/** Run whatever this URL asked for. Returns false when the URL is the game's,
 *  which is the only signal main.ts needs. */
export function startLab(pathname: string): boolean {
  const route = labRoute(pathname);
  if (!route) return false;
  clearShell();
  if (route.slug === null) { renderIndex(); return true; }
  const lab = LABS.find((l) => l.slug === route.slug);
  if (!lab) { renderIndex(route.slug); return true; }
  void lab.start().catch((error) => {
    console.error(`[lab:${lab.slug}]`, error);
    document.body.textContent = `lab "${lab.slug}" failed: ${String(error)}`;
  });
  return true;
}
