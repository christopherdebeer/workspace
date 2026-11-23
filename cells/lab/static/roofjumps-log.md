# Roof Jumps: running log (autonomous passes)

The brief (2026-11-22, while away): (1) one central, easily extended place for the city's procedural tagging, coupled with the
hand and foot holds (not disconnected); (2) a good new green baseline; (3) a first visual pass: basic renders of the tagged
details (windows, wires, pipes, signs and the rest) in the plain looks; (4) later, stroke-gouache done properly, referring back
to Switchback's techniques and rendering. Every half hour: pick up what's outstanding, proceed, note it here.

## Pass 1 (00:17 UTC)

- `parts.ts`: the city's parts registry (`PARTS`, `furnish`). Structure holds, fixtures, a course's holds and bars, drawn holds,
  alley bars, ground detail and details moved out of `city.ts` into one row each, own dice kept: the city is unchanged (the
  holds and details same-whenever-made tests, the lattice, every course check).
- Coupled: details carry `holds`. Pipe bundles and ladders are now climbable pipes (two runs per bundle); window rows above the
  ground sit on their storey's sill; rust links to its unit or pipe. A test checks every link is one of the chunk's own holds.
- Ladders climb as pipes for now (a `ladder` hold kind waits for its own climb pose).

## Pass 1, continued: the first visual pass

- Baseline green after the registry and coupling: 194/197 courses (the same three known), determinism exact over 38 scenes,
  footing 1/46 walking gaps (worst 33 ms), 26 held-pose findings as before. Deployed.
- `dressing.ts`: every detail kind drawn as plain boxes (`DRESS`, a `Record<DetailKind>`), new tags 15 to 25, colours in the plain
  looks (`dressOf` in looks.ts) and in gouache. Gouache's procedural windows are gone; the windows are the details now.
- Weight: the first try was 8 MB of mesh a chunk. Now a window row is one quad cut into panes in the fragment shader (which are lit
  from the seed; the sill band under each where the row has its sill hold), a bundle one striped box a run, a ladder rails and a
  rung quad: 3.7 MB a chunk, of which the city before was 2.3.
- `devtools/roofjumps-still.mjs`: a still of the running page (a look, a seed).
- Next: street-level stills (poles, wires, awnings, vending), a night/lit check, then the stroke-gouache treatment (item 4).

## Queued: Astra's critique (after items 1–4 are done)

The full text is in `static/roofjumps-critique-astra.md`. The thread running through it: a mistake should change what the athlete
can do next, and the player should be able to read, a moment ahead, what this body can still do from here. Don't tune
thresholds to turn checks green. The work, in order:

- **A. The one phrase (priority):** a playable scene as a single sequence. Stand at a parapet, take a small step back,
  change your mind, drive forward, land slightly wrong on the far side. The scene ties the weakest part (brushes) to the
  strongest (recoveries).
- **B. A backward brush that commits gradually:** a 12 px backward brush jumps from a 98° turn to 180° between 242 and 250 ms,
  and from 12 to 47 cm of travel after release. A single backward step should be there across a wide range of brush timings:
  - a shoe reaches behind and takes the weight;
  - the chest keeps facing where the player was looking;
  - if the player keeps going, the trailing hip opens into a turn;
  - if they let go, there is already somewhere to stop.

  Test it by sweeping the brush length one tick at a time and asserting no cliff. Also fix the 39 cm single-tick shoe snap at
  22 px / 400 ms.
- **C. Contact by shape, not by name:** today `standOf` and the pipe, shimmy and fire-escape timing checks go by kind. Keep the
  differences that describe the contact itself (wrappable, forefoot-narrow, whole-shoe deep, no knee clearance), and drop the
  catalogue names. Tests:
  - an unnamed projection the same size as a unit allows the same step;
  - as it gets shallower, the move goes from standing, to a forefoot push, to a hang.
- **D. late-change, made legible rather than green:** the second takeoff should show the bad first landing, through a shorter
  last-but-one stride, the less convenient leg, or a lower line toward a different catch.
- **E. Legibility:** a loaded, bent leg against the stairwell underside should read through the camera and the paint. Keep
  graded outcomes as fixtures, e.g. the slab-height sweep (9.70 m falls, 9.90–10.20 m exits, 10.40 m finds the slab but
  fails the push, 10.75 m and up falls).
- Local leftovers: vault-angles planted slide (8 cm/s); the courtyard pause under the opening runs short.

## Pass 2 (started by hand, about 00:50 UTC)

- Street-level stills (clay and gouache at dusk, from=0.5,36 fixed=-1.5,1.8,22 on seed 1): poles, wires, awnings, neon,
  ladders, pipes and window rows all read.
