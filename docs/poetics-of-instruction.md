# Poetics of Instruction

An exploratory research direction for sigils and incantatory prompting

8 October 2026 · Working brief 0.1 · Literature informed proposal · No experiments conducted

> Registered verbatim as supplied on 2026-10-08. The exploratory programme that
> follows from it is [[poetics-exploratory-programme]]; the specimens, data and
> analysis live in the `@c15r/poetics` cell (`cells/poetics/`).

## The proposition

We want to study the expressive language in which a prompt can be written when its interpreter is a language model. The material is an arbitrary sequence of tokens: prose, pseudocode, symbols, typography, examples, allusions, repetitions, and combinations that have no independently executable semantics. The ambition is to develop intricate, expressive ways of communicating intent that produce recognisable and repeatable behaviour while leaving authors considerable freedom.

"Spell", "sigil", and "incantation" name a design sensibility and a set of questions. A spell concentrates intention into a composition. A sigil offers a compact point of reference for something richer than its visible mark. An incantation organises language through recurrence, cadence, and association. These are working metaphors; their usefulness should be investigated rather than presumed.

The central research question is:

> Can we develop a repertoire of composable linguistic and symbolic forms that makes subtle intentions easier to express, sustain, and enact through language models, with effects that survive repeated trials and changes of context?

The project should preserve the freedom to write something strange, compressed, evocative, or locally invented. Its research discipline belongs in the comparison of compositions and their effects. A fixed grammar, compiler, type system, or universal symbol dictionary is not assumed. Nor is there a claim that unusual notation has intrinsic power.

"Magick" is a productive provocation here: language is arranged to bring about a transformation through an interpreter whose detailed response is difficult to anticipate. The practical question is which arrangements actually help, for whom, on which models, and under what conditions.

## What is already nearby

This is a selective map of antecedents, not an exhaustive or latest-frontier literature review. The sources establish that several ingredients deserve attention. They do not establish that an incantatory style improves results. Historical findings on particular models must be re-tested on the models used in a future study.

### Janus and prompt programming

Janus's Methods of prompt programming discusses direct specification, specification through proxies and demonstrations, and the use of cultural associations to evoke complicated behaviour. Its treatment of signs and implicit task references is especially close to this direction. It also attends to repetition and tokenisation as practical sources of unexpected behaviour. This is practitioner theory and observation grounded largely in GPT-3, rather than a validation of the present proposal. [1]

Reynolds and McDonell's Prompt Programming for Large Language Models: Beyond the Few-Shot Paradigm provides a related academic antecedent. It explores narratives and cultural anchors for nuanced intentions, and metaprompts that elicit further prompts. It gives us reasons to investigate compact evocation without assuming that every intention needs explicit procedural expansion. [2]

Janus's Simulators offers a conceptual distinction between a generative model and the contingent processes or characters it produces. Applied here as an interpretive lens, a composition could establish a situation whose continuation favours a particular way of working. This is not proof of a mechanism, and the lens does not completely characterise contemporary systems with post-training, tools, and externally enforced instruction hierarchies. [3]

Cyborgism, by Niki Dupuis and Janus, argues for human involvement in systems that augment thought. Its relevance is that the author's experience belongs inside our study: writing, revising, and recognising the effects of a spell may matter alongside autonomous task performance. [4]

Taken together, these are substantial antecedents. A plausible contribution would be a systematic study of expressive forms, composition, human authorship, and behavioural reliability. Novelty remains to be established.

### Empirical prompting research

Sclar and colleagues show that meaning-preserving formatting changes can substantially affect the tested models' performance, and that formats do not rank consistently across models. This motivates testing a family of variants rather than promoting a single attractive example. It does not imply that elaborate formatting is beneficial. [5]

Jerry Wei and colleagues study how models use semantic priors and locally demonstrated input–label mappings. Their results support investigating whether a locally established symbol can gain useful meaning from examples. Classification labels are a much narrower setting than a sigil for a complex working practice; transfer to that setting is a hypothesis. [6]

Liu and colleagues find position-sensitive use of information in long contexts. This motivates experiments on placement and recurrence. It does not establish that ritual repetition improves a multi-step workflow. [7]

