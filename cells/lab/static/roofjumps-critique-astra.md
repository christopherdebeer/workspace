# Critique from Astra (22 November, on the 00:03 build)

Roofjumps is closest to its ambition when a mistake changes what the athlete can do next. The courtyard and stairwell now produce sequences where you can explain the movement from the body's predicament: the hips have gone past the edge, one hand still holds, the swing brings a shoe within reach of a wall, and that foot buys a different way out. The weaker passages are the ones where the controller decides what the player meant, then commits the whole body to that interpretation. You can still feel that in a backward brush, and you can see it in parts of the new climbing system.

I replayed the 00:03 build of 22 November headlessly, using the deployed runner, rig, city, and scene code. The default runner passed 194 of 197 checks across 38 scenes. I also repeated the earlier brush inputs, varied their duration one simulation tick at a time, and changed the stairwell geometry. These results cover the actual joint motion and game outcomes. Touchscreen feel and readability through the painted chase camera remain unverified.

## The light brush has genuinely improved. The next few milliseconds expose the deeper problem.

The original 12 px backward brush for 133 ms is substantially repaired. Previously the runner travelled about 51 cm, turned 177°, and the airborne shoe snapped 39 cm in one tick. This build travels 2.9 cm, turns 2.3°, and the largest shoe movement is 2 cm. Leftward and rightward brushes now lift different first feet from the same stance. The touch handler also uses the movement threshold to cancel tap eligibility, closing the old overlap where one small gesture could both walk and jump.

But hold that same 12 px backward input slightly longer:

| Brush duration | Total travel | Travel after release | Maximum turn |
|---|---|---|---|
| 133 ms | 2.9 cm | 0.5 cm | 2° |
| 200 ms | 9.5 cm | 3.4 cm | 42° |
| 233 ms | 15.0 cm | 6.3 cm | 69° |
| 242 ms | 21.9 cm | 12.4 cm | 98° |
| 250 ms | 58.0 cm | 47.4 cm | 180° |

One additional 8.3 ms tick changes a partial turn into a full reversal and adds 35 cm of travel after release. A player cannot reliably express that distinction with their thumb. Both gestures are light, both start from the same stance, and both release at almost the same moment. Yet one says "adjust my position" and the other effectively says "turn around and keep going." At a moderately larger input, 22 px backward for 400 ms, I also reproduced a 39 cm single-tick shoe displacement. The original repro is fixed; the broader family of movements still contains the failure.

My critique here is about commitment. The current short brush finally feels capable of being small. What it still lacks is a convincing single backward step: a shoe reaches behind, accepts weight, and leaves the chest broadly facing what the player was looking at. That movement should be available over a generous range of thumb timings. If the player continues, the trailing hip can open and invite a turn. If they release, the athlete already has a place to stop. That would make the transition legible through the body before the player experiences it as extra travel.

## The stairwell is the clearest proof of the larger idea

I kept the scripted controller and runner fixed and changed only the height of the slab above the stairwell. The trailing foot's opportunity, and what the athlete could do with it, changed.

| Slab underside | What happened |
|---|---|
| 9.70 m | The foot reached the underside, but the runner fell into the well. |
| 9.90–10.20 m, at the three heights tested | The foot reached the underside and the runner exited down the second flight. |
| 10.40 m | The foot still reached the underside, but the exit failed. |
| 10.75–12.00 m, at the three heights tested | The foot found another contact and the runner fell into the well. |

The 10.40 m result matters most. Finding the surface and making a useful push from it are distinct achievements. A binary "underside available" trigger would have thrown away precisely the distinction that makes this interesting. In the courtyard, the save also survived the authored parapet shift: over the edge, caught by the hand, feet to the wall, into the opening. These are the sequences I would use to judge future systems. They have a cause, a moment of jeopardy, and a recovery whose shape belongs to the room.

There is still a gap between a sequence the simulation can perform and one a player can discover. In the stairwell, the scripted controller can read when swingFoot becomes available and change its command 60 ms later. A player has the silhouette, the camera, and the visible compression of the leg. The next question is whether they can see the foot buy that opportunity and intentionally use it on the next attempt. That is where motion, camera, and gouache rendering become the same design problem. A single clearly bent, loaded leg against the underside may communicate more than a detailed stairwell.

## The new city gives the athlete more to do. Some of its movement is becoming too dependent on object names.

Pipes, projecting units, balconies, railings, fire escapes, and railed walkways make the city a better partner for parkour. A building face can now offer several lines of travel after a missed roof. The new scenes demonstrate meaningful distinctions: catching a pipe to one side with one hand, getting a foot onto a projection, moving along a sill until it ends, or running across a walkway without inventing a jump. The diagonal-unit scene also has consequences for different bodies. With the same scripted controller, three of six characters reached the 15 m roof and three ended at street level. That is evidence that body differences matter; whether the shorter or differently proportioned runner has a readable alternative is the more interesting design question.

My concern is visible in Runner.standOf(). A ledge, air-conditioning unit, and fire escape return a standing height by kind. A balcony returns its rail height minus one metre. Pipe climbing, shimmy eligibility, and the timing of stepping onto a fire escape also have explicit kind checks. Those rules produce good individual scenes. As the city grows, they risk making the athlete knowledgeable about the developer's catalogue and surprisingly ignorant about an unfamiliar piece of perfectly usable architecture.

I would keep the distinctions that describe how contact works: a pipe can be wrapped, a narrow rail supports a forefoot, a wide projection can take a whole shoe, and a panel may offer a hand edge while giving the knee no clearance. Then I'd test a deliberately ordinary substitution. Replace the unit under the window with an unnamed projection of identical dimensions. Can the athlete make the same step? Make it progressively shallower. Does the movement change from standing, to a forefoot push, to hanging by the hands? That progression would do more for the ambition than another named fixture with another successful climb.

## The remaining failures say something about direction

The most revealing failed scene is late-change. The runner saves the first landing, but at the second gap it takes off only 0.08 s later, 1.0 m/s slower, and 9° off the clean line. There is a cost, and it narrowly misses the scene's authored criterion. I wouldn't tune a threshold just to turn that check green. I'd ask whether the viewer can tell, from the second takeoff foot, that the first landing went wrong. A shorter penultimate stride, a jump from the less convenient leg, or a lower line toward a different catch would give the recovery a consequence the player could use. The other failures were more local: 8.0 cm/s of planted-foot slide in angled vaults and a shorter-than-requested pause under the courtyard opening.

My priority would be one continuous playable phrase: standing at a parapet, taking a small step back, changing your mind, driving forward, and arriving slightly wrong on the far side. It joins the weakest part of the current build to its strongest. The first brush asks whether the athlete can stay available. The reversal asks whether the loaded leg matters. The leap asks whether commitment feels intentional. The imperfect arrival asks whether the city offers a way onward that neither player nor animator had to choose in advance.

That is the direction I'd protect. Roofjumps already has enough moves to look impressive. Its next advance is letting the player recognise, a fraction of a second before it happens, what this particular body can still do from here.