- Wires were broken into level dashes; each segment now spans its own rise, so the sag joins up.
- Gouache at dusk: lit rooms glow (their own light once the sun is low), dark panes deepen.
- Noted for item 4: gouache's paint thickens wires into heavy black zigzags; thin things need their own stroke rule.
- Noted: street poles stand 1.3 m out in narrow streets and are draw-only (the runner goes through them). They could become
  obstacles, or holds (a pole to swing round), once contact goes by shape (critique C).

### Item 4 begins: stroke-gouache, by Switchback's lessons

- Found and fixed a regression from the first visual pass: in stroke-gouache, every detail claimed depth but had no paint, so
  poles, awnings and window rows were holes of paper. Following Switchback's rule for things, details now claim no depth in the
  stroke pass (render.ts `uNoDetails`; they still cast sun shadows). Each is all marks:
  - a window row, a pull a pane (lit ones warm, glowing at dusk);
  - anything thin, one line along it; a wire, one line a span;
  - anything with faces, its faces filled; rust, a wash.
- Fixed an older bug: bars (railing posts, ladder sides) were always painted as horizontal lines, so posts showed as paper. They
  now follow their longest axis, and stay out to mid-distance (rank 0.62).
- A survey of Switchback's painter (client/switchback/paint.ts, static/switchback.md §Painted) against ours gave this plan, in
  order:
  1. no screen-locked terms in the stroke shader (dry-lift grain and colour grain use gl_FragCoord, so they crawl over moving
     marks): anchor grain to the mark's own coordinates;
  2. a pixel floor and ceiling on mark width (Switchback: 2.4·dpr px minimum, 0.19 of the height maximum), and widths that turn
     toward the eye with distance, so lips, pipes, wires and poles never thin to nothing;
  3. a lift along the view ray in place of the normal bias;
  4. far marks shrink away rather than fade, and the survivors grow; premultiplied blending, chunks painted far to near;
  5. a stamp atlas (bristle lanes, ragged edges, paint piled at the lift), with stamps chosen per subject;
  6. four value bands a stroke, mixed with a neighbouring band, a tint a stroke, stepped haze;
  7. scatter by coverage in two passes (masses, then detail) in place of the opaque fill and a few pulls, sized by distance from
     the line the runner is on. Keep our sun-shadow passages, which Switchback lacks.
