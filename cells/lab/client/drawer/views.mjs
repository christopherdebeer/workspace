/**
 * The drawer's views: the pictures its README (static/drawer.md) is written around. `node cells/lab/views.mjs drawer`.
 */
export const ready = '__drawer';
const PHONE = { width: 390, height: 760 };
export const views = [
  { name: 'closed', group: 'Heights', title: 'Closed', caption: 'its grip and a line saying what’s chosen; the scene almost whole', query: 'drawer=closed', size: PHONE, settle: 1500 },
  { name: 'focus', group: 'Heights', title: 'Focus', caption: 'tier 1: the controls used most', query: 'drawer=focus', size: PHONE, settle: 1500 },
  { name: 'full', group: 'Heights', title: 'Full', caption: 'everything, in sections that open one at a time and summarise themselves shut; the subject lifted clear', query: 'drawer=full', size: PHONE, settle: 1500 },
  { name: 'focus-mode', group: 'Working in it', title: 'One control alone', caption: 'a control’s name tapped: the drawer narrows to it, so the scene clears while you dial', query: 'drawer=full', size: PHONE, settle: 1500,
    run: async (v) => { await v.eval(() => { document.querySelector('details[data-key=subject]').open = true; }); await v.wait(400); await v.page.click('details[data-key=subject] [data-focus] label', { position: { x: 8, y: 6 } }); await v.wait(700); } },
  { name: 'dark', group: 'Working in it', title: 'In a dark page', caption: 'the same drawer in a page with dark tokens: it takes the page’s look', query: 'drawer=full&theme=dark', size: PHONE, settle: 1500 },
];
