---
id: flowers-upscale
title: flowers-upscale
kind: skill
provenance: Supplied with the brief "Poetics of Instruction" (working brief 0.1, 8 October 2026). Author and origin unverified. No execution history, source image or measured output accompanied it.
status: archived, not executed
---
The primary specimen. A photo-upscaling skill written as a dense procedure with aliases (`S`, `C`, `E(C)`, `M1`), arrows and conditional fragments, a reusable quoted prompt `Q` with material vocabulary ("quiet intervals", "cohesive groups"), and restraint as part of success ("Unreliable→retain prior pixels"). The brief's feature table reads it line by line; the exploratory round tests the obligations its `Q` and `ASSEMBLE` sections compress, on text proxies, not the skill itself.

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
