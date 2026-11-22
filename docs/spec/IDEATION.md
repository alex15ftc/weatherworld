# Ideation

The full record of what WeatherWorld is meant to be, in as much detail as ideation produced. It does not need to be tidy. This document captures intent and is the authority on what the owner meant. Specs summarize it. When a spec and this document disagree about intent, either the spec is wrong or the question goes to the owner.

<!-- Conventions
  - Tag every passage that describes a feature, guarantee, or experience bar with its
    FEATURES.md ID in square brackets at the start of the passage, e.g. [CAP-07].
    A passage may carry several tags. Every row in FEATURES.md has at least one
    tagged passage here.
  - Mark decisions inline as (settled), (tentative), or (open). Only the owner settles
    anything.
  - Keep the reasoning, not just the conclusion: why an idea matters, what it
    protects against, what was considered and rejected. Specs are written from this
    reasoning.
  - After scoping, append to this file instead of rewriting it. New ideas get new
    sections and new FEATURES.md rows with a blank Scope.
-->

## Game modes (2026-11-17)

[MODE-01] The current shared world becomes the sandbox mode. Other modes sit beside it to keep players engaged in
other ways: the shared world is realistic, so some days are quiet, and it makes tornadoes less often than games
like Twisted. (owner, tentative)

[MODE-02] Parked for later (owner, 2026-11-17: "keep the other ideas for later"). Agent proposals, all (open):
- Intercept Challenge: 10-20 minute rounds dropped in near a storm shortly before it makes a tornado; scored on
  view, video, a probe in the path, and getting out safely.
- High Risk Day: a weekly event where every server plays the same top outbreak day, with a leaderboard.
- Historic Days: replay the shared world's own big days (ReplayArchive keeps them for two days now).
- Forecast Desk: issue the outlook, watches and warnings, then get scored against what the engine does.
- Damage Survey: walk a tornado's path, rate damage indicators, compare with the engine's EF rating.
- Sandbox extras: a "when to play" calendar from the Day 1-3 outlooks; player roles (forecaster, spotter,
  chaser, surveyor).

[MODE-03] How modes other than the sandbox get busy days without painting (agent proposal, open): search engine
seeds offline for active and instructive convective days, keep them as a library, record each day's storm stream
once and play it back on instanced servers. Every storm is a real engine run; the mode picks the atmosphere, it
never forces a tornado. Instanced servers may skip quiet hours (start shortly before initiation).

## Campaign (2026-11-17)

[CAMP-01] A campaign, with the tutorial mixed into it rather than separate. (owner)

[CAMP-02] Difficulty levels from easy to hardcore. Easier levels give the player more products than harder ones.
(owner)

Agent proposal for how chapters work (open; the owner has not decided any of it):

[CAMP-03] Each chapter is one library day (MODE-03) and teaches one skill. Phases: briefing (the morning
outlook and what this chapter teaches), target (pick a target on the map before storms form; scored later
against where they formed), chase (drive, position, objectives), debrief (the day's radar loop with the player's
track over it, where the tornadoes were, medals). Quiet stretches can be skipped. Several qualifying days per
chapter so a replay is not the same day.

[CAMP-04] The tutorial is the first act: each chapter introduces one tool the first time it is needed (map,
radar, warnings, outlook, sounding, velocity). Experienced players can skip to act 2.

[CAMP-05] Difficulty sets what the player is shown and how forgiving the game is: Easy (every product plus
guidance), Normal (the products a chaser has), Hard (fewer products, radar a few minutes old), Hardcore (what a
1990s chaser had: the morning outlook text, warnings by radio, the sky; one life). Harder levels earn more.

[CAMP-06] Progression: medals per chapter and difficulty; career rewards unlock vehicles and instruments.

Draft chapter list (agent proposal, open):
- Act 1, Rookie (tutorial): 0 drive and the map; 1 first thunderstorm (radar, lightning, hail); 2 reading a
  supercell (wall cloud, inflow, RFD, FFD: photo objectives); 3 first tornado (isolated, slow, open country).
- Act 2, Chaser: 4 target day (outlook, sounding, mesoanalysis); 5 capped day (patience, one storm breaks the
  cap); 6 HP supercell (rain-wrapped tornado, velocity); 7 squall line (QLCS spin-ups); 8 night chase.
- Act 3, Veteran: 9 probe mission; 10 tornado through a town (blocked roads, aftermath); 11 High Risk finale
  (outbreak, many tornadic supercells, choosing storms).
