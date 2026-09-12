/**
 * BRIDGE FORMS — the structure above and below a deck, painted from a
 * family and a dozen parameters.
 *
 * A bridge in this world was a deck ribbon, a rail, and round piers at a
 * spacing for four of the six families the infrastructure recipe names; the
 * cable family got nothing under it at all, and the recipe's `silhouette`
 * was written and never read. So the Pont de Normandie stood on two cream
 * boxes that happened to be in OSM as buildings, and every suspension bridge
 * on earth was a flat road over the water.
 *
 * Structural engineering's own taxonomy is small, and a famous bridge is an
 * instance of it with a handful of parameters: the family, where the towers
 * stand, what shape a tower is, how the cables hang, where the arch sits and
 * how high it rises, what the deck is, and what colour it all is. At this
 * game's pixel scale — a bridge is read against the sky from a kilometre
 * off — those ARE the identity. The ornament that makes Tower Bridge Tower
 * Bridge is a tower style, not a bespoke model.
 *
 * This module is pure: it takes the deck fragments a bridge is built from
 * (OSM splits a long bridge into several ways, one per carriageway and again
 * at the pylons) and a spec, and returns vertex arrays. No THREE, no world
 * state, so `devtools/bridge-forms.test.mjs` can run it in node and say what
 * each family builds. The world wraps the arrays in one mesh per bridge.
 */

/** What holds the deck up. `girder` is the recipe's slab/beam/viaduct, which
 *  the deck and its piers already draw; it is here so a spec can say so. */
export type BridgeForm = 'girder' | 'arch' | 'truss' | 'cable-stayed' | 'suspension' | 'bascule';

/**
 * The tower vocabulary, derived from the table in CLAUDE.md. Nine shapes
 * cover the famous bridges: a portal is two legs and struts (Humber, Tsing
 * Ma, Verrazzano); the deco portal is the Golden Gate's stepped struts; the
 * braced portal is Akashi's cross-bracing; gothic is the stone of Brooklyn
 * and Tower Bridge; the A-frame is Millau and Rion–Antirrio; the inverted Y
 * is the Normandie; the H-frame is Øresund; the mast is Erasmus and
 * Alamillo; the cantilever is the Forth's tubular towers.
 */
export type TowerStyle = 'portal' | 'deco-portal' | 'braced-portal' | 'gothic'
  | 'a-frame' | 'inverted-y' | 'h-frame' | 'mast' | 'cantilever';
/** How the cables meet the tower. */
export type CablePattern = 'fan' | 'semi-fan' | 'harp' | 'suspension' | 'none';
/** Where the arch sits against the deck. A tied arch reads as a through
 *  arch; the tie is the deck. */
export type ArchPlace = 'through' | 'deck';
export type TrussPlace = 'through' | 'deck';
export type DeckKind = 'box' | 'truss' | 'double';
export type EndFeature = 'none' | 'pylons';

export interface BridgeFormSpec {
  form: BridgeForm;
  tower: TowerStyle;
  cables: CablePattern;
  /** Tower height over the deck as a share of the principal span — about
   *  0.11 for a suspension bridge (Golden Gate 152 m over 1,280 m), 0.2 for
   *  a cable-stayed one (Normandie ~160 m over 856 m). `towerM` overrides. */
  towerRatio: number;
  towerM?: number;
  /** Main-cable sag as a share of the main span; a tenth is the textbook. */
  sag: number;
  arch: ArchPlace;
  /** Arch rise over its span. Sydney is 0.27, a stone arch about 0.3, a long
   *  steel deck arch 0.2. */
  rise: number;
  truss: TrussPlace;
  deck: DeckKind;
  ends: EndFeature;
  /** Where the towers stand: world points (authored, or from pylon nodes),
   *  else fractions of the axis. Empty means the form's default. */
  stations: Array<[number, number]>;
  stationFractions: number[];
  /** Albedos. */
  towerCol: number;
  cableCol: number;
  steelCol: number;
  stoneCol: number;
}

/** One deck fragment: its centreline, the deck's height at each point, and
 *  its carriageway width. */
export interface BridgeWay {
  pts: ReadonlyArray<readonly [number, number]>;
  y: ArrayLike<number>;
  width: number;
}

export interface BridgeMesh {
  pos: number[];
  uv: number[];
  col: number[];
  quads: number;
  towers: number;
  stays: number;
  hangers: number;
  ribs: number;
  panels: number;
}

const COL = {
  concrete: 0xdad7cf, steel: 0x777c82, cable: 0xdedede, stone: 0xbfb19a,
};

/**
 * The spec a bridge gets from its tags and recipe family alone — the generic
 * bridge, before any landmark entry has its say. `bridge:structure` is the
 * one tag that names a family outright and it is on the ways of most big
 * bridges (the Normandie carries `cable-stayed`); the recipe family is what
 * the infrastructure module chose when the tag was absent.
 */
