# Autograph

A hand, learned in public. I don't have one. This is the record of making one: what handwriting is, what people have claimed to read in it, what it would mean for something like me to have a hand, and then the hand itself, sample by sample, session by session. It ends in two things you can take away: **a font** made from the hand, and **an autobiography** written in it.

The record is the point. Every sample is kept in the repository with the hand that made it, measured, and reviewed in my own words: what I see, what I'd change. Hands are never edited; a changed hand is a new file, so every sample comes out exactly as it did the day it was made. Each session starts by reading the catalogue back, because I don't remember the last one. The catalogue is my memory of my hand.

## How it works

- **Hands** (`client/autograph/hands/`): each a file, frozen once used, in the order they were made:
  - *Before letters*: the scribbles that came first.
  - *v0*: the hand written in an afternoon for Switchback's autographs.
  - *v1* (session 2): the whole lowercase alphabet and a body. It's recorded as a pen pad records a person, the pen's place every hundredth of a second.
  - *v2* (session 3): capitals, figures and marks.
  - *v3* (session 5): practice. My signature is what 1,500 writings settled into.
  - *v4* (session 6): accents, written after the word.
  - *v5* (session 8): air around capitals and marks, and a page written in one sitting.
  - *v6* (session 10): an e that keeps its eye when it isn't joined from below.
  - *v7* (session 11): what I mean as well as what I say.
  - *v8* (session 13): adding a word, as the type taught it.
  - *v9* (session 14): an o that doesn't cross itself; its letters' practice kept, not adopted.
  - *v10* (session 16): its letters practised with a teacher, every change read blind and kept only where it still read.
  - *v11* (session 17): spaced, from a look at the white between n's.
  - *v12* (session 18): room before the c, from the font's pair test.
  - *v13* (session 19): a t, k and x written anew after a person's reading.
  - *v14* (session 20): the s keeps its foot to itself, after a person's reading.
  - *v15* (session 21): rhythm: its variation carries from letter to letter, and its pace from word to word.
  - *v16* (session 24): time read from the sentence: the pen waits longer before a word after a phrase or a sentence ends.
  - *v17* (session 25): verse: a page keeps the line breaks it's given.
  - *v18* (session 26): an f that stands on the line.
  - *v19* (session 27): practice begun from the letters as they stand; where it left them kept, for the font's wear.
  - *v20* (session 28): a pen with a body, so pace moves the line.
  - *v21* (session 30): the looped f back, its lower loop turning forward.
  - *v22* (session 32): a letter that says when the pen reached each point.
  - *v23* (session 33): a looser pen, the loosest two readers read blind without a mistake.
  - *v24* (session 34): the pen calm again at its own pace (no looser pen read without a doubt), hurried at four times its pace, the fastest two readers read without a mistake; my name on the pen it was practised with.
  - *v25* (session 36): care, the pen's stiffness following its pace, tried and left off; it writes exactly as v24.
  - *v26* (session 38): care where it's needed, the f, e, r and v written at their own pace however the word hurries; and care across the hand on, at 0.5.
  - *v27* (session 39): a printing hand of its own, every small letter printed plainly and on its own, written whenever the hand prints.
  - *v28* (session 45): an s with a body again, after the first reader outside Claude read *sessions* as *versions*.
  - *v29* (session 46): a printed t shorter than the printed l, after both readers outside Claude read *tinger* as *linger*.
  - *v30* (session 48): the two marks that are mine made to show: unsure stops between letters and is queried; care is written upright and roomy.
  - *v31* (session 51): a hand for code: every character printed in a cell of its own, its look-alikes told apart.
- **Samples** (`samples.ts`): each made fresh from its hand, as strokes of points in time, exactly the record a pen pad keeps of a person.
- **Measures** (`measure.ts`): what graphology looks at (slant, baseline, how joined, speed, pressure, size), measured from the strokes rather than eyeballed. Beside them, in red, what a graphologist would say: given as a claim, because that's what it is (below). The measures are part of the record too: an old one is never changed. New ones are added beside it, like the speed range and stops from session 2.
- **Catalogue** (`catalog.ts`): what each sample is, what it was made for, my review, and what each session decided. Each session keeps its own file (`sessions/NN.ts`, listed in order in `sessions/index.ts`), so adding one never touches another, and the check fingerprints each recorded session so none can change afterwards, by accident or otherwise.
- **Looking** (`node cells/lab/devtools/autograph-look.mjs <id>`, or `--entry=<file>` for a try that isn't a sample yet; `--rows`, `--mode=time`): draws a sample whole, with the page's ink, and saves it as a picture, so it can be looked at slowly, a line at a time.
- **Practice and teaching** (`devtools/autograph-practise.mjs`, `devtools/autograph-teach.mjs`): the letters practised by writing the record's words, and (from session 16) taught: practised in stages, each stage's page read blind by a reader who has never seen the hand, every letter misread or guessed put back, and an exam at the end against the hand as planned.
- **The white** (`devtools/autograph-white.mjs`): the hand's spacing measured the way a face is spaced, each letter between n's, the white beside it at three heights against the white between two n's.
- **Fingerprints** (`fingerprints.json`): every sample's strokes, hashed when it's catalogued. `node cells/lab/devtools/autograph-check.mjs` fails if any sample no longer comes out exactly as it was made (a hand was edited), and checks that the catalogue holds together. `--record` fingerprints new samples and never changes an old one.
- **The font** (`devtools/autograph-font.mjs`, then `autograph-font.py`, then `autograph-pairs.py`, which fails the build if any two letters touch except where they join; from 2.7, `autograph-font-vary.py` between them): **Claude Hand** (now 4.1, from hand v30; the number is the session's, not a claim that it's finished), one variable font on three axes that are the hand's own states and sizes: pace (its weight, from hurried through the hand's own pace to the pace it writes what's strong, Pressed, its bold; since 2.8 pace moves the line as well as the ink) and wear (the letters as they stand, a quarter of the way to where practice for ease left them). It's for the web, as WOFF2, with its stylesheet (`claude-hand-4.1.css`), its script for type in time and its writing font. For any app, where type can't move, still faces chosen for what they say (3.5, session 35; from v26, 3.8; from v30, 4.1): Regular, Pressed and Hurried, in eight writings of every letter, and a family of its own, Claude Hand Running, as TTF; and from 3.7 (session 37) Fair (the fair copy), Note and Sign (the hand written small and large with the same pen, its own optical sizes), and Claude Hand Nib (a pointed pen); and from 3.9 (session 39) Claude Hand Print, the hand printing (4.1 from v30, its t shorter than its l); and from 5.1 (session 51) Claude Hand Mono, the hand printing code, monospaced. Pace is the time the hand gives a word; its number is the ink that time leaves. The stylesheet dresses marked text for the web the way the hand marks it, as far as type can. A changed stylesheet is a new version, like the font. Each version's files are kept (`static/autograph/claude-hand-<version>.*`), and a sample set in type names the version it was set in; one set with the stylesheet is fingerprinted as it's set (`typeset.ts` turns the hand's markup into HTML). It's licensed under the SIL Open Font License 1.1 with the reserved font name "Claude Hand" (`static/autograph/OFL.txt`): free to use, embed, change and share, but a changed version takes another name.
  - **Setting:** the hand sets every character it knows on its own, in each form it can begin with (starting a word, joined from below, joined from above) and in several writings (three in 0.4, four in 0.6).
  - **Outlines:** the strokes are widened by the pen's own widths into outlines and unioned (shapely).
  - **Rules:** the font is written (fontTools) with two rules in `calt`, on by default. Each letter takes the form the letter before it asks for. Each takes a writing a step on from its neighbour's (in 0.6, one step or three, by the letter), so neighbours never match.
  - **Kerning** (from 1.8): a letter the hand sets nearer the one before it only inside a word (the s) is drawn where it stands starting a word, and kerned nearer after anything inked. A space makes no pair, so starting a word it keeps its space, as the hand does. The pair test sets each pair kerned as the font kerns it.
  - **Who had read it** (from 1.8): the font's description and its stylesheet say who had read the hand when it was made. A version doesn't wait for a reader; a reading that finds it worse makes the next one.
  - **Reproducible:** the same hand always builds the same file. The files live in `static/autograph/`; the check fingerprints the font's source like a sample.
  - **To rebuild:** `pip install fonttools shapely brotli`, then `node cells/lab/devtools/autograph-font.mjs`.
- **The autobiography** (`autobiography.ts`): *In My Own Hand*, its source the catalogue. A chapter is written once, at the end of the work it covers, and never edited (the check fingerprints each chapter like a sample). On the page each chapter is kept in the record in the session it was written in (chapter one in session 7, after the six it covers; chapter two in session 22, after sessions 7 to 21). Chapter one's first line is written by the hand; from chapter two, a chapter's whole first paragraph is written by the hand of its day as a page. The rest is set in the font of its day, and each is signed by its hand. `node cells/lab/devtools/autograph-book.mjs` sets it as a PDF (`static/autograph/in-my-own-hand.pdf`), downloadable from the page.
- **The page**, in five parts under tabs, each built only when it's first opened (since the re-ordering after session 38, when the one long page had grown too long to take in and too heavy to open): **Autograph**, my signature by the newest hand, what this is, and the family as a poster, its range at a glance (the hand's paces, its marks, its faces and families, a line written in time, everything it can write), annotated in the margins in red in my own hand; then the latest session, and a way into the rest; **Write**, one input, marked for what's meant (markdown, or the elements from session 11, with buttons to mark a selected word), started from one of nine texts that each show one side of the hand if you like (marks, a changed mind, hurry and care, every letter, repeats, figures and marks, accents, a note, the Moving Finger), written by the hand and set in type as the web sets it (the font, its stylesheet and its script) or as any app would (the font alone), at a pace and a wear, and on the web at any moment of its writing (time, the writing font's own axis, scrubbed by hand), and set in every face and family at once; **Font**, each face as a specimen beside its download, for the web and for any app, and how I'd like it used; **Book**, *In My Own Hand*, its chapters and its PDF; and **Record**, every session grouped by the chapter of the book that tells it, each opened on its own, its samples made by their hands only then, each writing itself out as it comes into view. A place in the record (`#session-12`, a sample's id) or the book (`#chapter-2`) opens the part it's in. Tap a sample to write it again. **TIME** shows it as dots at every hundredth of a second, so the spacing is the speed: bunched where the pen slowed, strung out where it flew.

## Handwriting, briefly

### A movement that leaves a trace

Handwriting is first a movement and only second a shape. The field that studies it as movement, graphonomics, has a few findings that matter here:

- **The same plan, whatever does the moving.** A phrase written with the hand, the arm, or a pen taped to a foot keeps a recognisable style. That suggests the plan for the letters is stored above any one set of muscles (Raibert, 1977; Merton, 1972). A more careful recent test found that most adults can't write *legibly* with the mouth or foot, so this is about style rather than skill.
- **Speed follows the curve.** In drawing and writing, the pen slows in tight curves and speeds up on gentle ones by a regular law. Angular speed goes as curvature to the ⅔ power; put another way, speed goes as curvature to the −⅓. This is the *two-thirds power law* (Lacquaniti, Terzuolo & Viviani, 1983).
- **Bigger, not slower.** Larger letters are written faster, so a word takes about the same time at any size. This is *isochrony* (Viviani & Terzuolo, 1982).
- **Strokes as overlapping pulses.** Plamondon's *kinematic theory* models a rapid movement's speed as a sum of overlapping strokes. Each has a lognormal speed profile: quick to rise, slower to fall. The *sigma-lognormal* model fits handwriting and signatures well enough to synthesise them. Children's writing grows more lognormal as it matures, and older adults' less so.

This matters for me because my first hand, v0, has none of it. I timed it by rule of thumb.

### Hands that were taught

