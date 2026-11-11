---
name: watch-scene
description: Watch and judge a StormLab or cloudlab scene in Roblox Studio through romcp - pick the scene key, set a safe speed, capture the required camera angles, and turn captures into a contact sheet or timelapse. Use after any storm, cloud or tornado visual change.
---

# Watch a scene

## Setup
1. `dominus_status`, then `dominus_select_studio` for the right window (Game connection for play-mode output).
2. Studio must be the foreground window (it drops to ~15 fps unfocused). Ask the user to bring it forward if captures look stale.
3. If an edit seems to do nothing, compare `studio_read_script` with the file on disk: Rojo sync can go stale silently.

## Scene keys (see the lifecycle-scenes memory for the full list)
- L1 classic, L2 wedge/multi-vortex, L3 high base, L4 rope (keypad `.` `*` `+`), L5 rain-wrapped (`;`), L6 landspout (F4, Shift+`;`).
- SC supercell lifecycle (`'`), low base Shift+`'`; MG mergers (`` ` ``); hills F2.
- Reference shots P1-P5: comma steps through them; each pairs with a real photo.
- Press a scene key once and wait for "built". Number keys can't be sent (use keypad); never bind `/`; F7 is Studio's.

## Speed
Watch at 5-15x. Never judge at 60x (rope phase lasts ~4 real s at 15x).

## Angles (required for every visual change)
Default chase view, orbit left and right (hold arrows), far (O x3), under the base (I x3-6, PageUp x4-5).
Capture the same angles before and after the change when possible.
- Clicks are viewport logical px: (capture_px - viewport origin) / 1.5.
- `studio_capture_window` when Studio screenshots are unavailable.

## Game storms (the judging suite: tornado and supercell)
1. Replay server on 3029 (`tools/stormlab/lifecycle-serve.mjs`), `curl localhost:3029/life/goto?i=<tick>`, start
   a play test, then `curl "localhost:3029/life/place?bearing=0&km=2"`.
2. On the client: E, activate "Orbit", activate "Follow <storm>~engine", E. Keep each input batch under 30 s of
   waits. `-` zooms the follow camera out (x1.4 a press, up to 4x), `=` in. U spawns a car and ends the follow.
3. Tornado set: 4-6 close orbit shots, both the rain side and the clear side. Supercell set: NOT the `-` zoom -
   the storm is drawn ~3.6x wider than the map about its tornado, so a 4x zoom stays under the base (2026-11-10).
   Instead: `curl "localhost:3029/life/place?bearing=0&km=18"` for the ground-level far view (player camera, no
   follow), and the place's temporary VTCam poses (PageUp/PageDown step poses round the tornado: "whole 25000 up",
   "whole west 25000 up"; End returns the camera - but End/Home/Insert/Delete are also the lab's speed keys,
   press Home after End). Poses nearer than ~20000 studs see past the terrain built round the player (sky arcs).
   VTCam's Insert hides one storm layer at a time (prints `[VTCam] lab layer hidden: <name>`).
   `py tools/stormlab/grab_window.py "plains - Roblox" <out> --crop 430,130,1490,925 --n <N> --dt <s>`
   Take the close set FIRST, the far set last. The character rides under the follow camera, so a far
   zoom moves the server's one weather window (StormHost, 35 km) as a travelling player would - the far
   view is then the real one - but back in close the storm draws near-black with no rain or haze until
   the window follows back (wait 1-2 min, or restart the test).
   Zoom distances are map distances: the normal follow is ~10 km of map, 4x ~40 km (the sky is drawn
   ~9.6x taller than the map is wide, so it looks much nearer).
4. Give both sets to the visual-judge agent: it grades both tables (tornado and supercell) every round.

## Turn captures into something comparable
Save captures to a scratch folder as `<label>_<angle>.png`, then:
- Contact sheet: `magick montage <scratch>/*.png -tile 4x -geometry 480x270+4+4 -label %t <scratch>/sheet.png`
- Timelapse of a lifecycle: `ffmpeg -framerate 4 -pattern_type sequence -i <scratch>/f%03d.png -vf scale=960:-2 <scratch>/life.mp4`
  (or `-vf "fps=4,scale=640:-1" life.gif`)
- Before/after numbers: `py tools/shot_compare.py` (`--horizon` for sky-only). Judge wall/base contrast against the frame's own horizon.

## Judge by
Visible structure, not tornado counts. Use the visual-judge agent for a second opinion on a contact sheet.