- Known: a blade sign's face near the camera on seed 1's street (from=0.5,36) shows as paper. To look at.
- Steps 1 and 2 done:
  - the stroke shader's grain is now in the mark's own metres (it travels with the mark), calmed where it would be finer than a
    pixel;
  - no line mark is drawn narrower than about two pixels (`uPx`: a pixel's size a metre off, unprojected each frame), so far
    railings, lips and wires hold as lines.

  Paper and sky still use screen grain, which is right for paper. Not yet checked in motion; a two-frame comparison while the
  eye pans would confirm there's no crawl.

## Pass 3 (09:05 UTC, directed by hand; the overnight timer died with its container at about 01:15)

- Steps 3 and 4:
  - marks lift toward the eye along their view ray (the same depth clearance as the old normal bias, without the slide across
    the screen);
  - withdrawn marks shrink to their anchor instead of fading, so no half-alpha ghosts far off.
- Step 7 (with 6 folded in), first cut:
  - Switchback-style coverage over near planes (`scatter` in stroke-gouache.ts), in two sizes (masses, then detail), sized by the
    plane rather than the eye, laid down walls and along roofs;
  - each stroke has its own value near the plane's mass, a tint, and the next value over as its second pigment;
  - painted over the broad pulls (the first try sat under them and showed nothing). Any plane over 4 m² gets it, so the roof
    you stand on is painted too.
  - Hard four-value bands made shaded walls look like camouflage, so values are continuous now.
  - Kept to the nine nearest chunks (ranks 0.42 and 0.36).
  - Cost on seed 5 from a roof: 156k to 294k stamps (1.9×). City pass about 1–2 ms headless (software GPU, so only relative).
    Not yet timed on a phone.
  - Still to judge: parapets look blotchy where the darker underpainting shows between strokes.
- `devtools/roofjumps-cost.mjs`: stamps and pass times on the running page, plus a still.
- Left of item 4: the stamp atlas (5), and premultiplied blending with chunks painted far to near (from 4).
- Asked for: `?under=0` (or U, live) leaves out the brush looks' flat underpainting so only the strokes show. Bars (rails,
  railings, ladders' sides) now claim no depth in the stroke pass either, like the details; they still cast sun shadows.
- What it shows (seed 5, from a roof):
  - big near walls are fully covered (broad pulls plus scatter);
  - parapets and the roof underfoot are about a third covered;
  - past the nine near chunks it's bare paper, with the fills doing all the work there.
- The figure in stroke-gouache, unmasked:
  - the body no longer claims depth in the stroke pass;
  - the dark under-stroke round every part is gone (it was there to cover the body's depth, and was what made the figure read
    black);
  - parts are painted far to near (by each bone's own middle, not its forward-brought marks, or the hood covered the face),
    each part's body, lit pull and accents together.
- Pose-sheet iterations (`sheet=run,land,hang&side=70&zoom=3`, the teen from the front at `side=200`):
  1. a face (skin, toward where the head faces) with the hair over the crown and round the back, not a black disc;
  2. lighter overall (tone 0.45 + 0.35 of the sun's side), a wider lit pull, and a narrow dark pull on the turned-away edge to
     model the form; rounder tapers at the joints (by the part's width);
  3. sorted by the bone's middle, so the hood no longer paints over the face; the pelvis gets no edge pulls (it lies across
     the body, so they were bands at the waist).
- Fixed: `t=` with `auto` crashed the page (the input read `menu.launch` before the menu existed).
- The still tool takes `W=`/`H=` for its size.
- Asked for: a new character, the schoolgirl from the first reference (kyo-rooftops). `character=schoolgirl`, 1.60 m, age 16.
  - Dress: a sailor-style uniform (white top; the navy collar as a flap down the back and a band at the front; a red
    neckerchief), a flared navy skirt, bare thighs, navy knee socks, loafers, long dark hair down her back.
  - Checks: 6 of 6 leaps (reach x0.85, stride x0.87); no pose misses. She's the seventh in the menu line, and the palette
    array has room for eight.
  - Contact sheet: devtools/out/contact/contact-schoolgirl.png. The skirt doesn't move yet (the reference's bell on landing
    wants moving attachments).
- `devtools/roofjumps-contact.mjs`: a contact sheet a character (turnaround and motion), for art direction.
- The schoolgirl, restyled from the extracted reference sheets (kyo-rooftops, kyo-kling-parkour):
  - a dark sailor top and skirt (not white), the collar edged white back and front, the red neckerchief;
  - white socks to mid-calf, black loafers, a high ponytail; a longer, fuller skirt.
  - Worn parts on a limb are painted just after the limb (the socks were lost under the shins in the far-to-near sort).
- Moving attachments (character.ts `hang`, rig.ts `hung`):
  - the skirt and the ponytail each swing as a damped spring toward a pull of their rest on the bone, gravity and the wind of
    their own motion, changed only on the fixed update;
  - the skirt also flares: belled by the fall, kicked out at a landing.
  - Filmed on drop-rebound: it trails back on the run, bells from the drop, is widest at the landing; the ponytail streams.
  - Suite unchanged (determinism exact; she makes 6 of 6 leaps; no pose misses).
- Hair, skirts and other loose attachments:
  - chains (`segs`): hair and a scarf's end are links, each swinging from the end of the one before;
  - rings (`ring`): a skirt or coat is panels round the hips, each splayed to the hem, coupled to its neighbours (a hem that
    ripples rather than a fringe), pushed out by a lifting thigh, splayed further by the flare;
  - before moving (held poses, first frames) a loose piece hangs where rest and gravity balance (upside down the ponytail now
    hangs down).
  - The schoolgirl: 8-panel skirt; hair gathered at the crown and a 3-link ponytail.
  - The others: the slight figure's ponytail (3 links) and scarf (2); the older figure's coat skirt (6 stiff panels); the
    child's bag (a stiff bounce).
  - The figure buffer holds 32 worn blocks a character (was 12).
  - The pose check doesn't hold loose pieces to the ground (it flagged her ponytail through the floor at a held flip apex).
  - The skeleton test counts links and panels.
  - Suite: unchanged; 0 pose misses.
- The skirt as cloth (asked for, after looking at Fab's): `cloth.ts`, Fab's XPBD solver cut down.
  - A 10 x 4 ring of points, the waist held to the pelvis; stretch, soft shear and bending; gravity.
  - Normal-weighted air against the body's carried speed (75% horizontal, 35% vertical); the cloth's own damping.
  - Capsules: the hips, the thighs from a third down, the shins. Held poses settle a copy.
  - Found on the way, by measuring the hem against the pelvis:
    - isotropic drag at 11 m/s blew it horizontal;
    - the legs as a wall flipped it over the hips;
    - stiff shear and bend made a rigid cone that tilted with the hips;
    - no damping let strides pump it up;
    - thigh capsules from the hip joint lifted the waist.
  - Now it hangs plumb, drapes over the forward thigh, swings with the stride, lifts on a drop.
  - Suite unchanged; 0 pose misses.
- Cloth, continued:
  - Pleats: edges round can open to 2.2x at the hem. Without them a fall crumpled the skirt up the body, the hem's circumference
    fixed.
  - A cone limit: no further than 5 degrees past level from the waist's axis. Before it, a fall turned the skirt inside out
    within 0.2 s.
  - Air from below carried at 55%. Teleports re-hang the cloth instead of flinging it 2.5 m.
  - Measured in a unit test: the hem goes from radius 0.13 to 0.29 in a 12 m fall, never above 0.08 m up the hips' axis, and
    hangs again after landing.
  - The older figure's coat is cloth. Folds are lit per quad in stroke-gouache.
  - Cost: +0.2 ms a fixed step (desktop). A `long-drop` scene (39 scenes; 195/198 checks).
  - Filmed: the short drop opens the skirt out and back like the reference's leaps. The long drop is taken as a dive, not the
    reference's upright glide (movement, not cloth: noted).
- A new reference, `ychive-hands` (`"for": "hands"`): "How to animate hands", a tutorial by Ju Neng Binggui shared by YCHive.
  - Contents: finger segments with the knuckle a segment into the palm; fingers as cylinders folding into a fist that is a box
    of planes; the thumb's root a wedge deep in the palm; poses with their segments overlaid; the thumb two knuckles, not three.
  - For the runner's hands, which are dabs now: open reaching, closed on a hold, palm planted.
  - Manifest only. `node devtools/refs.mjs roofjumps ychive-hands` remakes the sheet and strips.
- Hands, from `ychive-hands`:
  - five blocks a hand: palm; fingers in two from a knuckle inside the palm; thumb in two from a root by the wrist;
  - shaped by use (closed on a hold, planted flat on a vault, open reaching or in flight, loose otherwise), eased on the fixed
    step;
  - painted as skin pulls in stroke-gouache, replacing the forearm's dab.
  - 23 bones (was 13). Suite unchanged, 0 pose misses, bones identical at 30 and 120 Hz.

## Queued: the painted figure, from Astra's studies (`static/roofjumps-studies/`)

Two generated studies from the dense motion sheets, and a critique (`astra-paint-critique.md`). The target: the side-on dive (the
lavender figure and the schoolgirl), where one sweep from hip through shoulder into the reaching arm carries the pose, and in
the uniform the white collar alone says which way the chest turns. The same skeleton, two paintings, because different marks
explain each character. The work, in order:

- **G1. A stroke that spans a joint; a contact that interrupts it.** A persistent garment mark from the hip, across the shoulder,
  into the upper arm (shortening as the arm folds across, the elbow's overlap showing). The vault's coat stays one mass while
  the solved wrist fixes the sleeve's end to the rail. The pose decides where the brush lifts.
- **G2. Contact as the point of the picture.** A planted hand gets a short, hard edge where it interrupts the rail; the far sleeve
  goes into the coat. A hang shows the small exposed interval where the hand meets the lip and how far the shoulder hangs
  below it; at distance that says more than any uniform detail.
- **G3. The view from behind (the one the player has).** The rear jacket is a rectangle with bars: one broad oblique pull across
  the back, an uneven hem over a lifted thigh, not frayed edges.
- **G4. Identity under reduction.** Protect what identifies each character at gameplay size before any detail: the hood's forward
  pitch and the gap between the legs (the teen), the pack offset from the head (the child), the collar's white (the
  schoolgirl). Judge at the original cell size, not the studies' enlarged figures.
- **G5. The test: does the paint hold from frame to frame?** The light multidirectional brush from rest, camera behind the indigo
  runner. A brush too small to step: the jacket registers the turn while the planted sole keeps its edge against the roof. The
  first committed step: the heel breaks, the gap opens between the legs. If the pale shoe or trouser highlight changes shape
  before either, the paint is adding to the jank. Alongside the dive.
- G1, first cut:
  - bent marks in the painter: a mark's `path`, one stroke over all its legs, its taper, load and dry lift over the whole length,
    the stamps lapped at each bend;
  - the figure painted in strokes across joints: a sleeve shoulder to wrist and a trouser leg hip to ankle as one bent stroke each
    (where one cloth covers both, and not seen end-on);
  - an arm raised in line with the body (the dive, a reach) gets one sweep from the hip up the back through the shoulder into
    the arm.
  - Found:
    - edge pulls on a bent path drifted off the limb past the joint (now each point moves across the limb as it runs there);
    - edge pulls sized by the chain's average stuck out past a shin (now sized by the narrowest member);
    - a chain run past the ankle left a dry, streaky tail (now no extension past the end, a wetter exit);
    - the turned edge on bare skin read as a seam (now a soft half-tone).
  - Suite unchanged.
- G2, first cut: contact as the point of the picture.
  - A hand's parts know when they're closed on a hold or the palm is planted on what's under it.
  - Then the sleeve ends hard at the wrist (no taper, no dry tail), and the hand is one compact, hard-edged mark round what it
    holds, with a thin dark line under it where it meets it.
  - Found:
    - a sharply folded limb (a tuck) made a chain's edge pulls cross over (now a joint folded past ~80 degrees paints its two
      parts apart);
    - the planted test missed a palm a hand's thickness above the box.
  - Not yet: the hang's shoulder-to-lip interval as its own mark; the far sleeve losing itself in the coat.
  - Noticed: the older figure's coat (cloth quads) paints as lumpy dabs; the coat wants its quads as one garment mark.
- G3, first cut: the view from behind.
  - Seen from behind, one broad, soft, dry pull across the back from the shoulder on the sun's side to the far hip, a value up
    from the cloth (on the dark navy a plain value up was invisible; as a narrow, hard band it read as a strap);
  - and the hem lifted over a thigh coming up, a short dark pull.
  - The indigo runner's back now turns in the light rather than being a rectangle with bars.

## Queued: round two of the studies (`static/roofjumps-studies/round2/`)

Seven single-frame studies on the clean study frames. They agree: clothes as two or three flat values meeting at hard,
straight edges (cut paper), the light splitting a form with one hard terminator, the figure the crispest thing in the
picture, contact and cast shadow drawn plainly, the cloth pushed further than the body. Work, with G4 and G5 still to come:

- **R1. Hard-edged planes for the figure.** A "crisp" mark: no side wobble, no bristles, no dry lift, a clean square end; and per
  garment a shadow plane under a lit plane cut by one straight terminator from the sun's side (replacing the soft lit and turn
  pulls). The back's diagonal (G3) becomes that terminator.
- **R2. A cast shadow, crisp and joined to the feet.** One flat dark shape on the ground under a standing or running figure.
- **R3. The figure crispest, the city softer behind it.** City marks keep their broad planes but lose some edge contrast near the
  figure.
- **R4. Accents and contact.** The shoes and socks at the top of the figure's values. Planted hands splayed flat (fingers apart on
  the rail); the hang's tucked knees with a gap to the wall.
