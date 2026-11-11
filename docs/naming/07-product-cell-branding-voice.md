# Product / cell branding & the overall naming voice

> Oblique strategy drawn: **"Consult other sources — promising / unpromising."**
> (second card, drawn live: *"Remove specifics and convert to ambiguities"* —
> used as a sanity check at the end.)
>
> Lens: hold parc.land's product names up against *external* naming systems —
> Unix, Smalltalk, biology/ecology, the design system's own park/reef metaphor,
> and a few deliberately absurd ones — and mine each for what the branding
> *should* be. This is a generative ramble over ONE domain: the names users and
> agents actually read. Sibling docs cover the other naming layers.

---

## 1. Inventory — name → what it names → fit

The product surface has four naming tiers, and they do **not** share a voice
today. Tier matters: the design language's hard rule (`park-design-language.md`)
is *"motifs never rename the system"* — park words live in copy, never in a
`target` string. So a name's tier decides which rulebook judges it.

### Tier A — the brand words (copy + identity, park register allowed)

| Name | What it names | Fit |
| --- | --- | --- |
| **parc.land** | the whole product / domain | Strong. A pun (parc/park + .land TLD), reads as a place. The "c" spelling is a small tax (people will type "park.land") but it owns the metaphor. |
| **park** / "park design language" | the visual language (`park-design-language.md`) | Strong, and *load-bearing*: the iOS icon, palette, field-guide voice all flow from it. The system "looks like the park it is named for." |
| **reef** | the *target* state of the substrate — "self-activating surfaces," monotonic accreting truth (`substrate.md`: "all organs and no reef") | Mixed. Evocative and precise *internally*, but it is a second ecology (marine) bolted onto a first one (alpine park). A reef is not in a park. See §4. |
| **substrate** | the data model / brand word for the foundation (facts + provenance + salience) | Good as a *technical* brand word; cold as a *consumer* word. "A personal substrate for exploring the world" is the tagline — accurate, slightly clinical. |

### Tier B — provider cells (the name IS the agent-typed namespace)

These are the names that become `<domain>.<verb>` in a read/act `target`.
`platform-cells.md` already legislated the rule: **generic domain noun + bare
verb**, no metaphors. Judge these harshly — they are API surface.

| Name | What it names | Fit |
| --- | --- | --- |
| **workspace** | `workspace.query` / `recall` / `attention` — the observed-state substrate | Exemplary. Generic noun, reads as a sentence with bare verbs. The model citizen. |
| **cells** (was `forge`) | the dynamic-cell control plane (`cells.create/deploy/logs`) | Good — the rename to `cells` already happened in the docs precisely because `forge` was a metaphor that fought the rule. |
| **models** | `@c15r/models.*` — the generative executor (LLM providers) | Good. Plain domain noun; `models.run` / `models.agent` read cleanly. |
| **run** | `@c15r/run.*` — the code executor | Good and *symmetric* with `models` (the two transformer kinds: code / generative). `run` as a noun-namespace is slightly verb-y but `run.submit` reads fine. |
| **regwatch** | FCA/IA regulatory monitoring cell | Domain-specific portmanteau (reg + watch). Fine as a *userland* cell name (not platform vocabulary); reads clearly. |
| **reef-writer** | a tiny cell that emits a fact to the reef via the event bus | Weakest provider-ish name. It leaks the *internal* "reef" metaphor into a tool surface (`reef-writer.report`), violating the very rule `platform-cells.md` set. See §5. |

### Tier C — infrastructure / module cells (name = internal clarity only)

Never appear in a user `target`; judged only on clarity.

| Name | What it names | Fit |
| --- | --- | --- |
| **home** | the SPA front-door + signed-in dashboard | Clear, warm, conventional. `home-cell.md` itself muses it "leans toward `web`/`app`" but isn't urgent — agreed, leave it. |
| **kernel** | the shared client ESM module (`ensureAuth`, `read`, `act`, `titleOf`) imported by every surface | Accurate (it *is* the shared core) but it imports an OS metaphor into a system whose other metaphors are biological/ecological. "kernel" + "cell" half-rhymes (a cell has a nucleus, not a kernel) — a near-miss. See §4. |
| **input** | a capture cell (a static input surface) | Generic to the point of vague; functional. Acceptable for infra. |
| **viewers** | the shared pure-renderer module (json/csv/mermaid/style) | Good, plain, plural-as-collection like `cells`. |
| **lit** | substrate-native literate authoring (docs as views over cell-facts) | The interesting one. See the dedicated note below and §5. |
| **canvas** | the spatial projection cell (parcland board) | Excellent. Universal, neutral, true to function. |
| **starter** | the canonical cell template | Good — conventional ("starter kit"), self-describing. |