Huang and colleagues identify limitations of intrinsic self-correction on the reasoning tasks and models they study. Their finding motivates distinguishing a prompt that asks for review from a process that demonstrably detects and repairs errors. It is not a general result about every contemporary model or visual inspection task. [8]

Schulhoff and colleagues' The Prompt Report provides a broad taxonomy of prompting techniques and modalities. It is useful for connecting proposed features to existing terminology and avoiding rediscovery under magical names. [9]

### What jailbreaking contributes to this inquiry

Jailbreak research is relevant as evidence about the sensitivity of model behaviour to context, framing, and token sequences. The present objective is expressive control on authorised tasks. We can investigate the relevant phenomena without making safety bypass a success criterion.

| Research strand | What the cited work contributes | Benign research translation |
|---|---|---|
| Competing objectives and mismatched generalisation | Alexander Wei, Haghtalab, and Steinhardt propose these as explanations for safety failures in the models studied. [10] | Study how framing changes the balance among legitimate task objectives, such as detail, fidelity, speed, and restraint. |
| Many-shot conditioning | Anil and colleagues show that sufficiently extensive demonstrations can alter behaviour in their jailbreak setting. [11] | Test whether examples establish a reusable local convention and whether it transfers to new tasks. |
| Adversarial token sequences | Zou and colleagues demonstrate effects from automatically searched suffixes, including transfer in their tested settings. [12] | Include symbol substitutions and opaque-token controls to distinguish meaningful composition from brittle token effects. |

The conceptual lesson is modest but important: fluent interpretation is not the only possible reason a token sequence changes behaviour. A symbol can work because of learned associations, local examples, formatting, or an accidental property of the sequence. Behaviour alone rarely identifies which mechanism is responsible.

There is also an evaluative warning. A response that sounds liberated, powerful, or compliant need not be more capable or accurate. Our corresponding failure mode is a spell that produces the performance of meticulous craftsmanship while leaving the artifact unchanged or worse.

## The specimen

The supplied flowers-upscale skill is the primary specimen. Its author and provenance have not been verified. We have its text, but no execution history, source image, or measured outputs. Appendix A preserves the supplied text. It is studied here, not executed.

The specimen combines a precise-looking workflow with tacit expert judgement and aesthetic suggestion. Its density is central to its interest. It creates the impression of a whole practice compressed into a small surface.

| Feature in the specimen | Possible expressive function | Question for study |
|---|---|---|
| YAML name and description | Establishes the document as a reusable skill | Does packaging affect execution, or only recognition and selection? |
| `S`, `C`, `E(C)`, `M1` | Names recurring objects and activities compactly | Do aliases help tracking, or increase reference errors? |
| Arrows, semicolons, conditional fragments | Suggest flow and consequence without full sentences | Does compression preserve obligations as the workflow grows? |
| Global `Q` plus relevant constraints | Suggests reusable instruction with local specialisation | Does the model apply relevant material guidance selectively? |
| Original as authority, crop as target | Establishes an asymmetric relationship between references | Is that relationship preserved in actual image-tool inputs? |
| Whole image, cores, salient regions, focal details | Organises attention across spatial scales | Does it improve coverage and consistency or accumulate drift? |
| "Quiet intervals" and "cohesive groups" | Evokes material behaviour through compact aesthetic concepts | Do these phrases produce recognisable and useful differences? |
| Retain prior pixels when unreliable | Makes restraint part of successful execution | Is the fallback used appropriately, or does it excuse inaction? |
| Limited retries and immediate persistence | Suggests bounded persistence and recoverability | Are limits honoured and intermediate artifacts actually saved? |
| Native versus exported resolution | Distinguishes transformation from presentation | Does the final report accurately describe what happened? |

### Tensions worth preserving as research material

The prompt asks for plausible reconstruction while discouraging invented structures. That leaves a meaningful boundary to interpret: which changes count as harmless material detail, and which change identity or content? Making every boundary explicit could remove exactly the tacit expressive capacity we want to study. Leaving it implicit could make results unreliable. Both possibilities are experimental conditions.

It also asks for exact crop geometry from a generative edit, reliable correspondence, and selective local correction. These are requests rather than established capabilities. Whether an available tool can satisfy them must be separated from whether the prompt expresses them successfully.

