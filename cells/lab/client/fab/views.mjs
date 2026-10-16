/**
 * Fab's views: the pictures its README (static/fab.md) is written around, each made by driving the page as a child
 * would. Made with `node cells/lab/views.mjs fab` (see views.mjs there); each is `static/fab/v-<name>.jpg`.
 *
 * A view's a fresh page at its query; `run` drives it and takes the shot when it's worth taking (mid-gesture, for a
 * gesture). The verbs here are the paper's: where a point of its sheet is on the screen, the piece's bounds on the
 * sheet, the hand's handles, picking up a tool.
 */
export const ready = '__fab';

/** a skirt as it is on the figure: four panels of lawn, the block as drafted (nothing done to it yet) */
const BLOCK = 'settle=30&len=34&panels=4&grain=0&fabric=lawn&print=1&colour=0&m=';
const TABLE = `at=table&${BLOCK}`;
/** a midi circle, bias cut: the darts closed into flare and the hem slashed open, in one piece */
const CIRCLE = 'settle=60&len=44&panels=1&grain=45&fabric=silk&print=1&colour=0&cut=flare&full=3.8';

export const helpers = (page, v) => {
  const h = {
    /** a point of the paper's sheet (its pixels) on the screen */
    S: (x, y) => page.evaluate(([a, b]) => window.__fab.sheetToScreen(a, b), [x, y]),
    /** a point in the room on the screen */
    at: (q) => page.evaluate((q) => window.__fab.roomToScreen(q), q),
    /** the piece's extent on the sheet */
    bounds: () => page.evaluate(() => window.__fab.paper.bounds()),
    /** where the hand's handles are on the sheet: the hem's tab, the grain arrow's knob, each dart's badge */
    marks: () => page.evaluate(() => window.__fab.paper.marks),
    /** pick up a tool from the palette */
    tool: async (t) => { await page.click(`.tool[data-tool="${t}"]`); await page.waitForTimeout(600); },
    /** the hem (or the waist) at a fraction across the piece, on the screen */
    edge: async (which, f = 0.5, inset = 4) => { const b = await h.bounds(); return h.S(b.x0 + (b.x1 - b.x0) * f, which === 'hem' ? b.y1 - inset : b.y0 + inset + 2); },
    /** the camera's had time to settle on the piece */
    still: () => v.wait(1800),
  };
  return h;
};