### The `@owner/cell` addressing scheme

`@c15r/lit`, `@c15r/models`, `@c15r/kernel`. This is the **best single naming
decision in the system** — it's directly the npm/`@scope/pkg`, Twitter/Bluesky
`@handle`, and email convention fused. It makes ownership legible, supports
multi-tenant, and reads aloud naturally ("at-c15r-slash-models"). It also keeps
cell *names* free to be short generic nouns because the `@owner` carries the
disambiguation. No change recommended.

### The "lit" question (called out by the brief)

`lit` is two coincidences stacked:
1. **Lineage-true:** it descends from `dotlitdev/dotlit`'s `.lit` literate-
   markdown format (`dotlit-review.md`), so the name carries real provenance.
2. **Slang-true:** "lit" = excellent/illuminated, and a literate document *is*
   text "lit up" with executable cells.

But it's also **collision-prone**: `lit` is a hugely popular web-components
library (lit.dev) and a common English word — bad for search, ambiguous in a
sentence ("open it in lit"), and it doesn't telegraph *authoring/documents* the
way `canvas` telegraphs *space*. Verdict: clever, defensible by lineage, but
the weakest *functional* signal among the surface cells. Candidate rename in §5.

---

## 2. External sources consulted (promising + unpromising)

### Promising analogues

- **Unix / coreutils.** The gold standard the provider-cell rule already
  imitates: short, generic, lowercase, *verb-or-noun-but-not-both* (`ls`, `cat`,
  `grep`, `make`, `cron`). Lesson parc.land already absorbed: `workspace.query`
  is `<noun>.<verb>` — a tiny sentence. Where Unix is *un*promising: its names
  are cryptic (`awk`, `grep`, `tr`) because they optimised for typing on a 1970s
  teletype, not for a first-time reader. parc.land's audience includes agents
  *and* humans reading the same screen (the dual-register rule), so it should
  keep Unix's brevity but reject Unix's opacity. `reef-writer` is an `awk`-style
  insider name; `canvas` is a coreutils-grade name.

- **Smalltalk.** The deepest analogue, because parc.land is *reflexive* (cells
  run their own content; the platform extends itself) exactly as Smalltalk's
  image is. Smalltalk's vocabulary — *image, become, doesNotUnderstand, message,
  workspace* — is plain English used as terms of art. Note: **"workspace" is a
  Smalltalk word** (the scratch evaluation pane). parc.land's best name is
  literally inherited from the most reflexive system ever built. Lesson: name
  the *concept the user manipulates*, in plain words, and let it become jargon
  by use — don't invent a metaphor when a plain word will calcify into one.

- **Biology / the cell metaphor.** `cell`, `substrate`, `organ`, `tending`,
  `salience`, `evaporation` are a coherent *cellular-biology + ecology* family:
  a cell sits on a substrate, cells form organs, attention evaporates, the
  gardener tends. This is genuinely good system-building — it gives the project
  a generative metaphor (you can ask "what's the *membrane* of a cell?" and the
  isolation answer falls out). Lesson: this is the **primary** metaphor family
  and most names should be checked against it.