- **R5. Secondary motion read.** Check that the scarf, ponytail and coat carry the motion as in the studies, and push the cloth
  where it lags too little.
- Correction to R1-R5 (from the user): not so flat, and stick to the characters.
  - The round-two studies go too flat (cut paper), and they take liberties with the designs (a beanie for the cap, a changed
    jacket, a scarf). Our characters stay as defined: the studies inform the painting, not the designs.
  - The point of the brush is to say more than the rig's blocks can. So R1 becomes **detail marks from each character's own
    definition**, painted, not modelled:
    - cuffs at the wrists and hems at the ankles (where the cloth isn't skin);
    - creases at a bent elbow or knee, more as it bends;
    - hair with a sheen and a few strands;
    - a shoe's sole line and toe;
    - a skirt's pleats.
  - R2-R5 stand, but painterly rather than flat.
- Detail marks, first set, each from the character's own parts and colours, painted just after the part it's on:
  - cuffs at the wrists and hems at the ankles (not on skin, nor on a hand in contact);
  - creases inside a bent elbow and behind a bent knee, longer as it bends;
  - hair: a sheen over the crown on dark hair, a darker strand on pale hair, one strand swept back;
  - shoes: a sole line along the bottom (darker on pale shoes, paler on dark) and the toe;
  - a skirt's pleats, a fine line down each column.
  - The turned edge on limbs is now a soft, wide, half-laid half-tone; as a narrow dark pull it read as a racing stripe.
  - Cloth (the skirt, the coat) is painted a column at a time, waist to hem, as one bent stroke each, lit by its own face. Its
    quads carry their place in the grid from the rig. The coat is now a sheet with folds, not a staircase of blocks.
  - Suite unchanged.
- The head in strokes, not blurred dabs (asked for):
  - the face a pull down its plane, a darker cheek and jaw plane on the shadow side, and a short stroke across the jaw (so the
    chin is round);
  - the hair a broad stroke bent over the crown (laid across: up the head), a mass down the back, three fringe strokes toward
    the brow where the face is seen, a lock down each side, a lighter stroke for sheen and a darker one for depth.
  - A part seen end-on is a short stroke too.
  - Found: the crown's stroke, laid along its own run, pinched into two lobes; the face stroke's taper made a V chin.
  - Not yet: the older figure's pale hair reads chalky; the hood (a worn block) still paints as a rectangle.

## The form layer (agreed: the rig decides pose and contact, the brush decides form and silhouette within a small margin)

- Variable-width bent marks: a path's `widths`, one per point, so one stroke swells and narrows.
- Profiles by body part, from how bodies are built, not from the blocks (the block gives only scale and direction):
  - the thigh full at the hip, the quad forward, narrowing to the knee;
  - the calf swelling behind the shin, slim at the ankle;
  - a deltoid capping the arm; the forearm full below the elbow, tapering to the wrist.
  - Each is offset toward the part's front or back as it's seen. Loose cloth eases a profile toward a tube; skin shows it all.
- Limbs are painted from the profile: one mass along the form, a found contour on the shadow side, a lost lit edge on the
  light side. A thigh starts up inside the hips.
- The torso: the seat one stroke across hip to hip (crotch to waist, dropping a little in the middle), the chest a form
  (waist eased under loose cloth, ribcage full, narrowing to the neck), and the slope from the neck into each shoulder.
- Found:
  - the hips laid along the pelvis's own axis collapsed to a knot; laid up the body, they were shorter than wide (a blob);
  - clothed limbs came out thinner than the old strokes.
- Tested on the slight figure's dive and the indigo runner from behind: the leg now grows from the hip and tapers, the seat
  joins torso to legs, the back reads as a body, not bars.
- Next: arms from behind; the near side lock of hair sticking out in front of the face; the head's own form; then the image
  studies on pose and description, not on our render.
- Passes and cloth, toward round three's target (the slight figure's dive):
  - a modelling pass: a cool half-tone band on the shadow side and a warm plane on the lit, each following the form's width;
  - a painting-in pass: smaller strokes along each form, each its own value and temperature about the local tone, never darker
    than it, blunt-ended, kept inside the silhouette;
  - a painter's value range: dark cloth lifted toward the light's colour where lit, so near-black trousers can be modelled;
  - fitted cloth's folds from the pose: compression at bent elbows and knees (more as they close), stacking at trouser hems and
    sleeve cuffs, tension from the armpit when an arm reaches, a roll where a top meets the waistband. Each a barely darker
    trough under a lit ridge, irregular in length and lean;
  - refinement at the points of attention: knuckles and the thumb's edge, the brow shadow and the shadow side of the nose and
    cheek when the face is seen, shoe toe caps and laces, the ponytail's tip frayed into strands;
  - the hip-to-arm sweep now goes under the chest as a gesture underlayer.
  - Found, by checking every character:
    - folds on near-black cloth were black chevrons (now ridge-led);
    - cross-contour modelling strokes tapered into stacked arrowheads and spiked past the silhouette (now bands);
    - painting-in strokes reaching past the edge made saw-teeth; dry tips spiked.
  - Rule kept: nothing inside a form crosses its silhouette; the found edge is the only edge.
  - Honest gap to the target, after this pass: the surfaces are still flat gouache planes beside its oil modelling, the head,
    hands and shoes are still the rig's shapes, there's no bunched cloth silhouette or scarf wrap, and the light is per part,
    not per point.
