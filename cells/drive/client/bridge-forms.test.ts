import { buildBridgeForms, bridgeAxis, planBridgeStations, specFor, type BridgeFormSpec, type BridgeWay } from './bridge-forms';

const fail = (m: string): never => { throw new Error(m); };

/** A straight deck along +x, `len` metres long, `y` metres up, `lat` metres
 *  off the axis — two of them make a twin carriageway. */
const deck = (len: number, y: number, lat = 0, width = 12, step = 12): BridgeWay => {
  const pts: Array<[number, number]> = [];
  const ys: number[] = [];
  for (let s = 0; s <= len; s += step) { pts.push([s, lat]); ys.push(y); }
  return { pts, y: ys, width };
};
const flat = (): number => 0;
const yMax = (pos: number[]): number => { let m = -Infinity; for (let i = 1; i < pos.length; i += 3) if (pos[i] > m) m = pos[i]; return m; };
const yMin = (pos: number[]): number => { let m = Infinity; for (let i = 1; i < pos.length; i += 3) if (pos[i] < m) m = pos[i]; return m; };

export function runBridgeFormsSelfTest(): void {
  // ── THE TAG NAMES THE FAMILY ──
  {
    if (specFor({ 'bridge:structure': 'cable-stayed' }, 'cable', 900).form !== 'cable-stayed') fail('cable-stayed tag');
    if (specFor({ 'bridge:structure': 'suspension' }, 'cable', 900).form !== 'suspension') fail('suspension tag');
    if (specFor({ 'bridge:structure': 'arch' }, 'beam', 300).form !== 'arch') fail('arch tag');
    if (specFor({}, 'truss', 100).form !== 'truss') fail('truss family');
    if (specFor({}, 'beam', 100).form !== 'girder') fail('a beam is a girder and paints nothing extra');
    // The recipe's roll names a form only on a short bridge; past 150 m the
    // tag or the store must say, or nothing is painted.
    if (specFor({}, 'truss', 900).form !== 'girder') fail('an untagged long bridge must not take the recipe\'s roll');
    if (specFor({}, 'cable', 900).form !== 'girder') fail('an untagged long cable roll paints nothing');
    if (specFor({ 'bridge:structure': 'suspension' }, 'beam', 900).form !== 'suspension') fail('the tag still names the form on a long bridge');
    if (specFor({ 'bridge:structure': 'cable-stayed' }, 'cable', 200).tower !== 'mast') fail('a short cable-stayed bridge is one mast');
  }
  // ── A GIRDER PAINTS NOTHING: THE DECK AND ITS PIERS ARE THE BRIDGE ──
  {
    const m = buildBridgeForms([deck(300, 20)], specFor({}, 'beam', 300), flat);
    if (m.quads) fail(`girder painted ${m.quads} quads`);
  }
  // ── A CABLE-STAYED BRIDGE: TWO TOWERS AT THE DEFAULT STATIONS, STAYS TO EVERY ANCHOR ──
  {
    const spec = specFor({ 'bridge:structure': 'cable-stayed' }, 'cable', 900);
    const ways = [deck(900, 60)];
    const ax = bridgeAxis(ways);
    if (!ax || Math.abs(ax.length - 900) > 1) fail(`axis ${ax?.length}`);
    const st = planBridgeStations(ways, spec, ax!);
    if (st.length !== 2) fail(`stations ${st.length}`);
    if (Math.abs(st[0].x - 270) > 13 || Math.abs(st[1].x - 630) > 13) fail(`stations at ${st[0].x}, ${st[1].x}`);
    const m = buildBridgeForms(ways, spec, flat);
    if (m.towers !== 2) fail(`towers ${m.towers}`);
    if (m.stays < 20) fail(`stays ${m.stays}`);
    // Tower height: the main span is 360 m, the ratio a fifth — 72 m over a 60 m deck.
    if (Math.abs(yMax(m.pos) - 132) > 3) fail(`tower top ${yMax(m.pos)}`);
    // The foundation goes down to the ground at 0, and a little under.
    // (A splayed leg tilts its square section, so a corner dips a little under.)
    if (yMin(m.pos) > 0.5 || yMin(m.pos) < -3) fail(`foundation ${yMin(m.pos)}`);
  }
  // ── A TWIN CARRIAGEWAY STANDS ONE TOWER BETWEEN ITS DECKS ──
  {
    const spec = specFor({ 'bridge:structure': 'cable-stayed' }, 'cable', 900);
    const ways = [deck(900, 60, -9), deck(900, 60, 9)];
    const ax = bridgeAxis(ways)!;
    const st = planBridgeStations(ways, spec, ax);
    if (st.length !== 2) fail(`twin stations ${st.length}`);
    if (Math.abs(st[0].z) > 0.5) fail(`twin tower not between the decks: lateral ${st[0].z}`);
    if (st[0].spread < 15) fail(`twin spread ${st[0].spread} does not clear the outer kerb`);
    const m = buildBridgeForms(ways, spec, flat);
    if (m.towers !== 2) fail(`twin towers ${m.towers}`);
  }
  // ── AUTHORED STATIONS FIX ONLY THE POSITION ALONG THE BRIDGE ──
  {
    const spec: BridgeFormSpec = { ...specFor({ 'bridge:structure': 'cable-stayed' }, 'cable', 900), stations: [[200, 40], [700, -35]] };
    const ways = [deck(900, 60)];
    const st = planBridgeStations(ways, spec, bridgeAxis(ways)!);
    if (st.length !== 2) fail(`authored stations ${st.length}`);
    if (Math.abs(st[0].x - 200) > 1 || Math.abs(st[1].x - 700) > 1) fail(`authored along ${st[0].x}, ${st[1].x}`);
    if (Math.abs(st[0].z) > 0.5 || Math.abs(st[1].z) > 0.5) fail(`authored tower stands off the deck: ${st[0].z}, ${st[1].z}`);
  }
  // ── A SUSPENSION BRIDGE: THE CABLE SAGS A TENTH OF THE SPAN AND HANGERS MEET THE DECK ──
  {
    const spec = specFor({ 'bridge:structure': 'suspension' }, 'cable', 1200);
    spec.stationFractions = [0.25, 0.75];
    const ways = [deck(1200, 50)];
    const m = buildBridgeForms(ways, spec, flat);
    if (m.towers !== 2) fail(`suspension towers ${m.towers}`);
    if (m.hangers < 30) fail(`hangers ${m.hangers}`);
    // Towers 600 m apart, 66 m over the deck (0.11 × 600); the cable's low
    // point is 60 m under the tops: well over the deck, well under the tops.
    const top = yMax(m.pos);
    if (Math.abs(top - 116) > 3) fail(`suspension tower top ${top}`);
  }
  // ── A THROUGH ARCH: RIBS OVER THE DECK, HANGERS DOWN TO IT ──
  {
    const spec = specFor({ 'bridge:structure': 'arch' }, 'arch', 500);
    const ways = [deck(500, 40)];
    const m = buildBridgeForms(ways, spec, flat);
    if (!m.ribs) fail('no ribs');
    if (!m.hangers) fail('no hangers');
    // The arch spans the middle 60 % (300 m) with a rise of 0.24: crown 72 m over the deck.
    if (Math.abs(yMax(m.pos) - (40 + 2 + 72)) > 3) fail(`arch crown ${yMax(m.pos)}`);
  }
  // ── A DECK ARCH: RIB UNDER THE DECK, ON FOOTINGS ──
  {
    const spec = specFor({ 'bridge:structure': 'arch' }, 'arch', 90);
    if (spec.arch !== 'deck') fail('a short arch is a deck arch');
    const ways = [deck(90, 30, 0, 8, 6)];
    const m = buildBridgeForms(ways, spec, flat);
    if (!m.ribs) fail('no deck-arch ribs');
    if (yMax(m.pos) > 31) fail(`deck arch rises over the deck: ${yMax(m.pos)}`);
    if (yMin(m.pos) > 0) fail(`deck arch footing above the ground: ${yMin(m.pos)}`);
  }
  // ── A TRUSS: PANELS ALONG THE WAY, NOTHING TALLER THAN THE LATTICE ──
  {
    const spec = specFor({ 'bridge:structure': 'truss' }, 'beam', 200);
    const ways = [deck(200, 25, 0, 10)];
    const m = buildBridgeForms(ways, spec, flat);
    if (m.panels < 10) fail(`panels ${m.panels}`);
    const D = Math.max(4.5, Math.min(11, 10 * 0.55));
    if (yMax(m.pos) > 25 + D + 1) fail(`truss taller than its depth: ${yMax(m.pos)}`);
  }
  // ── A BASCULE: TWO TOWERS AND THE WALKWAY BETWEEN THEM ──
  {
    const spec = specFor({ 'bridge:movable': 'bascule' }, 'beam', 240);
    if (spec.form !== 'bascule') fail('bascule tag');
    const m = buildBridgeForms([deck(240, 10, 0, 14, 8)], spec, flat);
    if (m.towers !== 2) fail(`bascule towers ${m.towers}`);
  }
  // ── END PYLONS FLANK THE DECK AT BOTH ENDS OF THE SPAN ──
  {
    const spec: BridgeFormSpec = { ...specFor({ 'bridge:structure': 'arch' }, 'arch', 500), ends: 'pylons' };
    const m = buildBridgeForms([deck(500, 40)], spec, flat);
    if (m.towers !== 4) fail(`end pylons ${m.towers}`);
  }
  // ── THE ARRAYS AGREE ──
  {
    const m = buildBridgeForms([deck(900, 60)], specFor({ 'bridge:structure': 'cable-stayed' }, 'cable', 900), flat);
    if (m.pos.length / 3 !== m.uv.length / 2 || m.pos.length !== m.col.length) fail('attribute lengths disagree');
    if (m.pos.length / 3 !== m.quads * 6) fail(`${m.quads} quads, ${m.pos.length / 3} vertices`);
    for (const v of m.pos) if (!Number.isFinite(v)) fail('a NaN in the geometry');
  }
}