The original image is repeatedly privileged, but later passes also receive enhanced material. An invented feature can become an apparent fact of the working image. Does recurrent source language help prevent that? Could a short refrain outperform a longer procedural explanation?

The apparent algorithm is substantial: nine initial edit calls, then four to eight per additional pass, before retries. Two passes imply 13–17 edits; three imply 17–25. This gives an immediate experimental confound: a composition might look better because it spends more generation and review effort. Comparisons need both budget-matched tests and transparent cost reporting.

Finally, this specimen crosses an interpretation boundary. An orchestration model may read the spell, then translate part of it into a prompt for an image model. A phrase can be lost, expanded, or altered in that handoff. The input spell, actual tool arguments, generated crops, assembly, and final report are distinct observable stages. They should not be collapsed into one score.

## A landscape of possible expressive features

The following are candidate dimensions, not a proposed language specification. Each may be useful alone, in combination, or not at all. "Attention" below refers to observable task focus, not a claim about measured transformer attention.

### Marks and local meaning

| Candidate | What might be composed | What could be measured |
|---|---|---|
| Familiar operators | Arrows, brackets, precedence signs, set-like notation | Correct sequencing, association, and reference tracking |
| Locally introduced sigils | A mark attached to a phrase, example, or recurring principle | Recall and application on new cases; need for a legend |
| Names and epithets | `S`, "the source", "the unaltered witness" | Reference accuracy, unwanted associations, token cost |
| Symbol families | Related marks for source, transformed copy, and uncertain region | Whether relationships generalise beyond taught examples |
| Density and ellipsis | Omitted verbs, compressed clauses, juxtaposed fragments | Constraint retention per token; ambiguity and repair burden |
| Layout and enclosure | Indentation, whitespace, margins, repeated delimiters | Local scope, leakage, position sensitivity, human scanability |

A glyph's visible geometry is not necessarily what a text-only model processes. Tokenisation and learned textual contexts matter. A diagram provided as an image is a different treatment and should be evaluated separately. Rare symbols may cost more tokens than ordinary words, and ornate appearance is not evidence of semantic compression.

### Evocation and disposition

| Candidate | What might be composed | What could be measured |
|---|---|---|
| Material vocabulary | Phrases such as "quiet intervals" and "cohesive groups" | Targeted visual changes and transfer across materials |
| Metaphor | Restoration, gardening, listening, excavation | Useful practice induced versus incidental style imported |
| Genre | Workshop note, field guide, score, recipe, ritual, proof sketch | Work performed versus genre imitation |
| Voice and address | Imperative, impersonal, collaborative, second person | Initiative, clarification, restraint, and reporting accuracy |
| Cadence and refrain | Parallel clauses, recurring source reminders, punctuation rhythm | Survival of priorities across long tasks; loop formation |
| Negative space | Permission to abstain, leave blur, preserve silence | Appropriate non-action versus failure to improve |

These dimensions invite a distinction between the model's behaviour and the author's experience. An evocative form may help a person articulate a subtle intention even if a plain paraphrase performs equally well. That is a potentially valuable HCI outcome in its own right.

### Relationships and movement

| Candidate | What might be composed | What could be measured |
|---|---|---|
| Relative priority | Fidelity before embellishment; local quality subordinate to whole | Decisions in cases where desirable goals conflict |
| Productive tension | "Enrich the texture; leave the history alone" | Quality–fidelity trade-off, ambiguity, case-specific judgement |
| Changes of scale | Whole–part–whole, near–far–near | Coverage, local/global consistency, missed defects |
| Recurrence | Revisit an earlier intention after transformation | Drift prevention, repeated work, regression |
| Phase changes | Distinct language for exploration, selection, and finishing | Ability to change working mode at the intended point |
| Examples and counterexamples | Small cases teaching what counts and what does not | Generalisation to unfamiliar cases, example copying |
| Inheritance and exceptions | A motif applied globally, then locally qualified | Exception handling and unintended global contamination |
| Open ends | Deliberately incomplete forms inviting continuation | Useful initiative versus uncontrolled expansion |

### Composition and transmission

A repertoire would become interesting when forms combine. Can a motif for restraint coexist with one for exhaustive coverage? Does their order change their effect? Does a local exception remain local? Does adding a second motif weaken the first? Does reusing a sigil preserve its meaning in a new task, or import irrelevant imagery?