- Fixed (reported from a phone): in stroke-gouache the menu's characters, and the runner while the line was still drawn, had
  lost their bodies; only hands, feet and heads were painted.
  - Cause: all the figures' bones are painted in one call, and the form layer looks parts up by name, so it found only the last
    figure's `torso`, `thighL` and so on, and marked every figure's parts of those names as done.
  - Now each figure (its bones start at its pelvis) is painted on its own.
  - A unit test checks three figures painted together make the same marks as each alone. The studies had only ever painted one
    figure, which is why they missed it.
- Painting over a lit body (agreed):
  - each frame the figure is rendered off-screen as smooth tubes, each bone an elliptic tube tapering from its start's width
    and depth to its end's, domed past each end (joints round over; a head, a hand, a foot an egg), with smooth normals;
  - it's lit per point by the real sun and the shadow map, in the look's own warm light and cool shade, with the dark-cloth
    value lift, a little bounce from below and a cool rim;
  - each figure mark takes its colour, as much as it asks (`body`), from that image under its own pixel: masses most, the
    painting-in and modelling bands some; contours, folds and details keep their own.
  - The mark keeps its shape, edge and brush; the light now turns across the form.
  - Cost: the mesh is built into a reused buffer and drawn indexed, 0.3 ms a frame for the schoolgirl's 64 bones (desktop),
    plus one small render.
  - Next: the head, hands and shoes as shapes of their own (they're still the rig's), the loose silhouette (sweater, scarf
    wrap), and the light read back in the stroke shader for marks' directions.

