# Soft smoke flipbooks for the particle tornado (roblox/src/shared/Tornado).
#
#   py -3.12 tools/smoke/smoke_flipbook.py --variant body --out roblox/assets/tornado2
#   py -3.12 tools/smoke/smoke_flipbook.py --variant wisp --out roblox/assets/tornado2
#
# A 4 x 4 sheet (1024 px, 256 px a frame) for a ParticleEmitter with FlipbookLayout Grid4x4 and
# FlipbookMode Loop: one puff that slowly churns and comes back to its first frame (the noise is
# made with an FFT, so it is periodic in time as well as space and the loop has no seam).
#
#   body: a round, soft, fairly dense puff with only large, smooth lumps; the funnel's main
#         layer. Many of these overlapping should read as one smooth solid surface.
#   wisp: a thin puff stretched sideways with fine streaks; the soft outer layer that blurs the
#         funnel's edge and suggests rotation.
#
# Neutral grey, lit softly from above (a small self-shadow so stacked particles have some
# depth); the game tints and lights them. The frame edges are kept fully clear.
# Writes <variant>.png (the sheet) and <variant>_preview.png (the sheet over mid grey).
import argparse
import os
import struct
import zlib

import numpy as np

GRID = 4
CELL = 256
FRAMES = GRID * GRID

VARIANTS = {
    "body": dict(
        radius=0.37,       # puff radius, share of the frame
        stretch=1.0,       # width / height of the puff
        noiseStretch=1.0,  # noise feature width / height
        beta=3.6,          # spectrum slope: higher = smoother, fewer small features
        billow=0.14,       # how far noise pushes the edge in and out (share of the radius)
        falloff=1.6,       # density profile (1 - (r/edge)^2) ^ falloff: higher = softer edge
        texture=0.45,      # how much noise varies the inside density
        erode=0.35,        # fine noise eating the edge into wisps
        density=3.2,       # optical thickness at the middle
        shadow=0.5,        # self-shadow strength (light from above)
        ambient=0.66,      # brightness in full shadow
        slow=5.0,          # time stiffness: higher = the puff changes less over the loop
    ),
    # nearly featureless soft blob (the reference look: realism from layering, not detail);
    # use with --single for one 512 px image (no flipbook)
    "soft": dict(
        radius=0.42, stretch=1.0, noiseStretch=1.0, beta=4.2, billow=0.10, falloff=1.9,
        texture=0.18, erode=0.12, density=2.6, shadow=0.22, ambient=0.86, slow=6.0,
    ),
    # a firmer blob: nearly a disc with a narrow soft rim. Stacked along the funnel's axis the
    # rims line up into the defined (not blurry) silhouette of the reference.
    "firm": dict(
        radius=0.44, stretch=1.0, noiseStretch=1.0, beta=4.4, billow=0.05, falloff=0.55,
        texture=0.1, erode=0.05, density=5.0, shadow=0.0, ambient=1.0, slow=6.0,
    ),
    # between soft and firm: a defined but not hard rim (firm discs stacked show their rims as faint
    # bands; soft ones blur the silhouette)
    "medium": dict(
        radius=0.44, stretch=1.0, noiseStretch=1.0, beta=4.4, billow=0.06, falloff=1.0,
        texture=0.1, erode=0.05, density=3.5, shadow=0.0, ambient=1.0, slow=6.0,
    ),
    # the medium blob as a wide, short ellipse (0.88 of the frame wide, ~0.29 tall): the funnel
    # core's slice of the cone. A round particle as wide as the funnel is as tall as it is wide
    # and hangs over the narrower part below.
    "wide": dict(
        radius=0.44, stretch=3.0, noiseStretch=3.0, beta=4.4, billow=0.06, falloff=1.0,
        texture=0.1, erode=0.05, density=3.5, shadow=0.0, ambient=1.0, slow=6.0,
    ),
    # a torn, stretched shred (scud): wide, thin and ragged, streaked along its length
    "shred": dict(
        radius=0.46, stretch=2.6, noiseStretch=4.0, beta=2.8, billow=0.35, falloff=2.4,
        texture=0.9, erode=0.75, density=1.8, shadow=0.0, ambient=1.0, slow=4.0,
    ),
    "wisp": dict(
        radius=0.36, stretch=1.0, noiseStretch=3.0, beta=3.2, billow=0.22, falloff=2.4,
        texture=0.8, erode=0.45, density=1.8, shadow=0.3, ambient=0.75, slow=4.0,
    ),
}


