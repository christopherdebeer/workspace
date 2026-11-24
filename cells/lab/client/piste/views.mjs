/**
 * Piste's views: the pictures its README is written around (`node cells/lab/views.mjs piste`), each
 * `static/piste/v-<name>.jpg`. All are the stand-ins' bout run on to a moment and held (`auto&t=…&still`).
 */
export const ready = '__piste';
const PHONE = { width: 390, height: 844 }, WIDE = { width: 1000, height: 560 };
export const views = [
  { name: 'mask', group: 'The bout', title: 'En garde, through the mask', caption: 'at the lines, before allez: their point toward you, your own bell low on the right', query: 't=0.5&still', size: PHONE, settle: 1200 },
  { name: 'close', group: 'The bout', title: 'In distance', caption: 'a riposte coming: their bell turned toward your blade, your blade crossing theirs', query: 'auto&t=2.6&still', size: PHONE, settle: 1200 },
  { name: 'wrist', group: 'The bout', title: 'Touched on the wrist', caption: 'they lunged as you came forward, at the nearest target: your arm. Their lamp is lit', query: 'auto&t=2.93&still', size: PHONE, settle: 1200 },
  { name: 'double', group: 'The bout', title: 'Coup double, from the side', caption: 'both tips home inside the 45 ms: both blades bowed against the chests, both lamps lit', query: 'auto&view=side&t=11.97&still', size: WIDE, settle: 1200 },
  { name: 'readout', group: 'The bout', title: 'What the box hears', caption: 'the readout: the gap, each tip\'s force against its 7.35 N, how far each blade is bowed, how hard each hand is working, what the opponent is doing', query: 'auto&view=side&readout&t=5.2&still', size: WIDE, settle: 1500 },
];
