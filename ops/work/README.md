# Work

One folder per bounded effort: a pitch, an engagement, a pilot negotiation, event prep, a dataset build, an incorporation. Anything with more than one file or an external deliverable gets a folder here. A single finished document goes in `../memos/` instead.

## Naming

`work/<YYYY-MM>-<slug>/`, using the month the effort started, for example `2026-07-loominary-sprint`. Folders sort chronologically and never move or get renamed afterward, so links to them stay valid.

## Required README Header

Every work folder starts with a `README.md` beginning like this:

```text
# <Effort name>

Status:   active | done | parked | abandoned
Dates:    YYYY-MM-DD → YYYY-MM-DD (or → ongoing)
Purpose:  one line: what this effort is for
Outcome:  1–3 lines, written at close: what happened and what we learned
Record:   the files that ARE the record (deliverables sent, final memo, raw inputs we cannot get again)
Exhaust:  by-products that can be regenerated or were superseded (runs/, tmp/, drafts, intermediate CSVs)
Promoted: where conclusions went (STRATEGY_MASTER §..., HISTORY YYYY-MM-DD, memos/..., contacts/...)
```

Everything after the header is free-form.

## Close-Out

When an effort ends, whoever knows it best (usually with the owner) does this once:

1. Write the `Outcome` line.
2. Confirm `Record`: what someone might need to reread or prove later. When unsure, keep it.
3. Remove `Exhaust` from git: delete it, or leave it locally under an ignored path (`runs/`, `tmp/`, `scratch/`).
4. Promote conclusions into the canonical files and fill in `Promoted`.
5. Set `Status: done` (or `abandoned`, with the reason in `Outcome`).

The folder stays where it is, permanently. Retention is decided at close-out by what a file is, never by its age.

## Staleness

An `active` folder untouched for 60 days is surfaced with one question: close, park, or still active? Nothing is deleted automatically.

## Finding Old Work

- `ls work/` gives a chronological list.
- `grep -H "^Outcome:" work/*/README.md` gives a one-line history of every effort.
- `grep -l "^Status: *active" work/*/README.md` lists open efforts.

There is no hand-maintained index; the headers are the index.
