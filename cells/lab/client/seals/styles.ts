/**
 * The seals' hyperparameters: one style per suit, and the schema the page builds its controls
 * from. A style is the family a seal belongs to; a seed picks one seal out of it (see
 * `sample` in seal.ts: every numeric key marked `vary` wanders by up to a quarter of its range
 * times `variance`).
 *
 * Two families, read off the reference seals:
 * - **filigree** (hearts, spades): lens arcs sweeping through the hub, a hexagram, fans of rays
 *   on the diagonals, curled scrolls, crescents on the axes; hearts carry a red wash.
 * - **lattice** (clubs, diamonds): an inscribed square with its edges run out to the rim, tick
 *   scales between the nodes, ringed motifs on the diagonals, cardinal nodes standing proud of
 *   the rim with dots beyond.
 */
export type Motif = 'heart' | 'diamond' | 'trefoil' | 'spade' | 'star';
export type Band = 'none' | 'scale' | 'rays';
export type Where = 'axes' | 'diagonals' | 'both';
export type Orient = 'radial' | 'tangent' | 'up' | 'free';
export type Border = 'none' | 'frame' | 'corners' | 'both';
export type Fade = 'outer' | 'inner' | 'edge' | 'deep';
export type Arrow = 'barb' | 'dart' | 'open' | 'fleur';

