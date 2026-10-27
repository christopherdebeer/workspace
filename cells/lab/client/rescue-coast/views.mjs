/**
 * Rescue · Rocky Coast's views: the pictures its README is written around, and the contact sheet it's judged by
 * against the concept boards. Made with `node cells/lab/views.mjs rescue-coast`; each is `static/rescue-coast/v-<name>.jpg`.
 *
 * All on seed 1 (Shell Bay), the crews all steered by the game (`auto`), run on to a moment and held there (`t=…&still`):
 * the Rescue Service unless the name says Rally (`mode=rally`). The Service's are mostly Puffin's day (`boat=0`): seed 1's
 * weather starting sunny goes to sunset at 100 s and night at 200 s, so the voyage's pictures go from day to dusk.
 */
export const ready = '__rescue';
const AT = (t, more = '') => `seed=1&auto&t=${t}&still${more}`;
const PUFFIN = (t, more = '') => AT(t, `&boat=0${more}`);
const RALLY = (t, more = '') => AT(t, `&mode=rally${more}`);
const PHONE = { width: 390, height: 844 };
export const views = [
  { name: 'title', group: 'The menu', title: 'Lily’s Rescue Boats', caption: 'All boats home: your lifeboat charging along under the lighthouse; Play (the Rescue Service), Rally (Lily’s race), Boats, Weather, Settings', query: 'seed=1&boat=0', size: PHONE, settle: 5000 },
  { name: 'title-wide', group: 'The menu', title: 'The title, on a bigger screen', caption: 'the menu to the right, as on the boards', query: 'seed=1&boat=1&weather=sunset', size: { width: 1280, height: 720 }, settle: 5000 },
  { name: 'boats', group: 'The menu', title: 'Choose your boat', caption: 'five lifeboats, a wheelhouse each in its own colour; your best with each', query: 'seed=1&boat=2&panel=boats', size: PHONE },
  { name: 'weather', group: 'The menu', title: 'The weather', caption: 'seven, from the boards: the title behind changes as you pick', query: 'seed=1&weather=windy&panel=weather', size: PHONE },
  { name: 'settings', group: 'The menu', title: 'Settings', caption: 'how good the others are, which side the stick goes, sound, a new coast', query: 'seed=1&panel=settings', size: PHONE },
  { name: 'start', group: 'The Rescue Service', title: 'Moored in the harbour', caption: 'as the count goes down, a look round the harbour: the five crews moored, bows to the mouth, the town on its hill behind; a few from the town on the quay to see them off', query: 'seed=1&t=0&still', size: PHONE },
  { name: 'steer', group: 'Steering', title: 'Your boat is the stick', caption: 'until you’ve steered, a ring round your boat says where: put your finger on it and drag', query: 'seed=1&t=2.5&still', size: PHONE, settle: 4000 },
  { name: 'steer-drag', group: 'Steering', title: 'Take hold and drag', caption: 'drag ahead to go, to one side to turn, back to slow down; a faint ring where you took hold; let go and she eases to a stop', query: 'seed=1&t=2.5&still', size: PHONE, settle: 4000,
    run: async (v) => { const g = await v.eval(() => window.__rescue.grab); await v.drag([g[0], g[1]], [g[0] + 34, g[1] - 56], { at: async () => { await v.wait(2500); await v.shot(); } }); } },
  { name: 'harbour', group: 'The Rescue Service', title: 'Setting out', caption: 'out through the harbour, the town on its hill, the lighthouses either side of the mouth', query: PUFFIN(5), size: PHONE },
  { name: 'racing', group: 'The Rescue Service', title: 'Along the coast', caption: 'the first calls are just outside the harbour; everyone rescued so far (of everyone whose call has come in), your own crew’s count, the time with the weather as it is now; the map, a little boat another crew is going for ringed in their colour; the five crews’ counts under it', query: PUFFIN(30), size: PHONE },
  { name: 'line', group: 'Coming alongside', title: 'The line goes over', caption: 'alongside and slowed right down, the little boat in the lee of the hull: the crew throws a line; the camera cuts in', query: AT(55.2, '&near=0'), size: PHONE },
  { name: 'climb', group: 'Coming alongside', title: 'Climbing aboard', caption: 'held steady, the water calm in the lifeboat’s lee: a crew member leans over the rail to take a hand, and up they come', query: AT(56.3, '&near=0'), size: PHONE },
  { name: 'paddle', group: 'Coming alongside', title: 'A paddleboarder', caption: 'near the harbour the first calls are the little ones: a kayaker, a paddleboarder blown out past the headland', query: AT(35.2, '&near=4'), size: PHONE },
  { name: 'open-sea', group: 'Out at sea', title: 'The open sea', caption: 'past the harbour’s headland the far shore falls away: islets and reefs out over the water, the swell bigger out here; the sun going down', query: PUFFIN(130), size: PHONE },
  { name: 'rough', group: 'Out at sea', title: 'Rough water', caption: 'out at sea, beam-on in a bigger swell: they climb across more slowly, and the bar goes amber', query: AT(152, '&near=16'), size: PHONE },
  { name: 'yacht', group: 'Out at sea', title: 'A yacht that’s lost its mast', caption: 'further out, the bigger calls: a yacht dismasted, four aboard, the mast lying along her deck', query: AT(103.6, '&near=13'), size: PHONE },
  { name: 'deck', group: 'Out at sea', title: 'A full deck', caption: 'everyone found out there, and no one left waiting: home with all seven of them', query: PUFFIN(185, '&zoom=0.8'), size: PHONE },
  { name: 'landing', group: 'Home', title: 'Safe ashore', caption: 'in through the mouth as night comes down: they step ashore one by one, to the crowd waving on the pier by the station', query: PUFFIN(213.6), size: PHONE },
  { name: 'podium', group: 'Home', title: 'Everyone home', caption: 'everyone rescued, every crew in at the quay; then the crews’ honours, 1st to 5th by Lily’s rule', query: 'seed=1&auto&view=podium&still', size: PHONE },
  { name: 'rally', group: 'The Rally', title: 'Lily’s race', caption: 'the same coast as a race: your place and the places under the map; the last call when the first boat is home', query: RALLY(24), size: PHONE },
  { name: 'rally-finish', group: 'The Rally', title: 'The finish line', caption: 'the race’s finish: through the harbour mouth under the banner', query: RALLY(126.8), size: PHONE },
  { name: 'rally-podium', group: 'The Rally', title: '1st to 5th', caption: 'in at the quay, the places by most rescued', query: 'seed=1&auto&mode=rally&view=podium&still', size: PHONE },
  { name: 'wide', group: 'Looks', title: 'On a bigger screen', caption: 'granite cliffs, sheltered water calmer and greener in the lee of the headlands, the wake churning white', query: PUFFIN(30), size: { width: 1280, height: 720 } },
  ...['calm', 'windy', 'stormy', 'foggy', 'night', 'sunset'].map((w) => ({ name: `weather-${w}`, group: 'Weather', title: w[0].toUpperCase() + w.slice(1), caption: { calm: 'a gentle swell, little foam, gulls', windy: 'a bigger, steeper sea; whitecaps and streaks of foam; spray flying', stormy: 'a big grey sea under a lid of cloud; rain, lightning, the beams already turning', foggy: 'the coast lost in it; the lighthouses’ beams and the searchlight cut through', night: 'stars, the moon on the water, windows lit, the beams turning, your searchlight ahead', sunset: 'the sun low ahead, the sea gold and the cliffs warm' }[w], query: AT(40, `&weather=${w}`), size: PHONE })),
  { name: 'storm-wide', group: 'Weather', title: 'A storm, on a bigger screen', caption: 'the swell high enough to hide the next boat', query: AT(44, '&weather=stormy'), size: { width: 1280, height: 720 } },
  { name: 'night-wide', group: 'Weather', title: 'Night, on a bigger screen', caption: 'your searchlight on the water, the lighthouse beam sweeping the harbour mouth', query: AT(60, '&weather=night'), size: { width: 1280, height: 720 } },
  { name: 'study', group: 'Looks', title: 'The lifeboat', caption: 'navy hull, red below the waterline, RNLI along the bow; the wheelhouse in the boat’s own colour, a tall black mast; the crew in white helmets', query: AT(20, '&study'), size: { width: 900, height: 900 } },
];
