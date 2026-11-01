# Afterword — RSVP with peripheral context

A mobile-first experiment in Rapid Serial Visual Presentation (RSVP), with an approximate Spritz-style optimal recognition point and two competing fields of context. Previous language sits above the anchor, and upcoming language below it. The context is not merely decoration: it invites prediction and regression without losing the central reading point.

## Touch

Tap the left third of the reading surface to go back one word, the right third to advance, the centre to start or pause. Drag horizontally to scan (right = forward; left = backward), reversible from the original touch-down position. The timeline seeks anywhere, and ±10 buttons make coarse steps. Keyboard arrows and Space work on desktop.

## Reading

The anchor letter is determined approximately by word length: first for 1-character words, second for 2–5, third for 6–9, fourth for 10–13, fifth for 14+. Typographic widths are accommodated by laying out characters before and after that anchor on opposite sides of a fixed centre. Modes: Off, Nearby words, Extended passage. Context strength and span are adjustable. WPM is a base rate; word length and punctuation change displayed durations.

## Audio

Click marks every word onset. Bass is a soft synthesized falling sine pulse every 2, 3, 4, 6 or 8 words. Both combines them. The sounds follow actual word onsets, including punctuation delays; they are not independent beats that drift away from the text. User-gesture play is required to enable Web Audio. No external assets.

## Shareable state

Everything is held in the URL fragment: \`#text=…&i=…&wpm=…&mode=…&span=…&opacity=…&pause=…&font=…&sound=…&volume=…&group=…\`. The position and settings travel with the source text, and no localStorage/server data is needed. The URL itself contains the source text: do not publicly share private text. Long passages make long URLs. Playback does not auto-start on reload due to mobile audio restrictions.

## Research questions

Does subdued preview help prediction without creating attention competition? Does previous-word context make regression useful? When does visibility harm comprehension? Can an audible pulse scaffold reading rhythm, or impose artificial grouping? The Off mode provides a minimal control condition. This is an interaction study rather than evidence for higher comprehension.