export interface Style {
  name: string;
  // ink
  ink: string;
  paper: string;
  wash: string;
  /** 0 none … 1 a heavy watercolour wash behind the lines */
  washAmount: number;
  /** the ground's base line weight (seal units: the rim is radius 50) */
  weight: number;
  /** the ground's opacity under the junction */
  faint: number;
  /** how much heavier the emphasised strokes are (rims, outer rules, node and medallion rings,
   *  the hub): 0 hairline like the detail, 1 bold */
  accent: number;
  // the rim
  /** rotational symmetry of the ground: 4, 8 or 12 (always keeps the four axes) */
  fold: number;
  rings: number;
  ringGap: number;
  /** a ring of beads inside the rim: 0 none … 1 close-set */
  beads: number;
  beadR: number;
  /** how far the four cardinal nodes stand out past the rim (0: on it) */
  nodeOut: number;
  /** dots running on outward from each cardinal node */
  nodeDots: number;
  /** small rings where the diagonals meet the bead ring */
  diagNodes: boolean;
  // the band between rim and lattice
  band: Band;
  bandDensity: number;
  bandLen: number;
  /** how ragged the scale's ticks are (0 a ruler, 1 a seismograph) */
  bandRough: number;
  /** how much of each sector the band fills */
  bandSpan: number;
  // the lattice
  /** a star polygon {star/starSkip}: 6/2 a hexagram, 4/1 a square, 8/3 an octagram; 0 none */
  star: number;
  starSkip: number;
  starR: number;
  starRot: number;
  /** each edge run on past its vertices, as a fraction of its length (clipped at the band) */
  starExtend: number;
  /** a second, smaller star turned half a step, as a fraction of the first (0 none) */
  star2R: number;
  /** draw the lines inside the band (spokes, star, orbit, arcs, petals): off leaves the fill
   *  the whole interior */
  lines: boolean;
  /** the card's number as pips round the inner orbit (an Ace one, a ten ten), as the game's
   *  dials have it */
  rankMarks: boolean;
  /** the inner star takes the card's number of points (from 5 up; below, the suit's own star) */
  rankStar: boolean;
  /** spokes from the hub to the band: 0, 4 (the axes) or 8 (and the diagonals) */
  spokes: number;
  // petals: circles round the hub, overlapping into lenses
  petals: number;
  petalR: number;
  /** centre distance as a fraction of the radius (1: every petal passes through the centre) */
  petalOffset: number;
  /** great arcs: circles larger than the lattice, centred out along the axes, sweeping through
   *  the hub as lenses (0, 2 east–west, 4) */
  lenses: number;
  lensR: number;
  /** centre distance as a fraction of lensR */
  lensOffset: number;
  // ornament
  motif: Motif;
  motifAt: Where;
  motifR: number;
  motifSize: number;
  /** the motif in a ring of its own */
  motifRoundel: boolean;
  motifFill: boolean;
  /** crescents: 0 none, 1 east and west, 2 all four axes */
  crescents: number;
  crescentR: number;
  /** beads strung along the spokes: 0 … 1 */
  dots: number;
  hubR: number;
  // the fill: discs packed evenly into the free space, one ornament each
  /** largest and smallest disc, and the space kept between discs */
  packMax: number;
  packMin: number;
  packGap: number;
  /** the space kept off the seal's lines */
  packEdge: number;
  /** candidates per disc: 1 random (clumps and holes) … 40 largest-first (even) */
  packTries: number;
  /** discs smaller than their space by up to this share (variety) */
  packJitter: number;
  /** a disc this close to a mirror (as a share of packMax) goes on it */
  snap: number;
  /** tiny dots in what is left: 0 none … 1 dense */
  stipple: number;
  /** the fill thins out (wider spacing, smaller ornament) away from where it is densest: the
   *  outer side (rims, a card's corners), the inner, every edge, or the deepest part; 0 even */
  fade: number;
  fadeFrom: Fade;
  /** the vocabulary's weights */
  oDot: number;
  oSparkle: number;
  oMotif: number;
  oRosette: number;
  oRoundel: number;
  oScroll: number;
  oStar: number;
  oEye: number;
  oCrescent: number;
  /** ornaments point out from the centre, along it, upright, or each its own way */
  orient: Orient;
  /** lace between neighbours: the share linked, and how much each link bows */
  links: number;
  linkBend: number;
  // safe zones
  /** space kept round the faces and the labels */
  zoneMargin: number;
  /** close the zones' gaps with a pass of smaller, unsymmetric discs */
  refill: boolean;
  /** medallions at a shape's nodes (on the rays `motifAt` names), as a share of their room: 0 none */
  medal: number;
  // the card's border
  border: Border;
  /** sparse (a double rule, rails and chains of punctuation) … dense (more rules, open corner
   *  medallions with rays, an arched window, pendants, a cartouche) */
  bDensity: number;
  /** rules at the sparse end (the density adds up to two) */
  bRules: number;
  /** the crest at the top: a compass star in a ring, or a target; and its size */
  bCrest: 'compass' | 'target';
  bCrestSize: number;
  /** the glyph in each corner, and the corners' size */
  bCorner: 'star' | 'crescent' | 'motif' | 'ring';
  bCornerSize: number;
  // the junction, drawn over the ground
  jWeight: number;
  /** the heads on the exits and the stay loop: barbed, a slim dart, an open chevron, or barbed
   *  with a lozenge behind; and their size */
  arrow: Arrow;
  arrowSize: number;
  /** how much a line's weight says its chance: 0 every line alike, 1 a one-in-six line a
   *  hairline beside a five-in-six one */
  probWeight: number;
  /** each direction's faces as one label ("4–6"), not a roundel apiece */
  faceGroups: boolean;
  roundelR: number;
  /** where the face roundels sit, from the centre */
  faceR: number;
  /** how far a seed moves the numbers (0: every seed the same seal) */
  variance: number;
}

