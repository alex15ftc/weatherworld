# Cloud kit wisp sprites (scud and base fringe)

The storm's ragged bits, rendered as real volumes (Cycles) by `tools/blender/cloud_wisp_bake.py`:

- **scud_1 … scud_6**: single torn fractus fragments (like `docs/storm-reference/real/05_scud_fractus_c.jpg`),
  thinner than the tower vapor so they read as partly see-through wisps.
- **fringe_1 … fringe_3**: the ragged lower edge of a cloud base seen side-on: an opaque strip along
  the top, hanging shreds below it, a few small detached scud bits. **Tileable left/right.**

These hang under the storm in shadow, so they are lit for that (see Lights). The colour is the
cloud's own white; tint darker in game.

| File | What |
|---|---|
| `scud_<n>.png` | 256 × 512 RGBA: two 256 × 256 cells stacked, **straight (not premultiplied) alpha** |
| `fringe_<n>.png` | 512 × 512 RGBA: two 512 × 256 cells stacked, straight alpha |
| `<piece>_preview.png` | The same sheet over dark slate `#3a4450`, for looking at |
| `fringe_<n>_row.png` | The fringe's diffuse cell three times side by side over slate: seam check (not for upload) |
| `sheet.png` | Contact sheet: the six scud previews in a row, the three fringe previews below (1536 × 1024) |

## Cell layout (both kinds)

| | |
|---|---|
| **top** | `diffuse`: uniform white sky only (no sun). The main look. |
| **bottom** | `back`: a sun behind the piece (20° up, 15° to the camera's left, strength 3) plus a dim white sky (0.15): silver-edged shreds, darker dense parts |

Diffuse: a non-absorbing cloud under a uniform white sky is close to white wherever it is (scud
rgb ≈ 1.0); the shape is carried by the alpha. The fringe's shreds are greyer because the slab above
hides the sky overhead. Back: thin edges glow, cores go grey (rgb p50 ≈ 0.9 scud, 0.4 fringe).

## What a cell covers

Camera orthographic, horizontal, looking at the piece's front; image right = +x, image up = +y.

**Scud** (256 × 256): a square 2 × 2 units. The fragment stays inside about the middle 80% (|x|, |y|
≲ 0.8 of the half-size) and its density is faded to 0 by 0.85–0.95, so **alpha is 0 on every cell
edge** (bilinear sampling won't bleed; inset UVs a pixel to be safe). The fragment's position inside
the cell varies (it is drawn, not centred by bounds); draw the sprite as a square quad.

**Fringe** (512 × 256): 2 units wide × 1 unit tall (the quad's aspect is 2 : 1).
- Top: **alpha = 1 across the whole top ~25%** (rows 0–64 of the cell; measured min 0.98–1.00), and
  1 on the top row, so the strip butts against the cloud base above it.
- Left/right: the volume is periodic in x with period = the cell width, and was rendered with a
  quarter-period of the wrap-around on each side, so the **left and right edges match**; strips laid
  end to end with no overlap tile seamlessly (mean |left column − right column| ≈ 0.02–0.04 in 0–1
  units, from render noise). No taper in x.
- Underside: the slab's lower edge wanders around 0.62–0.68 of the height (from the bottom); shreds
  hang to ~0.1–0.3 of the height above the bottom (fringe_3 longest, fringe_2 shortest); alpha at
  the bottom row is 0 (≤ 0.02).

| Piece | Look |
|---|---|
| `scud_1` | Rising, curling wisp: broad soft bottom thinning up into a hook (the photo) |
| `scud_2` | Horizontal tattered strip with two short drooping tails |
| `scud_3` | Thin leaning column breaking up at the top |
| `scud_4` | Horizontal strip with two long ragged shreds hanging from it |
| `scud_5` | Three small shreds on a diagonal |
| `scud_6` | Comma / hook curling up, trailing a thin tail |
| `fringe_1` | Medium shreds, some broad tufts, a few detached bits; moderate lean |
| `fringe_2` | Shorter, denser ragged edge, strongest lean (wind-driven), few bits |
| `fringe_3` | Longest, most fibrous shreds (wall-cloud underside), most detached bits, little lean |

## Render

Cycles on the RTX 4070 (OptiX), 256 samples with denoising, volume bounces 16, volume guiding on,
view transform Standard, film transparent, 8-bit PNG. Principled Volume, white, no absorption,
anisotropy 0.5. Bake time 4.3 min for all nine (scud ~4–10 s to build + ~5 s to render; fringe
~30–40 s to build + ~22 s to render).

How the volume is made (no mesh: the density is built in numpy and handed to Cycles as an OpenVDB
grid): noise is FFT Gaussian random fields (periodic, so the fringe tiles), smooth for the domain
warps and fibrous (stretched along one axis) for the erosion. Scud = soft distance-to-hand-drawn
strokes at strongly warped positions, eroded by fibrous noise, denser cores in places. Fringe = an
opaque slab with a lumpy, fraying underside plus randomly placed hanging strokes (curving, leaning,
torn the same way) and a few detached ones, all placed periodically in x.
