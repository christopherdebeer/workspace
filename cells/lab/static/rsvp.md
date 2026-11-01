# Afterword — RSVP with peripheral context

A mobile-first experiment in Rapid Serial Visual Presentation (RSVP), with an approximate Spritz-style optimal recognition point and two competing fields of context. Previous language sits above the anchor, and upcoming language below it. The context is not merely decoration: it invites prediction and regression without losing the central reading point.

## Touch

Tap the left third of the reading surface to go back one word, the right third to step on, the centre to start or pause. Stepping on is also how you set the pace (see The beat). Drag horizontally to scan as you'd drag a page (leftward brings on what's next), reversible from the original touch-down position. The timeline seeks anywhere, and ±10 buttons make coarse steps. The whole player folds away (⌄) to a slim bar with play, progress and the way back (⌃), leaving the page to the text. Keyboard arrows and Space work on desktop (→ steps on, and sets the pace, as a tap does).

## The beat

The reader runs on a steady beat, shown top right in beats per minute with a dot that lands on each word. Every word takes one beat (a long one, eleven letters or more, a beat and a half), and punctuation adds rests in whole half-beats: a comma half a beat, a clause or sentence end one, a paragraph end two, all scaled by the rests setting. So the pulse never wavers: the words, the clicks and the bass all fall on the same grid, and it doesn't drift (each onset is counted from the last, not from a chain of timers). The tempo is set by stepping: tap forward through the words (the right third, › or →) and, from the third step within two and a half seconds of the last, the rhythm of your steps becomes the BPM, each interval counted against the beats the word it left holds (so stepping off a sentence's end, with its rest, counts as the longer beat it is). Playing, your step lands at once and the beat runs on from it at the new tempo, so you can tap along to speed it up or hold it back; paused, Play goes on at the pace you stepped. It holds until you step again or move the slider; stepping back, seeking and pausing leave it as it is. Each start (Play, after a pause or a seek) eases in: the first few words (the warm-up, 4 by default, 0 to 8) held longer, the first by 1.6×, coming up to the tempo by the last.

## Reading

The anchor letter is determined approximately by word length: first for 1-character words, second for 2–5, third for 6–9, fourth for 10–13, fifth for 14+. Typographic widths are accommodated by laying out characters before and after that anchor on opposite sides of a fixed centre. A word too long for the page at your size is drawn smaller, that word only. Modes: Off, Nearby words, Extended passage. Context strength and span are adjustable.

The context reads as prose flowing through the word: the previous words sit just above it, set right, their last line ending where the word begins; the next words sit just below, their first line starting where the word ends and running on from the margin (when the word leaves under 30% of the width beside it, the line is a whole one of its own). The passage starts at a sentence, never mid-sentence at the top edge, and a blank line in the text is a paragraph break there, as on the page.

## Audio

Click marks every word onset. Bass is a soft synthesized falling sine pulse on the words that start a clause, or a sentence, or (as a comparison) every 2, 3, 4, 6 or 8 words. Both combines them. The sounds follow actual word onsets, including punctuation delays; they are not independent beats that drift away from the text. User-gesture play is required to enable Web Audio. No external assets.

## Shareable state

Everything is held in the URL fragment: \`#text=…&i=…&bpm=…&mode=…&span=…&opacity=…&pause=…&font=…&sound=…&volume=…&group=…&warm=…&ui=…\` (an older link's \`wpm\` is read as the bpm). The address is rewritten when you pause, seek or change a setting, not on every word as it plays. The position and settings travel with the source text, and no localStorage/server data is needed. The URL itself contains the source text: do not publicly share private text. Long passages make long URLs. Playback does not auto-start on reload due to mobile audio restrictions.

## Research questions

Does subdued preview help prediction without creating attention competition? Does previous-word context make regression useful? When does visibility harm comprehension? Can an audible pulse scaffold reading rhythm, or impose artificial grouping (bass on clause starts against every N words)? Does a steady beat with rests read better than durations that vary word by word? The Off mode provides a minimal control condition. This is an interaction study rather than evidence for higher comprehension.