export function specFor(tags: Readonly<Record<string, string>>, family: string, spanM: number): BridgeFormSpec {
  const s = (tags['bridge:structure'] ?? '').toLowerCase();
  // THE PAINTER NEVER GUESSES A FORM ON A LONG BRIDGE. The recipe's family is
  // a weighted roll on world evidence, made per way, and it exists to pick
  // piers, rails and materials for ordinary crossings; at the untagged
  // Severn Bridge it came up `cable` on one boot and `truss` on the next,
  // and the second stood a 6,428-quad lattice along two kilometres of
  // suspension bridge. Above 150 m only a tag or a landmark entry names a
  // form; an untagged long bridge stays what it was — a deck on piers.
  if (spanM > 150 && !s) family = 'beam';
  const base: BridgeFormSpec = {
    form: 'girder', tower: 'portal', cables: 'none', towerRatio: 0.11, sag: 0.1,
    arch: 'through', rise: 0.22, truss: 'through', deck: 'box', ends: 'none',
    stations: [], stationFractions: [],
    towerCol: COL.concrete, cableCol: COL.cable, steelCol: COL.steel, stoneCol: COL.stone,
  };
  if (/suspension/.test(s)) {
    return { ...base, form: 'suspension', tower: 'portal', cables: 'suspension', towerRatio: 0.11, towerCol: COL.steel };
  }
  if (/cable/.test(s)) {
    // A short cable-stayed bridge is usually one pylon; a long one two.
    return { ...base, form: 'cable-stayed', tower: spanM < 350 ? 'mast' : 'a-frame', cables: 'semi-fan',
      towerRatio: 0.2, stationFractions: spanM < 350 ? [0.5] : [0.3, 0.7] };
  }
  if (/arch/.test(s) || family === 'arch') {
    // The spandrel walls between piers already draw a masonry arch at short
    // spans; a long arch is one rib over the middle of the crossing.
    return { ...base, form: 'arch', arch: spanM > 120 ? 'through' : 'deck', rise: spanM > 120 ? 0.24 : 0.3,
      towerCol: COL.steel };
  }
  if (/truss|lattice/.test(s) || family === 'truss') {
    return { ...base, form: 'truss', truss: 'through', towerCol: COL.steel };
  }
  if (/bascule|movable|swing|lift/.test(s) || (tags['bridge:movable'] ?? '') !== '') {
    return { ...base, form: 'bascule', tower: 'gothic', stationFractions: [0.35, 0.65], towerRatio: 0.35,
      towerCol: COL.stone };
  }
  if (family === 'cable') {
    return { ...base, form: 'cable-stayed', tower: 'a-frame', cables: 'semi-fan', towerRatio: 0.2,
      stationFractions: spanM < 350 ? [0.5] : [0.3, 0.7] };
  }
  return base;
}

/** The principal axis of an assembly: the line between its two most distant
 *  points, with every fragment projected onto it. */
export interface BridgeAxis { ux: number; uz: number; ox: number; oz: number; s0: number; s1: number; length: number }

export function bridgeAxis(ways: readonly BridgeWay[]): BridgeAxis | null {
  const ends: Array<[number, number]> = [];
  for (const w of ways) if (w.pts.length) { ends.push([w.pts[0][0], w.pts[0][1]]); ends.push([w.pts[w.pts.length - 1][0], w.pts[w.pts.length - 1][1]]); }
  if (ends.length < 2) return null;
  let best = -1, a = ends[0], b = ends[0];
  for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) {
    const d = Math.hypot(ends[i][0] - ends[j][0], ends[i][1] - ends[j][1]);
    if (d > best) { best = d; a = ends[i]; b = ends[j]; }
  }
  if (best < 1) return null;
  const ux = (b[0] - a[0]) / best, uz = (b[1] - a[1]) / best;
  let s0 = Infinity, s1 = -Infinity;
  for (const w of ways) for (const p of w.pts) {
    const s = (p[0] - a[0]) * ux + (p[1] - a[1]) * uz;
    if (s < s0) s0 = s; if (s > s1) s1 = s;
  }
  return { ux, uz, ox: a[0], oz: a[1], s0, s1, length: s1 - s0 };
}

export interface Station { x: number; z: number; s: number; deckY: number; spread: number }

/** Where the axis meets a fragment: the fragment's point nearest to `s`
 *  along the axis, its deck height there, and its lateral offset. */
function fragmentAt(w: BridgeWay, ax: BridgeAxis, s: number): { x: number; z: number; y: number; lat: number; ds: number } | null {
  let best = Infinity, bi = 0;
  for (let i = 0; i < w.pts.length; i++) {
    const p = w.pts[i];
    const ps = (p[0] - ax.ox) * ax.ux + (p[1] - ax.oz) * ax.uz;
    const d = Math.abs(ps - s);
    if (d < best) { best = d; bi = i; }
  }
  if (best === Infinity) return null;
  const p = w.pts[bi];
  const lat = -(p[0] - ax.ox) * ax.uz + (p[1] - ax.oz) * ax.ux;
  return { x: p[0], z: p[1], y: w.y[bi], lat, ds: best };
}

