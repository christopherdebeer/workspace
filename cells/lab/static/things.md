# Things / 001 — A grammar of conceptualisation

A parallel, more elementary HCI experiment to Truth Mine. Begin with three things: round, square, triangle. Their forms distinguish them; they carry no imposed subject matter, meaning or computational behaviour.

## Gesture grammar

Tap a thing to attend to it; tap another to extend the selection. Drag a thing to arrange your own view. Draw a loop on empty space to select several things. Select two and relate them, or use Relate… on one then touch another (drag from the first also works). A relation has its own selectable identity, shown as a diamond on the connection when both ends are visible. It can itself be related, named or composed.

Group keeps the constituents visible and creates a collection with identity; its dashed envelope is a visual projection of visible membership, not a physical container. Compose creates a new identity and folds the selected constituents in the current personal view only. Enter a collection, composition or relation to see its immediate members or ends; return using the breadcrumb. Expose constituents or reveal hidden things to undo a fold. A collection can be composed as a new identity without destroying the collection. Composition can be recursive; no computation is attached. Introduce an unnamed thing when you have nothing selected. Name a thing with an attributed contribution; different names can coexist, and your own latest name is preferred in your view.

## Shared world, private viewpoints

Open a shared room and copy its invitation. The second inhabitant has the same three seed identities, but their own placement and disclosure history. Other people's constructions appear under Beyond this view; reveal any to work with it. Shared membership and relationships do not depend on the view. Enter as another inhabitant resets personal attention and selects a new pseudonym, without erasing shared contributions. Reset my view removes only your layout and disclosure state.

## Architecture and research boundary

The common world consists of immutable things, relations, collections, compositions and naming assertions. All references address existing identities, including relations and compositions. This produces an acyclic constitution graph (association is not restricted to a semantic hierarchy). Naming is an attributed assertion, not an authoritative overwrite. Geometry, selection and local folding are separate, scoped by room, inhabitant and context, kept in localStorage. Room facts live in the lab's isolated table, with append-only validated writes, optimistic concurrency retry and a bound of 160 contributions. Invitation links are bearer-like, not authenticated; do not share private data. No claims of knowledge or truth are inferred. No generative AI, typed computational inputs, executable behaviour, or subject-specific curriculum.

The test: can two inhabitants create different overlapping abstractions of identical things and can a third inhabitant discover, reuse, enter, name and compose them without having witnessed their creation? This version is a first test of the gesture grammar, not a full general-purpose canvas. Layout is deliberately bounded; reveal-all can become crowded, and names are currently the only textual annotation. No shared deletion. Browser-based HCI assessment is still needed.

## Things / 002 — Observation and inhabitation

Observation is a separate, opt-in recording, usable even in a local notebook. Start under Observe my interaction; a visible recording indicator and stop control appear. Completed gesture outcomes, elapsed times, context, selected identities and abstract node positions are recorded. No name text, keystrokes, raw pointer samples, room invitation or external browser activity. A distinct read-only observer URL opens a stepped replay. A writer secret stays in localStorage; delete revokes the link, and reads expire after 24 hours (logical expiry, not guaranteed physical deletion until explicitly deleted). Recordings are bounded to 240 events / 230KB, and do not resume automatically after reload. Leaving or switching inhabitant is blocked while recording. No automatic assistant access or monitoring. Invite a participant using the existing separate room link; participants can read and append the same shared fact vocabulary via /things/api/<room> and do not inherit control of your view. A pseudonymous agent is not a verified identity. No generative logic inside Things. Browser-level replay and interaction tests remain outstanding.

Browser writes require parc authentication at dispatch, even though the Lab page and bearer-link reads are public. Things now uses the shared kernel for a cell-only sign-in sheet on an unauthenticated recording start, stop/delete or shared contribution, with a full-page Sign in fallback. Local edits and observer reads remain anonymous. If a full-page redirect is needed, retry the original action after returning; no recording is automatically started.
