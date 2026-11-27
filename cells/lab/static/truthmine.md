# Truth Mine / 002 — Instruments that make instruments

A small HCI experiment in inhabited knowledge, not a tutorial or a signal-processing course. The starting phenomenon is a deterministic composite waveform in shared time. There is no score, prescribed destination, or AI tutor.

## Entering

Touch the trace to leave an observation. Pause or revisit earlier moments. Select two marks to compare elapsed time and signed change in height. Keep either relationship as an instrument.

## Using and constituting

An instrument has a definition and default input bindings. Use it on different traces without editing the definition or its original bindings; keep a variation to leave behind a new instance with provenance. Enter it to reveal its formula and constituent definitions.

Select two instruments of the same quantity to compose them into a mean, difference, sum or ratio. A composition has its own inputs, inherited from its parts. It can itself be composed again. Every definition is immutable and references existing instruments, producing a bounded DAG, not a collection of copied scripts. No hidden promotion from measurement to scientific claim: a measured interval is not necessarily a period.

## Inhabitants

Open a shared room in the bottom disclosure and copy its invitation URL. A second browser can see and contribute to the same room. Enter as another inhabitant is a local pseudonymous identity switch. A shared room starts empty; local marks are not silently published. The lab preview does not write or poll.

## Architecture

The world function is unchanged from 001 and old marks and interval instruments remain readable. Instrument algebra and validation live in client/truthmine/world.ts, shared by UI and API. Input slots are recursively inferred, units are checked (seconds, signal amplitude units, or dimensionless scalar), depth is bounded to five and arity to sixteen. Ratio with zero denominator is undefined. Rebinding is temporary until explicitly kept. Local notebooks use browser storage; invitation rooms use the lab's isolated DynamoDB table (160 objects, bounded writes, optimistic concurrency retries). Room links are bearer-like invitations, not authenticated identities. Do not share private data.

## Research boundary

This is still a hand-authored finite algebra, not arbitrary generative computation. The semantic graph, general concepts, named abstractions and agent-authored mechanics are not yet implemented. The next increment should derive candidate operations from an actual participant's attempted connection, with an inspectable declaration and explicit acceptance rather than an agent silently altering the world. A participant may use a composite without entering its constituent graph; expertise and authority are not the same thing.
