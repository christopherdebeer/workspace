/**
 * Rescue · Rocky Coast's views: the pictures its README is written around, and the contact sheet it's judged by
 * against the concept boards. Made with `node cells/lab/views.mjs rescue-coast`; each is `static/rescue-coast/v-<name>.jpg`.
 *
 * All on seed 1 (Shell Bay), the game's own race (`auto`), run on to a moment and held there (`t=…&still`).
 */
export const ready = '__rescue';
const AT = (t, more = '') => `seed=1&auto&t=${t}&still${more}`;
const PHONE = { width: 390, height: 844 };
export const views = [
  { name: 'lineup', group: 'The race', title: 'Choose your lifeboat', caption: 'five lifeboats, one in each colour; how good the others are; go', query: 'seed=1&boat=0', size: PHONE },
  { name: 'racing', group: 'The race', title: 'Out on the coast', caption: 'riding behind your boat; the stick in its corner, the places along the top, how far to go down the side', query: AT(24), size: PHONE },
  { name: 'line', group: 'Coming alongside', title: 'The line goes over', caption: 'alongside and slowed right down: the crew throws a line to the little boat', query: AT(32.5, '&near=6'), size: PHONE },
  { name: 'climb', group: 'Coming alongside', title: 'Climbing aboard', caption: 'pulled in against the hull, they climb up the side one at a time', query: AT(34.6, '&near=6'), size: PHONE },
  { name: 'deck', group: 'Coming alongside', title: 'A full deck', caption: 'the rescued fill the aft deck, then the foredeck, the side decks and the roof', query: AT(110, '&zoom=0.8'), size: PHONE },
  { name: 'finish', group: 'The finish', title: 'The harbour mouth', caption: 'the finish: through the gap between the lighthouses, under the banner', query: AT(129), size: PHONE },
  { name: 'podium', group: 'The finish', title: '1st to 5th', caption: 'in at the quay, the places by most rescued', query: 'seed=1&auto&view=podium&still', size: PHONE },
  { name: 'wide', group: 'Looks', title: 'On a bigger screen', caption: 'granite cliffs, a cobalt sea laced with foam, the wake churning white', query: AT(40), size: { width: 1280, height: 720 } },
  { name: 'study', group: 'Looks', title: 'The lifeboat', caption: 'navy hull, red below the waterline, RNLI along the bow; the wheelhouse in the boat’s own colour, a tall black mast; the crew in white helmets', query: AT(20, '&study'), size: { width: 900, height: 900 } },
];
