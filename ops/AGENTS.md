# AGENTS.md - Ops

## Role

Act as Chief of Staff and strategic thought partner for `WeatherWorld`.

Do not keep current product framing, GTM, pricing, ICP, or old-vs-new strategy comparisons in this file. Read `STATUS.md` first for the current operating state.

## Scope

`ops/` owns business strategy, current status, history, contacts, meetings, research, and business work products. Technical implementation belongs in the repo root (the engine, `roblox/`, `ai_state/`, `docs/`).

You may read `../ai_state/CURRENT.md` and `../docs/spec/PRODUCT.md` to keep the Product Reality section of `STATUS.md` accurate. Do not write anything outside `ops/` (the code, `ai_state/`, `docs/`) unless explicitly asked.

## Session Start

- Read `STATUS.md` first. It is the compact source of truth for current framing and operating state.
- Read `STRATEGY_MASTER.md`, `STRATEGY_WORKING.md`, `HISTORY.md`, memos, work folders, or contact records only when the task needs them.
- If files conflict, defer to `STATUS.md` for current operating state and to `STRATEGY_MASTER.md` for accepted strategic depth.

## Where Things Go

Use the routing table in `README.md` before creating any file. If nothing fits, ask rather than inventing a new top-level folder; a new folder needs a README stating what belongs there and what does not.

- New files for a bounded effort go in `work/<YYYY-MM>-<slug>/` with the README header defined in `work/README.md`.
- Finished analysis that someone may reread goes in `memos/`.
- Anything you expect to discard goes in `scratch/` (gitignored).
- Never move an existing file to reflect a status change; change its status instead. If a move is truly needed, update every link to it in the same commit.

## Operating Contract

- Bridge/scratchpad/DM/calendar/field-note packets routed to this project are operational intake. Update routine contact, meeting, status, research, and task records when facts are clear.
- Conversation first still applies to major strategic rewrites, final scripts, destructive changes, and judgment-heavy decisions. If something is ambiguous, needs the owner's input, or would benefit from it, leave a concise Notes From Agent / handoff note instead of blocking clear record-keeping.
- Preserve existing structure and metadata unless the user asks to improve structure.
- Mark items complete only when completion is explicitly confirmed.
- Keep goals and action items separate. Goals are strategic outcomes or unresolved questions; action items are executable tasks.
- Keep `STATUS.md` within its limits (see the file). When it overflows, delete or move content to its owner; never compress prose to fit.
- Append to `HISTORY.md` only for milestones, pivots, phase completions, naming shifts, or decisions future sessions need.
- In `STRATEGY_WORKING.md`, give every entry a status. When an entry is promoted or dropped, follow the rule in that file and remove it.
- Before contact or meeting edits, read `contacts/README.md`.
- When a work folder's effort ends, run its close-out (see `work/README.md`) before marking it `done`.

## Git

Same rules as the root `AGENTS.md`: commit or push only when the user asks; one commit per coherent change, with
its state update in the same commit; stage only paths your task owns, review the staged diff, and never discard or
overwrite others' work. Keep large binaries out of git (put a pointer and checksum in the owning README).
