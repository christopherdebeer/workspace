# Stillwater — syllabi, and what they mean for the design

*30 September 2026. How the early-number syllabi Stillwater serves (roughly ages
4–9) differ, where they agree, and how the river is built to follow any of
them. Scotland is the default (the children who play it are at school there).
The syllabus data lives in `client/challenges.ts` (`SYLLABI`).*

> Accuracy: curriculum statements below are paraphrased. England, US and
> Scotland are stated with reasonable confidence; lines marked *(check)* and
> the European notes are indicative and should be checked against the source
> before anything is built on them.

## 1. Shape: years, or broad levels

| | Scotland | England | United States | Ireland | Germany | Netherlands | Finland | France |
|---|---|---|---|---|---|---|---|---|
| Framework | Curriculum for Excellence: Experiences & Outcomes; Numeracy and Mathematics Benchmarks (2017) | National curriculum (2013); DfE *Mathematics guidance KS1–2* ("ready to progress", 2020); EYFS framework | Common Core State Standards (2010), adopted or adapted by state | Primary Mathematics Curriculum (NCCA, 2023) | KMK Bildungsstandards (end of Klasse 4) + each Land's curriculum | Kerndoelen; referentieniveaus 1F/1S (end of primary) | National core curriculum (2014) | Programmes by cycle, with annual *repères* |
| Unit | **Levels spanning years**: Early (ELC–P1), First (P2–P4), Second (P5–P7) | **Year by year** (statutory programme of study per year) | **Grade by grade** | **Stages of two years** | Year by year in most Länder | By groep, with end-of-school levels | Grade bands (1–2, 3–6) | Cycles (2: CP–CE2), with yearly markers |
| Formal school from | P1 at 4½–5½ | Reception at 4–5 (Year 1 at 5–6) | Kindergarten at 5–6 | Junior Infants at 4–5 | Klasse 1 at 6 | Groep 3 at 6 (groep 1–2 from 4) | Grade 1 at 7 (pre-primary at 6) | CP at 6 (maternelle from 3) |
| A year-6 child is | P2 (First level) | Year 1–2 | Grade 1 | 1st class | Klasse 1 | Groep 3 | Pre-primary | CP |

**Consequence.** A "year" only places a child. Scotland in particular expects
progress within a level by teacher judgement, not by date, which fits how the
river already moves: on evidence, not by age.

## 2. What is expected, and when (Stillwater's scope)

| Target | Scotland | England | US |
|---|---|---|---|
| Recognise numerals; before, after, missing | Early: recognises numbers 0–20; before/after/missing within 20 (MNU 0-02a "…count, create sequences and describe order") | EYFS: count beyond 20, subitise to 5; Y1: one more / one less | K.CC.1–3: count to 100; count on from a given number; write 0–20 |
| Add and subtract within 10 | Early: practical, "count on and back", recorded "in different ways" (MNU 0-03a); mental to 10 by the end of Early *(check)* | Y1 (RtP 1NF-1: fluency within 10) | Grade 1 (1.OA.C.6: fluent within 10) |
| Within 20, bridging ten | First level (recall to 20) | Y1 bonds within 20 (NC); bridging 10 fluent by Y3 (3NF-1) | Grade 2 (2.OA.B.2: from memory within 20) |
| The equals sign as a relationship; missing numbers | First: MTH 1-15a (=, ≠, <, >), MTH 1-15b (a symbol standing for a number) | Y1: "missing number problems such as 7 = □ − 9" | Grade 1: 1.OA.D.7 (meaning of =), 1.OA.D.8 (unknown in any position) |
| Early × and ÷ | First: 2, 3, 5 and 10 facts *(check exact list)* | Y2: 2, 5, 10; × ÷ = symbols | Grade 2: arrays to 5 × 5, even and odd (2.OA.C.3–4) |
| Further tables | Second: to 10 × 10 *(check)* | Y3: 3, 4, 8 | Grade 3 |
| All tables | to 10 × 10 | **to 12 × 12 by the end of Y4** (statutory Multiplication Tables Check) | to 10 × 10 by the end of Grade 3 (3.OA.C.7) |