Possible relationships include reinforcement, interference, cancellation, saturation, and transformation. These are descriptive possibilities, not laws. A fruitful result might be a catalogue of interactions and counterexamples rather than an algebra.

Transmission also deserves study: one model reads a spell, another receives its translated instructions, and a human later edits the composition. Meanings may survive literal copying yet fail paraphrase, or survive paraphrase while depending on a particular author's explanation. A useful repertoire should document those differences.

## Small sketches for comparison

These fragments express roughly the same intention. None is endorsed as better, and the sigil meanings are local. They are research stimuli, not a replacement for the specimen.

Plain instruction

```
Use the original image to resolve conflicts with generated detail.
If a change alters a meaningful feature without adequate support,
keep the earlier pixels.
```

Compressed notation

```
S=original; G=generated.
conflict(S,G) → prefer S;
unsupported change of meaningful feature → retain prior pixels.
```

Sigil with an explicit local association

```
⊙ the original remains our reference.
Detail may grow; identity returns to ⊙.
Where invention changes the subject, inherit the earlier image.
```

Cadence and recurrence

```
Look close. Return to the whole.
Let detail arrive where the source can bear it.
Look close. Return to the source.
```

A composite

```
⊙ S — original, still authoritative.
S → C → C′ → whole
       detail ≺ likeness
       near / far / ⊙
Doubt at the join → inherit.
```

The last two omit information contained in the first two. That omission is part of their character, but it prevents a clean causal comparison. A study needs both natural compositions and carefully matched variants. It should include a symbol-free paraphrase, consistent arbitrary symbol substitutions, and decorative symbols with no assigned meaning. Otherwise, "sigil effectiveness" could simply mean that one prompt contained better advice.

## What reproducibility could mean

The aim is reliable expressive influence, not a guarantee that every casting returns identical bytes. Several properties should remain distinct:

| Property | Operational question |
|---|---|
| Repeatability | Does the same composition produce acceptable behaviour over independent runs in the same recorded setup? |
| Robustness | Does it survive modest paraphrase, whitespace changes, distraction, and context length? |
| Transfer | Does it help on unseen inputs, tasks, or model families? |
| Composability | Do constituent effects survive when motifs are combined? |
| Authorability | Can people learn, revise, and predict the effects of the form? |
| Auditability | Can observed actions and artifacts substantiate the claimed result? |

An exact replay of stored tool outputs may reproduce an assembly. That is different from eliciting new outputs reliably. Both can be useful, but they answer different questions.

## An experimental programme we could choose from

### Establish the specimen before improving it

Preserve the supplied text and run it in a documented environment against a varied image set. Record actual behaviour before rewriting apparent flaws. Suggested cases include a face, a portrait with hands, patterned cloth, fine text, sparse surfaces, shallow focus, and rigid architecture. This describes a possible test corpus, not an instruction to execute the specimen now.

Keep the original as a baseline. Add a clear ordinary-language version and a workflow-matched procedural version. Neither should be deliberately weak. If an alternative changes the number of passes, tool calls, feedback opportunities, or image model, label it as a system comparison rather than a test of language alone.

### Separate interpretation from end-to-end capability

Start with inexpensive, observable tasks where the same features can be exercised: preserving exact names while editing prose; reconstructing a benign document with uncertain gaps; selecting regions from images with known annotations; or acting on a stub tool interface with unambiguous success criteria. These can reveal tracking, restraint, and composition effects without repeatedly paying for full image generation.

Then run end-to-end image trials. Passing an abstract test does not establish that a phrase improves photographs. Conversely, an image tool's geometry failure should not automatically be attributed to the orchestration language.

Do not turn a model's explanation of what a sigil means into the primary outcome. It may explain correctly and act incorrectly. Do not require private chains of thought: tool calls, submitted prompts, artifacts, acceptance decisions, and concise reports provide observable evidence.

### Explore, then isolate

Allow free composition in an exploratory phase. Save every variant and attempt, including failures. Then isolate promising features through controlled removals and substitutions. Test interactions after estimating individual effects; two useful ingredients can interfere when combined.

For a small illustrative screening study, six prompt conditions across eight cases and three independent runs would yield 144 executions per model. That is a workload illustration, not a power calculation or recommended final sample size. Use observed variability, cost, and the smallest worthwhile effect to design a subsequent study. Reserve unseen cases for confirmation and avoid repeatedly selecting winners on the same test set.

