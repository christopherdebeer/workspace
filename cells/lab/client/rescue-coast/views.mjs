/**
 * Rescue · Rocky Coast's views: the pictures its README is written around, and the contact sheet it's judged by
 * against the concept boards. Made with `node cells/lab/views.mjs rescue-coast`; each is `static/rescue-coast/v-<name>.jpg`.
 *
 * All on seed 1 (Shell Bay), the crews all steered by the game (`auto`), run on to a moment and held there (`t=…&still`):
 * the Rescue Service unless the name says Rally (`mode=rally`).
 */
export const ready = '__rescue';
const AT = (t, more = '') => `seed=1&auto&t=${t}&still${more}`;
const RALLY = (t, more = '') => AT(t, `&mode=rally${more}`);
const PHONE = { width: 390, height: 844 };
export const views = [
  { name: 'title', group: 'The menu', title: 'Lily’s Rescue Boats', caption: 'All boats home: your lifeboat charging along under the lighthouse; Play (the Rescue Service), Rally (Lily’s race), Boats, Weather, Settings', query: 'seed=1&boat=0', size: PHONE, settle: 5000 },
  { name: 'title-wide', group: 'The menu', title: 'The title, on a bigger screen', caption: 'the menu to the right, as on the boards', query: 'seed=1&boat=1&weather=sunset', size: { width: 1280, height: 720 }, settle: 5000 },
  { name: 'boats', group: 'The menu', title: 'Choose your boat', caption: 'five lifeboats, a wheelhouse each in its own colour; your best with each', query: 'seed=1&boat=2&panel=boats', size: PHONE },
  { name: 'weather', group: 'The menu', title: 'The weather', caption: 'seven, from the boards: the title behind changes as you pick', query: 'seed=1&weather=windy&panel=weather', size: PHONE },
  { name: 'settings', group: 'The menu', title: 'Settings', caption: 'how good the others are, which side the stick goes, sound, a new coast', query: 'seed=1&panel=settings', size: PHONE },
  { name: 'start', group: 'The Rescue Service', title: 'Off we go', caption: 'the bubble says what to do; the stick waits in its corner', query: 'seed=1&t=1.5&still', size: PHONE },
  { name: 'racing', group: 'The Rescue Service', title: 'Out on the coast', caption: 'low behind your boat, the coast ahead; everyone rescued so far (of everyone out there), your own crew’s count and the time top-left; the map top-right, a little boat another crew is going for ringed in their colour; the five crews’ counts under it', query: AT(24), size: PHONE },
  { name: 'line', group: 'Coming alongside', title: 'The line goes over', caption: 'alongside and slowed right down, the little boat in the lee of the hull: the crew throws a line; the camera cuts in', query: AT(34.7, '&near=5'), size: PHONE },
  { name: 'climb', group: 'Coming alongside', title: 'Climbing aboard', caption: 'held steady, the water calm in the lifeboat’s lee: a crew member leans over the rail to take a hand, and up they come', query: AT(36.4, '&near=5'), size: PHONE },
  { name: 'rough', group: 'Coming alongside', title: 'Rough water', caption: 'with the little boat on the side the swell comes from, it’s bumpy alongside: they climb across more slowly, and the bar goes amber', query: AT(37.6, '&near=6'), size: PHONE },
  { name: 'deck', group: 'Coming alongside', title: 'A full deck', caption: 'the rescued fill the aft deck, then the foredeck, the side decks and the roof', query: AT(110, '&zoom=0.8'), size: PHONE },
  { name: 'finish', group: 'Home', title: 'The harbour mouth', caption: 'home: through the gap between the lighthouses, under the banner', query: AT(135.9), size: PHONE },
  { name: 'podium', group: 'Home', title: 'Everyone home', caption: 'everyone rescued, every crew in at the quay; then the crews’ honours, 1st to 5th by Lily’s rule', query: 'seed=1&auto&view=podium&still', size: PHONE },
  { name: 'rally', group: 'The Rally', title: 'Lily’s race', caption: 'the same coast as a race: your place and the places under the map; the last call when the first boat is home', query: RALLY(24), size: PHONE },
  { name: 'rally-finish', group: 'The Rally', title: 'The finish line', caption: 'the race’s finish: through the harbour mouth under the banner', query: RALLY(126.8), size: PHONE },
  { name: 'rally-podium', group: 'The Rally', title: '1st to 5th', caption: 'in at the quay, the places by most rescued', query: 'seed=1&auto&mode=rally&view=podium&still', size: PHONE },
  { name: 'wide', group: 'Looks', title: 'On a bigger screen', caption: 'granite cliffs, sheltered water calmer and greener in the lee of the headlands, the wake churning white', query: AT(40), size: { width: 1280, height: 720 } },
  ...['calm', 'windy', 'stormy', 'foggy', 'night', 'sunset'].map((w) => ({ name: `weather-${w}`, group: 'Weather', title: w[0].toUpperCase() + w.slice(1), caption: { calm: 'a gentle swell, little foam, gulls', windy: 'a bigger, steeper sea; whitecaps and streaks of foam; spray flying', stormy: 'a big grey sea under a lid of cloud; rain, lightning, the beams already turning', foggy: 'the coast lost in it; the lighthouses’ beams and the searchlight cut through', night: 'stars, the moon on the water, windows lit, the beams turning, your searchlight ahead', sunset: 'the sun low ahead, the sea gold and the cliffs warm' }[w], query: AT(40, `&weather=${w}`), size: PHONE })),
  { name: 'storm-wide', group: 'Weather', title: 'A storm, on a bigger screen', caption: 'the swell high enough to hide the next boat', query: AT(44, '&weather=stormy'), size: { width: 1280, height: 720 } },
  { name: 'night-wide', group: 'Weather', title: 'Night, on a bigger screen', caption: 'your searchlight on the water, the lighthouse beam sweeping the harbour mouth', query: AT(126, '&weather=night'), size: { width: 1280, height: 720 } },
  { name: 'study', group: 'Looks', title: 'The lifeboat', caption: 'navy hull, red below the waterline, RNLI along the bow; the wheelhouse in the boat’s own colour, a tall black mast; the crew in white helmets', query: AT(20, '&study'), size: { width: 900, height: 900 } },
];