def periodic_noise(rng, shape, beta, stretch_x=1.0, time_scale=1.0):
    # time_scale stiffens the time axis: a change over the loop costs as much as a feature this
    # many times smaller
    """Fractal noise periodic on every axis: (t, y, x) -> roughly N(0, 1)."""
    t, h, w = shape
    kt = np.fft.fftfreq(t)[:, None, None] * t * time_scale
    ky = np.fft.fftfreq(h)[None, :, None] * h
    kx = np.fft.fftfreq(w)[None, None, :] * w * stretch_x
    k = np.sqrt(kx * kx + ky * ky + kt * kt)
    k[0, 0, 0] = 1.0
    amp = k ** (-beta / 2.0)
    amp[0, 0, 0] = 0.0
    phase = rng.standard_normal(shape) + 1j * rng.standard_normal(shape)
    field = np.real(np.fft.ifftn(amp * phase))
    return (field - field.mean()) / (field.std() + 1e-9)


def blur(a, sigma):
    """Gaussian blur over the last two axes (periodic; the frames are clear at the edges)."""
    h, w = a.shape[-2:]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def make_frames(v, seed):
    rng = np.random.default_rng(seed)
    shape = (FRAMES, CELL, CELL)
    ts = v["slow"]  # higher = the puff changes less over the loop
    low = periodic_noise(rng, shape, v["beta"] + 1.0, 1.0, ts)
    mid = periodic_noise(rng, shape, v["beta"], v["noiseStretch"], ts)
    fine = periodic_noise(rng, shape, v["beta"] - 0.8, v["noiseStretch"], ts)

    y, x = np.mgrid[0:CELL, 0:CELL]
    u = (x + 0.5) / CELL - 0.5
    w = (y + 0.5) / CELL - 0.5
    r = np.sqrt((u / v["stretch"]) ** 2 + w ** 2)[None]
    radius = v["radius"] / max(1.0, v["stretch"])
    edge = radius * (1.0 + v["billow"] * low)  # the edge, pushed in and out
    q = np.clip(1.0 - (r / edge) ** 2, 0.0, 1.0)
    body = q ** v["falloff"]  # dense middle, long soft fall to the edge
    inside = np.clip(1.0 + v["texture"] * 0.5 * mid, 0.0, 2.0)
    eaten = np.clip(1.0 - v["erode"] * np.clip(-fine, 0, None) * (1.0 - body), 0.0, 1.0)
    dens = body * inside * eaten

    margin = np.clip(np.minimum.reduce([x, y, CELL - 1 - x, CELL - 1 - y]) / (CELL / 21.0), 0, 1)[None]
    dens = dens * margin

    alpha = 1.0 - np.exp(-v["density"] * dens)
    # soft light from above: the (blurred) density already passed on the way down
    above = blur(np.cumsum(dens, axis=1) / CELL, CELL / 25.6)
    light = np.exp(-v["shadow"] * v["density"] * above * 4.0)
    value = v["ambient"] + (1.0 - v["ambient"]) * light
    return value, alpha