## The stroke look becomes an oil sketch (round four, `static/roofjumps-studies/round4/`)

- Asked for: the oil sketch is *the* stroke look, not a second one.
- A toned ground: a warm ochre board. The city's underpainting breaks toward its edges and here and there inside (on the mark
  itself, so it travels with it), and the board shows through.
- The city's broad pulls, scatter and wall drags are drier, so they break where the brush runs out.
- The bristles show in every pull: ridges lighter, grooves darker.
- The figure in a few big strokes, per form: the shadow mass (dragged dry at its ends), the cool half-tone, a heavier lit top
  (brighter, drier), the contour. All coloured from the lit body.
- Taken out: the scattered painting-in strokes, fold arcs, laces, knuckles, face details. The sketch says a form in a few big
  strokes and leaves the rest.
- The ponytail's tip is one calligraphic flick.
- Next: the figure's strokes looser and more gestural (wider, fewer, bending with the gesture), the head, hands and shoes as a
  few gestural strokes, the sky and the far city looser too.
- Round five (`static/roofjumps-studies/round5/`): six characters as oil sketches. Focus now brushwork and the characters, not
  the city.
  - Tried:
    - no contour;
    - masses wider and drier;
    - three broad wrap strokes across the torso;
    - the hair one broad curved mass, a lit stroke and flyaway flicks;
    - a swirl along a skirt's hem;
    - cuffs, hems and sole lines removed;
    - the lit body's shade lighter, the dark-cloth lift stronger;
    - figure marks given torn sides and broken edges in the shader.
  - Result, honestly: small gains. The figures still read as tubes: their strokes keep clean, straight sides and the rig's
    proportions, and the heads still read as blocks. The tuning isn't converging. The next step is to build and test the
    figure's brush on its own: a test page of single strokes against the studies' marks, before laying it over the figure.