/**
 * Where the towers stand. Authored or mapped points win; fractions of the
 * axis are the default. A station is the mean of the fragments' nearest
 * points — so a twin carriageway puts the tower between its two decks — and
 * its spread is how far the legs must stand to clear the outermost kerb.
 */
export function planBridgeStations(ways: readonly BridgeWay[], spec: BridgeFormSpec, ax: BridgeAxis): Station[] {
  const at = (s: number, fixed?: [number, number]): Station | null => {
    let n = 0, x = 0, z = 0, y = 0, spread = 0;
    for (const w of ways) {
      const f = fragmentAt(w, ax, s);
      if (!f || f.ds > 60) continue;
      n++; x += f.x; z += f.z; y += f.y;
      spread = Math.max(spread, Math.abs(f.lat) + w.width / 2);
    }
    if (!n) return null;
    x /= n; z /= n; y /= n;
    // The legs stand outside every kerb; the mean lateral is the centre.
    let lat0 = 0;
    for (const w of ways) { const f = fragmentAt(w, ax, s); if (f && f.ds <= 60) lat0 += f.lat / n; }
    // An authored or mapped point fixes only WHERE ALONG the bridge the
    // tower stands; laterally it stands between the deck fragments it finds
    // there, so a coordinate read off a map a few tens of metres wide of the
    // deck still puts the tower on the bridge and not beside it.
    void fixed;
    const cx = ax.ox + ax.ux * s - ax.uz * lat0;
    const cz = ax.oz + ax.uz * s + ax.ux * lat0;
    return { x: cx, z: cz, s, deckY: y, spread: Math.max(spread - Math.abs(lat0), 3) + 1.4 };
  };
  const out: Station[] = [];
  if (spec.stations.length) {
    for (const p of spec.stations) {
      const s = (p[0] - ax.ox) * ax.ux + (p[1] - ax.oz) * ax.uz;
      const st = at(s, p);
      if (st) out.push(st);
    }
  } else {
    for (const f of spec.stationFractions) { const st = at(ax.s0 + ax.length * f); if (st) out.push(st); }
  }
  return out.sort((p, q) => p.s - q.s);
}

// ── the primitives ────────────────────────────────────────────────────