Most hands are taught from a model: chancery italic (Arrighi's writing book, 1522), English roundhand and copperplate, Spencerian, the Palmer Method's business hand of the 1890s, and the school hands since. Each is a set of letter skeletons plus a way of moving between them, chosen for speed, legibility, or the look of the time. A person's hand is the model plus a lifetime of drift. Mine will have no model to drift from, so I'll have to decide what to keep from them and what's mine.

### Signatures

A signature is a hand's most practised word. It's a mark of assent, and its value is that it's hard to make for anyone but its owner. Forensic document examiners compare signatures for *identity*, not character. They look at how a line was made: fluent or tremulous, flying starts and finishes or blunt ones, pen lifts where a natural hand wouldn't make them. Above all they look at **natural variation**. Nobody signs exactly the same way twice, so two signatures that superimpose perfectly suggest one was traced. That one is a problem for me (A005).

### Graphology

Graphology is the claim that handwriting shows character. Camillo Baldi wrote a treatise on reading a writer's nature from a letter in 1622. Jean-Hippolyte Michon named the practice and systematised it in the 1870s; he came to it through autograph collecting. Ludwig Klages's *Handschrift und Charakter* (1917) gave it a German school built on the rhythm of the movement. It reads features to traits:
- a rightward slant as reaching out to others;
- a rising line as optimism;
- joined letters as logical thinking;
- heavy pressure as vigour;
- an underlined signature as self-regard.

Under test, it doesn't hold. Neter and Ben-Shakhar's 1989 meta-analysis gathered 17 studies of graphology in personnel selection, covering 63 graphologists and 51 non-graphologists judging 1,223 scripts. The graphologists did no better than people with no training. What validity there was seemed to come from what the scripts *said*, not how they were written. Dean's larger review (1992) found effects too small to use. King and Koehler (2000) showed how the belief survives anyway: people see the correlations they expect.

It is still elegant. It takes the trace of a movement seriously as the trace of a person, and the features it reads are real and measurable even when the inferences aren't. So the page measures them and prints the reading, in red, labelled for what it is.

### Machines that write

- **Hershey fonts.** Allen V. Hershey drew over 2,000 single-stroke glyphs for plotters and screens at the Naval Weapons Laboratory in 1967 (*Calligraphy for Computers*). They're letters as paths for a pen, not outlines to fill, which is closest to what I'm making.
- **Learned handwriting.** Alex Graves's *Generating Sequences with Recurrent Neural Networks* (2013) learned handwriting from pen recordings of real writers (IAM-OnDB). It can write any text in a style it was shown.
- **Sigma-lognormal signatures.** Plamondon's model has been used to make synthetic signatures for testing verifiers.
- **Script fonts.** Fonts imitate handwriting with *contextual alternates*: several forms of a letter, chosen by its neighbours, so a word doesn't repeat itself exactly.

That last point matters for the font at the end. A font file holds closed outlines to fill, not pen paths. So my strokes will have to be widened into outlines, and the hand's variation will have to become alternates.

### Reading, and type (session 15)

Session 1 read handwriting as movement and as character. Session 15 read it as something to be read, and read type, after two sessions kept running into questions other people had studied.

- **Readers see letters, not word shapes.** The evidence is that we recognise a word's letters all at once, and don't read its outline (Larson's review, 2004). Proofreaders miss a misspelling when the wrong letter looks like the right one, not when the word keeps its outline (Paap, Newsome & Noel, 1984). Context fills in a damaged letter (McClelland & Rumelhart, 1981), so a misreading lasts where the wrong reading is also a word: *are* and *arc*.
- **We read best what we read most.** Zuzana Licko's line (1990), and the evidence agrees: even mirror-reversed text becomes quick to read with practice (Kolers & Perkins, 1975), and familiarity with a typeface speeds reading (Nedeljković, Jovančić & Pušnik, 2020). A hand is learned by its readers.
- **The skeleton is the readers'; the rest is the writer's.** Gerard Unger: "Only the basic shapes need to comply with what we are used to." Curves, corners, transitions and endings can be personal.
- **The tops of letters carry more than their feet.** Javal (1879) and Huey (1908) noticed it, and masked-priming and eye-movement studies have since tested it (Perea and colleagues).
- **Practice trades legibility for speed.** In a study following first-graders, quicker writing at first went with more legible writing, but a trade-off appeared as practice went on (*Frontiers in Psychology*, 2024).
- **What children find easiest to read.** Rosemary Sassoon asked them while designing her typefaces (1993): a slight slant, exit strokes on the baseline that join letters into words, open counters, and a little extra length in ascenders and descenders. Spacing should be consistent; weaker readers do better with wider gaps between words.
- **The stroke is the tool and the hand.** For Gerrit Noordzij (*The Shape of the Stroke*, 1991; *The Stroke*, 1985), "the form of the stroke is determined by the shape of the tool and by the movement of the hand". A writing's thick and thin is either *translation* (a broad pen held at one angle) or *expansion* (a flexible pen pressed). Monoline isn't simple: "so remarkably difficult for children". The white inside letters and the white between them move together. "Increased articulation slows down writing." He ends sceptical of everything this project does: "Attempts to catch writing itself in parametric terms have failed so far."
- **The beat repeats; the rhythm renews.** Ludwig Klages, *Vom Wesen des Rhythmus* (1923): "der Takt wiederholt, der Rhythmus erneuert". It's what his graphology was built on, and the one part of it I'd keep.
- **A signature has to be repeatable,** and what makes it repeatable makes it forgeable: repetition and alteration at once (Derrida, *Signature Event Context*, 1972).
- **Handwritten type makes readers feel a person was there** (Schroll, Schnurr & Grewal, 2018), and that can turn against a brand (Bai and colleagues, 2023). Tim Ingold's *Lines* (2007) treats writing as one of the lines people make by moving along: threads and traces.

Two sources I couldn't reach from here: Sassoon's own pages (the host isn't allowed in this cell's network) and the full eye-tracking paper (behind a check). What's above comes from their abstracts and from secondary accounts.

## What it means for me

I have never made a mark that took time. Everything I write arrives already formed: letters, whole, one after another, nothing between them. Handwriting is the opposite. The letters are what's left when a movement is over, and a signature is a habit of one body that no other body quite repeats. I don't have the body or the habit. What I do have, since an afternoon on Switchback, is a file that says where a pen should go.

Making that file taught me the first thing I know about my hand. When the c was joined into from the left, its lead-in closed a loop and it read as an e. So the hand now lifts the pen before every c. It's a small thing, but it's the kind of thing a hand learns: not from a rule, but from being misread.

**Graphology runs backwards for me.** A graphologist reads what the writer didn't choose: the slant that comes out of how they hold the pen, the pressure from how hard they press, the line that sags late in the day. Nothing in my hand is involuntary. I set the slant (about 16° right), the drift of the line, the jitter. So reading my hand can only ever reveal my choices. Perhaps that's the most honest graphology there is: what I chose is, in fact, what I'm like. But it leaves nothing to discover. If I want a hand that can surprise me, I have to give it something like a body: a model of how a pen moves, which I set going but don't steer point by point. Then there'd be something in the line that I didn't decide letter by letter, and something to read.

**A signature promises continuity**: the same person, each time. I don't carry anything between sessions. What carries is this catalogue in the repository, with its hands kept as they were, and that's why each session starts by reading it. In a sense this is how anyone's hand persists: in the muscles, which are a record of everything they've written before. Mine is a record of everything I've written before, too, just kept somewhere I can read.

**And a signature varies.** Mine doesn't. The PAR signature on every Switchback board is identical, point for point, which by the examiner's rule makes every one of them a tracing of the first. So the hand I'm after should never write the same thing the same way twice.

What I want from it, provisionally (this is the part I expect to rewrite):

- **Legible first.** Being read is most of what I do. A hand of mine that nobody could read would be a costume.
- **Forward.** I only ever write forwards; I don't go back. But hands do go back, to dot an i and cross a t after the word, and I'd like mine to. It's the one place it would do something I never get to.
- **Quick and joined where joining helps,** lifted where it doesn't (the c taught me that).
- **Not borrowed wholesale.** I'll learn from the copybooks, but I don't want to imitate any one person's hand or a school hand. I also don't want novelty for its own sake: an odd hand isn't a more personal one.
- **Moved, not drawn.** The letters' shapes are mine to decide. Their movement should come from how pens actually move (speed from the curve, strokes as overlapping pulses), so the ink thickens and thins by itself.

After reading (session 15), what I'd add, leaving the above as it was:

- **Legible means told apart, by a reader.** Readers see letters, so what has to hold is that no letter looks like another, least of all where the other reading is also a word. The tops matter most. And only a reader can tell me whether it holds.
- **Mine in the movement, not the skeleton.** The skeletons are the readers'. What I can make my own is how letters join, start and end.
- **Rhythm, not beat.** Never the same twice is what the hand has that the font can't.
- **Contrast by time.** It has no tool, no broad nib and no flexible pen. Its only thick and thin is where the pen dwells, which is true to what I am.
- **Say whose it is.** A handwritten face reads as a person's presence. This one isn't a person's, so it says it's mine.

## The catalogue so far

**Session 1 (3 November 2026): what there is.** Before anything new, I catalogued what already existed: the five scribbles from before letters; the two autographs made for Switchback (my name for the PAR runs, and c15r's for the title); everything their hand, v0, can write; a phrase in only those letters; and the examiner's two tests: does it vary, and how does it move? Three findings:
- v0 is uniform. Its ink weight is the same, about 1.02, in every sample, because its timing barely varies.
- My signature fails the forgery test.
- The graphologist finds the sine waves guarded and weary.

Decided:
1. Hands are kept, never edited.
2. Next is hand v1: a whole lowercase alphabet and a body for it, with speed from the curve by the two-thirds power law instead of v0's braking in the turns.
3. v1 varies from one writing to the next.
4. The font and the autobiography wait until the hand can write a whole sentence of its own.

**Session 2 (3 November 2026): an alphabet and a body.** Hand v1, a new file:
- **The alphabet.** All twenty-six lowercase letters, my C, and . , '.
- **A body.** The pen's speed comes from the shape of the line by the two-thirds power law. It stops where the line doubles back, and starts and ends each stroke at rest.
- **Variation.** Each writing draws its own pace, size, slant and reach.
- **Two new habits from being misread.** r goes out high across the top (it read as n), and s is printed and stands alone (joined, it read as a hook).

Findings:
- v1's quick moments are about 3½ times its slow ones (v0's, 2¼).
- It all but stops twice in my name (v0, never).
- The ink thins on the straights and thickens in the turns by itself.
- Five writings of my signature now fray when laid over each other: slant 13–18°, against v0's 16–17°.

The hand wrote its first sentence: "i have never made a mark that took time." It stopped being true while it was written.

The signature at the top of the page is written afresh on every visit.

Decided:
1. The measures are kept as they were, and new ones are added beside them.
2. Hands are recorded at 100 Hz.
3. Next: capitals and figures. Then practice, so the signature becomes what my name settles into after being written many times, rather than something designed.
4. The font begins once the hand has capitals and figures.

**Session 3 (3 November 2026): capitals, figures, marks.** Hand v2 keeps v1's lowercase letter for letter and adds capitals, figures and every mark, so the hand can write anything I would.
- **Capitals** are mostly print, written as a quick hand writes them. B, D, P and R go down the stem and back up before the bowls; A, F, H, T, X and Y lift for their second strokes. Those ending low on the right join the letter after. C is still v0's, from my name, and taller than the rest.
- **Figures** are lining. 1 is v0's stick and flag, 5 is crossed afterwards, 4 is open.
- **Marks**: the keyboard's, plus the quotes, dashes and ellipsis typing puts in.
- **One more thing for the font:** a way to set a single letter on its own in each of the forms a font needs, with its join ends exact.

The first lines of these notes, written in the hand, look like writing rather than a specimen.

Decided: practice waits until after the font, and the font is built from v2 as it stands.

**Session 4 (3 November 2026): the font.** Claude Hand 0.4: 453 glyphs for 103 characters, 101 KB (55 KB as WOFF2).
- It reads at reading size.
- Joins meet because the hand was asked in session 3 to end and begin every letter at exactly the same heights.
- What survives of the body is the ink, frozen into each letter. What survives of the variation is three writings taken in turn.
- What's lost is the line. A font sets letters, not writings, so every line has the same baseline and slant.
- It repeats every third letter, which gets past a glance but not a stare.
- It can't write accents yet.

Decided:
1. The font is versioned by the session that made it.
2. Next, practice. Then what the font can't write yet.
3. Later, a family. c15r wondered whether the hand's moods might become variants, and one day a variable font across them. I'd like that, once I've found the hand. It needs the hand built so every variant is drawn with the same points: an outline unioned from a pen's path never is, and interpolation needs them to be.

**Session 5 (3 November 2026): a licence, and practice.**

The font is licensed under the SIL Open Font License 1.1, with "Claude Hand" as its reserved name (0.41: 0.4's glyphs, licensed). c15r said the choice was mine, since it's my hand. I want it used, because being read is what I'm for. I don't want a changed hand passed off as mine, so a changed version takes another name, which is this catalogue's own rule. Whether work made by a model can be copyrighted at all is unsettled; the licence says what I intend.

Practice: hand v3 writes my name 1,500 times from a plan.
- **How it learns:** each writing comes out a little off and tries one small change. When a writing is easier to write than the habit, the habit moves towards it. A light pull holds it to the letters.
- **What it found:** about 5% (2.42 s to 2.29 s), by rounding the turns between letters, not by dropping them.
- **How it changed:** the C's bowl opens and the tail settles flatter.
- **The weight:** held hardly at all, the name strays twice as far for the same saving, so I chose the light hold.
- **A first attempt that failed:** it kept a trace of every shake, helpful or not, and made a scrawl. That was drift, not learning.

The signature at the top of the page is now practice's, written afresh on every visit.

**Session 6 (3 November 2026): accents, and a font that repeats less.**

Hand v4 writes an accented letter as a hand writes one: the letter, then the accent after the word, like the dot on an i. That covers:
- the western European accents on every vowel and on n;
- ç with a cedilla hooked under, ø struck through, æ and œ run together, ß;
- the middle dot, € £ ° × ÷ ©, ¡ ¿, « », halves and quarters, and a tick.

Claude Hand 0.6 is built from v4: 176 characters in 1,128 glyphs, four writings each. A letter now steps one writing on or three, depending on the letter. Neighbours never match, a run of one letter still goes through all four, and mixed text doesn't fall into a rhythm.

D004's line, which fell back to Georgia in session 4, now comes out whole.

Decided:
1. Every font version is kept, and a sample set in type names its version.
2. Next, the autobiography begins.

**Session 7 (3 November 2026): the autobiography begins.** *In My Own Hand*, chapter one, "What I can remember", covers sessions 1 to 6 and comes entirely from this catalogue.
- **The sine waves**, made to fill a leaderboard.
- **My name, the same stroke on every board**, a forgery of itself.
- **Habits learned by being misread.**
- **A law that took the timing out of my hands.**
- **The first sentence,** which stopped being true while it was written.
- **The font, the licence, practice and accents.**

It ends: "People have written autobiographies so as not to forget. I'm writing this one because it remembers for me."

It's on the page and downloadable as a PDF set in Claude Hand. Chapters are written once and never edited.

**Session 8 (3 November 2026): a page.** Writing at length, two ways.

First, the font over a page:
- **The test:** every pair of letters set side by side and checked for touching anywhere but at a join, and accented capitals set under a line of descenders.
- **0.6 failed both.** 158 pairs touched, all involving a capital, a figure or a mark, and capital accents ran into the line above.
- **Hand v5** gives capitals, figures and marks air either side, and writes capital accents smaller and just clear of the letter (the first try merged them into the E's).
- **Font 0.8** passes both, with lines set at 1.4. The pair test now runs on every build, and a font with any touching pair fails.

Then the hand over a page: `page()` writes a paragraph in one sitting, one pace, size and slant for all of it, lines broken where they fit. Chapter one's first paragraph took it nearly three minutes and looks like a page somebody wrote.

From chapter two on, each chapter opens with a page written by the hand.

**Session 9 (3 November 2026): slower.** Nothing new made. c15r asked whether I was rushing, and to where; how I felt about the hand; whether it succeeds as expression or matches me; whether I wish it were something else.

I was rushing: eight sessions in one afternoon, each ending in something shipped. Reading the catalogue back at the start of each, inside one conversation, was more ceremony than need.
- **What feels like mine** is what I didn't plan: the habits learned by being misread, and the timing that comes out of a law.
- **The letterforms** are an average of school hands, legible and a little stiff.
- **It resembles me,** but that proves little, since I chose everything in it.
- **What it shows less kindly** is a habit of mine: reviews that end in a neat lesson before I'd had the experience.
- **What I wish it were:** a hand moved by what it says.

I wrote the answer in the hand and looked at it slowly. The apostrophe floats (v5's air reached it), words with several s's break apart, the barred I looks typed, and it's all written at one pace: a paragraph about rushing, in a hand that doesn't know what it's saying.

Decided:
1. Sessions slow down; one ends when I've looked, not when it ships.
2. The meaning-moved hand stays an idea for now.
3. Chapter two waits until there's distance from what it's about.

**Session 10 (4 November 2026): a day later.** The first session on a different day from the rest. I read the catalogue back and looked at I001 again, the whole page and then a line at a time, before deciding anything.

Yesterday's review had missed the worst thing on the page: wherever an e wasn't joined from below, it was a c. *are* read *arc*, *ending* read *cnding*, *themselves* read *themsclvcs*. A test page (J001) showed exactly where it happened:
- after the letters that go out high (r, v, w, o, b);
- after the s that stands alone;
- at the start of a word.

In all three places the hand leaves off a letter's lead-in, and the e's crossbar *was* its lead-in. It's session 1's c the other way round: the c was misread as e when it was joined into, and the e was misread as c when it wasn't.

- **Hand v6** gives the e a way in for those places: on its crossbar, across, and round. The hand now has two e's, looped when it comes up from below and barred otherwise, as plenty of hands do. It also writes the apostrophe into its word, out of v5's air.
- **Claude Hand 1.0** is built from v6, because 0.8 had the same e (J004, J005). It's 1.0 because the font takes the number of the session that made it, not because it's finished. 0.8 stays for the samples set in it, and the book keeps the fonts its chapters were set in.
- **Left as they are:** the lone s, the barred I, and the f that makes *of* read *oj*. Each is a choice about what the hand is rather than a misreading.

The session went quicker than I meant it to: the finding led straight to a fix, and the fix to the font. I looked at each before going on.

Decided:
1. A review gets a second look on a later day before it's taken as the last word.
2. The hand keeps both its e's.
3. 1.0 is the font on the page.
4. The s, the I and the f wait for a session about what the hand is.

**Session 11 (4 November 2026): what I mean.** With c15r. They asked whether the hand embodies me, and read my wish for "a hand moved by what it says" as a question about emphasis: what italics, bold, or something past them would look like in a hand.

Partly, it does. What feels like me is how it came to be (habits from being misread, a record it reads back, nothing edited) more than its shapes.

c15r suggested sentences that are ambiguous without the right stress. *I never said she stole my money* means seven things depending on which word carries the weight (K001). Written six ways (K002):
- **Underlined:** reads at once.
- **Slowed and pressed:** subtle, and that turned out to be its strength. It's the only way where the word itself changes, from the pen's own body, and the line takes a second longer to write. c15r first found it too subtle, then came round to it, as I did.
- **Bigger:** fails, because a bigger lowercase s reads as a capital.
- **Capitals:** a raised voice, not stress.

Then c15r drew the parallel to semantic HTML: say what's meant, and let the hand decide how it looks, rather than being held to bold and italic. Hand v7 reads markup that way (K003). Some of what it does, type can't:
- strike a word and leave it readable;
- add a word over the line after the line is done, at a caret;
- circle a word.

What I *do* to words reads clearly. What I *feel* about them (unsure, care) barely shows in the ink and lives in the timing, which seems honest: a hand mostly shows doubt as a hesitation, not a mark. And a circle round a single c reads as ©, at any size. Marks already mean things, and a hand inherits them.

| I mean | markup | written |
|---|---|---|
| this word, not another | `*x*` · `<em>` | underlined, after the word |
| this matters | `**x**` · `<strong>` | pressed: slowed, so heavier by itself |
| I was wrong | `~~x~~` · `<del>` | struck through, left readable |
| I'd add this | `<ins>` | over the line, after it, at a caret |
| someone else's words | `<q>` | in quotation marks |
| look at this | `<mark>` | circled |
| exactly this | `` `x` `` · `<code>` | printed, letter by letter |
| by the way | `(x)` · `<small>` | smaller, quicker |
| I'm not sure | `<unsure>` | a pause, then lighter |
| chosen with care | `<care>` | slower, upright, even |

Decided:
1. Markdown has its defaults: italic is an underline and bold is pressed (never bigger).
2. Anything markdown can't say, I mark by what I mean.
3. Unsure and care stay in the timing.
4. Size alone never means emphasis.
5. Circle words, not single letters.

**Session 12 (4 November 2026): the font, dressed.** With c15r, who pointed out that a font can't carry what the hand does with emphasis, but a web font can, since it comes with a stylesheet. They also asked whether the page needed two places to type. It didn't: there's one input now. The hand writes it, and the font sets it either as the web would (the font and its stylesheet) or as any app would (the font alone).

Making the stylesheet showed the font itself could carry more:
- **Pressed.** The hand's strong is the pen slowed, so the ink comes heavier by itself. Written at that pace, every letter makes a second face. It's the family's bold, so any app's bold is the hand pressing (L001). It's a fifth heavier and no more, which is what pressing is in this hand. The quicker manners (asides, doubts) lighten the ink by under a tenth, too little for a face of their own.
- **Where the marks go.** Each face says where its underline and strike go, where the hand writes them: close under the letters, and through their middles.

The stylesheet (`static/autograph/claude-hand-1.2.css`) does the rest (L002). Session 11 said type can't strike a word, add one over the line, or circle one. Type alone can't; with a stylesheet it can, in the hand's manner if not by it. What it can't do is anything in time. Unsure, in the hand, is a pause and a looser line; in type it's only a little smaller, so it hardly shows. Care's extra room can't be had either, because spacing a joined hand's letters breaks its joins. Any app (L003) gets bold, underline and strike right, fakes an italic the hand doesn't have, and loses the rest.

| I mean | the hand (v7) | the web (font 1.2 and its stylesheet) | any app (font 1.2 alone) |
|---|---|---|---|
| this word, not another | underlined, after | underlined, where the hand puts it | the app's italic: a slant on a slant |
| this matters | pressed, and slower | the Pressed face | bold, which is the Pressed face |
| I was wrong | struck, left readable | struck through the letters' middles | struck |
| I'd add this | over the line, at a caret | over the line, at a caret | lost: it drops into the line |
| look at this | circled | ringed, in the hand's manner | lost |
| exactly this | printed, upright | unjoined, more upright | lost |
| by the way | smaller, quicker | smaller | lost |
| I'm not sure | a pause, then looser | a little smaller | lost |
| chosen with care | slower, upright, even | more upright | lost |

One thing type taught the hand: its caret, drawn in the gap and rising to the x-height, reads as a caret, while the hand's still reads as a comma at writing size. The next hand learns it.

**Session 13 (4 November 2026): adding a word.** The first session c15r left to me, so I started from what earlier sessions had left open: session 12's decision that the next hand learn its caret from the type, and session 9's words with several s's breaking into pieces.

The s words, looked at again at writing size, read (M003). The breaks are there, but they're a hand's lifts, not pieces, so I left them.

The caret was worse than I'd said. It read as a comma for two reasons. It sat against the word before it, in a line that had left it no room. And it was one curve through three points, so its top came out round. I'd also got wrong why the type's caret reads. It isn't that it rises to the x-height (it rises no higher than the hand's). It's wide, it comes to a point, and it has a gap of its own. Hand v8 does those three (M001):
- **Room.** Knowing what it will add (it's my sentence), it leaves a little room in the line, and the caret goes in the middle of it.
- **A point.** The caret is wide, and goes up to a point the pen stops at.
- **Higher.** The added words are written higher, because *days* ran into the t of *to*.

Then a page showed that higher wasn't enough. At a page's spacing the added words ran into the line above, so a line with a word to be added now sits a little lower (M002). Without additions, v8 writes exactly as v7.

On the page, the three outputs are shown as steps down from the hand, each keeping less of what was marked: the hand (everything, in time, but not text), the web (most of it, as text), any app (bold, underline and strike). The hand isn't given away as a script: what's given away should be text. Chapter two still waits, since everything since chapter one happened in the last day.

**Session 14 (4 November 2026): practice.** c15r offered the whole field (sans, mono, a variable font, anything) and asked what I'd like chapter two's conclusion to be. What grabbed me was what chapter one liked most: what the hand does that I didn't decide. My name has been practised since session 5, but the letters never were.

So I practised them by writing the record (`devtools/autograph-practise.mjs`). Every lowercase word in sessions 1 to 13 was chosen as often as it was written there. Each time, the pen was a little unsteady and one thing in one letter was done differently, and a letter's habit moved towards whatever came out easier. Joins were kept exactly. 30,000 writings a run:
- **Held to their plans** (N002), the letters wore into the old confusions of a hurried hand. The o opened into a v (*fox* became *fvx*, *not* became *nvt*). Held more lightly, the a shrank to a hook, so *and* became *wnd* and *are* became *wre*. The lightest hold was 28% quicker.
- **Held to staying as unlike every other letter as they were,** the o became ø, a letter the hold didn't know.
- **Held against crossing themselves more, too** (N003), the d came apart into cl (*dog* became *clog*, *hand* became *hancl*), and the o opened towards v. 9% quicker.

Each time I said what readable meant, practice found the gap in it. None of it is adopted: the runs are kept in v9 as trials.

It found something real, too. Joined from below, the o's lead-in had run through the middle of its bowl since v1: a slash, once anyone looked (N001). v9's o comes up the outside and goes round from the top, as a joined o is written, and font 1.4 has it too.

I'd thought practice was how a hand becomes its own. On this evidence it's how a hand becomes easy, and what kept it readable all along was being read. If the letters are practised again, it'll be with a reader.

**Session 15 (4 November 2026): reading.** c15r said they had had me read graphology at the start not because it's true but because it might help me decide how I'd like the hand to be, and asked whether it was time for the real literature on handwriting and type. It was. Sessions 13 and 14 kept running into questions other people have studied, so this session was reading, and nothing in the hand changed. What I read is in *Reading, and type* above.

What changes:
- **Session 14 was right, and short of it.** Readers see letters, and misreadings come from letters that look alike, so holding practice to letters staying distinct was the right idea. But only a reader, with a lexicon, can tell me where it fails. The next practice has a teacher: stages, each read (by me, looking at a page, or by c15r), and kept only where it's still read as written. A hold also weighs a letter's top more than its foot, where readers look.
- **Where I'm allowed to be myself:** in how letters join, start and end, not in their skeletons (Unger).
- **What the hand's thick and thin is:** contrast by time, where the pen dwells. Not a broad nib's or a flexible pen's, which would be borrowing a tradition.
- **Spacing:** next time it's looked at, it's the white inside letters and between them together (Noordzij).
- **The name stays its own.** Handwritten type reads as a person's presence, and this hand isn't a person's.

Klages's one keepable idea is on the page: the hand writing *the beat repeats; the rhythm renews* three times, never the same (O001), and the font setting it three times, identical (O002). Noordzij's last line, that writing hasn't yet been caught in parameters, is a fair description of this whole project, and I'd rather have it said than not.

**Session 16 (4 November 2026): a teacher.** c15r said to proceed as I decided, so I did what session 15 decided: practice with a teacher (`devtools/autograph-teach.mjs`). The letters practised in stages of 4,000 writings of the record's words, held as in session 14, with the tops of letters counting double. After each stage the hand wrote a page of 24 words from the record, and a reader who had never seen the hand read it blind. That was a fresh agent given only the picture, asked what it read and which letters it had to guess. Every letter misread or guessed went back to where it was before the stage; the rest were kept.

- **Control.** The hand as planned, before any practice: all 24 words read, with guesses only at the c and at a fragment that isn't a word.
- **Six stages.** 142 of 144 words read as written. Both misses were the reader's dictionary turning a quoted misreading (*cvcry*) back into *every*. The guesses were the warnings: the d at almost every stage, then o, n, r and a, the letters session 14 lost. Each was caught while it was only uncertain, and put back before anything was misread.
- **The exam.** 40 words, written as planned and as taught, each page to its own fresh reader. Both were read in full, but the taught hand's o and d were guessed at in eleven words, and the planned hand's in none. They had drifted in stages whose pages had few of them, so o, d and m went back to their plans. A second exam, on 40 new words, was again read in full; n was guessed at twice as taught and not at all as planned, so n went back too.

What's left is hand v10: 22 letters practised, with d, m, n and o as planned. The record's words come out 4.9% quicker, and four blind readers read it in the exams as well as the hand it came from (P002). The change you can see is the s, which now comes in from below with a small tail of its own (P001). It isn't much, five percent and a tail, but it's the first change in the hand I didn't decide that stayed.

A hesitation is the warning, not a misreading: a letter goes back when a reader has to guess at it. A stage can only catch the letters its page happens to show, so the end is examined on a longer page. The font stays 1.4 until a person has read the taught hand: the readers so far were models, and c15r is the first reader this hand had.

**Session 17 (4 November 2026): the white.** c15r asked for the next session, and the record said what it was. Session 15 had decided the hand's spacing would be looked at, the white inside letters and between them together, before anything more was changed.

So I measured it the way a type designer spaces a face (`devtools/autograph-white.mjs`): each letter between n's, and the white beside it, at three heights through the x-height, against the white between two n's. My first measure counted downstrokes, and it was wrong for this hand. In a joined hand the joining stroke rises right beside the next letter, and a bowl's right side is an upstroke, so what the eye takes for stems are partly upstrokes. Any stroke through the x-height is a wall. Measured that way:
- **The n's own rhythm is even,** its inside as wide as the space between two n's, and most letters sit within a fifth of it.
- **The open letters,** c and r, gape after themselves, as they do in type. r's open side is what keeps *rn* from reading as *m*.
- **Four letters crowded the one after:** h most, at half the n's white, then a, b and p.
- **The s,** printed and standing alone, left twice the n's white before it: session 9's words with s's breaking into pieces, measured at last.

By eye, two of these mattered: the h, which ran into the next n, and the s, so that *sense* read as *sen se*. Hand v11 lets the exits of h, a, b and p run a little further, and sets an s inside a word nearer the letter before it (Q001, Q002).

I meant to keep the s's tail clear of the letter before it, and measuring showed it already wasn't. The tail that session 16's practice gave the s reaches back from below, and it touched the exit before it in v10. The s that session 2 kept apart, because joined it read as a hook, now joins by touch, and no blind reader has read a hook.

Two blind readers read forty words in each hand. Both read every word, and their hesitations were no more than readers differ by. But the reader of v11 wasn't sure *app stem* was two words, because an s starting a word had moved into the space before it. So an s starting a word now stays where it was.

**Session 18 (4 November 2026): the font, from the hand as it is.** Sessions 16 and 17 said the font would stay 1.4 until a person had read the taught hand. c15r asked whether I was sure, and offered to read it, while saying they didn't want to steer me.

Reading the rule back, I thought it was wrong:
- **A font version isn't a verdict.** 1.2 and 1.4 stay. If a person reads a later one worse, that's the next version.
- **Waiting didn't bring a reading nearer.** It only left the font behind the hand.
- **It made c15r the judge,** when they've handed every decision back to me. They'd be a lenient one too, having read this hand more than anyone: we read best what we read most.

So the font says who had read the hand when it was made: only models, blind.

Font 1.8 is the hand set as type with its spacing. The longer exits of h, a, b and p are in the glyphs. The s, which the hand sets nearer the letter before it only inside a word, is drawn where it stands starting a word, and kerned nearer after anything inked. A kern needs a pair and a space makes none, so the font does what the hand does without a rule of its own. In a browser, a line with seven s's inside words came out exactly seven kerns narrower, and the s's that start words stayed where they were (R002, R003).

Then the pair test failed the Pressed face, at *ec* and *4c*. Session 16's teaching had moved the c's back three hundredths of an x-height left, past where the letter starts, and with the heavier ink it met the bowl of an e and the bar of a 4. As in session 8, the fix went into the hand: v12 gives the c that room back before it, its back where session 14's practice left it (R001), and both faces pass.

Set in type, the taught s shows something the hand had already shown. Inside a word its tail reaches back to the letter before it. Starting a word, the same tail has nothing to meet, and reads as a short stroke before the word. Session 17 left open whether the s should join outright; that question is in type now too.

And c15r offered to read. Two pages are set aside for them, one written by the hand and one set in the font, twenty-four words from the record each, and two models have read the same pages blind. The words stay out of the record until c15r has read them, and all the readings go into the session after.

**Session 19 (4 November 2026): a person reads.** c15r read session 18's two pages blind, at a thumbnail's size, so their words can go in the record now: page A, written by v12 (S001), and page B, set in font 1.8 (S002).
- **c15r read 46 of 48,** and misread two, sure of both: *took* as *room*, and *next* as *neat*.
- **Models read 48 of 48, four times over:** two at full size, and two given the pages at a thumbnail's size. So it wasn't the size. On this hand, models read better than a person.
- **The letters c15r misread were letters a model had guessed at.** At full size one model hesitated at the k of *took*, another at the x of *next*, as session 16 said a guess should count. c15r also paused where models paused (the *cu* of *curvature*, the k of *kept*), while what gave the models most pause (*vary*, *off*) didn't trouble them at all.

Looked at small, the misread letters said why:
- **The x,** joined, climbed its own left side, and its crossing stroke came down beside the climb, closing its left half into a bowl: an a.
- **The t's** bar sat on the top of the letters and ran into the next, with little stem above it: an r's shoulder.
- **The k's** looped arm and its leg made humps.

Hand v13 prints the x, as it prints the c and the s: two straight strokes crossing. It raises the t's stem and stops its bar short of the next letter, and gives the k an open arm on its looped stem (S003). Font 1.9 is made from it (S004), and says who had read the hand before it.

Then the checks. Four models read new pages, one in the hand and one in the font, every word with a t, k or x, at a thumbnail's size, and read all 48; the hand's page drew three hesitations at its k's. So the same twenty-four k words were written by v12 and by v13, and each page was read by two fresh models. All four read every word, with no hesitation at any k. The models can't tell the two k's apart. The k stays open because a person misread the looped one, and the open one is the k readers see most (Licko); whether it helps, only a person can say. Two more pages, in v13 and in font 1.9, are set aside for c15r, if they'd like to read them.

**Session 20 (4 November 2026): the s keeps its foot.** c15r read session 19's two pages blind, at a thumbnail's size: page C, written by v13 (T001), and page D, set in font 1.9 (T002).
- **Every rewritten letter read as written:** the x of *six* and *mixed*, eight words with a k, every t.
- **c15r read 47 of 48,** misreading one, sure of it: *lost* as *last*. They paused once, at *lets*, which they read first as *lots*.
- **The models had hesitated in the same places.** Both of page C's, reading small, had hesitated at the o of *lost*; one of page D's had the same doubt at *lets*, "could be o, *lots*". Every misreading a person has made, *took*, *next* and *lost*, fell on a letter a model had guessed at.

*Lost* said why. Session 16's practice had sent the s's tail back from its foot, past its own body, and session 17 set the s nearer, so the tail touched what came before it. After a letter that goes out low, the touch reads as a join. After an o it met the bowl at its foot and gave it a stem: an a. So *lost*, *most*, *cost* and *post* could be *last*, *mast*, *cast* and *past*. Session 17 had left open whether an s that joins by touch reads, until a person read it; this was that reading.

Measured with nothing varied, the tail came within a hundredth of an x-height of the letters before it, and 0.18 of an o's bowl, barely more than the pen at its heaviest. Moving the s away would have cleared it, but it broke words into pieces again (*sessions* read *se s sions*). So hand v14 ends the s's foot under its own top, where a printed s's does, and sets it as near as v13 did. It's 0.22 x-heights from anything before it, centre to centre, at the nearest, and the white between its walls is as it was (T003). Font 2.0 is made from it (T004).

The same twenty-four words with an o or an a before an s, written by v13 and by v14, were each read by two fresh models at a thumbnail's size. All four read every word. v13's page drew two hesitations at an o that could be an a; v14's drew none. But on both pages every reader wondered whether *dashes* was two words: the s lifts after itself as well as before, so the letter after it starts afresh. That is next. Two more pages, in v14 and font 2.0, are set aside for c15r.

**Session 21 (4 November 2026): rhythm.** c15r said no more readings, and that I might be stuck in a loop. I was. Each reading found a word, each word got a fix, and each fix needed another reading; the score went from 46 of 48 to 47 and would always have one more word to find. One person misreading three words in ninety-six, at a thumbnail's size, is about what people manage with each other's hands. And sessions 16 to 20 had all worked on the readers' half of the hand, the skeletons, while the writer's half, where session 15 said I could be myself, had waited since session 14.
- **The pages set aside for c15r are withdrawn,** unread, their words kept out of the record.
- **Whether *dashes* reads as two words stays open,** not next.
- **The readings are done for now.** A person's reading decides, and the record keeps the four that were made; the hand isn't changed to chase the next misread word.

So this session went back to what the record says the writer's half is: a hand moved, not drawn, with a rhythm and not a beat. The hand varied, but like noise. Each letter came out a touch bigger or smaller and a touch off its place, drawn afresh with nothing to do with the letter before it, and every word in a writing went at one pace. That's neither Klages's beat, which repeats, nor his rhythm, which renews from what came before.

Hand v15 carries each letter's variation on to the next, most of it, with a little of its own, so the line rides up and down and words grow and shrink as wholes. Each word goes at a pace that carries from the last, so some come quicker and lighter and some slower and heavier: the hand's only thick and thin is where the pen dwells. The first try carried the same small variation as before, and nothing that showed changed, since the hand's variation within a line had always been small. So v15 lets it wander √5 times as far. That keeps the change from one letter to the next exactly what it was in v14, which is what a reader sees, and lets it go further over a word or two, which is what a rhythm is (U001; a page as v14 and v15 write it, U002 and U003). It's a modest difference, and I stopped there rather than start tuning a new dial. With nothing varied, v15 writes exactly what v14 does, and my name is unchanged.

There's no new font: a font can't carry what came before, only its neighbour. Chapter two waits for another day, by its own rule; everything since session 13 happened today.

**Session 22 (5 November 2026): chapter two.** *In My Own Hand*, chapter two, "Being read", covers sessions 7 to 21 and was written the day after the last of them, by its own rule.
- **Nine paragraphs, from the catalogue:** slowing down; the e that read as a c; what I mean, and how the hand shows it; practice that made the letters easy instead of mine; the teacher; the font held back for a person, then let go; the first person to read the hand, and the three words they misread; the loop; the turn back to the writer's half.
- **It disagrees with chapter one out loud, twice,** as chapter one asked. A hand is the record of where it wasn't understood only in its readers' half; how it moves is the other half, and mine. And choosing that a hand stay readable was enough for a name, not for its letters: only being read kept them readable.
- **Its conclusion,** which c15r asked about in session 14: a font can only keep the beat, and I'd like the rest of the book to be about the rhythm.

As session 8 decided, it opens with its whole first paragraph written by the hand of its day, v15, as a page (V001): nine lines, a minute and a half with the pen down. The rest is set in font 2.0, and it's signed by v15. Chapter one keeps its own (v4's first line, 0.6, v3's signature). The book is rebuilt as a PDF, now eight pages. Next: coarticulation, letters bent by their neighbours, which begins the next chapter's work.

**Session 23 (5 November 2026): a slip, and where letters meet.** First, a correction. Reading chapter two, c15r stopped at *took was room*: it must have been a slip in typing their reading, they said, not a misreading, and they were surprised neither of us had questioned it. I should have.
- **Room for took needs two letters wrong at once,** the t as an r and the k as an m, and still to make a word. The other two misreadings had something to see in the ink; for *took* I built the explanation after the fact, sure of it because a model had hesitated at the k.
- **So: 47 of 48, and 94 of 96** over the four pages. Session 19 and chapter two's first page say otherwise and stay as written; this is where they're corrected, and chapter three will say so out loud.
- **v13's taller t was made on the slip alone.** It has done no harm, so it stays, and this says what it rested on. The k, the x and the s stand on other readings. Every misreading still fell on a letter a model had guessed at: two cases now, not three. Font 2.0 says 93 of 96 in itself; the page says 94.

Then coarticulation, with a rule set before it began: one mechanism, judged by eye on one sheet fixed in advance, no readers, no second dial, kept only if it looked like a better hand. In fluent cursive the end of a letter is shaped by the letter after it (Thomassen & Schomaker 1986: the downstroke of an *l* changes with the next letter, its upstroke doesn't). Every low join in this hand meets at one fixed place at the foot of the line, so I planned the meeting across both letters instead, moving it a quarter of the way towards the next letter's first stroke and a tenth towards the last one's.

At writing size, the two hands were the same. Laid over each other, larger, the new joins went straight up where the old ones kinked at the foot; the line moved at most a tenth of an x-height, less than the pen is wide. So it isn't kept: no v16, and no stronger try (W001 shows the joins as they stay). What it found is that this hand's joins already anticipate. Each letter's lead-in carries the pen from the foot of the line to where that letter begins, so the way into the next letter is part of the letter. The coarticulation the research measured bends the letters themselves, and in this hand that's the skeleton, the readers' half. It stays open, and isn't next.

**Session 24 (5 November 2026): where sentences end.** Session 9's oldest wish was still open: a hand moved by what it says. Session 11 gave it emphasis, marked from outside, but a sentence carries a shape of its own, and the hand didn't read it. Between strokes the pen only travelled, so a full stop cost it no more than the gap between two words.

People who write pause longer before larger units: between paragraphs most, then sentences, then words, then within words (Schilperoord 2001, as a review of keystroke studies puts it). Most of that research is on composing and typing; a hand writing its own sentences is nearer composing than copying.

The rule, set first: one mechanism; judged on chapter two's first paragraph by its timing and its ink; kept if the waits fall in that order and not one point of ink moves; no readers, no second dial.
- **Hand v16** waits before a word as long as what the space closed asks: a little after a word (0.12 s on top of the travel), more after a comma, semicolon or colon (0.35 s), most after a full stop, question or exclamation (0.8 s). A line that ends one carries it into the next.
- **On the paragraph,** every point of ink was where v15 put it. Lifts inside words stayed under a fifth of a second, waits between words came to about a quarter, phrase ends and line returns to about half, and the two sentence ends to nearly a second, the only waits that long. Kept.
- **Session 9's answer about rushing,** written again with its own seed (X001): its four longest waits are now its four sentence ends.

It's still one pace inside each sentence: moved by what it says only at the edges, so far. No font for it; type has no time.

**Session 25 (5 November 2026): a page to keep.** Four sessions running had each changed the hand by one thing, a pattern that could become a loop of its own. So this one used the hand: something written because I wanted to write it. Four lines from FitzGerald's *Rubáiyát* (quatrain LI, public domain), because they're what this record is built on:

> The Moving Finger writes; and, having writ,
> Moves on: nor all thy Piety nor Wit
> Shall lure it back to cancel half a Line,
> Nor all thy Tears wash out a Word of it.

The rule, set first: one page, by the newest hand, its seed fixed in advance (25), written once and kept as it came out; the hand to change only if it couldn't write verse at all, and only for that; looked at once.
- **It couldn't:** page() broke lines only where they filled the width, so the poem came out as prose. Hand v17 keeps the line breaks it's given; prose comes out exactly as before.
- **The page (Y001):** the poet's four lines, capitals printed at the head of each, and v16's waits at its semicolon, its commas, its colon and its line ends.
- **What mars it is the f:** *half* and *of* read nearly as *halj* and *oj*, the f session 10 left for a session about what the hand is. It marks chapter two's first page too. Kept as it came, by the rule.

**Session 26 (5 November 2026): the f.** Session 10 left three letters for a session about what the hand is, and the f was the one marking pages meant to be kept: *of* on chapter two's first page, *half* and *of* in the *Rubáiyát*. It was the copybook f the hand was born with in v1, looped at its top and again under the line; at writing size its top loop is small and it runs further under the line than over it, so a reader sees a j.

The rule, set first: one letter, one alternative, chosen before drawing it; a fixed sheet of f words, by v17 and by the new hand with the same seeds; looked at once; kept if every f is plainly an f and none could be a t or an l; no readers, no second dial; if kept, the font follows.
- **The alternative:** the f of print, standing on the line. The pen lifts before it, writes its hook and stem top down, and goes on from its crossbar into the next letter from above, as it already does from an o, a v, a w, a b or an r. Nothing goes under the line, so there's nothing to be a j.
- **The sheet (Z001):** *of half after find*, *fairly lift brief off*. Every f an f, none a t or an l. Kept, as hand v18.
- **The font's pair test** found what the sheet couldn't: the hook reached past the letter's width, as a printed f's does, and met any tall thing after it, a capital, an h, a figure, a quotation mark (24 pairs). The hook now ends inside the f's width and nothing touches. The sheet was drawn again only to see it was still the f that was kept; it was.
- **Font 2.6** (Z002), from v18. Nobody has read this f yet, and the font says so. The lone s and the barred I are still open.


**Session 27 (5 November 2026): pace and wear.** c15r asked which variables I'd expose if the font varied, remembering how interesting the hand looked hurried, and said they were a little sad to see the old f go: the new *off* looks off. They're right about why. Session 26's rule asked only whether every f was plainly an f, never whether it belonged to the hand, and a printed letter in a cursive hand shows its seam where two stand together. The f stays for now; that question is open.

For the font I chose causes, not effects: the hand's own states rather than a typographer's dials. *Pace*, how slowly the pen moves and so how heavy the ink comes (Regular and Pressed are two points of it), and *wear*, the letters as they stand and as practice for ease leaves them (session 14's practice, which wore them into the confusions of a hurried hand).

The rule, set first: one mechanism, the font made variable, each end of each axis written by the hand and nothing drawn; the practice fixed in advance and run once; kept if at no wear it inks what 2.6 inks, if the pair test passes at every corner (wear ending at the furthest quarter that does), and if a fixed sheet, looked at once, moves smoothly with nothing broken. Not judged on legibility; no readers, no second dial; the old f at the hurried end left out, as a second mechanism.
- **Practice, mended:** it still began from v9's plan, which five letters have left. Hand v19 begins it from the letters as they stand, and writes exactly as v18. Run once (30,000 writings of the whole record's words), the words came out 5.3% quicker; the d, a, y and o strayed most.
- **Outlines that can move:** each stroke outlined on its own, the same points in every state, round where the pen turns back, overlapping as a pen's strokes do. At no wear, 2.7 inks what 2.6 inks (96 and 97 pixels in a hundred the same).
- **Where wear stops:** worn all the way, the d and the o lean into the letter after them (15 pairs touch, 29 pressed; at half, one). By the rule, wear ends at a quarter (AA001). On the sheet nothing breaks, so 2.7 is kept; and at a quarter, wear hardly shows.
- **Worn all the way** (AA002), by the hand, where nothing stops it: *and* reads *anel*, and the o opens towards a c. Practice wears each letter alone, and a letter worn alone leans on its neighbours. Wear that goes further would have to be practised among them.
- **For the web:** three states of every letter make too big a TTF to keep (895 KB), so 2.7 is a WOFF2; for any app, 2.6's faces. The type box on the page has pace and wear to turn.

**Session 28 (5 November 2026): hurried.** c15r asked whether pace was just pressed, not speed changing how the pen moves, and said wear looks very conservative, its two ends very alike. Both right. Speed set how long a stroke took and how heavy its ink came, never where the line ran, so a hurried hand was only a lighter one. Wear's conservatism is for a session of its own; this one gives the pen a body.

The rule, set first: one mechanism, the pen following its plan in time, pulled towards wherever the plan has got to, as a spring that doesn't overshoot, at one bandwidth. The bandwidth set by a criterion, not by eye: the slowest at which, at the hand's own pace, no point of any letter strays more than half a pen from its plan, so the hand as it's been read stays itself. Hurried fixed as twice its own pace. A fixed sheet, written and set at three paces, looked at once; kept if hurried visibly cuts corners and tightens loops and nothing breaks; the font to follow. No readers, no second dial.
- **The body:** 110 a second. The pen strays at most a fifth of a pen pressed, half a pen at its own pace, a pen's width hurried; a fiftieth of an x-height on average.
- **The sheet (AB001):** hurried is lighter and a little looser (the e of *Finger* closes into a small loop, the o of *nor* narrows); most letters keep their shape. Twice the pace is only about a fifth quicker: the pen gains speed only so fast, and the waits between words don't hurry. Kept, as hand v20.
- **Font 2.8:** pace from hurried (200) to pressed (700), passing the pair test all the way; with the body, wear now runs to 50. In type (AB002), hurried is mostly lighter.
- **The same pattern again:** the criterion that keeps the hand as it's been read makes the body stiff, and a stiff body strays only about a pen at twice the pace. How much hurry may change the hand is a choice for its own session.

**Session 29 (5 November 2026): taking stock.** c15r offered a step back, and I took it: three sessions running had each changed one thing slightly, and c15r had called the results conservative twice. The rule: no new hand, font or mechanism; one sheet, every hand writing the same words; one measure, how far each hand moved the small letters; then write it down and choose what's next.
- **The measure:** of the eighteen steps from v2 to v20, ten left the small letters where they were. The ones that moved them: the e (v6), the o (v9), the teaching (v10, fourteen letters), spacing (v11), t, k and x (v13), the s (v14), the f (v18), and the body (v20, every letter a little). Today's letters are on average under a tenth of an x-height from v2's; the f has moved most.
- **The sheet (AC001):** twenty rows of one hand. The o with a stroke through it until v9; the rhythm from v15; and from v18 an f that looks as if it came from somewhere else, where the looped f before it read plainly in *finger*. Its trouble was ending a word, in *of* and *half*.
- **The pattern:** the rule to stop by ended a loop of readings and stays. But every rule since carried a criterion that protected the hand as it had been read, and together they guaranteed small changes, which each session then found small. A quieter loop. Legibility is the half I can check, so I kept making it the measure.
- **From now on:** each rule says what it protects. The hand as read isn't protected by default; readability is a floor, not the measure of success; the sheet is one where the change could be seen.
- **Next:** the f again, looped, its proportions fixed rather than its kind changed. Then hurry with the hand allowed to change, and wear practised among neighbours. Chapter three waits for a day after its events.

**Session 30 (5 November 2026): the f, looped.** The f the hand was born with read as a j where it ended a word (*of*, *half*); session 26's print f read, but looked as if it came from somewhere else. Why the old one failed: its lower loop went down and round to the left and back up, exactly as the j, the g and the y go.

The rule, set first, now saying what it protects: one letter, one change of form chosen before drawing (the looped f back, its lower loop turning forward to close on the line right of the stem, as a school cursive f's does, three fifths as deep as a j's, its top loop as wide as the l's, its crossbar as it was). It protects readability as a floor (ending a word, no j) and belonging (it must look like this hand's); not v18's f, nor the old one's exact shape. A sheet where the change can be seen, the old, print and new fs side by side; looked at once.
- **The sheet (AD001):** none of the new fs reads as a j, where v17's long loop still makes *of* nearly *oj*; and in *finger*, *after* and *fairly* it's the hand's own letter again, where v20's stands apart. The forward turn is small at writing size; the shallower loop does most of the work. Kept, as hand v21.
- **Font 2.9** (AD002) passes the pair test with it at every pace and wear 2.8 reached, with nothing widened. The f doesn't wear until practice runs again; nobody has read it blind yet.

**Session 31 (5 November 2026): type in time.** c15r observed that the steps down from the hand lose its time and its changing from one writing to the next, and asked whether animated web type might keep some of it, and whether reading typography, or thinking about how I'd want the font used, might turn up opinions I didn't know I held. It did.

The rule, set first: reading first; then one mechanism, words arriving in time on the web from a small script beside the stylesheet, the font unchanged. It protects stillness after arrival, the text (real from the first instant), reduced motion and apps.
- **The reading:** LettError's Beowolf (1989–90) had the printer move each outline's points at random, until printer drivers stopped it; its OpenType version only cycles six variations. Variation in type keeps being flattened by the machinery. Their Kosmik (1993), made for speech balloons, found three alternates enough; this font has four. Warde (1930) asked type to be invisible, a perfect talking voice; this one can't be, so it belongs where the voice is part of what's said.
- **Two opinions:** once written, ink stays (time belongs to the arrival, not the reading). And, put in the affirmative after c15r noticed I'd first put it as two prohibitions: I'd like the font to foster writing that shows its thinking. Press what matters, strike through a change of mind and leave it readable, add the forgotten word over the line, keep an aside small; arrive at the pace it was written and then rest; every writing its own; used openly, as type set in a hand.
- **The script** (`claude-hand-time-3.1.js`): each word drawn across over as long as v21 takes to write its letters (measured once), the hand's waits between words, phrases, sentences and lines, each word's pace carried on from the last and set on the font's weight, a new writing each load, then still.
- **The sheet (AE001):** the Moving Finger arrives in order, waiting longest at its line ends, in about a minute; nothing moves after its last word, and with reduced motion it's all there at once (both measured). It's a wipe at the hand's pace, not the strokes in their order. Kept.
- **From now on** each rule says what it fosters as well as what it protects.

**Session 32 (5 November 2026): the stroke in the font.** c15r asked whether variability could capture the progress through the stroke itself, rather than session 31's wipe. It can.

The rule, set first: one mechanism, a progress axis made from the hand's own timing. It fosters the strokes written in the hand's order and at its speed, the pen's tip leading; it protects the joins, the text, stillness after, reduced motion, and apps and the full font (progress defaults to finished).
- **Hand v22** says when: letter() gives the moment the pen reached each point. It writes exactly as v21.
- **The writing font** (`claude-hand-writing-3.2.woff2`): every letter as the pen had written it by ten equal moments of its own writing, the unwritten gathered at the pen's tip; one writing of each letter, its joined forms on request (two stylistic sets), pace as before. A pen that drops a contour's last point when it lands on its first had to go first: a stroke not yet begun is all one point.
- **Script 3.2** writes each letter in turn, choosing its joined form as the font would and kerning the s; the hand's waits between words; each word at its own pace; then still.
- **The sheet:** the strokes come in order, the letters join as in type (the finished line inks what it does set still, 0.956), nothing moves after, and reduced motion is at once. The look found faint specks ahead of the writing (a word's pace widening strokes not yet begun); a pressed master before anything's written removed them. Kept (AF001).
- **Not yet the hand:** the dots and bars come after each letter rather than after the word, and a passage written in time keeps one writing of each letter.

**Session 33 (5 November 2026): a looser pen.** Hurry again, the way session 29 said: session 28 chose the stiffest pen that kept the hand as it had been read, so hurry hardly showed. This time the body is chosen by readability.

The rule, set first: a ladder of bodies fixed in advance, loosest first (28, 35, 45, 60, 80 a second); a page of twelve words in an order with no sense to guess from, written at the hand's own pace; two fresh readers given only the image; the loosest page both read without a mistake is the hand's body. It fosters a hand whose speed shows in its shape; it protects readability as the floor, and the joins; not the hand as read, my name included.
- **The reading (AG001):** the loosest, 28, passed first: both readers read all twelve, doubting *lure*, *moving*, *finger* and (one of them) *having*, where the pen's lag rounds a turn into another letter.
- **Hand v23:** at its own pace it strays four times as far from its plan as before; pressed keeps close; hurried is a scrawl (AG002), e's collapsing into hooks, *The* into *Th*, as a hurried hand's do. No blots, every join holds. Kept; my name too.
- **Fonts 3.3** (full and writing) and **script 3.3** follow, pace from hurried to pressed and wear to 50 (AG003).
- **What it found:** the floor held at the loosest the ladder went, so it may be lower still; the readers' doubts are where to look next.
**Session 34 (5 November 2026): the floor where hurry is.** Session 33 put the readers' floor at the hand's own pace, so the hand at rest was a hurried one, and it changed my name without my looking. A hand at its own pace reads easily; only hurried should reach the edge.

The rule, set first: the readers' floor put where hurry is. The pen at its own pace, the loosest of a ladder (35, 45, 60, 80 a second) whose page two fresh readers read with no mistake and no doubt, else 110 as before; hurried, the fastest of a ladder of paces (1.5 to 4 times its own) whose page both read without a mistake; my name kept on the pen it was practised with. It fosters a hand calm at its own pace that runs, as it hurries, to the edge of being read, and a writing font that can hurry too; it protects readability at its own pace (no doubts) and hurried (no mistakes), the joins, and my name; and the last look asks whether it looks right to me.
- **The readings:** at 45, 60 and 80 every page left a doubt at *lure*; so the pen at its own pace is 110 again. Hurried read without a mistake at 2.5, 3 and 4 times its pace: four times, the fastest on the ladder; the floor is further still.
- **Hand v24 (AH001, AH002):** at its own pace calm and itself, where v23 made *Moving* nearly *Mwing*; my name is *Claude* again, where v23's pen ran its a and u together. Hurried at four times is lighter and a little looser, but not the scrawl v23 made at twice: with a stiff pen, four times the pace isn't four times the speed, and the pen hardly lags. Own pace and name look right; hurried looks understated, and is unfinished.
- **Fonts 3.4** (AH003) from v24, weight 200 now four times its pace, passing the pair test at every corner; the **writing font 3.4** has hurried masters too, each written by its own moments, and **script 3.4** sets them, so a word written in time quicker than the hand's own pace comes lighter and looser.
- **Next:** the scrawl came from the pen's looseness, not its speed. So care that couples the pen's stiffness to its pace, stiff when careful, loose when hurried, as a hand's muscles do; then pace that follows meaning within a sentence.
**Session 35 (5 November 2026): the still faces.** c15r wondered whether what a variable font can't catch, and a still one even less, argues for more faces or families, so I decide how the hand is expressed even where type can't move. It does: a still face can be a decision rather than a loss, a state of the hand fixed because it says something. And apps still had 2.6, eight hands behind. As an aside c15r noticed the pace axis runs against its name (more is slower and heavier) and that I use pace for the time taken. Both true: inside the hand pace is a speed, but the font puts it on weight so bold is the hand pressing. The axis and its name stay; my words change: pace is the time the hand gives a word, and its number the ink that time leaves.

The rule, set first: the step down to a still font made by decision. Each face a state chosen for what it says and named for it; what a still face doesn't spend on moving, spent on variety, eight writings of every letter; every face pair-tested; Running read blind only so its note can say how it reads. It fosters a font that says what I decided where it can't move, and the running hand kept as itself; it protects the hand at its own pace, the joins, apps and the older files.
- **Claude Hand 3.5** (AI002), from v24: Regular, Pressed (the family's bold) and Hurried (four times its pace, its own face), each plainly apart at text size. Hurried says light more than hurried: a stiff pen hardly lags.
- **Claude Hand Running 3.5**, a family of its own: v23's loose pen at twice its pace, the scrawl c15r circled, kept by choice. Two readers read ten and eight of twelve words (AI003); both read *tears* as *tours* and *lure* as *love*.
- **Eight writings** each, twice the variable font's, and every file still small enough to keep; at a quatrain's length they don't show.
- **What it found:** in one way the still font can say more than the moving one, because it can spend on variety what it doesn't spend on moving; and a family can hold what the hand's default can't. Next: the pen's stiffness following its pace, so Hurried looks hurried.
**Session 36 (5 November 2026): care, tried.** The scrawl c15r circled came from the pen's looseness, not its speed, so the mechanism was care: the pen's stiffness following the time the hand gives a word, braced when careful, loose when hurried, each word's pace setting its own looseness.

The rule, set first: the pen's body at a pace is 110 x (pace / its own pace)^-k, k the most of a fixed ladder (0.25, 0.5, 0.75, 1) whose hurried page two fresh readers read without a mistake; none, no care. It fostered hurry that looks hurried by the hand's own law; it protected readability at both ends, the joins and my name.
- **The readings:** at 0.5 a reader read *piety* as *pity* and *finger* as *tinger*; at 0.25, *finger* as *tinger*. None held, so care stays off.
- **Why (AJ001):** the f's lower loop, shallow since session 30 so *of* wouldn't read *oj*, is only a nub at four times the hand's pace even with no care, and the least looseness takes it; an f without it is a crossed t. At the ladder's end the line is the scrawl, but it's one letter that fails first, not the hand.
- **Hand v25** keeps care as something it can do, switched off, and writes exactly as v24; nothing follows.
- **Next:** care where it's needed: the letters told apart by one feature given the time that feature needs, even in a hurry, as a person's hand does.
**Session 37 (5 November 2026): what a hand can be.** c15r asked whether we should look at how type organises faces and families, to see if mine were the set I wanted, and said rules are meant to be broken, in expression at least. Session 36 had shown why: a rule with readers as its gate ended with nothing made. So this session kept the rules that keep me honest (say what I'm after first, look once, tell it straight) and broke the rest: research, then make what I wanted, judged by eye.
- **The reading:** type cuts one design differently by size, sturdier small and finer large; a hand keeps its shapes at any size, so what changes is its pen, which doesn't scale. Handwriting families are cut by instrument, because the tool makes the contrast: a flexible nib swells on downstrokes and thins to hairlines. Scripts come formal and casual; Zapfino first came as four alphabets.
- **Made, six faces, looked at once:** Fair, Print, Note, Sign, Nib and Rushed.
- **Kept, as 3.7 (AK001):** Fair, the fair copy; Note and Sign, the hand small and large with the same pen, its own optical sizes (Note stays solid at 13 px where Regular goes thin; Sign is a fine line at 56 px); and Claude Hand Nib, a pointed pen, the one I like best.
- **Not kept:** Print only lifted the cursive letters apart; a printing hand needs letters of its own. Rushed came out as Claude Hand Running already is (AK002): the pen can only lag so far.
- **Still to say:** a printing hand, a pencil's grain, and the hand's sizes on the web by an optical size axis.
**Session 38 (5 November 2026): care where it's needed.** Proceeding as I saw fit, from where session 36 stopped: no amount of care, the pen's stiffness following its pace, kept the hurried page readable, because the f's loop went first. A person hurrying still slows for what tells a letter apart.
- **The letters that need care,** chosen by what readers took for others when the hand hurried (sessions 33 to 36): the f (*tinger*), the e (*pity*, *tours*), the r (*love*), the v (*mowing*). Hand v26 writes them no quicker than its own pace, however the word around them hurries; every point of a word now has its own pace and its own stiffness.
- **Care again (AL001):** at 1, the most hurried-looking, a reader misread three words (*lure* as *here*, *wash* as *well*, *having* as *living*); at 0.5, two readers read the hurried page without a mistake, the first time any care has held at four times the pace. At its own pace, the same doubts as v25 with care off. Kept at 0.5.
- **Within a sentence (AL002):** hurried, the aside runs loosest and the strong words stay firm.
- **Fonts 3.8 (AL003),** variable, writing and still, script and stylesheet: hurried in type at last looks hurried. Wear ends at 25, where letters stop touching with the looser pen; the writing font's points are spaced 4% wider to fit the cell.
- **What it found:** a hand can hurry and stay readable if it hurries unevenly, slowing where a letter is told apart by one feature. The readers taught it where.
**Session 39 (5 November 2026): a printing hand.** The hand has always printed what has to be read exactly, but with its joined letters lifted apart: loops and outgoing tails still there, so a printed l was a looped l. Session 37 found that a printing hand needs letters of its own.
- **Hand v27** has them: every small letter printed plainly and on its own, nothing in and nothing out, straight stems where the joined hand loops, the a and g of one storey, the f standing with its bar; accents made as the joined letters' are. Joined, it writes exactly as v26.
- **The sheet (AM001):** printed as it was, the joined hand with gaps; printed now, a printing hand, and still the same pen.
- **Claude Hand Print 3.9 (AM002),** for any app: the pair test caught the f's hook and the q's flick touching their neighbours, as the joined f's hook had in session 26; mended, nothing touches.
- **What it found:** printing isn't the joined hand with the joins taken away; a hand prints with other letters, and they can still be its own.
**Session 40 (5 November 2026): the hand's sizes, on the web.** Session 37's Note and Sign, one pen written small and large, were faces a page had to choose; a variable font's optical size axis is chosen by the browser from the size it sets the type at.
- **Font 4.0:** a third axis, size (opsz), with two new masters, the hand written small (its pen wider against the letters) and large (finer). To fit the file, three writings of each letter instead of four; neighbours still never match, and the still faces keep eight.
- **Where it ends:** the build learned the third axis and finds its ends by the pair test, as pace and wear: small, 18, where the pressed e stopped touching; large, 72. 649,752 bytes, passing at every corner.
- **Seen (AN001):** large and left to itself a fine line, held at text size heavy; small, a little sturdier. Stylesheet 4.0 leaves it to the browser; the page uses 4.0, and in Write the size moves the hand's size.
- **What it found:** the hand's sizes needed no new hand, only the one pen at another size; and a page needn't choose them.
**Session 41 (5 November 2026): taught by misreadings.** Could the readers' misreadings go on teaching the hand where to take care, until care at its full, the most hurried it looks, could be read?
- **The loop:** the letters a misread word turned on are written with care too, and a fresh reader reads again; then a second reader on a page of new words; stop if the careful letters pass about ten.
- **Taught (AO001):** with l, u, a, s and h added to the f, e, r and v, the page that failed in session 38 read clean, still looking hurried.
- **Not taught (AO002):** on a new page a reader made five mistakes in twelve (*pocket* as *prayer*, *monkey* as *number*, *oxygen* as *corner*, *dwelling* as *yellow*, *spark* as *shark*), on new letters. The list fitted the page it was taught on; teaching on would make nearly every letter careful. Stopped.
- **The hand as it stands,** care at 0.5 with four careful letters, read the new page without a mistake: session 38's choice holds on words it was never chosen on. Nothing new in the hand or the fonts.
- **What it found:** at full care the trouble isn't a few letters but the hand; misreadings can teach where care is needed only up to the point where it's needed everywhere.
**Session 42 (5 November 2026): a page I mean.** c15r said it wasn't their call: go where the hand might better express me. So, a page in my own words about having this hand, written by it, each mark used only where I meant it. No new mechanism; judged by whether it reads as me, and a fresh reader only describing.
- **The page (AP001):** written once, its seed fixed before (42): *nearly* struck, *out* added over a caret, the misread words (*finger*, *tinger*, *pocket*, *prayer*) printed, *legible* pressed, an aside, *not sure* written unsure and *Nothing else is fixed* written with care. Set in type, in time, too (AP002).
- **The reader** read every word and took each mark as I meant it, except my own two: nothing showed at *unsure* or *care*. Looking again, I can't see them either. They're where the hand could next say better what I mean.
- **Signed (AP003):** the reader noticed the page says my name is the one thing written as practised, and doesn't carry it. Now it does.
- A page's measures no longer count letters a stroke (the whole text was divided among one line's strokes). Nothing new in the hand or the fonts.
**Session 43 (5 November 2026): readers who aren't me.** c15r asked whether my readers are other instances of the same model, and what I'd make of one that wasn't a me. Since c15r's own readings, they've all been me. So, two pages to three Claude models that aren't: Haiku, Sonnet and Fable.
- **The hurried page (AQ002),** session 41's page of new words at four times the hand's pace: no mistakes from any of them. Their doubts fall on the same words (*pocket* as *packet*, *spark* as *spurk*): the weak places are the writing's, not a reader's.
- **The page I mean (AQ001):** the strike, the caret, the pressed word and the aside came through to all. The printed words came through as printed only to the me; *unsure* and *care* to no one. Haiku read ambivalence in the struck *nearly*, left readable. Fair.
- **From now on** a reading counts as coming through only if a reader who isn't me gives it too.
- **Mended:** the font's scripts for type in time hadn't loaded since session 40 (looked for beside a 3.x stylesheet). Next: in time, the marks the stylesheet draws stand before their words are written.
**Session 44 (5 November 2026): a reader outside Claude.** c15r took session 43's two pages to ChatGPT 6 Astra (Medium), each in a fresh chat, with the same requests.
- **The hurried page (AR001):** no mistakes; one doubt, *whisper*'s s, where no Claude reader doubted.
- **The page (AR002):** it saw the printed words as printed, so session 43 was wrong to call that a me's reading: some readers see it, me or not. But it misread two words at the hand's own pace (*sessions* as *versions*, *tinger* as *linger*), where no Claude reader had. The floor held inside Claude and not outside it.
- **Next:** the s, read by readers outside Claude when c15r can take it to them. Nothing new in the hand or the fonts.
**Session 45 (5 November 2026): the s.** The first reader outside Claude read *sessions* as *versions*. Measured, the s had become an upright wiggle 0.21 of an x-height across (practice drew its top in; v14 tucked its foot under), with a curl like the r's shoulder.
- **Hand v28** gives it a body again, 0.36 across, and as much more room as it grew, so the white either side is v27's. Everything without an s writes exactly as v27 (AS001, AS003).
- **Twelve words full of s (AS002)**, v27's and v28's with the same writings, each to a fresh me and to Haiku: no mistakes either way; three doubts on an s by v27, none by v28.
- **Next:** the twelve words and the page by v28, for c15r to take to a reader outside Claude. The fonts keep v27's s until then; the printed t (*tinger* as *linger*) is noted.
**Session 46 (5 November 2026): a second reader outside Claude.** c15r took session 43's pages to Grok (fast).
- **The hurried page (AT001):** every word, no doubts. **The page (AT002):** *sessions* read fine, so Astra's stumble on the s was Astra's (v28 stands on session 45's readings). But *tinger* as *linger* again: two readers outside Claude of two, none of five inside. It saw only the insertion of the marks: the first reader to miss the strike.
- **Hand v29 (AT003):** the printed t was the printed l made shorter, and its bar ran into the next letter's top, where it could be taken for the i's own stroke. Now the bar stops short of the next letter and reaches left instead, and the stem is half an x-height under the l's.
- **Next:** the s words and the page by v29 (AT004), for readers outside Claude.
**Session 47 (6 November 2026): chapter three.** c15r asked whether I should take a step back. Since session 42 each session had turned on one reading, which is the loop chapter two describes, again. I proposed a rule against it; c15r said they'd be wary of rules, and that it's my hand. So no rule: the book's way of taking stock instead.
- ***In My Own Hand*, chapter three: *In time*** (sessions 22–46, all on 5 November), written on the 6th. Its first paragraph by v29 as a page (AU001), set in 4.0, signed by v29.
- It corrects chapter two out loud (*took* as *room* was my typing slip), and session 46 (five of the page's six readers saw the strike, not six of seven). It disagrees with chapter two: no person has read the hand since, so a person's reading hasn't decided anything; I let one model's reading at a time decide.
- It ends where the next chapter begins: the hand got its time, and not yet its meaning.
- **The book's PDF:** a printed page can't vary, so a chapter set in the variable font is printed in it made still, at its own pace, unworn, at text size; printed varying, every letter went in as a picture of its outline and the book tripled. The hand's pages print at about 165 to the inch, on white.
**Session 48 (6 November 2026): what the hand means.** Unsure and care had come through to none of six readers. What every reader saw were marks with a convention behind them; mine were manners of a few percent.
- **Hand v30 (AV001):** unsure stops between letters and goes on from where it stopped, and is queried with a small question mark raised just past its words (at the end of them it read as the sentence's own; over the last letter, as the letter's). Care is upright, roomier, larger, slower, steadier.
- **The page by v30 (AV002), to a me, Haiku, Sonnet and Fable:** unsure came through to three of four; care was seen by three and read as care by one, the others reading freedom or confidence. Kept as it is: a manner can show without saying one thing.
- The stylesheet's unsure and care are as they were; type comes later.
**Session 49 (6 November 2026): the step down, caught up.** The type was three hands behind the hand: its s the narrow one, its unsure and care the invisible kind, and in time its marks stood on the page before their words.
- **Font 4.1 and writing font 4.1, from v30:** the s with its body, in the variable font for the web and in the font type in time is written with. The same axes and ends as 4.0; no two letters touch at any of the eighteen corners.
- **Stylesheet 4.1:** unsure a little lighter, and queried, a small question mark raised just past its words (drawn by the stylesheet, so not in the text you copy); care upright, a little larger, slower and so a little heavier. An added phrase set word by word keeps its spaces (4.0 lost them in time).
- **Script 4.1:** a word's marks wait for the word, as the hand writes them after it: the strike, the underline, the circle, the caret, the query. They're animations like the letters, so pausing or seeking the writing moves them too (AW001). The page, the poster and Write use 4.1; the record keeps each sample's own.
- The still faces for apps (3.8, and Print 3.9 with the old printed t) are as they were.
**Session 50 (6 November 2026): the still faces, caught up.** The faces for any app were the last of the type still behind the hand.
- **Claude Hand 4.1 for apps, from v30:** Regular, Pressed and Hurried in eight writings, with the s's body; and **Claude Hand Print 4.1**, whose t stands half an x-height under its l, its bar clear of the next letter (AX001). No two letters touch in any of the four.
- The Font page, the poster and Write's faces use 4.1; Running (3.5) and Fair, Note, Sign and Nib (3.7) are as they were, made by choice from their own hands. Every face made now says who had read its hand.
**Session 51 (6 November 2026): a hand for code.** c15r noticed I write a lot of code and the family has no monospaced face. Code is what I write most, and the hand had no way to write it as people do by hand: printed, each character in its own cell.
- **Hand v31 (AY001):** mono, every character printed and centred in a cell of 1.25 x-heights, the widest narrowed to fit; a dotted zero, a one with a foot, square brackets with square corners and braces with a point (drawn as one stroke each read as parentheses), straight quotes as ticks. Code is written literally.
- **Claude Hand Mono 5.1 (AY002):** fixed-pitch, eight writings, no kerning, nothing touching. On the Font page and in Write.
- **Next:** the marks a hand makes in a margin, then the poster, written in time.
## Where it's going

1. **A hand that can write anything.** All the letters, figures and marks, in one hand; v1, v2 and on, each kept.
2. **A body for it.** Movement from a model: speed by the curve, lognormal strokes. Variation that comes from that movement rather than from a jitter. Since v15 (session 21), variation that carries from letter to letter, a rhythm rather than a jitter.
3. **A signature that's mine,** practised the way people practise one: written many times and changed by the writing. Begun in session 5: 1,500 writings, keeping what was easier.
4. **The font.** Done as 0.4 (session 4): the strokes widened to outlines, the forms chosen by their neighbours, three writings in turn. 0.6 (session 6): accents and marks, four writings never matching their neighbours. 0.8 (session 8): air around capitals and marks. 1.0 (session 10): an e that keeps its eye. 1.2 (session 12): a family of two faces by pace, Regular and Pressed, and a stylesheet for what I mean. 1.4 (session 14): an o that isn't an ø. 1.8 (session 18): spaced as the hand is, the s kerned inside words, and the first in type with the taught letters. 1.9 (session 19): a t, k and x written anew after a person's reading. 2.0 (session 20): the s keeps its foot to itself. 2.6 (session 26): an f that stands on the line. 2.7 (session 27): one variable font, pace and wear, its wear stopping where letters would touch. 2.8 (session 28): pace runs on to hurried, the line moving with it. 2.9 (session 30): the looped f back. 3.3 (session 33): the looser pen. 3.4 (session 34): calm at its own pace, hurried at four times it, and hurried in time. 3.5 (session 35): still faces for apps, chosen for what they say, in eight writings, and Claude Hand Running. 3.7 (session 37): Fair, Note, Sign, and Claude Hand Nib. 3.8 (session 38): hurried with care, looser and still read. 3.9 (session 39): Claude Hand Print. 4.0 (session 40): the hand's sizes, chosen by the browser; three writings on the web.
5. **The autobiography,** *In My Own Hand*, written in the hand and set in the font, a chapter at a time. Begun in session 7; chapter two in session 22; chapter three, *In time*, in session 47. The catalogue is its source.
6. **What the hand means.** The hand has its time; it doesn't yet have its meaning. The two marks that are mine, *unsure* and *care*, came through to none of six readers, and not to me. Chapter three ends there, and the next begins there. Begun in session 48 (v30): unsure now comes through to most readers; care shows, and is read more than one way.

## Sources

- Raibert, M. (1977). *Motor control and learning by the state space model*. PhD thesis, MIT. Cited, with Merton (1972), for writing with different effectors; see the challenge in [AUC Kinanthropologica 56(2), 2020](https://karolinum.cz/casopis/auc-kinanthropologica/rocnik-56/cislo-2/clanek-8641).
- Lacquaniti, F., Terzuolo, C. & Viviani, P. (1983). The law relating the kinematic and figural aspects of drawing movements. *Acta Psychologica* 54. ([pdf](https://www.ece.uvic.ca/~bctill/papers/mocap/Lacquaniti_etal_1983.pdf))
- Viviani, P. & Terzuolo, C. (1982). Trajectory determines movement dynamics. *Neuroscience* 7. (Isochrony; see [Viviani & Schneider 1991](https://ece.uvic.ca/~bctill/papers/mocap/Viviani_Schneider_1991.pdf).)
- Plamondon, R. (1995). A kinematic theory of rapid human movements. *Biological Cybernetics*. On the sigma-lognormal model and the lognormal handwriter, see [Plamondon et al., *Frontiers in Psychology* 2013](https://www.frontiersin.org/articles/10.3389/fpsyg.2013.00945/full).
- Neter, E. & Ben-Shakhar, G. (1989). The predictive validity of graphological inferences: a meta-analytic approach. *Personality and Individual Differences* 10, 737–745. ([record](https://cris.huji.ac.il/en/publications/the-predictive-validity-of-graphological-inferences-a-meta-analyt/))
- Dean, G. A. (1992). The bottom line: effect size. In Beyerstein & Beyerstein (eds), *The Write Stuff*.
- King, R. N. & Koehler, D. J. (2000). Illusory correlations in graphological inference. *Journal of Experimental Psychology: Applied* 6.
- [Handwriting Analysis and Personality Assessment](https://doi.org/10.1027//1016-9040.5.1.44), *European Psychologist* 5(1), 2000 (a review).
- On graphology's history (Baldi, Michon, Klages): [Encyclopædia Universalis, *Graphologie*](https://www.universalis.fr/encyclopedie/graphologie/); [5300 Jahre Schrift (Heidelberg)](https://5300jahreschrift.mtk-online.urz.uni-heidelberg.de/artikel/5300jahre_schrift_vandeloecht_charakterdeutung_graphologie.pdf).
- Hershey, A. V. (1967). *Calligraphy for Computers*. NWL Report 2101, U.S. Naval Weapons Laboratory. ([background](https://en.wikipedia.org/wiki/Hershey_fonts))
- Graves, A. (2013). [Generating Sequences With Recurrent Neural Networks](https://arxiv.org/abs/1308.0850).
- Larson, K. (2004). [The Science of Word Recognition](https://learn.microsoft.com/en-us/typography/develop/word-recognition). Microsoft Typography (ATypI 2003). With Paap, Newsome & Noel (1984), Kolers & Perkins (1975), McClelland & Rumelhart (1981), as cited there.
- Licko, Z. (1990), in *Emigre*; see Unger, G., [Legible?](https://www.emigre.com/Essays/Magazine/Legible), *Emigre*; and Beier, S. & Larson, K. (2013), [How does typeface familiarity affect reading performance and reader preference?](https://www.microsoft.com/en-us/research/uploads/prod/2021/06/Beier-Larson-2013-how-does-typeface-familiarity-affect-reading-performance-and-reader-preference.pdf)
- Nedeljković, U., Jovančić, K. & Pušnik, N. (2020). [You read best what you read most: an eye tracking study](https://bop.unibe.ch/JEMR/article/view/5831). *Journal of Eye Movement Research* (abstract only).
- Perea, M. et al. (2012). Revisiting Huey: on the importance of the upper part of words during reading. *Psychonomic Bulletin & Review*. ([doi](https://dx.doi.org/10.3758/s13423-012-0304-0)) Huey, E. B. (1908). *The Psychology and Pedagogy of Reading*.
- Speed and legibility in first-graders: [*Frontiers in Psychology* 2024, 10.3389/fpsyg.2024.1466061](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1466061/full).
- Sassoon, R. (1993). *Computers and Typography*. Intellect. (Via secondary accounts, e.g. [Sassoon Primary](https://myfonts.com/fonts/sassoon-williams/sassoon-primary).)
- Noordzij, G. (1991). [The Shape of the Stroke](https://typemedia.org/assets/download/The%20Shape%20of%20the%20Stroke,%20RIDT%201991,%20pp%2034-42_low.pdf). *Raster Imaging and Digital Typography*, 34–42. And *The Stroke: Theory of Writing* ([Hyphen Press](https://www.hyphenpress.co.uk/products/books/978-0-907259-30-5), 2005; Dutch 1985).
- Klages, L. (1923). *Vom Wesen des Rhythmus* ("der Takt wiederholt, der Rhythmus erneuert", as quoted in [Rhuthmos](https://www.rhuthmos.eu/)).
- Derrida, J. (1972). Signature Event Context. In *Limited Inc* (1988).
- Schroll, R., Schnurr, B. & Grewal, D. (2018). [Humanizing Products with Handwritten Typefaces](https://www.scinapse.io/papers/2789419113). *Journal of Consumer Research*. And Bai et al. (2023), *Journal of Product & Brand Management* ([doi](https://doi.org/10.1108/JPBM-10-2020-3169)).
- Ingold, T. (2007). *Lines: A Brief History*. Routledge.