const filigree: Omit<Style, 'name' | 'ink' | 'wash' | 'washAmount' | 'motif' | 'motifAt'> = {
  paper: '#f7f0e3', weight: 0.5, faint: 0.9, accent: 0.2,
  fold: 4, rings: 3, ringGap: 1.5, beads: 0.6, beadR: 0.42, nodeOut: 0, nodeDots: 0, diagNodes: true,
  band: 'rays', bandDensity: 1.6, bandLen: 11, bandRough: 0.6, bandSpan: 0.7,
  lines: true, rankMarks: true, rankStar: true, star: 6, starSkip: 2, starR: 31, starRot: 0, starExtend: 0.35, star2R: 0, spokes: 4,
  petals: 0, petalR: 24, petalOffset: 0.85, lenses: 2, lensR: 40, lensOffset: 0.72,
  motifR: 29, motifSize: 3.4, motifRoundel: false, motifFill: false,
  crescents: 1, crescentR: 19, dots: 0.3, hubR: 11.5,
  packMax: 5, packMin: 0.55, packGap: 0.5, packEdge: 0.35, packTries: 30, packJitter: 0.3, snap: 0.5, zoneMargin: 1.4, refill: true, medal: 1, fade: 0.3, fadeFrom: 'outer', bDensity: 0.2, bRules: 2, bCrest: 'compass', bCrestSize: 1, bCorner: 'star', bCornerSize: 1, stipple: 0.25,
  oDot: 0.35, oSparkle: 0.5, oMotif: 0.35, oRosette: 0.3, oRoundel: 0.1, oScroll: 0.9, oStar: 0.1, oEye: 0.25, oCrescent: 0.1, orient: 'radial', links: 0.5, linkBend: 0.6, border: 'frame',
  jWeight: 1.2, arrow: 'barb', arrowSize: 1, probWeight: 0.8, faceGroups: true, roundelR: 5.2, faceR: 28.5, variance: 0.5,
};
const lattice: Omit<Style, 'name' | 'ink' | 'wash' | 'washAmount' | 'motif' | 'motifAt'> = {
  paper: '#f7f0e3', weight: 0.5, faint: 0.9, accent: 0.2,
  fold: 4, rings: 2, ringGap: 1.6, beads: 0.85, beadR: 0.34, nodeOut: 4, nodeDots: 2, diagNodes: true,
  band: 'scale', bandDensity: 2, bandLen: 7, bandRough: 0.8, bandSpan: 0.85,
  lines: true, rankMarks: true, rankStar: true, star: 4, starSkip: 1, starR: 33, starRot: 45, starExtend: 0.8, star2R: 0, spokes: 8,
  petals: 4, petalR: 16, petalOffset: 1.1, lenses: 0, lensR: 40, lensOffset: 0.72,
  motifR: 26, motifSize: 3.2, motifRoundel: true, motifFill: false,
  crescents: 0, crescentR: 19, dots: 0.4, hubR: 12,
  packMax: 5.5, packMin: 0.6, packGap: 0.5, packEdge: 0.35, packTries: 30, packJitter: 0.3, snap: 0.5, zoneMargin: 1.4, refill: true, medal: 1, fade: 0.3, fadeFrom: 'outer', bDensity: 0.2, bRules: 2, bCrest: 'compass', bCrestSize: 1, bCorner: 'star', bCornerSize: 1, stipple: 0.15,
  oDot: 0.5, oSparkle: 0.3, oMotif: 0.5, oRosette: 0.6, oRoundel: 0.7, oScroll: 0, oStar: 0.35, oEye: 0.1, oCrescent: 0, orient: 'up', links: 0.2, linkBend: 0.2, border: 'frame',
  jWeight: 1.2, arrow: 'barb', arrowSize: 1, probWeight: 0.8, faceGroups: true, roundelR: 5.2, faceR: 28.5, variance: 0.5,
};

/** by suit: hearts, diamonds, clubs, spades (the game's order) */
export const SUIT_STYLES: Style[] = [
  { ...filigree, name: 'hearts', ink: '#7a1b16', wash: '#d8301f', washAmount: 0.5, motif: 'heart', motifAt: 'diagonals', bCrest: 'target' },
  { ...lattice, name: 'diamonds', ink: '#3e2715', wash: '#b8742c', washAmount: 0, motif: 'diamond', motifAt: 'both', arrow: 'dart', bandDensity: 1.5, petalR: 18, oStar: 0.8, oSparkle: 0.7, oRosette: 0.2, orient: 'radial', stipple: 0.35 },
  { ...lattice, name: 'clubs', ink: '#46461a', wash: '#7c8a2a', washAmount: 0, motif: 'trefoil', motifAt: 'diagonals', bRules: 3 },
  { ...filigree, name: 'spades', ink: '#1f2c6c', wash: '#3550b0', washAmount: 0, motif: 'spade', motifAt: 'axes', rings: 4, beads: 0.8, bandLen: 12, bandDensity: 2, starR: 33, petalR: 28, lenses: 4, lensR: 42, motifR: 40, motifSize: 2.6, crescents: 2, dots: 0.4, packMax: 4.5, arrow: 'fleur', oScroll: 1, oCrescent: 0.25, oEye: 0.35, links: 0.65, stipple: 0.35, border: 'frame', bCrest: 'target', bCorner: 'crescent' },
];

