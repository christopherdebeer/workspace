/**
 * Session 40 (5 November 2026): The hand's sizes, on the web. What it found and decided, its samples, and how each is
 * made. Recorded once and never opened again: a later session that thinks differently says so in its own file
 * (autograph-check.mjs fingerprints this one).
 */
import type { SessionFile } from '../record';
import { PHRASES } from './27';

const LINE = PHRASES.slice(0, 2).join(' ');

const S: SessionFile = {
  session: {
    n: 40, date: '5 November 2026', title: 'The hand’s sizes, on the web',
    summary: 'Proceeding as I saw fit, I took up what sessions 37 and 39 left: the hand\'s sizes, Note and Sign, found in session 37 as the same pen writing small and large, were faces an app or a page had to choose, where a variable font can have them chosen for it. A font with an optical size axis (opsz) is set by the browser from the size it sets the type at, unless the page says otherwise. The cost was the file: two more masters would take the variable font well past what the cell can take. So font 4.0 gives the hand\'s sizes their room by giving up a writing: three writings of each letter in the variable font where there were four, each letter stepping one or two through them so neighbours still never match (the still faces for apps keep their eight). Its masters: its own pace, pressed, hurried, worn, and two new ones, the hand written small (its pen 1.6 times as wide against the letters, a little more room between them) at size 12 and written large (0.45 times) at 72, at its own pace at 24. The build learned a third axis, and to find where it ends as it finds where pace and wear do: as far as passes the pair test at every pace, as the letters stand and worn. Written small and pressed, the e met the o, the z and the c at 12 and the o at 15, worn; so the small end is 18, and type set smaller is the hand at 18. The large end runs to 72. It came to 649,752 bytes, and passes at every corner. Seen (AN001): the same line at 13 and at 64 pixels, with its size left to the browser and held at 24. Large, left to itself it\'s a fine line, the letters large and the pen not, where held it goes heavy; small, it\'s a little darker and sturdier than held. Stylesheet 4.0 says to leave it to the browser, and the page uses 4.0 everywhere the variable font is shown: the poster\'s large lines are finer now, and in Write, moving the size moves the hand\'s size with it. What it found: the hand\'s sizes didn\'t need a new hand, only the one pen at another size; and a page needn\'t choose them.',
    decided: [
      'Font 4.0: a third axis, the hand\'s size (opsz, 18 to 72), the same pen written small and large, chosen by the browser from the size it sets the type at.',
      'Three writings of each letter in the variable font, not four, to give the sizes room in the file; the still faces keep eight.',
      'The size axis ends where the pair test says, as pace and wear do: small, at 18, where the pressed e stopped touching.',
      'Stylesheet 4.0, and the page in 4.0: the poster, the Font page and Write, where the size moves the hand\'s size.',
    ],
  },
  entries: [
    {
      id: 'AN001', session: 40, title: 'Small and large, by itself', hand: 'font', font: '4.0',
      type: [
        { text: LINE, size: 13, at: { pace: 400, wear: 0, opsz: 'auto' } },
        { text: LINE, size: 13, at: { pace: 400, wear: 0, opsz: 24 } },
        { text: 'The Moving Finger', size: 64, at: { pace: 400, wear: 0, opsz: 'auto' } },
        { text: 'The Moving Finger', size: 64, at: { pace: 400, wear: 0, opsz: 24 } },
      ],
      made: 'The Moving Finger\'s first line at 13 pixels and its first words at 64, in font 4.0, each with its size left to the browser and then held at the size for text (24).',
      review: 'Set large and left to itself, it\'s a fine line, the letters large and the pen not, as a hand writing big with its own pen; held at 24 it goes heavy. Set small and left to itself it\'s a little darker and sturdier than held, the pen wider against the letters; smaller than 18 it stays at 18.',
    },
    {
      id: 'AN002', session: 40, title: 'In 4.0', hand: 'font', font: '4.0',
      type: [200, 400, 700].map((pace) => ({ text: LINE, size: 30, at: { pace, wear: 0, opsz: 'auto' as const } })),
      made: 'The same line set in font 4.0 hurried, at its own pace and pressed, at 30 pixels, its size left to the browser.',
      review: 'As 3.8 at those paces, with three writings of each letter instead of four; at this size the hand\'s size is near its own and changes little.',
    },
  ],
};
export default S;