European notes *(indicative)*: **Germany** covers numbers to 20 in Klasse 1,
to 100 with the *kleines Einmaleins* (1×1 to 10×10) in Klasse 2, to 1000 in
Klasse 3. **The Netherlands** introduces the tables (*tafels*) in groep 4–5
(ages 7–9), with strong use of the empty number line and the *rekenrek*.
**France**: the tables of 2–5 in CE1, all by CE2. **Finland** starts formal
arithmetic a year or two later (grade 1 at 7) and moves quickly. **Ireland's**
2023 curriculum is stage-based, like Scotland's.

**Where they agree.** The order is nearly universal: numerals and counting;
facts within 10; within 20 and bridging ten; equal groups with 2, 5 and 10;
the other tables; relationships (inverse, equivalence, missing numbers)
throughout. **Where they differ:** *when* (England earliest and fastest on
the tables; Finland and Germany later but steeper), *how far* (12 × 12 in
England, 10 × 10 almost everywhere else), and *how much symbol at the start*
(Scotland's Early level is practical, with symbols optional; England's Year 1
already writes `7 = □ − 9`).

## 3. Notation and words

- **Division and multiplication signs.** `÷` and `×` are the English-speaking
  convention. Germany, the Netherlands, France and the Nordic countries mostly
  write `:` for division, and often `·` for multiplication. Historically `÷`
  has been used for *subtraction* in Denmark and Norway *(check)*. The glyph
  atlas would need `:` and `·` before offering those syllabi.
- **Number words.** German and Dutch say the units first above twenty
  (*einundzwanzig*, *eenentwintig*); French counts 70–99 in twenties
  (*soixante-dix*, *quatre-vingts*). Spoken help and sequences above twenty
  must be localised, not translated.
- **Operation words.** UK "take away" / "lots of" / "shared between"; US
  "minus" / "groups of" / "times"; Scotland's classrooms use the UK words.
  Spoken help uses the UK words today.
- **Representations.** Ten- and twenty-frames and part–whole models are
  everywhere in the UK (Numicon in many Scottish schools). The Netherlands
  uses the *rekenrek* (bead frame) and the empty number line, and Germany the
  *Zwanzigerfeld* (20-frame). The dot picture under the question is laid out in
  fives, which reads as any of these.

## 4. What this means for the river's design

1. **One ladder, many syllabi.** The levels are one ladder in teaching order.
   A syllabus is data: which school years start where, what each level is
   called there (a Scottish parent sees "First level (P2)", an English one
   "Year 1"), which tables each level draws on, and the top table. Adding a
   syllabus is a new entry in `SYLLABI`, not new questions.
2. **Years place; evidence moves.** The school year a grown-up chooses sets a
   starting level and a floor. Moving on needs clean answers on more than one
   day; a level that is not holding steps back. This suits Scotland's broad
   levels and England's yearly statements equally.
3. **Symbols when the syllabus uses them.** The early level asks only
   symbol-free questions: gather a number of drops, which numeral says how many,
   what comes before or after. Written `+ − =` begins with Facts within 10
   (Scotland P2, England Year 1, US Grade 1).
4. **Numerals on the leaves only where the numeral is the question.** Water
   numerals are shown on leaves only for numeral identity ("how many?" shown as
   dots at the top, answered by touching the numeral) and order ("5 6 ?"). That
   is the Early level / Reception / Kindergarten, and one more / one less at
   Facts within 10. Everywhere else the leaves are dew, because counting and
   grouping the drops *is* the maths there. The dew gathers into its numeral for
   the question and back into dew after it, so the numeral and the quantity are
   visibly the same water.
5. **The tables follow the syllabus.** 10 × 10 for Scotland and the US, 12 × 12
   for England; the grouping levels use each syllabus's tables in its order.
   Physical equal groups stay at six or fewer leaves of six or fewer drops;
   larger facts are asked as a group size, as in every syllabus.
6. **Before a non-English syllabus:** the `:` and `·` glyphs, localised spoken
   number words and operation words, and a 20-frame / number-line option for
   the dot picture.

## 5. Not yet covered (all syllabi)

These are all in every syllabus at these ages, and could be river-native in
time:

- place value beyond 100 (tens as bundles: a raft of ten leaves?);
- halves and quarters (a leaf's dew shared between two fish: the basket);
- money;
- time (the river already has a day);
- measurement and shape;
- simple data (the notebook's sightings as a pictogram).