export interface Control {
  key: keyof Style;
  label: string;
  group: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<string | number>;
  kind: 'num' | 'enum' | 'bool' | 'color';
  /** a seed moves it (by up to a quarter of its range × variance) */
  vary?: boolean;
}
const n = (key: keyof Style, label: string, group: string, min: number, max: number, step: number, vary = false): Control => ({ key, label, group, min, max, step, kind: 'num', vary });
const e = (key: keyof Style, label: string, group: string, options: Array<string | number>): Control => ({ key, label, group, options, kind: 'enum' });
const b = (key: keyof Style, label: string, group: string): Control => ({ key, label, group, kind: 'bool' });
const c = (key: keyof Style, label: string, group: string): Control => ({ key, label, group, kind: 'color' });

export const SCHEMA: Control[] = [
  c('ink', 'ink', 'Ink'), c('paper', 'paper', 'Ink'), c('wash', 'wash', 'Ink'),
  n('washAmount', 'wash amount', 'Ink', 0, 1, 0.05), n('weight', 'line weight', 'Ink', 0.15, 1, 0.01), n('faint', 'ground opacity', 'Ink', 0.2, 1, 0.05), n('accent', 'bold accents', 'Ink', 0, 1, 0.05),
  n('variance', 'seed variance', 'Ink', 0, 1, 0.05),
  e('fold', 'symmetry', 'Rim', [4, 8, 12]), n('rings', 'rings', 'Rim', 1, 6, 1), n('ringGap', 'ring gap', 'Rim', 0.8, 3, 0.1, true),
  n('beads', 'beads', 'Rim', 0, 1, 0.05, true), n('beadR', 'bead size', 'Rim', 0.2, 0.9, 0.02),
  n('nodeOut', 'nodes out', 'Rim', 0, 8, 0.5), n('nodeDots', 'node dots', 'Rim', 0, 4, 1), b('diagNodes', 'diagonal nodes', 'Rim'),
  e('band', 'band', 'Band', ['none', 'scale', 'rays']), n('bandDensity', 'density', 'Band', 0.3, 2.5, 0.05, true), n('bandLen', 'length', 'Band', 2, 12, 0.5, true),
  n('bandRough', 'roughness', 'Band', 0, 1, 0.05, true), n('bandSpan', 'span', 'Band', 0.15, 1, 0.05, true),
  b('lines', 'inner lines', 'Lattice'), b('rankMarks', 'number as pips', 'Lattice'), b('rankStar', 'star from number', 'Lattice'), e('star', 'star points', 'Lattice', [0, 4, 5, 6, 8, 12]), n('starSkip', 'star skip', 'Lattice', 1, 5, 1), n('starR', 'star radius', 'Lattice', 15, 40, 0.5, true),
  n('starRot', 'star turn', 'Lattice', 0, 90, 7.5), n('starExtend', 'edges run on', 'Lattice', 0, 1.5, 0.05, true), n('star2R', 'inner star', 'Lattice', 0, 0.95, 0.05, true),
  e('spokes', 'spokes', 'Lattice', [0, 4, 8]),
  e('petals', 'petals', 'Petals', [0, 3, 4, 6, 8]), n('petalR', 'petal radius', 'Petals', 6, 36, 0.5, true), n('petalOffset', 'petal offset', 'Petals', 0.3, 1.4, 0.05, true),
  e('motif', 'motif', 'Ornament', ['heart', 'diamond', 'trefoil', 'spade', 'star']), e('motifAt', 'motif at', 'Ornament', ['axes', 'diagonals', 'both']),
  n('motifR', 'motif radius', 'Ornament', 14, 44, 0.5, true), n('motifSize', 'motif size', 'Ornament', 1, 5, 0.1, true), b('motifRoundel', 'motif ringed', 'Ornament'), b('motifFill', 'motif filled', 'Ornament'),
  e('crescents', 'crescents', 'Ornament', [0, 1, 2]), n('crescentR', 'crescent radius', 'Ornament', 10, 40, 0.5, true),
  n('dots', 'spoke beads', 'Ornament', 0, 1, 0.05, true), n('hubR', 'hub radius', 'Ornament', 7, 16, 0.25),
  n('packMax', 'largest', 'Fill', 1.5, 12, 0.25, true), n('packMin', 'smallest', 'Fill', 0.3, 4, 0.05, true), n('packGap', 'gap', 'Fill', 0, 3, 0.05, true),
  n('packEdge', 'off the lines', 'Fill', 0, 3, 0.05), n('packTries', 'evenness (tries)', 'Fill', 1, 60, 1), n('packJitter', 'size variety', 'Fill', 0, 0.9, 0.05, true),
  n('snap', 'snap to mirrors', 'Fill', 0, 1, 0.05), n('fade', 'fade', 'Fill', 0, 1, 0.05, true), e('fadeFrom', 'dense at', 'Fill', ['outer', 'inner', 'edge', 'deep']), n('stipple', 'stipple', 'Fill', 0, 1, 0.05, true),
  n('oDot', 'dots', 'Vocabulary', 0, 1, 0.05), n('oSparkle', 'sparkles', 'Vocabulary', 0, 1, 0.05), n('oMotif', 'suit motif', 'Vocabulary', 0, 1, 0.05),
  n('oRosette', 'rosettes', 'Vocabulary', 0, 1, 0.05), n('oRoundel', 'roundels', 'Vocabulary', 0, 1, 0.05), n('oScroll', 'scrolls', 'Vocabulary', 0, 1, 0.05),
  n('oStar', 'star polygons', 'Vocabulary', 0, 1, 0.05), n('oEye', 'eyes', 'Vocabulary', 0, 1, 0.05), n('oCrescent', 'crescents', 'Vocabulary', 0, 1, 0.05),
  e('orient', 'orientation', 'Vocabulary', ['radial', 'tangent', 'up', 'free']), n('links', 'lace', 'Vocabulary', 0, 1, 0.05, true), n('linkBend', 'lace bow', 'Vocabulary', 0, 1, 0.05),
  n('medal', 'medallions', 'Zones', 0, 1.5, 0.05, true), n('zoneMargin', 'zone margin', 'Zones', 0, 5, 0.1), b('refill', 'refill round zones', 'Zones'),
  e('border', 'card border', 'Border', ['none', 'frame', 'corners']), n('bDensity', 'sparse … dense', 'Border', 0, 1, 0.05), n('bRules', 'rules', 'Border', 1, 3, 1), e('bCrest', 'crest', 'Border', ['compass', 'target']), n('bCrestSize', 'crest size', 'Border', 0.5, 1.6, 0.05), e('bCorner', 'corner glyph', 'Border', ['star', 'crescent', 'motif', 'ring']), n('bCornerSize', 'corner size', 'Border', 0.5, 1.6, 0.05),
  n('jWeight', 'junction weight', 'Junction', 0.5, 1.8, 0.05), e('arrow', 'arrow heads', 'Junction', ['barb', 'dart', 'open', 'fleur']), n('arrowSize', 'arrow size', 'Junction', 0.5, 1.6, 0.05), n('probWeight', 'weight by chance', 'Junction', 0, 1, 0.05), b('faceGroups', 'group faces (4–6)', 'Junction'), n('roundelR', 'roundel size', 'Junction', 3, 6.5, 0.1), n('faceR', 'roundel radius', 'Junction', 20, 34, 0.5),
];
