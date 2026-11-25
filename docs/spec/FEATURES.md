# Features

Every feature, guarantee, and experience bar from ideation, one row each. This file is the index to `IDEATION.md` and the checklist the product is measured against. A goal names which rows are in scope and is finished when its journeys work; each row in scope must hold on them.

<!-- How to use this file

  Rows
  - Add a row as soon as ideation names something new, and tag the IDEATION.md
    passage with the same ID.
  - A row is something a person using the product would notice missing, or a promise
    they could hold the product to. Write it as what that person gets, not how it is
    built. Mechanisms, field names, thresholds and schemas are detail: they stay in
    IDEATION.md, tagged with the row's ID, not as rows.
  - One idea, one row. When ideation returns to an idea, tag the new passage with
    the existing ID.
  - Item: what it is in the owner's words, plus why it matters when that is not obvious.

  IDs
  - Two levels only: an area prefix of 3-4 capitals, then a number from 01.
  - Never renumber or reuse an ID. A cut row keeps its ID.

  Kind
  - capability:      something a person can do or experience.
  - guarantee:       a promise the product keeps, such as privacy, correctness, or
                     what it will never claim.
  - experience bar:  how using it must feel, e.g. "a student never has to learn the
                     evidence model".

  Scope (set only by the owner)
  - (blank)          not decided. No spec work starts while any row is blank.
  - scoped           in this version, at the MVP form given.
  - deferred         a later version. Write "deferred, room" if SYSTEM.md must leave
                     space for it now.
  - cut              not coming.
  - merged           the same promise as another row. Item names that row, which
                     carries it. Set when the rows are reshaped after the spec.
  - detail           turned out to be detail of a contract. Spec names the section
                     that carries it. Set when the rows are reshaped after the spec.

  MVP form
  - "full", or one line describing the smaller version being built (for example,
    "diet: desktop AI apps and browser only") when it is less than IDEATION.md
    describes. A scoped row built below its MVP form is a defect.

  Spec
  - The one section that owns the row, e.g. "capture.md Seal and receipt" or
    "SYSTEM.md Invariants". A section may own several rows.

  State (filled in during execution)
  - (blank)          not built.
  - built            the journey carrying it works, and an agent checked that
                     journey's acceptance itself, except items marked (the owner). Set in
                     the commit that makes the journey work. The owning spec section
                     or CURRENT.md says how to see it.
  - accepted         the owner saw it work, usually at a checkpoint. Only the owner sets
                     this.
-->

## MODE - Game modes

How players choose what kind of game they play: the shared sandbox and the modes beside it.

| ID | Item | Kind | Scope | MVP form | Spec | State |
|----|------|------|-------|----------|------|-------|
| MODE-01 | The current shared world is the sandbox mode | capability | | | | |
| MODE-02 | Other modes parked for later (challenges, weekly High Risk Day, historic days, forecast desk, damage survey, sandbox roles and calendar) | capability | | | | |
| MODE-03 | Modes other than the sandbox play busy days that are real engine runs, never painted storms | guarantee | | | | |

## CAMP - Campaign

A chaser's campaign, chapter by chapter, with the tutorial inside it.

| ID | Item | Kind | Scope | MVP form | Spec | State |
|----|------|------|-------|----------|------|-------|
| CAMP-01 | A campaign with the tutorial mixed in | capability | | | | |
| CAMP-02 | Difficulty from easy to hardcore; easier levels give more products | capability | | | | |
| CAMP-03 | Each chapter is one day that teaches one skill: briefing, target, chase, debrief | capability | | | | |
| CAMP-04 | The first act is the tutorial; experienced players can skip it | experience bar | | | | |
| CAMP-05 | Difficulty sets the products shown and how forgiving the game is | capability | | | | |
| CAMP-06 | Medals and career rewards unlock vehicles and instruments | capability | | | | |

## Scoping Notes

<!-- Reasons, keyed by ID. Required for deferred and cut rows, and for any scoped row
     whose MVP form is smaller than IDEATION.md describes. Optional otherwise. One
     note may cover several IDs that share a reason. Agent recommendations and
     change proposals are marked "Proposed:" until the owner decides; replace them with
     the decision. -->

- [AREA-01]: [Reason.]
