# Ops Layer

`ops/` owns business and operating state for `WeatherWorld`: strategy, current status, history, contacts, meetings, research, and business work products. It does not hold product implementation.

## Where Does This Go?

Decide at creation time, when the choice is cheap.

| If it is... | It goes in |
|---|---|
| Current priorities, blockers, or operating state | `STATUS.md` |
| Accepted direction | `STRATEGY_MASTER.md` |
| Open strategic thinking | `STRATEGY_WORKING.md` |
| A milestone, pivot, or durable decision | `HISTORY.md` |
| A person, organization, or relationship | `contacts/` |
| A finished analysis or decision memo someone may reread | `memos/` |
| An effort with several files or a deliverable (pitch, engagement, pilot, event prep, dataset build) | `work/<YYYY-MM>-<slug>/` |
| Sourced external research that outlives one effort | `research/` (if this project uses it) |
| Legal, equity, governance, or filing records | `company/` (create when needed) |
| Something you will probably delete | `scratch/` (gitignored) |
| Code with its own runtime (engines, services, apps) | the repo root (`js/`, `server/`, `roblox/`, `tools/`), not ops |

Scripts that exist only to support one ops effort may live inside that effort's work folder.

## Authority

- `STATUS.md` is the compact source of truth for current framing, goals, blockers, action items, and product reality.
- `STRATEGY_MASTER.md` is accepted strategy in depth.
- `STRATEGY_WORKING.md` is unsettled thinking; it is not canonical when it conflicts with the two files above.
- `HISTORY.md` is the append-only milestone and pivot log.
- Memos and work folders are records of what was done and learned. They are evidence, not current authority.

## Standard Contents

- `AGENTS.md` - agent contract (the only instruction file)
- `STATUS.md`, `STRATEGY_MASTER.md`, `STRATEGY_WORKING.md`, `HISTORY.md`
- `contacts/` - people, orgs, meetings
- `memos/` - finished internal analysis, flat and dated, never expires
- `work/` - one folder per bounded effort, each with a status header
- `scratch/` - local, gitignored, disposable
- `.gitignore` - defaults that keep generated output and large media out of git

Optional per project: `research/` (kept here), `marketing/`, `meetings/`, `design/`, `company/`. Every additional top-level folder needs a README that states what belongs there and what does not.

## Large Files

Raw inputs you cannot re-obtain are part of the record. Keep them in git if small; otherwise store them outside git (shared storage) and put a pointer (location and checksum or date) in the owning README. Generated output, run logs, caches, and video stay out of git by default.
