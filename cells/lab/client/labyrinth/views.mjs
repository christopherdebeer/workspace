/**
 * The labyrinth's views: the pictures its README (static/labyrinth.md) is written around, each made by opening the page
 * where the README says to look (`node cells/lab/views.mjs labyrinth`; each is `static/labyrinth/v-<name>.jpg`). The
 * storyboard (`?story=1..4`) is made with the same gestures a hand would make (demo.ts), read by the same rules.
 */
export const ready = '__labyrinth';

export const views = [
  { name: 'stone', group: 'The storyboard', title: 'The stone', caption: 'where it starts: a travertine slab, on a table in the sun', query: 'ops=[]' },
  { name: 'story-1', group: 'The storyboard', title: '1 · First touch', caption: 'tap the stone, tap its top, tap a side: a small raised platform', query: 'story=1&zoom=0.5' },
  { name: 'story-2', group: 'The storyboard', title: '2 · A traced wall', caption: 'trace across the stone from it: a wall grows along the stroke', query: 'story=2&zoom=0.5' },
  { name: 'story-3', group: 'The storyboard', title: '3 · An elevated connection', caption: 'a terrace tapped up higher; a trace from the platform\'s top along the wall\'s and up to it: landings on the wall, a step up at the end, piers where there\'s nothing under it', query: 'story=3&zoom=0.5' },
  { name: 'story-4', group: 'The storyboard', title: '4 · A resolved labyrinth', caption: 'a passage carved under the walkway (an arch carries it); the court walled in (paved, water, a cypress); a tower, and a trace from its top to the terrace: a bridge on one great arch', query: 'story=4&zoom=0.5' },
  { name: 'story-4-turned', group: 'The storyboard', title: 'From the other side', caption: 'the bridge\'s great arch, the passage under the walkway, the court', query: 'story=4&zoom=0.5&turn=3' },
  { name: 'close', group: 'Close to', title: 'The stone, close', caption: 'dressed travertine in courses, its joints staggered; pitted and banded; the light gathered under an arch', query: 'story=4&zoom=0.3&turn=3' },
  { name: 'print', group: 'Print', title: 'As a print', caption: 'print: the light hatched, closer and crossed as it darkens', query: 'story=4&print&zoom=0.5&turn=3' },
];
