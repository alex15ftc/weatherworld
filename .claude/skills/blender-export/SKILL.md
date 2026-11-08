---
name: blender-export
description: Make, preview and upload Roblox art (textures, sprite sheets, cloud kit pieces) with headless Blender 5.2 and romcp. Use when creating or changing any baked texture, flipbook, sprite sheet or mesh piece for WeatherWorld.
---

# Blender art pipeline

## Run
`blender --background --factory-startup --python tools/blender/<script>.py -- <options>`
(Blender 5.2 on PATH; full path `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.)
Scripts, options and timings: `tools/blender/README.md`. Soft lab textures: `tools/smoke/*.py`, `tools/blender/lobe_bake.py` + `lobe_post.py`.

## Rules
- Untrusted .blend files (for example the friend's tornado file): always add `--disable-autoexec`.
- Look: soft, smooth, low-contrast (Severity-style), never crisp cauliflower. Tune contrast/feather in `lobe_post.py` before re-rendering.
- Assets only make materials; the game sizes, tints and fades them from the fields.
- Read the PNG previews back and judge them before uploading. A contact sheet helps: `magick montage *.png -tile 4x -geometry 256x256+2+2 sheet.png`.

## Check
- Cloud kit: `py tools/blender/check_cloud_kit.py`.

## Upload (romcp)
1. Select ONE Studio connection first (`dominus_select_studio`), or the upload returns a decal id that won't load in an ImageLabel.
2. `roblox_upload_asset` with creatorUserId 8632902. The Open Cloud key lives in romcp's panel; never put it in chat or files.
3. Wait for processing before using the id: a texture requested too early stays broken until Studio restarts.
