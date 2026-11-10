/**
 * Splats' views: the pictures its README (static/splats.md) is written around, in the order the experiment went.
 * Made with `node cells/lab/views.mjs splats`; each is `static/splats/v-<name>.jpg`. (Boards that put several pages
 * side by side, and pictures from outside the page (the reference studies, the restyled wireframes), are kept beside
 * them as `static/splats/b-<name>.jpg`, made by the devtools named in their captions.)
 */
export const ready = '__splats';
const LAND = { width: 720, height: 480 }, PHONE = { width: 390, height: 760 };
const REF_YAW = 0.6 + Math.PI;
export const helpers = (page, v) => ({
  /** the camera at an orbit (yaw, pitch), the page's framing kept */
  at: async (yaw, pitch) => { await v.eval(([y, p]) => window.__splats.stone.at(y, p), [yaw, pitch]); await v.wait(2500); },
  /** the stone close: its middle, nearer than the page frames it */
  close: async (yaw, pitch) => { await v.eval(([y, p]) => window.__splats.camera({ yaw: y, pitch: p, dist: 2.5, target: [0, 0.35, 0] }), [yaw, pitch]); await v.wait(2500); },
});
export const views = [
  // ─── what a splat is ───
  { name: 'garden', group: 'Splats', title: 'A made scene', caption: 'the procedural garden: 120,000 Gaussians, each a centre, a shape, a colour and an opacity, sorted and blended', query: 'scene=garden&clean', size: LAND, settle: 5000 },
  { name: 'plush', group: 'Splats', title: 'A captured scene', caption: 'a phone capture (plush.splat), as captured: the kind of scene splats exist for', query: 'scene=plush&clean', size: LAND, settle: 15000 },
  // ─── one stone ───
  { name: 'stone', group: 'One stone', title: 'One stone, in wash', caption: 'the One Stone study from its designed side: the seam and its wedge, the lip and the shadow under it, washes on the shaded faces, drawn by the brush', query: 'scene=stone&look=wash&clean&view=reverse', size: LAND, settle: 5000, run: async (v) => { await v.close(0.6 + Math.PI, 0.3); } },
  { name: 'stone-dry', group: 'One stone', title: 'One stone, dry brush', caption: 'the same stone in the dry look: hatching in place of wash', query: 'scene=stone&look=dry&clean&view=reverse', size: LAND, settle: 5000, run: async (v) => { await v.close(0.6 + Math.PI, 0.3); } },
  { name: 'stone-sparse', group: 'One stone', title: 'One stone, spare', caption: 'the detail turned down: the marks that rank highest survive (the seam’s hook, the lip, the shadow under it)', query: 'scene=stone&look=wash&clean&view=reverse&detail=0.3', size: LAND, settle: 5000, run: async (v) => { await v.close(0.6 + Math.PI, 0.3); } },
  // ─── brushes, composed ───
  { name: 'brushes', group: 'Brushes and the composed scene', title: 'Shared brushes', caption: 'one brush drawing a stone, an architectural corner, a culm and a free gesture', query: 'scene=brushes&clean', size: LAND, settle: 6000 },
  { name: 'composed', group: 'Brushes and the composed scene', title: 'The composed scene, resolved', caption: 'the stone, three culms and a corner from the reference camera, every mark kept', query: 'scene=composed&clean&detail=1&policy=ranks&look=wash', size: LAND, settle: 8000 },
  { name: 'composed-mid', group: 'Brushes and the composed scene', title: 'Intermediate', caption: 'the same view at intermediate detail, by the marks’ ranks', query: 'scene=composed&clean&detail=0.55&policy=ranks&look=wash', size: LAND, settle: 8000 },
  { name: 'composed-sparse', group: 'Brushes and the composed scene', title: 'Sparse', caption: 'sparse, by the marks’ ranks: broken outlines', query: 'scene=composed&clean&detail=0.25&policy=ranks&look=wash', size: LAND, settle: 8000 },
  { name: 'composed-dry', group: 'Brushes and the composed scene', title: 'In dry brush', caption: 'the composed scene resolved in the dry look', query: 'scene=composed&clean&detail=1&policy=ranks&look=dry', size: LAND, settle: 8000 },
  // ─── the policy ───
  { name: 'policy-rules', group: 'A drawing policy', title: 'Sparse, by the rules', caption: 'the hand-written rules at the sparse budget: structure kept, broken', query: 'scene=composed&clean&detail=0.25&policy=rules&look=wash', size: LAND, settle: 9000 },
  { name: 'policy-learned', group: 'A drawing policy', title: 'Sparse, learned', caption: 'the policy learned from 59 judged pairs, at the same budget: the stone as a mass with its shadow, less outline', query: 'scene=composed&clean&detail=0.25&policy=learned&look=wash', size: LAND, settle: 9000 },
  { name: 'judge', group: 'A drawing policy', title: 'Judging a pair', caption: 'the judging page on a phone: two treatments of one view at one budget; tap the better', query: 'scene=composed&judge&look=wash', size: PHONE, settle: 14000 },
  // ─── the pen ───
  { name: 'pen-word', group: 'The pen', title: 'Autograph’s pen in space', caption: 'Autograph’s hand writing “stone” with the broad pen, on a board and wrapped round a culm, against the brush’s round stroke', query: 'scene=pen&part=word&clean', size: LAND, settle: 6000 },
  { name: 'pen-rock', group: 'The pen', title: 'A Bamboo rock and bank', caption: 'one of Bamboo’s outcrops and the bank rim beside it, drawn only by the brush: edges by the pen, shadowed faces and the bank’s slope in pooled washes', query: 'scene=pen&part=rock&clean', size: LAND, settle: 8000 },
  // ─── bench, mist ───
  { name: 'bench', group: 'The bench and mist', title: 'The bench', caption: 'one stroke made editable: its handles, its pressure, its wash', query: 'scene=bench&clean', size: LAND, settle: 6000 },
  { name: 'mist', group: 'The bench and mist', title: 'Mist', caption: 'a volume of splats lit by a tiny network evaluated per splat in the shader', query: 'scene=mist&clean', size: LAND, settle: 8000 },
  // ─── captured scenes in ink ───
  { name: 'ink-shoe', group: 'Captured scenes in ink', title: 'A shoe drawn by its own splats', caption: 'the shoe capture in ink: every splat paper, outline discs shown only edge-on, dark splats as ranked tone; its long splats hatch the mesh upper', query: 'scene=nike&ink&clean&detail=0.5', size: LAND, settle: 20000 },
  { name: 'ink-plush', group: 'Captured scenes in ink', title: 'The plush in ink', caption: 'the plush capture in ink: it reads, busily (fur is noise at this scale)', query: 'scene=plush&ink&clean&detail=0.4', size: LAND, settle: 20000 },
  // ─── fitted fields ───
  { name: 'field-stone', group: 'Drawings fitted as fields', title: 'The stone, fitted', caption: 'the stone’s drawing fitted as a field: discs whose ink depends on where they’re seen from, on a view it wasn’t fitted to', query: 'scene=field&clean', size: LAND, settle: 6000, run: async (v) => { await v.close(4.8, 0.24); } },
  { name: 'field-stone-flat', group: 'Drawings fitted as fields', title: 'Without view dependence', caption: 'the same discs with one opacity each, from the same view: every edge ghosts across every face', query: 'scene=field&flat&clean', size: LAND, settle: 6000, run: async (v) => { await v.close(4.8, 0.24); } },
  { name: 'field-composed', group: 'Drawings fitted as fields', title: 'The composed scene, fitted', caption: 'the whole composed scene fitted as a field (33,730 discs), from a view it wasn’t fitted to', query: 'scene=field&field=composed&clean', size: LAND, settle: 8000, run: async (v) => { await v.at(REF_YAW + Math.PI / 6, 0.2); } },
  { name: 'field-sumi', group: 'Drawings fitted as fields', title: 'Sumi-e, fitted', caption: 'the field fitted to an image model’s sumi-e restyle of six wireframe views, each disc’s shape fitted with its ink, from the reference view', query: 'scene=field&field=composed-sumi-shape&clean', size: LAND, settle: 8000 },
  { name: 'field-sumi-new', group: 'Drawings fitted as fields', title: 'Sumi-e, from a view no drawing covered', caption: 'the same field halfway between two of the drawn views', query: 'scene=field&field=composed-sumi-shape&clean', size: LAND, settle: 8000, run: async (v) => { await v.at(REF_YAW + 0.22, 0.24); } },
  { name: 'field-sumi-low', group: 'Drawings fitted as fields', title: 'Sumi-e, from low', caption: 'and from low down, also undrawn', query: 'scene=field&field=composed-sumi-shape&clean', size: LAND, settle: 8000, run: async (v) => { await v.at(REF_YAW - 0.2, 0.06); } },
  // ─── marks as organised splats; walking into a wash; the room ───
  { name: 'marks', group: 'Marks as organised splats', title: 'Teacher marks, each drawn by a mark fitted to it', caption: 'nine marks cut from the sparse conservatory studies (roots, sprays, washes, a veil), each drawn by a stroke or wash whose few parameters were fitted to it', query: 'scene=marks&clean', size: LAND, settle: 6000 },
  { name: 'marks-independent', group: 'Marks as organised splats', title: 'The same, every deposit free', caption: 'the same number of deposits, each set free: closer to each picture, and nothing left to pick up', query: 'scene=marks&way=independent&clean', size: LAND, settle: 6000 },
  { name: 'marks-style', group: 'Marks as organised splats', title: 'A style put on other spines', caption: 'the held-out marks drawn in the style learnt from another (only their pose fitted); the rest as fitted', query: 'scene=marks&way=style&clean', size: LAND, settle: 6000 },
  { name: 'marks-bent', group: 'Marks as organised splats', title: 'A fitted mark, bent', caption: 'a fitted root picked up by a point of its spine and bent: its deposits come with it', query: 'scene=marks&only=root-a&clean', size: LAND, settle: 6000, run: async (v) => { await v.eval(() => { const m = window.__splats.marks; m.select(0); const c = m.state.marks[0].ctrl[3]; m.drag(3, [c[0], c[1] + 0.07, c[2]]); }); await v.wait(2500); } },
  { name: 'walk-far', group: 'Walking into a wash', title: 'A canopy from 12 m', caption: 'one canopy patch from 12 m: a wash of fifty deposits', query: 'scene=walk&d=12&clean', size: LAND, settle: 6000 },
  { name: 'walk-mid', group: 'Walking into a wash', title: 'From 5 m', caption: 'from 5 m: the wash giving way to its fronds', query: 'scene=walk&d=5&clean', size: LAND, settle: 6000 },
  { name: 'walk-in', group: 'Walking into a wash', title: 'Inside it', caption: 'from 1.5 m, under it: strands and their leaves, a few deposits a leaf', query: 'scene=walk&d=1.5&clean', size: LAND, settle: 6000 },
  { name: 'room-tunnel', group: 'The room', title: 'The root tunnel', caption: 'the boardwalk under the willow’s roots, as taught from three drawn views: every mark a stroke or a wash, no outline pass', query: 'scene=room&view=tunnel&clean', size: LAND, settle: 9000 },
  { name: 'room-pool', group: 'The room', title: 'The open pool', caption: 'stepping stones, the willow, and a gesture on the air that stands on nothing; still water', query: 'scene=room&view=pool&clean', size: LAND, settle: 9000 },
  { name: 'room-canopy', group: 'The room', title: 'The canopy', caption: 'the deck under hanging fronds, looking back across the water', query: 'scene=room&view=canopy&clean', size: LAND, settle: 9000 },
  { name: 'room-reserved', group: 'The room', title: 'A reserved view, as taught', caption: 'between the pool and the canopy: a view the room was never fitted to, drawn as taught from the three it was', query: 'scene=room&view=between%20pool%20and%20canopy&clean', size: LAND, settle: 9000 },
  { name: 'limb-parts', group: 'One limb, three ways', title: 'A limb in parts', caption: 'the root tunnel’s third arch as the room draws it: a line along each edge and a graded stroke between', query: 'scene=limb&way=parts&d=5.5&clean', size: LAND, settle: 6000 },
  { name: 'limb-sweep', group: 'One limb, three ways', title: 'The same limb as one sweep', caption: 'the same deposits as one pass of a loaded brush: its pressure sets its width, its coverage and how far its ink spreads together', query: 'scene=limb&way=sweep&d=5.5&clean', size: LAND, settle: 6000 },
  { name: 'limb-accents', group: 'One limb, three ways', title: 'The sweep with accents', caption: 'the sweep, with stretches of a line along one edge or the other, each there or not on its own', query: 'scene=limb&way=accents&d=5.5&clean', size: LAND, settle: 6000 },
];
