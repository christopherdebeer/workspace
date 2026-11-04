/**
 * Rescue Race's views: the pictures its README (static/rescue.md) is written around. Made with
 * `node cells/lab/views.mjs rescue`; each is `static/rescue/v-<name>.jpg`.
 *
 * All on seed 3 (moss-hollow-0), the race the game's own (`auto`: the camera follows whoever's rescued most), run on to
 * a moment and held there (`t=…&still`), so the same view comes out the same each time it's made.
 */
export const ready = '__rescue';
const AT = (t, more = '') => `seed=3&auto&t=${t}&still${more}`;
export const views = [
  { name: 'lineup', group: 'The race', title: 'The line-up', caption: 'choose your boat, how good the others are, and go', query: 'seed=3&boat=2', settle: 4000 },
  { name: 'racing', group: 'The race', title: 'Out on the sea', caption: 'thirty seconds in: the first rescued aboard, the places along the top, how far to the finish down the side', query: AT(30), settle: 4000 },
  { name: 'waving', group: 'The rescue', title: 'Near enough', caption: 'a boat swings in; the people in the tiny boat wave both arms', query: AT(15.7, '&zoom=0.55&near=0'), settle: 4000 },
  { name: 'jump', group: 'The rescue', title: 'Coming across', caption: 'one at a time, in an arc, onto the deck', query: AT(16.75, '&zoom=0.55&near=0'), settle: 4000 },
  { name: 'deck', group: 'The rescue', title: 'A full deck', caption: 'everyone rescued stands on the deck, then the side decks, the stern, the wheelhouse roof', query: AT(60, '&zoom=0.5'), settle: 4000 },
  { name: 'finish', group: 'The finish', title: 'The finish line', caption: 'a chequered band across the water, a lighthouse at each end', query: AT(108.6), settle: 4000 },
  { name: 'podium', group: 'The finish', title: '1st to 5th', caption: 'the boats in the harbour at their berths; the places, by most rescued', query: 'seed=3&auto&view=podium&still', settle: 4000 },
  { name: 'wide', group: 'The finish', title: 'On a bigger screen', caption: 'the same race, wider', query: AT(40), size: { width: 1280, height: 800 }, settle: 4000 },
];
