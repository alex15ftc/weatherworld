# Fine condensation detail on billboard storms (2026-10-25)

How to get the missing fine detail (crisp cauliflower lobes, self-shadow, fibrous edges) while keeping BillboardGui cards. This covers findings, an offline prototype, and a ranked plan. **Steps 1-5 were implemented on 2026-10-25; see "Implemented" at the end.**

## Why the detail is missing

1. **The tower and base texture has no detail inside it.** `lumpyFlat` is the smoke flipbook's `body --flat` puff (`tools/smoke/smoke_flipbook.py`):
   - It is white, with the shape in alpha only, so everything inside a card is one tint plus one UIGradient. A gradient can shade a ball, but it can't draw the domes and creases a cauliflower tower is made of.
   - Its 16 "frames" are **time steps of one churning puff**, not 16 shapes. Every card is effectively the same blob.
   - Its noise is smooth (spectrum slope 3.6), so there are no small domes even at the edge.
2. **The detail we already have isn't used.** The cloud-kit Cycles bakes (`roblox/assets/cloudkit/vapor/*_preview.png`, `tools/blender/cloud_vapor_bake.py`) show crisp domes-on-domes with deep self-shadow. The cards never adopted them.
3. **There aren't enough texels up close.** Frames are 256 px, and uploads are capped at 1024 px. Under the base a 600 m card 1 km away covers about 600 px, so it is magnified 2-3x and looks soft.
4. **Every card is the same scale.** Every card carries the same detail regardless of size. From afar the small cards turn into an even "popcorn" texture, and the eye loses the tower's big lit and shadowed masses.

## The method: bake the light into the texture, then rotate the card toward the sun

This is the standard technique for billboard smoke and clouds (Unity/Unreal "6-way lighting"), cut down to what a BillboardGui can do. Roblox has no pixel shaders. All we have per card is tint, transparency, rotation, a UIGradient and stacked ImageLabels.

- Bake each lobe as a small cloud volume with the **light coming from the top of the frame**. Rotate the card so the frame's top points at the sun's direction on screen. The renderer already computes that angle (`sunScreenAngle`). Cloud lobes look the same at any rotation, so this costs no variety.
- Use **two ImageLabels in the same BillboardGui:**
  - **amb:** grey shows how much sky light reaches each point (dark in the creases); alpha is coverage. Tint it with the card's shadow colour, lifted by the big-scale light so the sunny side's creases aren't black.
  - **sun:** white; alpha marks where direct sun reaches the visible surface (sunlit dome tops and edges). Tint it with the lit colour. Its ImageTransparency carries the sun amount (the storm's own shadow, the sun's height).
  - The result is `lerp(amb × shade, lit, sunMask × sunAmount)`, which only uses alpha blending.
- **Bake the sun at three angles:** `front` (sun behind the viewer), `side` and `back` (sun behind the cloud, bright rims). Choose or crossfade between them by view·sun. That front/back part is what rotation can't express.

### Prototype (offline, Roblox operations only)

- `tools/smoke/lobe_sheets.py` bakes 16 distinct lobes as numpy volumes (domes on domes, eroded skin, a sky term, three sun angles). It writes `lobe_amb`, `lobe_sun_front|side|back` sheets and `lobe_preview.png`.
- `tools/stormlab/card_mock.py` draws one tower layout twice from 6 and 18 km: left with an approximation of today's shading (body puff + tint + ramp + random rotation), right with the two-layer method. The left side is a stand-in for StormCards, not a capture from the game.

| | |
|---|---|
| 6 km: `detail/mock_6km.png` | cream sunlit side, blue-grey shadow side, cauliflower domes and creases, crisp silhouette (vs a soft blur) |
| 18 km: `detail/mock_18km.png` | the big lit/shadow masses are kept and the lobes show; the smallest cards still look busy (fixed by the contrast LOD, step 3) |

The numpy lobes are a proof of method. They are a bit grainy, and the back-lit set has no proper silver lining. The real assets should come from Cycles (step 1).

## Ranked plan