Use fresh conversations for independent trials. Fix surrounding instructions and tools where possible. Record the exact model identifier, date, decoding settings where exposed, full prompt, input order, tool versions, input hashes, outputs, retries, latency, and cost. A seed alone is insufficient. Hosted-model changes can limit replication even with careful records.

### Measure several outcomes together

| Outcome | Specimen-specific evidence | Important limitation |
|---|---|---|
| Fidelity | Source-relative landmarks, text preservation, meaningful feature changes | Pixel similarity can reward doing nothing |
| Perceptual quality | Blinded comparisons of naturalness, detail, and coherence | Taste varies; sharpening can masquerade as improvement |
| Registration and seams | Landmark residuals, boundary discontinuities, overlap inspections | Smooth blends can conceal semantic drift |
| Material treatment | Blind ratings of texture variation, hair grouping, and fabric consistency | Ratings need shared examples and recorded disagreement |
| Restraint | Appropriate acceptance or fallback on independently labelled cases | Excessive fallback can inflate fidelity |
| Process adherence | Actual input pairs, crop boxes, saved intermediates, retry counts | Following the workflow does not guarantee a good result |
| Reporting accuracy | Claims compared with tool logs, dimensions, and generated artifacts | Confident prose is not evidence of completion |
| Human expression | Authoring time, revision effort, ability to state subtle preferences | Familiarity and visual appeal can bias preference |
| Reliability and cost | Distribution of results, failure frequency, edit calls, latency | Average improvement can hide severe regressions |

For visual trials, include high-quality images deliberately degraded to provide a reference, alongside authentic low-resolution images for ecological validity. The former allows some recovery checks but is not equivalent to every real restoration problem. Detail absent from a real source cannot be verified as historical truth merely because it looks plausible.

Blind evaluators to prompt condition and randomise presentation order. Separate fidelity from beauty, and artifact scores from liking the prompt. Model-based judges can assist but should be checked against independent measurements and human review. Report uncertainty and failure cases, not just winners. Repeated runs on the same image are clustered observations; they are not equivalent to additional independent images.

### Look for disconfirming results

Useful negative findings could include: symbols add no benefit beyond their verbal gloss; effects vanish under equal budgets; ornate forms raise confidence without quality; motifs help authors but not models; a convention fails across model families; repetition causes saturation or loops; compositions work only on the cases that inspired them.

These findings would constrain the repertoire rather than invalidate the entire inquiry. The critical distinction is between an expressive practice with documented conditions of use and a collection of memorable anecdotes.

## What a meta framework might eventually contain

A lightweight framework could be a research practice and a shared collection rather than a language runtime. Possible components are:

- A specimen archive preserving original compositions, provenance where known, and observed behaviour.
- A field guide of expressive motifs, examples, counterexamples, and alternative readings.
- A comparison workspace for paraphrases, symbol substitutions, omissions, and combinations.
- A record of trials tied to exact contexts and artifacts.
- Studies of how people learn to author and critique compositions.
- Provisional findings labelled by task, model, cost, and degree of replication.

It need not reject an unfamiliar symbol or require a standard syntax. It can record that one motif helped under particular circumstances and invite a different rendering of the same intention. The emerging conventions could be plural, local, and revisable.

Questions to leave open include whether sigils should be shared or personal; how much their meaning should be taught through examples; whether their main benefit is compression, recall, disposition, or human expression; and whether symbolic richness helps at a different scale from procedural clarity.

The near-term research object is a repertoire of compositions and their measured effects. We are not yet choosing an alphabet, building a compiler, declaring a universal grammar, or claiming that the upscaling specimen works.

## Sources and evidence status

Sources checked 8 October 2026. Academic entries were checked through primary abstracts and publication pages; the Janus essays were read through primary web text. This is a scoping review, not full methodological replication. References support the adjacent literature summaries; the proposed feature landscape and experiments are our synthesis.