def write_png(path, rgba):
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[row].tobytes() for row in range(h))

    def chunk(kind, data):
        c = struct.pack(">I", len(data)) + kind + data
        return c + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--variant", default="body", choices=sorted(VARIANTS))
    ap.add_argument("--out", default="roblox/assets/tornado2")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--single", action="store_true", help="one 512 px image instead of a 4x4 sheet")
    ap.add_argument("--flat", action="store_true",
                    help="pure white, shape in the alpha only: overlapping particles then blend the same in any "
                         "draw order, so they cannot flicker when Roblox re-sorts them")
    ap.add_argument("--slice", action="store_true",
                    help="a horizontal slice of a column: crisp left and right edges, soft top and bottom. "
                         "Upright particles (FacingCameraWorldUp) of this stacked up the funnel merge into one "
                         "column with crisp sides and no lines inside (discs show their stacked rims)")
    ap.add_argument("--low", type=float, default=0.0,
                    help="with --foot: move the puff down this share of the frame first (a shorter foot)")
    ap.add_argument("--foot", action="store_true",
                    help="the lower half is the middle row carried straight down to a crisp bottom edge: "
                         "for particles standing on the ground without cutting into it (a particle the ground "
                         "cuts shimmers along the cut)")
    a = ap.parse_args()
    global GRID, CELL, FRAMES
    if a.single:
        GRID, CELL, FRAMES = 1, 512, 4  # a few frames for the noise; the first is kept

    value, alpha = make_frames(VARIANTS[a.variant], a.seed)
    if a.slice:
        rng = np.random.default_rng(a.seed)
        y, x = np.mgrid[0:CELL, 0:CELL]
        u = (x + 0.5) / CELL - 0.5
        v = (y + 0.5) / CELL - 0.5
        for i in range(alpha.shape[0]):
            # edge half-width wobbles a little down the slice so stacked edges don't line up exactly
            wob = 0.43 + 0.004 * np.sin(2 * np.pi * (v * 2 + rng.random())) + 0.002 * np.sin(2 * np.pi * (v * 5 + rng.random()))
            ex = np.clip((wob - np.abs(u)) / 0.03, 0, 1)
            ex = ex * ex * (3 - 2 * ex)
            ey = np.exp(-(v / 0.09) ** 2) * np.clip((0.3 - np.abs(v)) / 0.05, 0, 1)
            alpha[i] = ex * ey
        value = np.ones_like(value)
    if a.flat:
        value = np.ones_like(value)
    if a.foot:
        if a.low:
            # move the puff down so the foot is short: soft top from ~65% of the frame
            alpha = np.roll(alpha, int(CELL * a.low), axis=1)
            alpha[:, : int(CELL * a.low), :] = 0
        mid = CELL // 2 + (int(CELL * a.low) if a.low else 0)
        alpha[:, mid:, :] = alpha[:, mid:mid + 1, :]
        for k, f in enumerate((0.85, 0.5, 0.15)):  # a 3 px antialiased bottom edge
            alpha[:, CELL - 3 + k, :] *= f
    sheet = np.zeros((CELL * GRID, CELL * GRID, 4))
    for i in range(GRID * GRID):
        r, c = divmod(i, GRID)
        ys, xs = slice(r * CELL, (r + 1) * CELL), slice(c * CELL, (c + 1) * CELL)
        sheet[ys, xs, 0:3] = value[i][..., None]
        sheet[ys, xs, 3] = alpha[i]
    os.makedirs(a.out, exist_ok=True)
    out = (np.clip(sheet, 0, 1) * 255 + 0.5).astype(np.uint8)
    out[..., 0:3][out[..., 3] == 0] = 128  # no dark fringes where filtering pulls in empty texels
    name = a.variant + ("_single" if a.single else "") + ("_flat" if a.flat else "") + ("_foot" if a.foot else "") + ("_low" if a.low else "") + ("_slice" if a.slice else "")
    write_png(os.path.join(a.out, f"{name}.png"), out)

    grey = 0.45
    prev = sheet[..., 0:3] * sheet[..., 3:4] + grey * (1 - sheet[..., 3:4])
    prev = (np.clip(prev, 0, 1) * 255 + 0.5).astype(np.uint8)
    prev = np.concatenate([prev, np.full(prev.shape[:2] + (1,), 255, np.uint8)], axis=2)
    write_png(os.path.join(a.out, f"{name}_preview.png"), prev)
    print("wrote", a.variant, "alpha mean", round(float(alpha.mean()), 3))


if __name__ == "__main__":
    main()
