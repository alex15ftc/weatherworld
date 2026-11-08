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

## Turn captures into something comparable
Save captures to a scratch folder as `<label>_<angle>.png`, then:
- Contact sheet: `magick montage <scratch>/*.png -tile 4x -geometry 480x270+4+4 -label %t <scratch>/sheet.png`
- Timelapse of a lifecycle: `ffmpeg -framerate 4 -pattern_type sequence -i <scratch>/f%03d.png -vf scale=960:-2 <scratch>/life.mp4`
  (or `-vf "fps=4,scale=640:-1" life.gif`)
- Before/after numbers: `py tools/shot_compare.py` (`--horizon` for sky-only). Judge wall/base contrast against the frame's own horizon.

## Judge by
Visible structure, not tornado counts. Use the visual-judge agent for a second opinion on a contact sheet.