1. **Lobe sheets baked in Cycles** (biggest gain; new assets).
   - Reuse `cloud_vapor_bake.py`'s volume shader (Voronoi domes-on-domes, eroded fringe, anisotropy 0.75, many bounces) on 16 small lobe volumes.
   - Render separate passes by switching lights: a sky-only pass gives `amb`, and sun-only passes at front/side/back give the masks. Cycles gives true multiple scattering (soft shadows, a glowing rim when back-lit), which numpy can't.
   - Make three families: **tower lobes** (crisp, light from above), **base/underside lobes** (lit from below and from the horizon, hanging domes) and **soft body** (low contrast, for the column's interior and for distance).
   - Sheets are 1024 px, 4x4 at 256 px. The near/large set is 2x2 at 512 px.
2. **Two-layer cards in `StormCards`** (code).
   - `acquire()` adds a second ImageLabel (`sun`) above `img`. Lobe cards take rotation = the sun's screen angle instead of a random one, and drop the UIGradient (the bake replaces it). Big soft cards keep the gradient.
   - `shadeCard()` writes `img.ImageColor3` = shade (today's `dark`/`mid` colours), `sun.ImageColor3` = lit colour, and `sun.ImageTransparency` = 1 − a × sunAmount.
   - Front/side/back: one sheet per storm, chosen by view·sun at the storm's centre with hysteresis, crossfaded over ~1 s when it changes.
   - Re-aiming when the camera turns rewrites Rotation (already done for the gradient, 250 cards a frame).
3. **Detail by on-screen size** (code).
   - A card's sun-mask contrast and its sheet scale with its size in pixels: below ~60 px, fade the `sun` layer toward the plain tint and use the soft-body family; above ~300 px, use the 512 px set.
   - This removes the far-away popcorn and the near-field blur.
4. **Scale hierarchy in `CardPlan`** (code).
   - Large soft body cards give the mass. Small crisp lobe cards go only where detail reads: the sunlit silhouette, the boiling top and overshooting dome, and the rim of the base.
   - Card sizes vary (a few big lobes, many small ones) instead of one size per ring. The mock improved visibly from this alone.
5. **Variety.**
   - Mirroring with a negative `ImageRectSize` doubles the shapes. The forums confirm it works; we still need to test it in Studio.
   - Mix sheets per place: towers crisp; undersides, precipitation and the anvil body soft.
6. **Leave alone:** the curtain, striation and fractus sheets already carry their detail in alpha. They can get the same amb/sun split later if they look flat next to the new towers.

## Costs and risks

- **Label count:** ImageLabels roughly double (one extra per lobe card); BillboardGui count stays the same. This needs a Studio frame-time check before rollout. Fallback: one layer with the shading baked in as grey (rotation toward the sun still works; we lose separate shadow and lit colours).
- **Re-render cost:** a BillboardGui re-renders when any of its properties change (DevForum). Animated cards already do this every frame, and the `sun` layer adds no per-frame writes except during fades and re-aims.
- **Sorting:** how overlapping translucent billboards sort is undocumented. The cards already rely on it today, and two labels inside one BillboardGui keep their order.
- **Assets:** new sheets go up through romcp `roblox_upload_asset` only with the user's OK, with one Studio connection selected first, or it returns a decal id.

## Implemented (2026-10-25)

- **Sheets:** `tools/blender/lobe_bake.py` bakes 16 lobes per family in Cycles (about 22 min for everything on the RTX 4070, 64 samples).
  - All 16 lobes of a sheet go in one frame, with each row set deeper so no lobe shadows the one below.
  - Passes: amb (an even white sky, sun off) and sun-only front/side/back. The masks are normalised to the side pass's sunlit faces.
  - Families: `tower`, `under` (hanging domes), `soft`, plus `tower_near`/`under_near` (2x2 sheets of 512 px, the first four lobes).
  - Files are in `roblox/assets/clouds/lobe_*`. All 20 are uploaded; the texture ids are in `LabConfig.LOBES`.
  - Mock-ups with these sheets: `detail/mock_cycles_6km.png` and `detail/mock_cycles_18km.png`.
- **Renderer (`Render/StormCards`):**
  - Lobe cards carry three ImageLabels in their one BillboardGui: amb, then the side and front/back masks. View·sun sets the mask weights, and front swaps to back where its weight is 0.
  - Square cards turn so the frame's top faces the sun on screen; the aim queue re-aims them when the camera turns. Squashed cards stay level.
  - Half the cards are mirrored (negative `ImageRectSize`, `LabConfig.LOBE_MIRROR`); this is confirmed working in Studio.
  - Lobe cards drop the UIGradient. Colours: amb gets shade = mix(sky only, card mean, 0.5) ÷ the sheet's mean grey; the masks get the fully lit colour.
  - Family by on-screen size: `soft` under 40 px, the near sheets over 320 px.
- **Layout (`CardPlan`):** about one ring card in four is a big lobe set further in, and the rest are smaller and further out (they draw the silhouette). The column's centre card and the anvil's top layer are `soft`. Cumuliform `lumpyFlat` cards default to `tower`, or `under` when facing down.
- **Tornado:** `TornadoCards` has 26 heights (182 funnel cards + 18 condensation tags = 200 billboards, the user's budget).
- **Seen in Studio** (`detail/studio_tower_frontlit.png`, `studio_tower_backlit.png`):
  - The supercell tower from ~15 km shows cauliflower lobes all over, a shaded lower flank and a crisp edge. Looking toward the sun it is greyer, with faint rims.
  - From under the base: a dark deck with lobed scud.
  - No errors. StormCards averages 0.9-1.5 ms for 3 storms with ~1,100-1,300 cards (it was ~0.5-2 ms before); all lab scripts total 2.5-3.1 ms.
- **Not done / open:**
  - Shaft caps (`Shafts.luau`) and shelf pieces still use `lumpyFlat`.
  - The base's grid cards still show as flat ovals from below.
  - The back-lit look could use stronger rims (raise the back pass's mask gain).
  - GPU cost of the extra labels has not been measured separately (frame time looked unchanged).

## Second look pass: smooth, Severity-style (2026-10-25)

The user found the first bake too cauliflower-like and wanted a texture that blends and smooths much more, pointing at the Severity reference frames (`docs/storm-reference/frames/twisted_*`, `docs/tornado-reference/frames/clip_mobile_severity_sheet.jpg`). In those frames the clouds are big soft volumes with smooth light-to-dark gradients, blurry low-contrast lumps and fuzzy edges, with no creases.

- **Bake (`lobe_bake.py`):** smooth billows (low-frequency noise on a smooth-unioned sphere cluster) replace the Voronoi domes-on-domes. The surface ramp is wide, a mottling noise runs through the density, and the volume is less dense so light soaks in. `OUT` is raised to 0.3, because the halo was reaching the grid's edge and showing as squares.
- **Post (`lobe_post.py`, plain Python):** turns the raw passes into sheets.
  - Fringe shading is pulled to each lobe's mean.
  - `contrast` 0.3; `feather` 2.2 (alpha^2.2 for a wide rim fade).
  - The back-lit sheet is half side light, because on its own its bright rim read as an outline.
- **One image per card.** The two-layer method (amb + sun masks) was dropped. Stacking two alpha-blended labels is not a mix: over the card behind, every partly transparent rim darkens by `m·A·(1−A)·(behind − shade)`. That caused the "bubbles" and "fish-scales" in the mock-ups, and no texture could fix it.
  - Each lobe card now draws one `lobe_<family>_lit_<front|side|back>` sheet: the light baked into the grey, picked by view·sun with a margin.
  - It is tinted and gradient-shaded like any card and turned so the frame's top faces the sun.
  - This is also cheaper (no extra labels).
- **Layout:** the ring cards' size mix is gentler (big 1.2 r vs 0.9-1.05 r), because a strong big/small mix added to the bubbly look.
- **Mock-ups:** `detail/mock_soft_6km.png` and `mock_soft_18km.png`; sheets `detail/lobe_soft_contact.png` (rows tower/under/soft; columns front/side/back).
- **Studio:** `detail/studio_soft_frontlit.png`, `studio_soft_backlit.png`, `studio_soft_underbase.png`.
  - Soft billowy towers with blended edges.
  - From below, a smooth dark slate deck with the scud blending in.
  - No errors. StormCards averages 0.86 ms for 3 storms / 1,293 cards.
  - Possible next tuning: from afar the tower can read a little thin or translucent. Lower `feather` (1.4-1.8) for firmer edges, or raise `contrast` for more visible billows; both are a re-run of `lobe_post.py` plus re-upload, with no re-render needed.
- 15 sheets uploaded; ids in `LabConfig.LOBES` (`front`/`side`/`back` per family). The first bake's 20 uploads are no longer used.
