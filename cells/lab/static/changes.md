# Changes

A quiet I Ching experiment, prompted by the supplied iOS app: six blue lines in open white space, one Roll button, then a reading.

## Use

Consider a question, optionally write it, and tap Roll. Six three-coin throws appear from bottom to top. Open the reading for the name, upper and lower trigrams, the classical Judgment and Image, an original supplementary reflection prompt, and the relating figure if any lines change. Explore all 64 without casting. Keep a reading and note in the journal if you wish.

The journal keeps the latest 100 saved entries in this browser's local storage. It is not synced to the substrate. Cast links encode only the six line values, never the question or journal note. Clearing browser storage removes the journal.

## Casting

Casts are deterministic: SHA-256 of a versioned seed containing the normalized question, cadence, local IANA time zone and calendar window supplies six groups of three bits, each mapped to 2 or 3. No random device salt is used. The same inputs always give the same six lines, including changing lines. Outcomes 6, 7, 8 and 9 have weights 1, 3, 3 and 1 out of 8. Six and nine are changing yin and changing yang; seven and eight are stable yang and stable yin. The relating figure flips only changing lines. The lookup uses the traditional King Wen ordering; bit zero is the bottom line.

## Renewal preference

Hourly (default), daily, weekly or monthly, saved in this browser. Windows are calendar-aligned in the device’s local time zone: hours at :00, days at midnight, weeks on Monday, months on day one. Both occurrences of a repeated daylight-saving hour use the same cast. The question is NFC-normalized, trimmed, whitespace-collapsed and lowercased; punctuation is preserved. Empty and whitespace-only questions share a seed. Different windows or questions may coincidentally yield the same result; a fresh window is a fresh seed, not a promise of a different hexagram.

Time and question are captured when Roll is tapped; animation cannot straddle two seeds. Saved entries retain their original lines plus optional casting context; older entries remain readable. Shared cast links retain their exact lines and omit question and casting metadata. Question editing is locked after casting until New cast, so it cannot silently relabel an existing result. Changing cadence resets the displayed cast. Hashing happens locally; the question is not transmitted.

## Editorial scope

All 64 figures have Chinese names, pinyin, short English labels, upper/lower trigram names, and newly written reflection questions. English naming varies between editions. Kǎn is labelled Water, while the supplied app uses the associated Cloud image.

The Judgment, Image (Great Symbolism, Appendix II), all 384 line passages, and the two additional all-changing passages for hexagrams 1 and 2 are taken from James Legge’s public-domain translation, The Yî King (1882), transcribed by the Internet Sacred Text Archive. The reading presents the Judgment and Image first; cast changing lines appear in full, and all six passages are available in an expandable section. The relating figure has its own Judgment and Image. Original modern reflection prompts are supplementary and labelled separately. Historical wording and romanisation are retained; whitespace and page-break fragments are joined, and page numbers and footnote-reference markers are omitted. The full commentaries are not included. No AI generation occurs during use, and no question or journal note is sent to a model or server.

## Links and presets

- `/changes`: a new cast.
- `/changes?hex=3`: explore Beginning, as in the reference screenshots.
- `/changes?cast=788878`: the screenshot's stable figure, lines bottom first.
- `/changes?cast=688879`: a reproducible example with moving lines.
- `/changes?preview`: a quiet, static card for the lab index.

## Text provenance

- James Legge, The Yî King, Sacred Books of the East, volume XVI, Oxford: Clarendon Press, 1882. Public-domain translation.
- Source: Internet Sacred Text Archive, https://sacred-texts.com/ich/ — hexagram pages ic01.htm through ic64.htm; Images from icap2-1.htm and icap2-2.htm.
- Source passages are bundled locally; opening a reading does not depend on the archive being online.

## References

- [Hexagram names and trigram composition](https://en.wikipedia.org/wiki/List_of_hexagrams_of_the_I_Ching)
- [Three-coin casting method](https://iching-bazi-fengshui.com/en/iching/coin-method/)

## Design questions

Does a single unhurried casting action create enough of a pause? Does the transformation read clearly without explanatory controls? Does a short reflection invite more attention than a long reading? How well do the historical text and modern prompt support different ways of contemplating a cast?