- **The "park" field-guide (the design language's own choice).** `park-design-
  language.md` is disciplined: park words are scenery (trailhead, outpost, day
  pass, ranger station, weather) and **never** rename `facts`/`cells`/`grants`.
  This is the right model for the whole brand: a warm outer layer, a precise
  inner layer, kept strictly apart. Lesson: brand register and API register are
  *different namespaces* and the system already knows it.

- **npm `@scope/package` + the fediverse `@user@host`.** Validates the
  `@owner/cell` addressing as a proven, human-legible ownership scheme.

### Deliberately unpromising / absurd sources

- **AWS service naming** (the platform's own substrate!): `Elastic Beanstalk`,
  `SageMaker`, `Kinesis`, `Cognito`, `Fargate`. A cautionary tale of brand-words
  that name nothing — you must *memorise* that Cognito is auth. parc.land's
  `auth`/`gateway`/`dispatch` infra names are the deliberate anti-AWS: say what
  they do. Lesson by negation: never let a cell become a `SageMaker`.

- **Pokémon / "-mon" suffix naming.** Absurd on purpose: what if cells were
  `canvasmon`, `litmon`? It teaches one real thing — a *shared morphology*
  (suffix/prefix) signals family membership instantly. parc.land could (lightly)
  use the plural-collection morphology it already stumbled into (`cells`,
  `viewers`, `models`) to mark "this is a *registry* namespace" vs a singular
  app. Mostly a reminder not to over-systematise into cuteness.

- **Marvel/DC superhero codenames** (everything is a Proper Noun: `forge` was
  basically this). Teaches the failure mode parc.land already corrected:
  metaphor-names (`forge`) feel cool but force the reader to learn a mapping.
  The doc's own `forge → cells` rename is exactly this lesson applied.

- **Apartment-complex / housing-estate branding** ("The Reserve at Pine Hollow")
  — absurd-adjacent because it's *exactly the park register* taken too far. It
  warns: if park scenery words ever creep from copy into structure
  (`reef-writer`, a hypothetical `outpost.deploy`), the brand curdles into
  real-estate kitsch. Hold the line the design doc drew.

---

## 3. Coherence assessment of the metaphor families

There are **four** metaphor families in play, and they form two pairs that
half-cohere and half-clash:

1. **Cellular biology** — `cell`, `membrane`/isolation, `organ`, `substrate`,
   `nucleus`(implicit). *Primary, generative, internally consistent.*
2. **Ecology / tending** — `tending`, `salience`, `evaporation`, `garden`
   (legacy "Digital Garden"), `reef`. *Adjacent to biology; mostly compatible* —
   an ecosystem is made of cells. The strain is *which* ecology: a **reef**
   (marine) and a **park** (alpine, the icon is *pines under stars*) are two
   different biomes. A reef in a pine park is an image clash.
3. **The park (design-language scenery)** — `trailhead`, `outpost`, `ranger
   station`, `day pass`, `weather`. *Quarantined to copy by rule, so it can't
   clash with the API* — this is why the clash is survivable.
4. **Computing / OS** — `kernel`, `dispatch`, `gateway`, `run`, `input`.
   *Necessary and honest* (this is software), but `kernel` specifically pulls
   toward an OS metaphor (kernel/process/syscall) that competes with the cell
   metaphor. A cell has a *nucleus*, not a kernel.

**Verdict: it's a coherent *system with one seam*, not a grab-bag.** The biology
family is the spine; the park family is correctly fenced off in copy; the
computing family is unavoidable and mostly plain. The single real incoherence is
the **biome confusion inside family 2**: `reef` vs `park`/pines. Either the
ground state is a *reef* (and the icon/park scenery is a costume) or it's a
*park* (and "reef" should arguably be "meadow," "undergrowth," or just stay an
internal codename that never reaches a tool name). Right now both are first-class
and they point at different oceans-vs-mountains.

Secondary seam: `kernel`'s OS register inside a cellular system (minor, infra-
only, low urgency).

---

## 4. A proposed naming voice + guidelines

**The voice, in one line:** *plain English nouns for what the user touches; a
warm field-guide register for scenery; never the two in the same string.*

Codify the existing-but-implicit rules:

1. **Provider names are nouns, not metaphors.** A provider name becomes
   `<noun>.<verb>` — it must read as a sentence with bare verbs. (`workspace`,
   `cells`, `models`, `run` pass; `forge`, `reef-writer` fail.) *Already law in
   `platform-cells.md` — promote it to the brand bible.*

2. **One metaphor family is canon: cellular biology.** When you need an
   *evocative* internal term, draw from biology/ecology, and **keep one biome.**
   Pick park *or* reef as the ground metaphor and demote the other to a costume.
   (Recommendation: keep **park** — the icon, palette, and shipped design
   language are all park; "reef" is the newcomer and only appears in two doc
   lines. Rename the *target-state concept* "reef" to something park-native or
   keep it strictly as an internal codename that never names a cell or tool.)

3. **Scenery words stay in copy.** The park register (trailhead, outpost, day
   pass) may appear in headings, tooltips, empty states — never in a `target`,
   a fact `type`, or a cell name. (The hard rule, already written.)

4. **Tier decides the rulebook.** Brand words (parc.land, park) may be playful;
   provider cells must be plain; infra cells must be clear; userland cells get
   latitude (regwatch is fine).

5. **Use morphology to mark registries.** Plural-collection names (`cells`,
   `models`, `viewers`) read as "a namespace of many"; singular names (`canvas`,
   `home`, `kernel`) read as "one surface." Keep this accidental pattern on
   purpose.

6. **Prefer the boring true word over the clever one** unless the clever one
   carries real lineage. (`canvas` > any cute alternative. `lit` is clever *and*
   has lineage, but loses on functional signal — see below.)

### Rename candidates (where names fight the system)

| Name | Problem | Candidate | Confidence |
| --- | --- | --- | --- |
| **reef-writer** | leaks internal "reef" metaphor into a tool surface (`reef-writer.report`); violates the no-metaphor provider rule | `reporter` (`reporter.report` is redundant → `reporter.emit`) or fold into `workspace.write` / a generic `emit` cell | High — it's a tool-name leak |
| **"reef"** (concept) | second biome clashing with park/pines; promising internally but ambiguous | keep as **internal codename only** (never a cell/tool), or rename the *concept* to a park-native word ("the meadow"/"undergrowth"/"the living layer") | Medium — design call, not mechanical |
| **lit** | search collision (lit.dev), weak functional signal for "documents/authoring" | `pages`, `docs`, `notebook`, or keep `lit` as the *format* (`.lit`) while the cell becomes `docs`/`pages` | Medium — lineage argues to keep; clarity argues to rename |
| **kernel** | OS register vs cellular metaphor; a cell has a *nucleus* | `core` (neutral), or lean in: **`nucleus`** (biology-coherent, and it literally is the shared core every cell imports) | Low/playful — infra-only, low urgency |
| **input** | vague generic | `capture` (matches the "quick capture" UI language in `home-cell.md`) | Low |

Names that are **right and should not move**: `workspace`, `cells`, `canvas`,
`models`, `run`, `viewers`, `home`, `starter`, `@owner/cell`, `parc.land`,
`park`, `substrate`.

> Sanity check via the second oblique card (*"remove specifics, convert to
> ambiguities"*): the strongest names survive being made generic — `canvas`,
> `workspace`, `cells` are *already* maximally generic and still unambiguous in
> context. The weak names (`reef-writer`, `lit`) are the ones that get *more*
> ambiguous when you strip specifics — a tell that they were leaning on a
> private metaphor or a pun to carry meaning.

---

## 5. Top 3 concrete recommendations

1. **Rename `reef-writer` and quarantine "reef" to a codename.** `reef-writer`
   is the one provider-ish name that leaks an internal metaphor into a tool
   `target` — exactly what `platform-cells.md` forbade for `forge`. Rename the
   cell/tool to a plain noun (`reporter.emit`, or fold its single `report`
   action into `workspace`), and declare in the brand bible that **"reef" is an
   internal codename for the substrate's target state and never appears in a
   cell name, tool name, or fact type.** This resolves the biome clash for free.

2. **Write the brand bible as one page, promoting the rules that already exist.**
   The naming voice is *de facto* coherent but lives scattered across
   `park-design-language.md` (scenery rule), `platform-cells.md` (provider rule),
   and `home-cell.md` (the `home`→`web` musing). Consolidate into a single
   "naming voice" doc: the four tiers, the one-canon-biome rule, the noun+bare-
   verb provider rule, and the table of fixed names. This stops the next cell
   from being a `forge`.

3. **Decide `lit` deliberately, don't drift.** It's clever and lineage-true but
   has a real search collision (lit.dev) and the weakest functional signal of
   the surface cells. Pick one: (a) **keep `lit`** as a conscious lineage homage
   and document the `.lit` format provenance so the name is *earned*, or
   (b) **rename the cell to `docs`/`pages`** while keeping `.lit` as the file
   format. Either is fine; what's not fine is leaving it ambiguous. Given the
   strong `dotlit` provenance, keeping it (with documentation) is the lighter-
   weight choice — but only if the brand bible records *why*.