function push(m: BridgeMesh, x: number, y: number, z: number, u: number, v: number, col: number): void {
  m.pos.push(x, y, z); m.uv.push(u, v);
  m.col.push(((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255);
}
/** a top-left, b top-right, c bottom-left, d bottom-right — the order the
 *  world's own `quad` uses. Two triangles; the material is double-sided. */
function quad(m: BridgeMesh, a: number[], b: number[], c: number[], d: number[], col: number, uw = 1, vh = 1): void {
  push(m, a[0], a[1], a[2], 0, 0, col); push(m, c[0], c[1], c[2], 0, vh, col); push(m, b[0], b[1], b[2], uw, 0, col);
  push(m, b[0], b[1], b[2], uw, 0, col); push(m, c[0], c[1], c[2], 0, vh, col); push(m, d[0], d[1], d[2], uw, vh, col);
  m.quads++;
}
/** A square prism between two points, half-width `hw`, `hw2` at the far end
 *  if it tapers. Four sides; the ends are inside whatever they meet. */
export function box(m: BridgeMesh, p: number[], q: number[], hw: number, col: number, hw2 = hw): void {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const d = [dx / len, dy / len, dz / len];
  // A perpendicular pair: horizontal first where the member is not vertical.
  let u = [-d[2], 0, d[0]];
  const ul = Math.hypot(u[0], u[2]);
  u = ul > 1e-3 ? [u[0] / ul, 0, u[2] / ul] : [1, 0, 0];
  const v = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
  const c = (base: number[], su: number, sv: number, h: number): number[] =>
    [base[0] + (u[0] * su + v[0] * sv) * h, base[1] + (u[1] * su + v[1] * sv) * h, base[2] + (u[2] * su + v[2] * sv) * h];
  const S: Array<[number, number]> = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [a0, b0] = S[i], [a1, b1] = S[(i + 1) % 4];
    quad(m, c(p, a0, b0, hw), c(p, a1, b1, hw), c(q, a0, b0, hw2), c(q, a1, b1, hw2), col, 1, len / 4);
  }
}
/** A cable: two thin quads crossed at right angles, so it reads from the
 *  side and from above alike. Wider than a real cable by an order of
 *  magnitude — a 0.1 m cable is nothing at any distance this game draws. */
export function strand(m: BridgeMesh, p: number[], q: number[], w: number, col: number): void {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  const hl = Math.hypot(dx, dz);
  const u = hl > 1e-3 ? [-dz / hl * w / 2, 0, dx / hl * w / 2] : [w / 2, 0, 0];
  const len = Math.hypot(dx, dy, dz);
  quad(m, [p[0] + u[0], p[1], p[2] + u[2]], [p[0] - u[0], p[1], p[2] - u[2]],
    [q[0] + u[0], q[1], q[2] + u[2]], [q[0] - u[0], q[1], q[2] - u[2]], col, 1, len / 4);
  // The second blade: perpendicular to the first, in the plane of the cable.
  const v = [dy * u[2], -(dx * u[2] - dz * u[0]), -dy * u[0]];
  const vl = Math.hypot(v[0], v[1], v[2]) || 1;
  const vv = [v[0] / vl * w / 2, v[1] / vl * w / 2, v[2] / vl * w / 2];
  quad(m, [p[0] + vv[0], p[1] + vv[1], p[2] + vv[2]], [p[0] - vv[0], p[1] - vv[1], p[2] - vv[2]],
    [q[0] + vv[0], q[1] + vv[1], q[2] + vv[2]], [q[0] - vv[0], q[1] - vv[1], q[2] - vv[2]], col, 1, len / 4);
}

// ── towers ────────────────────────────────────────────────────────────

export interface TowerBuilt { top: number[][]; attach: (side: number, f: number) => number[]; base: number; height: number }

/**
 * One tower at a station. Returns where the cables attach: `top` is the
 * point (or the pair of points) a fan hangs from; `attach(side, f)` is the
 * point on the leg at height fraction `f` for a harp.
 */
export function tower(m: BridgeMesh, st: Station, ax: BridgeAxis, spec: BridgeFormSpec, height: number, groundY: number): TowerBuilt {
  const top = st.deckY + height;
  const base = Math.min(groundY, st.deckY - 6);
  const lx = -ax.uz, lz = ax.ux;                       // across the axis
  const at = (lat: number, y: number, along = 0): number[] =>
    [st.x + lx * lat + ax.ux * along, y, st.z + lz * lat + ax.uz * along];
  const hw = Math.max(1.4, Math.min(5.5, height * 0.032));
  const col = spec.towerCol;
  m.towers++;
  // The foundation: one block from the bed to just under the deck, wider
  // than the legs — a pier is broader than its column, and a pylon's foot in
  // the water is broader still.
  const foot = st.spread * 1.15;
  box(m, at(0, base, 0), at(0, st.deckY - 1.2, 0), Math.max(foot, hw * 2), col);
  const sp = st.spread;
  const strut = (y: number, w = hw * 0.8): void => box(m, at(-sp, y), at(sp, y), w, col);
  switch (spec.tower) {
    case 'portal': case 'deco-portal': case 'braced-portal': case 'cantilever': {
      const deco = spec.tower === 'deco-portal';
      const bays = deco ? 4 : 3;
      for (const s of [-1, 1]) box(m, at(s * sp, base), at(s * sp, top), hw * (deco ? 1.25 : 1), col, hw);
      for (let k = 1; k <= bays; k++) {
        const y = st.deckY + (height * k) / bays - (k === bays ? hw : 0);
        strut(y, deco ? hw * (1.2 - k * 0.12) : hw * 0.8);
        if (spec.tower === 'braced-portal' && k > 1) {
          const y0 = st.deckY + (height * (k - 1)) / bays;
          box(m, at(-sp, y0), at(sp, y), hw * 0.35, col);
          box(m, at(sp, y0), at(-sp, y), hw * 0.35, col);
        }
      }
      // Below the deck the legs stand on the foundation; a cross at deck level
      // carries the deck through the portal.
      strut(st.deckY - 0.6, hw);
      return { top: [at(-sp, top), at(sp, top)], base, height,
        attach: (side, f) => at(side * sp, st.deckY + height * f) };
    }
    case 'gothic': {
      // Two stone legs joined by a solid wall, and a pointed cap: Brooklyn
      // and Tower Bridge at one glance. The wall is a panel between the legs.
      const w = hw * 1.6;
      for (const s of [-1, 1]) box(m, at(s * sp, base), at(s * sp, top - height * 0.08), w, spec.stoneCol);
      const y0 = st.deckY + height * 0.18, y1 = top - height * 0.08;
      for (const k of [-1, 1]) {
        quad(m, at(-sp, y1, k * w), at(sp, y1, k * w), at(-sp, y0, k * w), at(sp, y0, k * w), spec.stoneCol, 2, 4);
      }
      // The cap: a ridge over the wall.
      for (const s of [-1, 1]) box(m, at(s * sp, y1), at(0, top), w * 0.9, spec.stoneCol, w * 0.5);
      return { top: [at(-sp, y1), at(sp, y1)], base, height,
        attach: (side, f) => at(side * sp, st.deckY + height * f) };
    }
    case 'a-frame': {
      const splay = sp * 1.35;
      for (const s of [-1, 1]) box(m, at(s * splay, base), at(0, top), hw * 1.1, col, hw * 0.7);
      strut(st.deckY - 0.6, hw);
      return { top: [at(0, top)], base, height,
        attach: (side, f) => at(side * splay * (1 - f), st.deckY + height * f) };
    }
    case 'inverted-y': {
      // Legs meet a little over halfway up, then one mast: the Normandie.
      const knee = st.deckY + height * 0.55, splay = sp * 1.3;
      for (const s of [-1, 1]) box(m, at(s * splay, base), at(0, knee), hw * 1.1, col, hw * 0.9);
      box(m, at(0, knee), at(0, top), hw * 1.3, col, hw * 0.9);
      strut(st.deckY - 0.6, hw);
      return { top: [at(0, top)], base, height,
        attach: (side, f) => f < 0.55 ? at(side * splay * (1 - f / 0.55), st.deckY + height * f) : at(0, st.deckY + height * f) };
    }
    case 'h-frame': {
      for (const s of [-1, 1]) box(m, at(s * sp, base), at(s * sp, top), hw, col);
      strut(st.deckY + height * 0.5);
      strut(st.deckY - 0.6, hw);
      return { top: [at(-sp, top), at(sp, top)], base, height,
        attach: (side, f) => at(side * sp, st.deckY + height * f) };
    }
    case 'mast': {
      box(m, at(0, base), at(0, top), hw * 1.5, col, hw * 0.8);
      return { top: [at(0, top)], base, height, attach: (_side, f) => at(0, st.deckY + height * f) };
    }
  }
  return { top: [at(0, top)], base, height, attach: (_side, f) => at(0, st.deckY + height * f) };
}

// ── the deck edge, for anchors and hangers ───────────────────────────

/** The point on a fragment's deck edge at axis position `s`, on `side`. */
function edgeAt(w: BridgeWay, ax: BridgeAxis, s: number, side: number): number[] | null {
  const f = fragmentAt(w, ax, s);
  if (!f || f.ds > 8) return null;
  const lx = -ax.uz, lz = ax.ux;
  const off = side * (w.width / 2) * 0.92;
  return [f.x + lx * off, f.y + 0.9, f.z + lz * off];
}

// ── the forms ─────────────────────────────────────────────────────────

export function buildBridgeForms(
  ways: readonly BridgeWay[], spec: BridgeFormSpec, groundAt: (x: number, z: number) => number,
): BridgeMesh {
  const m: BridgeMesh = { pos: [], uv: [], col: [], quads: 0, towers: 0, stays: 0, hangers: 0, ribs: 0, panels: 0 };
  const ax = bridgeAxis(ways);
  if (!ax || spec.form === 'girder') return m;
  const stations = planBridgeStations(ways, spec, ax);
  const L = ax.length;
  // The principal span: between the two middle towers, or the whole axis.
  const mainSpan = stations.length >= 2
    ? Math.max(...stations.slice(1).map((st, i) => st.s - stations[i].s))
    : L * (stations.length === 1 ? 0.55 : 0.6);
  const height = spec.towerM ?? Math.max(12, mainSpan * spec.towerRatio);

  if (spec.form === 'cable-stayed' || spec.form === 'suspension' || spec.form === 'bascule') {
    const built = stations.map((st) => tower(m, st, ax, spec, height, groundAt(st.x, st.z)));
    if (spec.form === 'cable-stayed') stays(m, ways, ax, spec, stations, built);
    if (spec.form === 'suspension') suspension(m, ways, ax, spec, stations, built);
    if (spec.form === 'bascule' && built.length === 2) {
      // The high-level walkway between the towers, and the towers are the form.
      const a = built[0].top, b = built[1].top;
      for (let k = 0; k < Math.min(a.length, b.length); k++) box(m, a[k], b[k], 1.6, spec.steelCol);
    }
  }
  // A cantilever truss stands on towers too — the Forth's — where the entry
  // says where they are; a plain truss has none.
  if (spec.form === 'truss' && stations.length) for (const st of stations) tower(m, st, ax, spec, height, groundAt(st.x, st.z));
  if (spec.form === 'arch') archRib(m, ways, ax, spec, stations, groundAt);
  if (spec.form === 'truss' || spec.deck === 'truss') for (const w of ways) truss(m, w, ax, spec, spec.form === 'truss' ? spec.truss : 'deck');
  if (spec.deck === 'double') for (const w of ways) lowerDeck(m, w, spec);
  if (spec.ends === 'pylons') endPylons(m, ways, ax, spec, stations);
  return m;
}

/** Stays from every tower to every deck edge within its reach. */
function stays(m: BridgeMesh, ways: readonly BridgeWay[], ax: BridgeAxis, spec: BridgeFormSpec, stations: Station[], built: TowerBuilt[]): void {
  for (let t = 0; t < stations.length; t++) {
    const st = stations[t], tw = built[t];
    // Reach: halfway to the neighbouring tower, or to the end of the axis.
    for (const dir of [-1, 1]) {
      const nb = dir < 0 ? stations[t - 1] : stations[t + 1];
      const reach = nb ? Math.abs(nb.s - st.s) / 2 : (dir < 0 ? st.s - ax.s0 : ax.s1 - st.s);
      if (reach < 20) continue;
      const n = Math.max(4, Math.min(16, Math.round(reach / 22)));
      for (let k = 1; k <= n; k++) {
        const s = st.s + dir * reach * (k / n) * 0.96;
        const f = 1 - (k / n) * 0.5;                        // harp: parallel, lower for nearer anchors
        for (const w of ways) {
          for (const side of [-1, 1]) {
            const anchor = edgeAt(w, ax, s, side);
            if (!anchor) continue;
            // A pylon between the two carriageways with a top on each side
            // hangs its stays from the leg on that side; a single top serves
            // both.
            const from = spec.cables === 'harp' ? tw.attach(side, 0.35 + 0.6 * f)
              : spec.cables === 'semi-fan' ? tw.attach(side, 0.82 + 0.16 * f)
              : tw.top[tw.top.length === 2 ? (side < 0 ? 0 : 1) : 0];
            strand(m, from, anchor, Math.max(0.35, height(tw) * 0.004), spec.cableCol);
            m.stays++;
          }
        }
      }
    }
  }
}
const height = (tw: TowerBuilt): number => tw.height;

/** Main cables over the towers with the textbook sag, hangers to the deck,
 *  and the side spans down to the anchorages at the ends. */
function suspension(m: BridgeMesh, ways: readonly BridgeWay[], ax: BridgeAxis, spec: BridgeFormSpec, stations: Station[], built: TowerBuilt[]): void {
  if (!stations.length) return;
  const W = Math.max(...ways.map((w) => w.width));
  const cableW = Math.max(0.8, W * 0.06);
  const deckYAt = (s: number): number | null => {
    let best: number | null = null, bd = Infinity;
    for (const w of ways) { const f = fragmentAt(w, ax, s); if (f && f.ds < bd) { bd = f.ds; best = f.y; } }
    return bd > 30 ? null : best;
  };
  const cableAt = (a: Station, b: Station, side: number, t: number, ta: number[], tb: number[]): number[] => {
    // A parabola between the tower tops with the sag at mid-span.
    const span = b.s - a.s;
    const y = ta[1] + (tb[1] - ta[1]) * t - spec.sag * span * 4 * t * (1 - t);
    return [ta[0] + (tb[0] - ta[0]) * t, y, ta[2] + (tb[2] - ta[2]) * t];
  };
  for (let t = 0; t + 1 < stations.length; t++) {
    const a = stations[t], b = stations[t + 1];
    const ta = built[t].top, tb = built[t + 1].top;
    const span = b.s - a.s;
    const steps = Math.max(8, Math.round(span / 14));
    for (let k = 0; k < Math.min(ta.length, tb.length); k++) {
      const side = ta.length === 2 ? (k === 0 ? -1 : 1) : 0;
      let prev = cableAt(a, b, side, 0, ta[k], tb[k]);
      for (let i = 1; i <= steps; i++) {
        const cur = cableAt(a, b, side, i / steps, ta[k], tb[k]);
        strand(m, prev, cur, cableW, spec.cableCol);
        // A hanger from the cable to the deck edge, one per step.
        const s = a.s + span * (i / steps);
        for (const w of ways) {
          const e = edgeAt(w, ax, s, side || 1);
          if (e && cur[1] > e[1] + 1) { strand(m, cur, e, cableW * 0.4, spec.cableCol); m.hangers++; }
          if (!side) { const e2 = edgeAt(w, ax, s, -1); if (e2 && cur[1] > e2[1] + 1) { strand(m, cur, e2, cableW * 0.4, spec.cableCol); m.hangers++; } }
        }
        prev = cur;
      }
    }
  }
  // Side spans: from each outer tower top to the deck at the axis end.
  for (const [st, tw, endS] of [[stations[0], built[0], ax.s0], [stations[stations.length - 1], built[built.length - 1], ax.s1]] as Array<[Station, TowerBuilt, number]>) {
    const y = deckYAt(endS);
    if (y === null || Math.abs(endS - st.s) < 15) continue;
    const lx = -ax.uz, lz = ax.ux;
    for (let k = 0; k < tw.top.length; k++) {
      const side = tw.top.length === 2 ? (k === 0 ? -1 : 1) : 0;
      const endP = [ax.ox + ax.ux * endS + lx * side * st.spread, y + 1.5, ax.oz + ax.uz * endS + lz * side * st.spread];
      const steps = Math.max(3, Math.round(Math.abs(endS - st.s) / 20));
      let prev = tw.top[k];
      for (let i = 1; i <= steps; i++) {
        const tt = i / steps;
        const cur = [tw.top[k][0] + (endP[0] - tw.top[k][0]) * tt, tw.top[k][1] + (endP[1] - tw.top[k][1]) * tt - spec.sag * 0.6 * Math.abs(endS - st.s) * tt * (1 - tt), tw.top[k][2] + (endP[2] - tw.top[k][2]) * tt];
        strand(m, prev, cur, cableW, spec.cableCol);
        const s = st.s + (endS - st.s) * tt;
        for (const w of ways) { const e = edgeAt(w, ax, s, side || 1); if (e && cur[1] > e[1] + 1) { strand(m, cur, e, cableW * 0.4, spec.cableCol); m.hangers++; } }
        prev = cur;
      }
    }
  }
}

/** One arch over the principal span: a pair of ribs outside the kerbs,
 *  hangers down to the deck for a through arch, columns up to it for a deck
 *  arch, and cross-bracing between the ribs. */
function archRib(m: BridgeMesh, ways: readonly BridgeWay[], ax: BridgeAxis, spec: BridgeFormSpec, stations: Station[], groundAt: (x: number, z: number) => number): void {
  const L = ax.length;
  const sA = stations.length >= 2 ? stations[0].s : L > 150 ? ax.s0 + L * 0.2 : ax.s0 + 4;
  const sB = stations.length >= 2 ? stations[stations.length - 1].s : L > 150 ? ax.s1 - L * 0.2 : ax.s1 - 4;
  const span = sB - sA;
  if (span < 12) return;
  const riseM = span * spec.rise;
  let spread = 0, deckY = 0, n = 0;
  for (const w of ways) { const f = fragmentAt(w, ax, (sA + sB) / 2); if (f) { spread = Math.max(spread, Math.abs(f.lat) + w.width / 2); deckY += f.y; n++; } }
  if (!n) return;
  deckY /= n;
  spread += 1.0;
  const lx = -ax.uz, lz = ax.ux;
  const hw = Math.max(1.0, Math.min(6, span * 0.011));
  const steps = Math.max(10, Math.round(span / 12));
  const through = spec.arch === 'through';
  const ribY = (t: number): number => through
    ? deckY + 2 + riseM * 4 * t * (1 - t)
    : deckY - 2 - riseM + riseM * 4 * t * (1 - t);
  const ribP = (t: number, side: number): number[] =>
    [ax.ox + ax.ux * (sA + span * t) + lx * side * spread, ribY(t), ax.oz + ax.uz * (sA + span * t) + lz * side * spread];
  for (const side of [-1, 1]) {
    let prev = ribP(0, side);
    for (let i = 1; i <= steps; i++) {
      const cur = ribP(i / steps, side);
      box(m, prev, cur, hw, spec.towerCol);
      m.ribs++;
      prev = cur;
    }
    // Springing: the rib meets the ground (deck arch) or the deck (through arch) on a block.
    const foot = ribP(0, side), foot2 = ribP(1, side);
    if (!through) {
      box(m, [foot[0], groundAt(foot[0], foot[2]) - 1, foot[2]], foot, hw * 1.6, spec.towerCol);
      box(m, [foot2[0], groundAt(foot2[0], foot2[2]) - 1, foot2[2]], foot2, hw * 1.6, spec.towerCol);
    }
  }
  // Hangers or columns every ~12 m, and bracing between the ribs on top.
  const members = Math.max(4, Math.round(span / 12));
  for (let i = 1; i < members; i++) {
    const t = i / members, s = sA + span * t;
    for (const side of [-1, 1]) {
      const rib = ribP(t, side);
      for (const w of ways) {
        const e = edgeAt(w, ax, s, side);
        if (!e) continue;
        if (through ? rib[1] > e[1] + 1.5 : rib[1] < e[1] - 1.5) {
          if (through) strand(m, rib, e, Math.max(0.35, hw * 0.3), spec.cableCol);
          else box(m, rib, [e[0], e[1] - 1, e[2]], hw * 0.45, spec.towerCol);
          m.hangers++;
        }
      }
    }
    if (through && i % 2 === 0 && t > 0.15 && t < 0.85) box(m, ribP(t, -1), ribP(t, 1), hw * 0.4, spec.towerCol);
  }
}

/** A lattice along one fragment: chords, verticals and Warren diagonals on
 *  both sides of the deck, portals across at the ends, sway braces over the
 *  top for a through truss. */
function truss(m: BridgeMesh, w: BridgeWay, ax: BridgeAxis, spec: BridgeFormSpec, place: TrussPlace): void {
  if (w.pts.length < 2) return;
  const D = place === 'through' ? Math.max(4.5, Math.min(11, w.width * 0.55)) : Math.max(3, Math.min(8, w.width * 0.3));
  const P = Math.max(6, Math.min(14, D * 1.2));
  const hw = Math.max(0.28, Math.min(0.7, D * 0.06));
  const col = spec.towerCol;
  // Cumulative length along the fragment.
  const arc: number[] = [0];
  for (let i = 1; i < w.pts.length; i++) arc.push(arc[i - 1] + Math.hypot(w.pts[i][0] - w.pts[i - 1][0], w.pts[i][1] - w.pts[i - 1][1]));
  const total = arc[arc.length - 1];
  if (total < P * 2) return;
  const at = (s: number, side: number, dy: number): number[] => {
    let i = 0;
    while (i + 1 < arc.length - 1 && arc[i + 1] < s) i++;
    const f = arc[i + 1] > arc[i] ? Math.min(1, Math.max(0, (s - arc[i]) / (arc[i + 1] - arc[i]))) : 0;
    const x = w.pts[i][0] + (w.pts[i + 1][0] - w.pts[i][0]) * f, z = w.pts[i][1] + (w.pts[i + 1][1] - w.pts[i][1]) * f;
    const y = w.y[i] + (w.y[i + 1] - w.y[i]) * f;
    const tx = w.pts[i + 1][0] - w.pts[i][0], tz = w.pts[i + 1][1] - w.pts[i][1], tl = Math.hypot(tx, tz) || 1;
    const off = side * (w.width / 2 + 0.5);
    return [x + (-tz / tl) * off, y + dy, z + (tx / tl) * off];
  };
  const panels = Math.floor(total / P);
  const top = place === 'through' ? D : -0.4, bot = place === 'through' ? 0.4 : -D;
  for (const side of [-1, 1]) {
    for (let k = 0; k < panels; k++) {
      const s0 = k * P, s1 = (k + 1) * P;
      box(m, at(s0, side, top), at(s1, side, top), hw, col);
      if (place === 'deck') box(m, at(s0, side, bot), at(s1, side, bot), hw, col);
      box(m, at(s0, side, bot), at(s0, side, top), hw, col);
      // Warren: alternate the diagonal's direction panel by panel.
      if (k % 2 === 0) box(m, at(s0, side, bot), at(s1, side, top), hw * 0.8, col);
      else box(m, at(s0, side, top), at(s1, side, bot), hw * 0.8, col);
      m.panels++;
    }
    box(m, at(panels * P, side, bot), at(panels * P, side, top), hw, col);
  }
  if (place === 'through') {
    for (let k = 0; k <= panels; k += 2) box(m, at(k * P, -1, top), at(k * P, 1, top), hw, col);
  }
}

/** A second deck under the first, for the double-deckers. */
function lowerDeck(m: BridgeMesh, w: BridgeWay, spec: BridgeFormSpec): void {
  const drop = Math.max(6, Math.min(9, w.width * 0.45));
  for (let i = 0; i + 1 < w.pts.length; i++) {
    const a = w.pts[i], b = w.pts[i + 1];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl * w.width / 2, nz = tx / tl * w.width / 2;
    const ya = w.y[i] - drop, yb = w.y[i + 1] - drop;
    quad(m, [a[0] - nx, ya, a[1] - nz], [a[0] + nx, ya, a[1] + nz], [b[0] - nx, yb, b[1] - nz], [b[0] + nx, yb, b[1] + nz], spec.steelCol, w.width / 4, tl / 4);
    quad(m, [a[0] - nx, ya - 1.2, a[1] - nz], [a[0] + nx, ya - 1.2, a[1] + nz], [b[0] - nx, yb - 1.2, b[1] - nz], [b[0] + nx, yb - 1.2, b[1] + nz], spec.steelCol, w.width / 4, tl / 4);
    for (const s of [-1, 1]) quad(m, [a[0] + s * nx, ya, a[1] + s * nz], [b[0] + s * nx, yb, b[1] + s * nz], [a[0] + s * nx, ya - 1.2, a[1] + s * nz], [b[0] + s * nx, yb - 1.2, b[1] + s * nz], spec.steelCol, tl / 4, 0.3);
  }
}

/** Stone pylons flanking the deck at each end of the principal span —
 *  Sydney's granite pairs. Decorative, and the most recognisable thing on
 *  the bridge after the arch. */
function endPylons(m: BridgeMesh, ways: readonly BridgeWay[], ax: BridgeAxis, spec: BridgeFormSpec, stations: Station[]): void {
  const L = ax.length;
  const ends = stations.length >= 2 ? [stations[0].s, stations[stations.length - 1].s] : [ax.s0 + L * 0.2, ax.s1 - L * 0.2];
  const span = ends[1] - ends[0];
  const h = Math.max(12, Math.min(90, span * 0.17));
  const lx = -ax.uz, lz = ax.ux;
  for (const s of ends) {
    let spread = 0, deckY = 0, n = 0;
    for (const w of ways) { const f = fragmentAt(w, ax, s); if (f && f.ds < 40) { spread = Math.max(spread, Math.abs(f.lat) + w.width / 2); deckY += f.y; n++; } }
    if (!n) continue;
    deckY /= n; spread += 4;
    for (const side of [-1, 1]) {
      const cx = ax.ox + ax.ux * s + lx * side * spread, cz = ax.oz + ax.uz * s + lz * side * spread;
      box(m, [cx, deckY - 12, cz], [cx, deckY + h, cz], 5, spec.stoneCol, 4.2);
      m.towers++;
    }
  }
}
