/**
 * The lab's experiments, as the index shows them: grouped, each live in its card (the experiment
 * itself, in a frame, opened with its `preview` query), a blurb, its README, and its presets (the
 * same experiment opened a particular way: a query string on its page).
 *
 * `page` is the experiment's page under static/ (its script is `{{app}}`, filled with the bundle's
 * hashed path); `readme` is its README (markdown), rendered as a page of its own.
 */
export interface Preset {
  label: string;
  /** the query string it opens with (no `?`) */
  query: string;
}
export interface Experiment {
  id: string;
  title: string;
  group: string;
  blurb: string;
  page: string;
  /** the query its live preview in the index opens with: small and quiet */
  preview: string;
  readme: string;
  presets: Preset[];
}

export const EXPERIMENTS: Experiment[] = [
  {
    id: 'cloudfold', title: 'Cloudfold', group: 'Contemplation',
    blurb: 'Keep folding space and hiding symmetry until cloud happens. An evolving volumetric KIFS cloud: orbit, gather, reveal the folds, and move the light from day through afterglow to storm.',
    page: 'static/cloudfold.html', preview: 'preview&seed=1947', readme: 'static/cloudfold.md',
    presets: [{ label: 'daylight', query: 'seed=1947' }, { label: 'afterglow', query: 'seed=1947&light=dusk' }, { label: 'storm', query: 'seed=819&light=storm&fullness=.8' }, { label: 'reveal the folds', query: 'seed=1947&conceal=0&still' }],
  },
  {
    id: 'blocks', title: 'Blocks', group: 'Play',
    blurb: 'Plain stone blocks on a lattice, set with a finger, and every form comes from how they are put together. Each cell, stone or empty, is read from the cells round it as a few plain quantities (how open each face is, how much rests on it, how far walls close round an empty cell along its level), and two programs fill it with small cubes from those. Ring some ground with walls and it becomes a paved court with a tiled pool, rose beds and cypresses, windows looking onto it and a porch with a tiled door; walls grow cornices, roofs parapets and domes, stacks fluted columns, spans arches. Nothing names any of them. Drawn as a diorama on a slab in the dark.',
    page: 'static/blocks.html', preview: 'preview', readme: 'static/blocks.md',
    presets: [{ label: 'build', query: '' }, { label: 'a courtyard house', query: 'demo=courtyard' }, { label: 'a castle', query: 'demo=castle' }, { label: 'an arcade', query: 'demo=arcade' }, { label: 'an aqueduct', query: 'demo=aqueduct' }, { label: 'standing stones', query: 'demo=stones' }, { label: 'a house', query: 'demo=house' }, { label: 'a harbour', query: 'demo=harbour' }, { label: 'the stuffs', query: 'demo=courtyard&debug=3' }],
  },
  {
    id: 'rescue', title: 'Rescue Race', group: 'Play',
    blurb: 'A game designed by Lily. Little people are waiting out on the sea in tiny boats of every colour; steer your boat near enough and they jump across onto yours. Rescue as many as you can and reach the finish line: four other boats are out there doing the same, and the winner is the boat that rescued the most, 1st to 5th. Hold a finger where you want to go.',
    page: 'static/rescue.html', preview: 'preview', readme: 'static/rescue.md',
    presets: [{ label: 'play', query: '' }, { label: 'a new sea', query: 'seed=moss-ford-7' }, { label: 'mid-race', query: 'auto&t=45' }, { label: 'the five racing', query: 'auto' }, { label: 'the finish', query: 'view=podium' }],
  },
  {
    id: 'rescue-coast', title: 'Lily’s Rescue Boats', group: 'Play',
    blurb: 'All boats home: Lily’s lifeboat game, built from the concept boards. The Rescue Service: your crew (one of Lily’s five, in its colour) in the boat you choose (the all-weather lifeboat; the inshore boat, quick but bumpy alongside; the harbour launch, slow but steadiest) moored at the end of the lamp-lit pier of a little harbour, timber jetties all round it with fishing boats, dinghies and yachts moored along them, the town come down to see you off; two neighbouring crews in the other kinds of boat in their own little harbours down the coast. The calls come in on the radio, each in a station’s stretch: near the harbours first, then along the coast, then the bigger ones out at sea (a yacht that’s lost its mast); the neighbours help with any left waiting. Come alongside and hold steady (easier in the lee of a headland, or with the little boat sheltered by your own hull) and they climb aboard; when everyone’s been found, each crew brings theirs home to its own quay. The weather changes through the day: a squall, a fog bank, evening into night. Everyone home, then the crews’ honours. And the Rally, Lily’s race as she wrote it: five lifeboats up the channel to the harbour mouth, 1st to 5th. You steer by putting your finger anywhere on the sea and dragging (or a stick in a corner).',
    page: 'static/rescue-coast.html', preview: 'preview&seed=1', readme: 'static/rescue-coast.md',
    presets: [{ label: 'play', query: '' }, { label: 'the Rally', query: 'mode=rally' }, { label: 'moored in the harbour', query: 'seed=1&t=0&still' }, { label: 'the harbour from above', query: 'seed=1&ref=harbour' }, { label: 'a neighbour’s harbour', query: 'seed=1&ref=neighbour&n=1' }, { label: 'in the inshore boat', query: 'kind=inshore' }, { label: 'in the harbour launch', query: 'kind=launch' }, { label: 'along the coast', query: 'seed=1&auto&boat=0&t=30' }, { label: 'coming alongside', query: 'seed=1&auto&t=41.2&near=0' }, { label: 'a dismasted yacht', query: 'seed=1&auto&t=112.3&near=4' }, { label: 'out at sea, at sunset', query: 'seed=1&auto&follow=1&t=130' }, { label: 'a full deck', query: 'seed=1&auto&boat=0&t=192' }, { label: 'safe ashore', query: 'seed=1&auto&boat=0&t=210.6' }, { label: 'the stick in a corner', query: 'hand=right' }, { label: 'the lifeboat', query: 'seed=1&auto&t=20&study' }, { label: 'a storm', query: 'seed=1&auto&t=44&weather=stormy' }, { label: 'fog', query: 'seed=1&auto&t=40&weather=foggy' }, { label: 'night', query: 'seed=1&auto&t=60&weather=night' }, { label: 'everyone home', query: 'seed=1&auto&view=podium' }, { label: 'the Rally’s finish', query: 'seed=1&auto&mode=rally&view=podium' }],
  },
  {
    id: 'labyrinth', title: 'Labyrinth', group: 'Play',
    blurb: 'Architecture that follows the hand, on a piece of land: shelves, a ravine with a stream, an outcrop (or the flat travertine slab). Built on a grid of half cells, so a wall or a path is thin unless it\'s built up, and a pier, a setback or a recess can be half a cell; a flight still climbs a level a cell. Five brushes: auto reads gestures (tap raises, trace builds a wall, reaches out or climbs) and the stone works out what it takes to stand; a piece brush for one thing exactly, or dressing (brick, marble, moss, ivy, parapets, lanterns, pots); take; and select, to take up a piece or a whole arcade, flight or tower and read it another way. Arches and arcades under what has nothing beneath it, courtyards where walls close round the ground. Each land is built in one of four traditions, grammars of construction rather than costumes: the middle sea\'s terracotta and round arches; the plateau\'s flat tops, pointed arches and lit windows in painted frames; the north\'s timber frame, steep slate gables stepped in brick, dormers and chimneys; the east\'s whitewash between dark posts and deep grey eaves turned up at the corners. Kept as a print, too.',
    page: 'static/labyrinth.html', preview: 'preview', readme: 'static/labyrinth.md',
    presets: [{ label: 'the land', query: 'land=6' }, { label: 'the half grid, by hand', query: 'story=20' }, { label: 'a town at work', query: 'story=21' }, { label: 'a courtyard house, half grid', query: 'story=19&region=persian' }, { label: 'the land, in cells', query: 'land=6&grid=cells' }, { label: 'the plateau', query: 'story=16&region=persian' }, { label: 'a courtyard house', query: 'story=17&region=persian' }, { label: 'the north', query: 'story=16&region=timber' }, { label: 'the east', query: 'story=16&region=eaves' }, { label: '12 · on the land', query: 'story=12' }, { label: '13 · a place for cats', query: 'story=13' }, { label: '14 · water', query: 'story=14' }, { label: '15 · on the slope', query: 'story=15' }, { label: 'the stone', query: 'ops=[]' }, { label: '1 · first touch', query: 'story=1' }, { label: '2 · a traced wall', query: 'story=2' }, { label: '3 · an elevated connection', query: 'story=3' }, { label: '4 · a resolved labyrinth', query: 'story=4' }, { label: 'motifs and dressing', query: 'story=6' }, { label: 'auto alone, no cap', query: 'story=7' }, { label: '8 · a labyrinth', query: 'story=8' }, { label: '9 · features and rhythms', query: 'story=9' }, { label: '10 · flow', query: 'story=10' }, { label: '11 · gestures read', query: 'story=11' }, { label: 'as a print', query: 'story=4&print' }],
  },
  {
    id: 'fab', title: 'Fab', group: 'Play',
    blurb: 'A dressmaking workbench for children. Start at the rails (the workshop\'s, and one for each person) and put something on the little wooden figure: a skirt, a top, a dress, trousers or a jumpsuit. Work a skirt\'s paper pattern by hand, as a cutter does (slash and spread it, fold pleats, gather, close darts into flare; every move recorded), and decide what a dressmaker decides about the rest: a bodice\'s neckline, sleeves (plain, puffed, bell) and collar, trousers\' legs, tiers. Every pattern is drafted to the figure after GarmentCode (armholes, sleeve heads solved to fit them, crotch curves, darts and all), sewn up round it, and falls as that cloth falls: its silhouette, folds and swing are found, never set. With an evidence bench that says what it does and doesn\'t establish.',
    page: 'static/fab.html', preview: 'preview&fabric=lawn&print=2&colour=1', readme: 'static/fab.md',
    presets: [
      { label: 'the rails', query: '' },
      { label: 'a flared gingham', query: 'cut=flare&full=2.2&fabric=lawn&print=2&colour=1' },
      { label: 'chiffon, gathered', query: 'cut=gather&full=2.8&fabric=chiffon&print=4&colour=3' },
      { label: 'three tiers', query: 'cut=gather&full=1.8&len=44&tiers=3&fabric=lawn&print=4&colour=2' },
      { label: 'a puff-sleeved blouse', query: 'fam=top&sleeve=puff&slen=8&collar=peterpan&fabric=lawn&print=3&colour=0' },
      { label: 'a T-shirt', query: 'fam=top&fabric=jersey&slen=8&print=1&colour=1' },
      { label: 'a party dress', query: 'fam=dress&cut=gather&full=2.4&sleeve=puff&slen=8&collar=peterpan&fabric=lawn&print=2&colour=0' },
      { label: 'a tiered maxi', query: 'fam=dress&cut=gather&full=2&tiers=3&sleeve=bell&slen=12&neck=v&len=50&fabric=chiffon&print=4&colour=3' },
      { label: 'trousers', query: 'fam=trousers&fabric=linen&print=2&colour=4' },
      { label: 'a jumpsuit', query: 'fam=jumpsuit&llen=30&slen=8&neck=v&collar=band&fabric=jersey&print=1&colour=4' },
      { label: 'the evidence', query: 'bench=evidence' },
],
  },
  {
    id: 'changes', title: 'Changes', group: 'Contemplation',
    blurb: 'Six blue lines, a moment of attention. Cast an I Ching hexagram, follow its changing lines, and keep a reflection. A quiet experiment in chance and interpretation, inspired by a minimal iOS app.',
    page: 'static/changes.html', preview: 'preview', readme: 'static/changes.md',
    presets: [{ label: 'cast', query: '' }, { label: 'beginning', query: 'hex=3' }, { label: 'changing lines', query: 'cast=688879' }],
  },
  {
    id: 'markovs', title: 'Markovs Chains', group: 'Play',
    blurb: 'A game of finite probabilities on a standard poker deck: build a table of junction cards, then race one counter to your secret King with a d6. Two to four at one phone, or against bots; print the deck and play it on a table.',
    page: 'static/markovs.html', preview: 'preview&seed=1941', readme: 'static/markovs.md',
    presets: [{ label: 'you v three bots', query: 'seed=1941&players=4&bots=0111' }, { label: 'two at the table', query: 'seed=1941&players=2&bots=00' }, { label: 'four at the table', query: 'seed=1941&players=4&bots=0000' }, { label: 'the grid prototype', query: 'mode=physical' }, { label: 'the four-state chain', query: 'mode=challenge' }],
  },
  {
    id: 'seals', title: 'Seals', group: 'Play',
    blurb: 'The junction cards of Markovs Chains, engraved as seals: one family per suit, a seed for each card, every line from hyperparameters you can turn. Ornament packs evenly into any shape (seals, frames, corners) and keeps clear of the labels. Pure drawing functions, to be ported to the game.',
    page: 'static/seals.html', preview: 'preview&seed=1', readme: 'static/seals.md',
    presets: [{ label: 'the spade turn', query: 'suit=3&rank=3' }, { label: 'all four suits', query: 'view=suits&rank=5' }, { label: 'the bases, faces hidden', query: 'view=suit&suit=0&faces=hidden' }, { label: 'safe zones', query: 'suit=3&rank=6&faces=zones&overlay' }, { label: 'shapes: borders, corners', query: 'view=shapes&suit=2&label=The%20Thicket' }, { label: 'six seeds', query: 'suit=2&rank=9&view=seeds' }],
  },
  {
    id: 'crystals', title: 'Crystals', group: 'Drawings',
    blurb: 'A mineral specimen from a seed, ray-traced: a cluster of crystals grows out of its matrix, and the key light goes through them — refracted, dispersed into colour at the edges, reflected inside, and thrown onto the slate as caustics. Drag to turn it; pinch to come close.',
    page: 'static/crystals.html', preview: 'preview&seed=1947&still', readme: 'static/crystals.md',
    presets: [{ label: 'a specimen', query: '' }, { label: 'amethyst', query: 'mineral=amethyst&seed=12' }, { label: 'fluorite', query: 'mineral=fluorite&seed=5' }, { label: 'zircon', query: 'mineral=zircon&seed=8' }, { label: 'emerald', query: 'mineral=emerald&seed=3' }, { label: 'rhodochrosite', query: 'mineral=rhodochrosite&seed=4' }],
  },
  {
    id: 'taohua', title: 'Taohua · 桃花', group: 'Woods',
    blurb: 'A climb through peach blossom to the mountain temples, on forever. After a print: crowns of flat pink, black standing stones, stone steps and trails that wander between them, temples of teal tiles and red columns, a walker in a straw hat with a staff, arriving by boat as 桃花源记 has it, casts from Changes written on the hillside. Tap the path to walk.',
    page: 'static/taohua.html', preview: 'preview&seed=7', readme: 'static/taohua.md',
    presets: [{ label: 'climb', query: '' }, { label: 'a hillside', query: 'seed=7' }, { label: 'another', query: 'seed=peach-ford-3' }],
  },
  {
    id: 'field', title: 'Field Journal', group: 'Woods',
    blurb: 'The lab in one walk: the Mistwood wood, with the Seals engraving drawn over it, and in it crystals and fungi to find. Come close and open one: its card holds the real Crystals specimen or Hat-thrower, grown from the find, and the journal keeps it.',
    page: 'static/field.html', preview: 'preview&hour=11', readme: 'static/field.md',
    presets: [{ label: 'walk', query: '' }, { label: 'a morning', query: 'hour=8' }, { label: 'another wood', query: 'seed=moss-ford-7' }],
  },
  {
    id: 'mistwood',
    title: 'Mistwood',
    group: 'Woods',
    blurb: 'A walk through a seeded wood in fog: trees grown branch by branch, deer, ponds, a creek, ruins. Touch the ground to walk, the sky to look.',
    page: 'static/mistwood.html',
    preview: 'preview&hour=11',
    readme: 'static/mistwood.md',
    presets: [
      { label: 'walk', query: '' },
      { label: 'pencil', query: 'style=sketch' },
      { label: 'the creek', query: 'find=ford' },
      { label: 'a ruin', query: 'find=tower' },
      { label: 'tune', query: 'tune' },
    ],
  },
  {
    id: 'plate',
    title: 'Botanical plate',
    group: 'Drawings',
    blurb: 'One plant from a seed, grown before your eyes and drawn as an engraving you can turn in your hand and hand-coloured in watercolour: roots, stem, leaves hatched as they turn from the light, flowers opening.',
    page: 'static/plate.html',
    preview: 'preview&seed=412',
    readme: 'static/plate.md',
    presets: [
      { label: 'a specimen', query: '' },
      { label: 'pl. 412', query: 'seed=412' },
      { label: 'pl. 77', query: 'seed=77' },
      { label: 'pl. 2051', query: 'seed=2051' },
      { label: 'ink only', query: 'wash=0' },
    ],
  },
  {
    id: 'bricks',
    title: 'Bricks',
    group: 'Play',
    blurb: 'Lego, Tetris-fashion: bricks are offered one at a time — tap for another, drag it out to use it — and any placed brick can be picked up, moved, turned or recoloured. Nothing falls, nothing clears; you build.',
    page: 'static/bricks.html',
    preview: 'preview&seed=21',
    readme: 'static/bricks.md',
    presets: [
      { label: 'build', query: '' },
      { label: 'watch a town', query: 'town&seed=21' },
    ],
  },
  {
    id: 'technic',
    title: 'Technic',
    group: 'Play',
    blurb: 'Bricks, evolved: beams, pins and axles on a pegboard, gears that mesh, wheels that roll, ramps and marbles, a motor and a hub that tells it what to do. It is always going: gravity, the floor, the motor turning from the first piece; pause and rewind. A drop explains itself (what it pins to, what it meshes with, why it can\'t go); your builds are pieces to use again; missions with a bell to ring and a cup to fill.',
    page: 'static/technic.html',
    preview: 'preview&demo=crank',
    readme: 'static/technic.md',
    presets: [
      { label: 'build', query: '' },
      { label: 'mission: the big gear', query: 'mission=turn' },
      { label: 'mission: ring the bell', query: 'mission=bell' },
      { label: 'mission: a marble in the cup', query: 'mission=cup' },
      { label: 'mission: keep it, use it twice', query: 'mission=twice' },
      { label: 'a gear train', query: 'demo=gears' },
      { label: 'a crank and rocker', query: 'demo=crank' },
      { label: 'a car', query: 'demo=car' },
      { label: 'pendulums', query: 'demo=swing' },
      { label: 'a marble run', query: 'demo=marble' },
      { label: 'watch it run', query: 'auto&demo=marble' },
    ],
  },
  {
    id: 'squishy-lab',
    title: 'Squishy · Level Lab',
    group: 'Play',
    blurb: 'A renderer-free laboratory for generated Squishy levels: inspect physical geometry, discover route candidates, validate flicks with the actual soft-body simulator, replay witnesses and export spatial schematics. Shared physics; no WebGL.',
    page: 'static/squishy-lab.html',
    preview: 'preview&level=3&seed=0',
    readme: 'static/squishy-lab.md',
    presets: [
      { label: 'spatial composition study', query: 'study&level=7&seed=2' },
      { label: 'the preparation table', query: 'level=3&seed=0' },
      { label: 'the sink', query: 'level=9&seed=1' },
      { label: 'the whole kitchen', query: 'level=18&seed=4' },
      { label: 'alternate seed', query: 'level=6&seed=13' },
    ],
  },
  {
    id: 'squishy',
    title: 'Squishy',
    group: 'Play',
    blurb: 'A third-person platformer in which you are a dumpling: a steamed one, of dough, with a face (and later, as a treat, a clear pink jelly squishy toy, full of glitter). You don\'t walk, you flick: drag back and let go, and it flies the other way, as hard as you pulled, the dotted line showing where it will land. It is a soft body: it squashes when it lands, bulges, wobbles back, dents on an edge, sticks to a wall for a moment, and rights itself like a roly-poly. Across a preparation table (a spoon to land in, a towel over a bench, butter melted on the wood), then up stacks of bamboo steamers, tea tins, a chopping board on jars, a slippery plate, a bouncy mango pudding and a turning lazy Susan, to the golden steamer: home; then onto the stovetop, where butter slides, a pan has a rim, a honey jar is something you stick to the side of, and a pot\'s lid lifts on the steam. Flour, butter, crumbs, pepper and sprinkles come off on it where it touches, and have their say. Swipe as you let go for spin; tap to nudge.',
    page: 'static/squishy.html',
    preview: 'preview',
    readme: 'static/squishy.md',
    presets: [
      { label: 'the preparation table', query: 'level=1' },
      { label: 'the counter', query: 'level=3' },
      { label: 'the stovetop', query: 'level=5' },
      { label: 'level 8', query: 'level=8' },
      { label: 'jelly', query: 'level=13' },
      { label: 'watch', query: 'auto&level=3' },
    ],
  },
  {
    id: 'marbles',
    title: 'Marble Run',
    group: 'Play',
    blurb: 'A roster of twelve glass marbles, each its own look and name, in a row behind a gate at the top of a wide, sloping board. Tap one and it\'s yours; tap to go, and down board after board of pegs, mazes, slaloms, spinners, funnels, bridges, causeways, jumps, tunnels and hairpins they bump and part, to a funnel, the chequered line and a channel one marble wide, where they come to rest in the order they crossed. A chase camera follows yours. At the end, build: three boards on offer from the seed, pick one and the run grows downward. Two places to race in: a daylit atelier of kraft and tape, and an observatory at night, lacquer, gold and brass under the lamps.',
    page: 'static/marbles.html',
    preview: 'preview',
    readme: 'static/marbles.md',
    presets: [
      { label: 'race', query: '' },
      { label: 'run 21', query: 'seed=21&run=0.1.2.0.1.2.0' },
      { label: 'run 7, the long way', query: 'seed=7&run=0.1.2.0.1.2.0.1.2.0.1.2' },
      { label: 'follow Dusk', query: 'seed=21&run=0.1.2.0.1.2.0&marble=Dusk' },
      { label: 'nocturne', query: 'seed=7&run=0.1.2.0.1.2.0&theme=nocturne' },
      { label: 'watch', query: 'auto' },
    ],
  },
  {
    id: 'imperecept',
    title: 'Imperecept',
    group: 'Perception',
    blurb: 'The unseen ground between percept and precept. Local time-reversal as latent rule: a constraint that shapes what can be heard without declaring itself. Drift, amplitude-following, and a revealable substrate.',
    page: 'static/imperecept.html',
    preview: 'preview',
    readme: 'static/imperecept.md',
    presets: [
      { label: 'transparent 30 ms', query: 'grain=30' },
      { label: 'uncanny 70 ms', query: 'grain=70' },
      { label: 'collapse 130 ms', query: 'grain=130' },
    ],
  },
  {
    id: 'fungi',
    title: 'Hat-throwers',
    group: 'Drawings',
    blurb: 'A macro timelapse of dung fungi in a pasture, on the real clock: pats of every age in the grass, each its own succession over three weeks: hat-throwers and pin moulds first, then jelly cups, eyelash cups and flask fungi, inkcaps last. Each spreads through the dung and eats it out from under the others. Nematodes ride the thrown sporangia or are caught in the snares of a trapping fungus; mites and springtails graze; dung flies wait on fresh pats and beetles bore them; mosses, clover and plantain grow among the grass. The camera goes where something is about to happen.',
    page: 'static/fungi.html',
    preview: 'preview&seed=2&t=250',
    readme: 'static/fungi.md',
    presets: [
      { label: 'the field, now', query: '' },
      { label: 'the field at dawn', query: 'hour=6.5' },
      { label: 'an old pat', query: 'age=40' },
      { label: 'a terrarium', query: 'terrarium' },
      { label: 'no. 2, day 15', query: 'terrarium&seed=2&t=330' },
      { label: 'throwers alone', query: 'one&seed=2&t=9' },
      { label: 'a pin mould', query: 'one&seed=4&t=8' },
      { label: 'inkcaps', query: 'one&seed=10&t=9' },
      { label: 'jelly cups', query: 'one&seed=9&t=8' },
      { label: 'eyelash cups', query: 'one&form=eyelash&seed=5&t=16' },
      { label: 'mottlegills', query: 'one&form=mottlegill&seed=3&t=12' },
      { label: 'yellow fieldcaps', query: 'one&form=fieldcap&seed=5&t=12' },
      { label: 'flask fungi', query: 'one&form=flask&seed=3&t=15' },
      { label: 'a mite', query: 'one&seed=4&t=10&critter=macro' },
      { label: 'a springtail', query: 'one&seed=4&t=10&critter=hypo' },
      { label: 'a nematode, caught', query: 'one&seed=4&t=9.6&critter=trap' },
    ],
  },
];

/** The groups, in the order they first appear. */
export function groups(): Array<{ name: string; experiments: Experiment[] }> {
  const out: Array<{ name: string; experiments: Experiment[] }> = [];
  for (const e of EXPERIMENTS) {
    let g = out.find((x) => x.name === e.group);
    if (!g) out.push((g = { name: e.group, experiments: [] }));
    g.experiments.push(e);
  }
  return out;
}
