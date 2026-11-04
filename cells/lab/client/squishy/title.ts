/**
 * Squishy's name, as the title shows it: soft dough letters, each a single rounded stroke drawn
 * three times over (a dark brown outline, the dough, a shine along its top), each letter tipped
 * and bobbed a little, as if just set down; sesame seeds scattered round. Drawn as an SVG string,
 * with nothing to load.
 */

/** each letter: its strokes (in a box 100 high, the baseline at 100), how wide it is, how it's tipped (degrees) and bobbed */
const LETTERS: Array<{ d: string; w: number; tilt: number; bob: number }> = [
  { d: 'M70 18C58 2 16 0 14 26C12 50 70 44 72 70C74 98 22 104 8 82', w: 80, tilt: -8, bob: 6 },
  { d: 'M72 36C64 0 8 4 8 52C8 98 64 104 72 66M72 6L72 148', w: 80, tilt: 4, bob: -3 },
  { d: 'M10 6L10 58C10 104 70 104 72 58M72 6L72 100', w: 82, tilt: -3, bob: 4 },
  { d: 'M12 22L12 100M12 -28L12 -27', w: 24, tilt: 6, bob: -8 },
  { d: 'M70 18C58 2 16 0 14 26C12 50 70 44 72 70C74 98 22 104 8 82', w: 80, tilt: -5, bob: 2 },
  { d: 'M10 -62L10 100M10 58C10 0 72 0 72 46L72 100', w: 82, tilt: 3, bob: -6 },
  { d: 'M8 6L8 46C8 92 70 92 70 46M70 6L70 116C70 162 14 162 6 128', w: 78, tilt: -4, bob: 4 },
];
const GAP = 58;
/** sesame seeds round it: where, how turned */
const SEEDS: Array<[number, number, number]> = [[-66, 0, -30], [-54, 58, 20], [-74, 104, -60], [892, -24, 35], [930, 34, -15], [912, 96, 50], [456, -104, 10]];

export function logoSVG(): string {
  let x = 0, letters = '', masks = '';
  LETTERS.forEach((l, i) => {
    const cx = x + l.w / 2, g = `translate(${x} ${l.bob}) rotate(${l.tilt} ${l.w / 2} 50)`;
    masks += `<mask id="lm${i}" maskUnits="userSpaceOnUse" x="-60" y="-120" width="${l.w + 120}" height="320"><path d="${l.d}" stroke="#fff" stroke-width="51" fill="none" stroke-linecap="round" stroke-linejoin="round"/></mask>`;
    letters += `<g transform="${g}">`
      // (the outline, dark brown)
      + `<path d="${l.d}" stroke="#4b2614" stroke-width="68" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      // (the dough: shaded underneath, lit above)
      + `<path d="${l.d}" stroke="#dcb889" stroke-width="51" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<g mask="url(#lm${i})"><path d="${l.d}" transform="translate(-1.5 -4)" stroke="url(#dough)" stroke-width="47" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
      // (a shine along its top, and a little warmth in the creases)
      + `<path d="${l.d}" transform="translate(-4 -9)" stroke="#fffaf0" stroke-opacity=".8" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`
      + `</g>`;
    void cx;
    x += l.w + GAP;
  });
  const seeds = SEEDS.map(([sx, sy, a]) => `<g transform="translate(${sx} ${sy}) rotate(${a})"><ellipse rx="9" ry="14" fill="#f4dfb2" stroke="#4b2614" stroke-width="3.5"/><ellipse rx="3" ry="6" cx="-2.5" cy="-3" fill="#fffaf0" opacity=".8"/></g>`).join('');
  const W = x - GAP;
  return `<svg viewBox="-100 -134 ${W + 200} 356" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="squishy">`
    + `<defs><linearGradient id="dough" gradientUnits="userSpaceOnUse" x1="0" y1="-40" x2="0" y2="150"><stop offset="0" stop-color="#fffbf2"/><stop offset=".55" stop-color="#f7e9cf"/><stop offset="1" stop-color="#ead0a4"/></linearGradient>${masks}</defs>`
    + seeds + letters + `</svg>`;
}