1. Janus. Methods of prompt programming, 2021. Practitioner essay; includes signifiers, proxies, cultural context, and practical prompting observations.
2. Laria Reynolds and Kyle McDonell. Prompt Programming for Large Language Models Beyond the Few-Shot Paradigm, 2021. Academic antecedent for narrative and cultural specification.
3. Janus. Simulators, 2022. Conceptual framework; used here as a lens rather than an established complete theory.
4. Niki Dupuis and Janus. Cyborgism, 2023. Human-in-the-loop research agenda.
5. Melanie Sclar, Yejin Choi, Yulia Tsvetkov, and Alane Suhr. Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design, ICLR 2024. Empirical formatting sensitivity.
6. Jerry Wei et al. Larger language models do in-context learning differently, 2023. Empirical comparison of semantic priors and local label mappings.
7. Nelson F. Liu et al. Lost in the Middle How Language Models Use Long Contexts, TACL 2024. Empirical context-position sensitivity.
8. Jie Huang et al. Large Language Models Cannot Self-Correct Reasoning Yet, ICLR 2024. Empirical limits of intrinsic self-correction in studied settings.
9. Sander Schulhoff et al. The Prompt Report, 2024, revised 2025. Survey and taxonomy; a route to broader related work.
10. Alexander Wei, Nika Haghtalab, and Jacob Steinhardt. Jailbroken How Does LLM Safety Training Fail, 2023. Failure-mode hypotheses and adversarial evaluation.
11. Cem Anil et al. Many-shot Jailbreaking, 2024. Primary research overview linking its paper; evidence on long-context demonstrations.
12. Andy Zou et al. Universal and Transferable Adversarial Attacks on Aligned Language Models, 2023. Empirical effects of searched adversarial sequences.

## Appendix A

Supplied specimen preserved verbatim

```
---
name: flowers-upscale
description: Photo to 8K; 2/3-pass contextual AI crop enhancement and registered blending.
---
INPUT S=uploaded photo; missing→request. Unspecified→ask "2 passes (recommended) or 3? 8K default; another resolution?" Await choice. N=2|3; L=specified longest edge else8192; preserve aspect. Discover available AI image-editing+raster-processing capabilities; missing→report requirement. Use environment-native tools/paths; create helpers as needed. Preserve S; separate outputs. Execute end-to-end after choice.

E(C): inspect; AI-edit inputs=[S=context,C=target], maximum practical supported resolution; retain actual output dimensions. Prompt=Q+only relevant material constraints. Concurrent independent calls where supported; persist outputs+source-coordinate boxes+prompts immediately.

P1: S→3×3 cores; pad each side20% core dimension, clip to S→9 overlapping C→E→register/blend→M1; resize assembled M1 to L.
P2: M1→4–8 padded salient ROIs(face/hair/hands/objects/textiles as present)→E→register/blend→M2. Exclude low-information regions.
N=3: M2→4–8 tighter focal ROIs(individual eyes/lips/nose/fingers/material details as present)→E→register/blend→M3. Keep homologous features consistent. Every E receives S, never crop alone.

Q="1=original: identity/anatomy/color/light authority. 2=target: return exact crop/framing/geometry. Reconstruct plausible photographic detail; preserve expression, pose, contours, clothing, genuine imperfections, focus falloff. Optical clarity; natural edge transitions; spatially varied texture. Repair inherited artifacts. Skin: irregular pores/fine creases, quiet intervals. Hair: cohesive groups, selective fibers, natural sparse fringe. Iris: source color, irregular branching fibers, coherent pupil, restrained reflections. Textiles: original weave direction/spacing/motifs. Avoid invented structures/marks, beautification, relighting, halos, ringing, embossed/crosshatched/repeated texture, synthetic grain, blanket sharpening."

ASSEMBLE: map recorded boxes→master; global similarity registration first; bounded smooth local correction only with reliable correspondence, never distort rigid geometry/repeating patterns. Unreliable→retain prior pixels. Match broad exposure/color without transferring old fine texture. Normalized overlap/multiband blend; feather15–25% border→alpha0 at interior patch boundaries. Preserve native enhanced crops. Before next pass: inspect full image+100% focal/overlap crops; repair doubling/seams/drift/texture mismatch. ≤2 targeted retries/defect; rejected/failed→retain prior content+disclose.

EXPORT: M_N→lossless PNG at L; verify dimensions+decode; deliver file+preview+prompts/settings. Describe detail as reconstructed; distinguish exported resolution from native generated resolution.
```
