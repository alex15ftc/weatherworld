# System

The master spec: how WeatherWorld is built so the stories in `PRODUCT.md` work. The strongest available model writes it in one pass over `PRODUCT.md` and `FEATURES.md`, after every row has a Scope. Area specs build on the contracts here and may not contradict them.

Architecture is the part of a product that is most expensive to change later, so this document gets the most care. Prefer a few components with clear owners over many thin ones. A responsibility with no owner, or with two owners, is a defect in this document. Area specs describe features; this document decides how they fit together.

## Shape

[A diagram or a short description of the components and how they connect.]

## Components

| Component | Owns | Serves |
|-----------|------|--------|
| [Name] | [Its one responsibility, and the facts only it may write.] | [FEATURES.md IDs] |

## Flows

<!-- For each PRODUCT.md story: the path through the components in order, naming the
     data that crosses each boundary. This is the piping that makes the story work. -->

### [Story]

## Shared Contracts

<!-- Data models, event formats, APIs, and anything else that more than one component
     or area depends on. Move a contract into its own file under docs/spec/ only when
     it is too large to live here, and link it. -->

## Invariants

<!-- Properties that hold everywhere, always: security, privacy, correctness, and the
     product's promises. Each cites the FEATURES.md guarantee rows it enforces. An
     invariant does not change without the owner's decision, and no experiment may
     suspend it. -->

## Hypotheses

<!-- Parts of this design that are bets rather than seen to work: a mechanism, a
     threshold, an assumption about users, a model, or a platform. Machinery that
     already exists is still a bet until it has produced its result. For each one:
     - the bet;
     - the cheapest test that could show it wrong;
     - the simplest alternative it must beat, often a strong model given the same
       input, when there is one;
     - the fallback if it fails.
     A test is the first work on its bet, run before anything builds on it. It is
     not an optional instrument, and it is not a gate on work that holds either way.
     A hypothesis may be simplified or stubbed to run its test. An invariant may not.
     When a test settles a hypothesis, record the result and move it to Decisions.
     This section stays live during execution: a bet discovered mid-build is added
     here when a reconnaissance front opens on it. The rest of this document
     changes only by approved amendment. -->

## Room for Deferred Features

<!-- For each FEATURES.md row marked "deferred, room": where it will attach, and what
     this design does now so it can land later without a rewrite. -->

## Build Order

<!-- First, the hypothesis tests and what must exist before features can be built in
     parallel (the foundations), in one narrow round. Nothing that builds on a bet
     comes before its test. Then which areas or stories can proceed at once.
     Campaign maps start from this section. -->

## Decisions

<!-- Choices a future reader might question: what was chosen, what was rejected, and
     why. -->

## Open Questions

<!-- Conflicts and gaps the author found but did not resolve, for the owner. Remove an
     entry once it is answered and the answer lives in the right section. -->