- The brush test board, `?brushes` (`brushtest.ts`): single strokes on the toned ground, the city left out, beside lit forms.
  Rows: one pull at three drynesses (old brush, then the figure brush); bent pulls (arc, S, swelling); impasto (socks, shoe, lit
  over dark, hair mass and flicks); strokes over lit forms. It showed what was wrong at once:
  - every stroke was a pointed lozenge (both ends tapering);
  - bends were hard angles and a swelling stroke a stack of rectangles;
  - the figure's torn sides barely differed from plain;
  - the bristles were faint.
- The figure brush, fixed on the board:
  - lands blunt (a rounded end, the brush's own width), keeps its width, and ends breaking into bristle streaks;
  - sides torn about the width rather than eating into it;
  - bristle ridges lighter and grooves darker, a little impasto highlight on the ridges;
  - bent marks smoothed (Catmull-Rom, four legs a span, widths eased), so curves and swells are continuous.
- Correction (from the user): the ochre ground was the image generator's, not a direction, and mustn't become the game's baseline.
  - The stroke look is back on its pale paper, with its underpainting whole (broken underpainting on pale paper reads as white
    specks).
  - Only the brush board can take a toned ground (`?brushes&ground=ochre`), to judge whites; its underpainting breaks only then.
  - Kept from the oil-sketch move: the drier city strokes, the bristles, and the figure brush.

## Brush splats: the primitives (planned, then built on the board, `?brushes`)

A mark is a splat: an oriented stroke in 3D (a path, widths along it), its pigment, and four properties, each in the stamp
(widened from 36 to 44 floats: two vec4s more):
- **surface** (`surf`): the normal of what it lies on. Lit by the sun on it (the look's warm light, cool shade), with the
  bristles' relief bumping the normal, and a gloss on ridges turned to the light.
- **view**: from the same normal, a splat seen edge-on narrows (to 40%) and fades, so no slivers and no gaps.
- **load** (`load`): paint drains along it: thick and opaque where it lands, the bristles breaking it where it thins. The
  relief is the paint's thickness.
- **pickup** (`pick`, `smear`): wet into wet. What's painted so far is copied to a texture, and marks that pick up paint are laid
  last, sampling it back along their own direction: they drag the paint under them, most where they land, and only paint, not
  paper.
- Also: a swelling mark's legs carry their ends' widths, eased in the shader.

Kinds, as presets of these on the figure brush (blunt landing, bristle exit, torn sides):
- pull: a long loaded stroke;
- wrap: a bent, swelling stroke round a form;
- dab: impasto, short, full load;
- flick: thin, calligraphic;
- scumble: dry, little load, broken over.

Board rows: A light (surface toward the sun, the eye, sideways, away); B view (0 to 86 degrees from the eye); C load (0.2, 0.5, 1,
and one draining); D pickup (0, 0.5, 1 over a dark passage); E the kinds.

Known: a tight wrap still facets (the bristle pattern restarts each leg); the light rows want more contrast.

Next: the figure re-laid with these: few big splats, each with its surface from the lit body's form, a load, and the top
strokes picking up the masses under them.
- Board fixes:
  - **The wrap faceted.** Each leg of a bent mark sized its brush coordinates by its own width, so the bristles and torn sides
    jumped at every joint; and straight-edged legs showed corners at a sharp turn. Now every leg is the mark's widest brush (its
    own widths as shares, eased), and bent marks are smoothed into ten legs a span, so each turns little. The bristles flow round
    the bend.
  - **Light contrast:** shade to 0.6 of the look's shade, light to 1.1, over a narrower turn. A splat facing away from the sun
    is now a clear deep violet.
  - Noted: two headless renders of the board came back blank with no error; re-run, the same source draws. Treat a blank still
    as a harness flake before blaming the code.
- Spline strokes (`strokes.ts` `Spline`), on the board (`?brushes=splines`, `&t=` to hold a moment):
  - a stroke is four control points with a width at each, and the stroke's pigment, surface, load and pickup;
  - drawn as one strip of 32 segments evaluated on the GPU (uniform Catmull-Rom with its ends extended, widths eased between
    the points), so there are no joins, seams or notches at any curvature;
  - the strip lies on its surface, or turns to the eye, narrows and fades edge-on, and never thins below two pixels;
  - its own vertex shader emits the same varyings as the stamps, so the same fragment shader paints it: the figure brush's blunt
    landing, bristle exit, torn sides, load, splat light and wet pickup all carry over;
  - forty floats a stroke, against ten to thirty stamps for a bent mark.
  - The board's rows, redrawn as splines; and a row F, a sleeve pinned to a limb bending at the elbow with time, its points from
    the bones each frame. Over three moments the stroke bends with the limb, its bristles and edges fixed to it, not crawling.
  - The city stays on stamps.
  - Next: the figure's strokes as splines from its bones.
- Spline strokes twist in 3D:
  - a surface normal at each control point (`surfs`), eased along the curve;
  - the ribbon lies across the surface at each point (its width direction from the normal and the curve's tangent), so it turns
    as it goes, narrowing edge-on where the surface turns away;
  - lighting follows the turning normal point by point (a smooth varying now, shared with the stamps).
  - 52 floats a stroke.
  - On the board, row G: a ribbon turned 180 degrees about its length (broad face, edge, its back, darker), and a stroke
    wrapping round a column, from its lit front onto the side away.

## The figures re-laid in spline strokes (first pass): a field of strokes a form, not a stroke a bone

- Asked: don't fixate on one stroke per bone or limb; a form is many strokes.
- The design: each form (a sleeve or a leg across its joint, the torso, the hair, the face) is a stroke field over its own
  surface. The surface is parametrised along the form (over its bones, by length) and round it, from the bones' real blocks
  (each part now carries its bone).
- Each form gets:
  - a block-in, one broad stroke down its middle as wide as it is (a painter's first pass);
  - strokes along it at several places round the side the eye sees;
  - strokes wrapping across it at several places along it.
- The strokes:
  - lie on the surface (a normal at every point, so they turn, narrow and darken as the form turns away);
  - are lit by the sun;
  - are seeded by form and place, their points fixed in the bones' own space, so they come back each frame and move with the
    body;
  - are counted by screen size (more near, fewer far), never wider than the form.
- Hands, feet, worn blocks and cloth keep their stamp marks for now.
- Found: as a dense field the forms read as knitted fabric; with too few strokes each grew wider than the form and flared into
  fins. Now 2-3 along and 1-2 across, widths capped by the form.
- Not yet:
  - the joins between forms (the waist, the neck) show gaps;
  - the hair reads as a helmet;
  - the light is dark overall;
  - cloth (skirt, coat), hands and feet are not yet in splines.

## 23 November: joins, light, hair, cloth
- Joins: field strokes lap past each form's ends (s from -0.08 to 1.08; the surface extrapolated past the bone), limbs reach up into the shoulder and hip, and a neck stroke runs from inside the collar into the head.
- Light: the splat shade takes more sky fill and a little warm bounce from below; dark cloth is lifted a little more, hair less, so black hair stays black.
- Head: the head is an ellipsoid. The face is one smooth plane, brow to chin, with a jaw stroke across it and a darker cheek plane away from the sun. The hair is a dark mass down the back, with eleven tapered locks from near the crown to the nape or behind the ear, a fringe when the face is seen, and flicks off the ends. It no longer reads as a helmet.
- Cloth: skirt and coat columns are now spline strokes (4 points along the column, normals from the quads), with a narrower fold stroke a value off on every other column. The hem is drawn in overlapping runs of four.
- Wrap strokes are narrower and translucent, so they read less like bandages. New `aim=` URL key (the height looked at) for head close-ups.
- Still to do: the side-view face (hair covers the profile), hands and feet as splines, Astra's critique items.

## 23 November (afternoon): the figure painter as masses, then passages
In response to the critique of the 13:29 build. The full notes are in `roofjumps-studies/round6/README.md`.
- The gloss test (`paint=flat`) showed the ridge gloss caused most of the plastic shine. Its default dropped from 1 to 0.25, and the bristle value contrast on figure strokes was halved.
- Every figure stroke is now fixed on the body (bone space, fixed counts), with no eye-chosen angle and no distance-scaled count. Far-side strokes hide themselves (spline flag `front`). Strokes are sorted far to near by form, with garment layers lifted.
- Garment masses: jacket panels, the shoulder slope, sleeves through the elbow, a collar band, the neck under the jaw, the head blocked in in the hair's dark with face planes over it, and attachments as splines.
- New URL keys: `paint=masses` (broad masses only), `paint=flat` (no ridge gloss), `aim=` (the height looked at).
- Not yet done: the brush-from-rest motion test (only the frozen-pose orbit was rendered); hands and feet are still stamps.

## 23 November (evening): round seven worked in order
The full notes are in `roofjumps-studies/round8/README.md`. The changes: a hard terminator per form and no per-stroke value noise; garment ease profiles (top, sleeves, trouser legs) with hem and cuff bands; drape strokes from the shoulder points; face planes (sockets, nose, mouth) with flattened face normals; a larger sailor collar; skirt and coat flare. Still to do: the brush-from-rest motion test, and hands and feet as splines.
