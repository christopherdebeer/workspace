# Painted figure studies, and a critique (Astra, 22 November)

Two image-generation studies made from the dense motion contact sheets: eight frames across all seven characters, repainted.
`astra-flat.jpg` is flatter, closer to gameplay scale; `astra-full.jpg` is fuller and spends more paint in a few places.
The frames, left to right, top then bottom:
- the indigo runner from behind, arms out;
- the sage teen on a rail;
- the child with the ochre pack on the rail;
- the broad figure in the red cap running;
- the lavender slight figure diving;
- the older figure vaulting a railing;
- the schoolgirl diving;
- the schoolgirl hanging, far off.

The critique, as given:

The clearest target for Roofjumps is the side-on dive, especially the lavender runner and the schoolgirl. Both have almost the same underlying pose. In lavender, one long sweep from hip through shoulder into the reaching arm carries the dive. In the sailor uniform, the dark sleeve, hair and torso can merge, and the white collar still tells us which way the upper body is turning. That's the kind of economy I'd pursue. The same skeleton can produce two different paintings because different marks explain each character.

I used eight frames across all seven characters for the two studies above. The flatter sheet comes closer to gameplay scale. The fuller sheet earns its extra paint in a few specific places.

- The rear-view indigo runner is the weakest figure in the flatter study. The jacket reads as a rectangle with two bars attached. Fraying the edges just gives the rectangle bristles. The fuller treatment gains something with the oblique pull across the jacket back and the uneven hem over the lifted thigh. I'd spend one broad mark there. This is the view the player inhabits most, and it's also where the face can do none of the work.
- The sage runner and the child show how identity survives reduction. The sage runner reads through the forward pitch of the hood and the opening between the legs. The child's ochre backpack establishes the smaller figure almost immediately. At the size of the original cells, I'd protect the offset between pack and head before spending a mark on either shoe. Both generated studies enlarge the figures' apparent presence, so the originals remain the better test of what survives at distance.
- The white-haired vaulter exposes a failure in both studies. You can identify the coat and hair, yet it takes a second look to find the hand bearing weight on the rail. The hanging sleeve gets a larger, clearer ending than the supporting wrist. I'd give the planted hand a short, hard edge where it interrupts the rail, then let the far sleeve disappear into the coat. That single junction would explain why the whole body is folded there.
- The distant schoolgirl exposes the limit of reduction. A dark upright and a pale flick preserve the palette, but you can read the result as someone sitting behind the parapet. In a hang, the high-value information is where the hand meets the lip and how far the shoulder hangs below it. A tiny exposed interval there would say more about the action than another uniform detail.

The implementation change I'd prioritize is letting one stroke span a joint, and letting a contact interrupt that stroke. For the lavender dive, a persistent garment mark could run from the hip, across the shoulder, into the upper arm. As the arm folds across the body, that mark could shorten while the overlap at the elbow becomes visible. For the vault, the coat can stay one mass while the solved wrist fixes the end of the sleeve to the rail. This gives the pose a say in where the painter lifts the brush.

I'd judge the first iteration on your light multidirectional input from rest, alongside the dive. Hold the camera behind the indigo runner. On a brush too small to cause a step, the jacket can register the turn while the planted sole keeps the same edge against the roof. On the first committed step, watch for the heel breaking away and the gap opening between the legs. If the pale shoe or trouser highlight changes shape before either event, the paint itself is contributing to the jank. The contact sheets establish the spatial target. That short motion test would reveal whether the renderer can hold it from frame to frame.