export const views = [
  // ─── the room ───
  { name: 'rails', group: 'The room', title: 'The rails', caption: 'a rail per person; slide along, tap the front one to put it on', query: 'rails&warm', settle: 3500 },
  { name: 'figure', group: 'The room', title: 'The figure', caption: 'cloth and print in the drawer; the pattern pinned up, bottom right', query: CIRCLE },
  { name: 'drawer-closed', group: 'The drawer', title: 'Closed', caption: 'its handle, and what\'s chosen in a line', query: `${CIRCLE}&drawer=closed` },
  {
    name: 'drawer-drag', group: 'The drawer', title: 'Drawn up', caption: 'the drawer follows the finger: what\'s below comes into view before it\'s let go', query: CIRCLE,
    run: async (v) => { const g = await (await v.page.$('#grip')).boundingBox(), x = g.x + g.width / 2, y = g.y + 8; await v.drag([x, y], [x, y - 130], { at: v.shot }); },
  },
  { name: 'custom-fabric', group: 'The drawer', title: 'Your own cloth', caption: 'expanded: the swatch\'s measured qualities, dial by dial; the skirt settles again', query: `${CIRCLE}&drawer=full&sec=fabric` },
  { name: 'custom-print', group: 'The drawer', title: 'Your own print', caption: 'how big it\'s printed', query: `${CIRCLE}&drawer=full&sec=print&own=${encodeURIComponent(JSON.stringify({ s: 2.2 }))}` },
  { name: 'custom-colour', group: 'The drawer', title: 'Your own palette', caption: 'its three inks, each picked', query: `${CIRCLE}&drawer=full&sec=colour&own=${encodeURIComponent(JSON.stringify({ i: ['#f6c9cf', '#2f6f9f', '#fff4e2'] }))}` },
  { name: 'table-full', group: 'The drawer', title: 'The table\'s, expanded', caption: 'the tool\'s gestures and what it\'s set to, under its history', query: `${TABLE}&drawer=full` },
  { name: 'figure-turned', group: 'The room', title: 'Turned round', caption: 'the cutting table behind it: tap it to go there', query: CIRCLE, run: async (v) => { await v.eval(() => { window.__fab.view.az = 0.9; }); await v.wait(600); } },
  { name: 'table', group: 'The room', title: 'The cutting table', caption: 'the pattern at true size, the figure across the room', query: TABLE },
  { name: 'table-up', group: 'The room', title: 'Looking up from the table', caption: 'drag (or pinch) off the piece to look up at the figure', query: TABLE, run: async (v) => { await v.page.mouse.move(200, 600); await v.page.mouse.wheel(0, 1000); await v.wait(2500); } },
  { name: 'sheet', group: 'The room', title: 'The whole pattern', caption: 'every piece, its grain, how much cloth, its checks', query: `${CIRCLE}&sheet` },

  // ─── the room's layout ───
  ...[
    ['room-plan', 'From above', 'the rails at the top, the figure on its rug, the cutting table below it; the back wall and its windows down the right, the window light across the floor', { az: Math.PI / 2, el: 1.45, dist: 2100, target: [-260, 0, 180] }],
    ['room-wide', 'The room', 'from the corner: the window light falling across the floor, the stool and the plant by the figure, the bolts of cloth behind the table', { az: 0.55, el: 0.3, dist: 760, target: [-40, 70, 120] }],
    ['room-along', 'Along the rails', 'down the room past the rails to the figure and the table', { az: -1.15, el: 0.18, dist: 900, target: [-260, 90, 60] }],
  ].map(([name, title, caption, view]) => ({
    name, group: 'The room', title, caption, query: `${CIRCLE}&drawer=closed`,
    run: async (v) => { await v.eval((w) => { Object.assign(window.__fab.view, w, { target: w.target }); }, view); await v.wait(900); },
  })),

  // ─── the hand ───
  { name: 'hand', group: 'The hand', title: 'The hand', caption: 'the hem lit, its tab; the grain arrow\'s knob; a badge on the dart', query: TABLE },
  {
    name: 'hand-hem', group: 'The hand', title: 'Dragging the hem', caption: 'how long, by the finger', query: TABLE,
    run: async (v) => { await v.still(); const m = await v.marks(), a = await v.S(...m.hem); await v.drag(a, [a[0], a[1] + 45], { at: v.shot }); },
  },
  {
    name: 'hand-grain', group: 'The hand', title: 'Turning the grain', caption: 'the knob follows the finger, straight to bias', query: TABLE,
    run: async (v) => { await v.still(); const m = await v.marks(), a = await v.S(...m.knob); await v.drag(a, [a[0] + 40, a[1] - 6], { at: v.shot }); },
  },
  {
    name: 'hand-dart', group: 'The hand', title: 'A dart, tapped', caption: 'closed into flare: the badge goes rose', query: TABLE,
    run: async (v) => { await v.still(); const m = await v.marks(); await v.tap(await v.S(...m.darts[0])); await v.still(); },
  },

  // ─── slash, fold, gather ───
  { name: 'slash', group: 'Slash', title: 'Scissors in hand', caption: 'the hem lit: where a slash starts', query: TABLE, run: async (v) => { await v.tool('scissors'); await v.still(); } },
  {
    name: 'slash-touch', group: 'Slash', title: 'Touched', caption: 'a ghost of the cut, hem to waist, before it opens', query: TABLE,
    run: async (v) => { await v.tool('scissors'); await v.still(); const a = await v.edge('hem', 0.4); await v.drag(a, [a[0] + 2, a[1]], { steps: 1, at: v.shot }); },
  },
  {
    name: 'slash-open', group: 'Slash', title: 'Spread open', caption: 'the wedge of new cloth, how much by the finger', query: TABLE,
    run: async (v) => { await v.tool('scissors'); await v.still(); const a = await v.edge('hem', 0.4); await v.drag(a, [a[0] + 70, a[1]], { at: v.shot }); },
  },
  {
    name: 'slash-made', group: 'Slash', title: 'Slashed', caption: 'its hinge ringed, an arrow across the opening; the figure flares', query: TABLE,
    run: async (v) => { await v.tool('scissors'); await v.still(); const a = await v.edge('hem', 0.4); await v.drag(a, [a[0] + 90, a[1]]); await v.still(); },
  },
  {
    name: 'fold', group: 'Fold', title: 'Folding a pleat', caption: 'the waist lit; how much is folded in, by the finger', query: TABLE,
    run: async (v) => { await v.tool('fold'); await v.still(); const a = await v.edge('waist', 0.6); await v.drag(a, [a[0] + 50, a[1]], { at: v.shot }); },
  },
  {
    name: 'fold-made', group: 'Fold', title: 'A pleat', caption: 'fold line, where it\'s laid, the way it folds, stitched down to a bar', query: TABLE,
    run: async (v) => { await v.tool('fold'); await v.still(); const a = await v.edge('waist', 0.6); await v.drag(a, [a[0] + 60, a[1]]); await v.still(); },
  },
  {
    name: 'gather', group: 'Gather', title: 'Gathering', caption: 'width added at the waist, by the finger', query: TABLE,
    run: async (v) => { await v.tool('thread'); await v.still(); const a = await v.edge('waist', 0.5); await v.drag(a, [a[0] + 50, a[1]], { at: v.shot }); },
  },
  {
    name: 'gather-made', group: 'Gather', title: 'Gathered', caption: 'notched either side, a running stitch, drawn in', query: TABLE,
    run: async (v) => { await v.tool('thread'); await v.still(); const a = await v.edge('waist', 0.5); await v.drag(a, [a[0] + 70, a[1]]); await v.still(); },
  },

  // ─── the cloth on the paper ───
  { name: 'cloth', group: 'Cloth', title: 'The cloth on the paper', caption: 'off by default; laid on along the grain, as it\'ll be cut', query: `at=table&cloth&${CIRCLE}` },
];
