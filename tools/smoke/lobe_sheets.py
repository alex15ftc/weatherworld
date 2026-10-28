"""Lit cauliflower lobe sheets for storm-lab billboard cards (prototype of the two-layer method).

Roblox has no pixel shaders, so a card's inside shading has to come from its texture. These
sheets bake it in. Each lobe is a small cloud volume (domes on domes, eroded edges) rendered
orthographically, with the light coming from the TOP of the frame. In game the card is rotated
so the frame's top points at the sun on screen, and two ImageLabels are stacked in the card's
BillboardGui:

  amb    grey = the light the lobe gets from the sky (dark in the creases between domes, where
         little sky reaches), alpha = the lobe's coverage. Tinted with the card's shadow colour.
  sun    white, alpha = where direct sunlight reaches the visible surface (sunlit dome tops and
         edges). Tinted with the card's fully lit colour; its ImageTransparency carries how much
         sun reaches the card (the storm's own shadow, the sun's height).

  over = lerp(amb x shadowColour, litColour, sunAlpha x sunAmount): only tint, transparency,
  rotation and alpha blending, which a BillboardGui can do.

Three light angles are baked: `front` (the sun behind the viewer), `side` (the sun across the view, light along the frame's top) and
`back` (the sun behind the cloud: dark body, bright rims). The game fades between them by
view . sun.

  py -3.12 tools/smoke/lobe_sheets.py [--seed 3] [--res 96] [--out roblox/assets/clouds]

Writes lobe_amb.png, lobe_sun_side.png, lobe_sun_back.png, lobe_sun_front.png (1024 px, 4x4 frames of 256 px) and
lobe_preview.png (a side-lit and a back-lit composite over storm grey).
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke_flipbook import write_png

F = 256
N = 4


def fbm(rng, n, beta=3.0):
    """Periodic 3D noise, ~N(0, 1)."""
    k = np.fft.fftfreq(n) * n
    kx, ky, kz = np.meshgrid(k, k, k, indexing="ij")
    kk = np.sqrt(kx * kx + ky * ky + kz * kz)
    kk[0, 0, 0] = 1
    spec = (rng.normal(size=(n, n, n)) + 1j * rng.normal(size=(n, n, n))) / kk ** (beta / 2)
    spec[0, 0, 0] = 0
    z = np.real(np.fft.ifftn(spec))
    return (z - z.mean()) / z.std()


def lobe_density(rng, n):
    """Grid axes (x right, y up, z toward the viewer), coordinates -1..1."""
    c = (np.arange(n) + 0.5) / n * 2 - 1
    X, Y, Z = np.meshgrid(c, c, c, indexing="ij")
    # level 1: a few big domes in a squat mass, flatter underneath
    spheres = []
    for _ in range(rng.integers(3, 6)):
        r = rng.uniform(0.26, 0.38)
        spheres.append((rng.uniform(-0.3, 0.3), rng.uniform(-0.15, 0.2), rng.uniform(-0.2, 0.2), r))
    # levels 2 and 3: domes on domes, placed on the surface (upper side mostly: rising cloud)
    for level, count, rr in ((2, 22, (0.11, 0.19)), (3, 45, (0.06, 0.1))):
        base = list(spheres)
        for _ in range(count):
            cx, cy, cz, r = base[rng.integers(len(base))]
            d = rng.normal(size=3)
            d[1] = abs(d[1]) * 0.9 + 0.1 * d[1]  # (mostly up and sideways)
            d /= np.linalg.norm(d)
            rs = rng.uniform(*rr)
            spheres.append((cx + d[0] * r * 0.92, cy + d[1] * r * 0.92, cz + d[2] * r * 0.92, rs))
    sdf = np.full(X.shape, 9.0)
    for cx, cy, cz, r in spheres:
        sdf = np.minimum(sdf, np.sqrt((X - cx) ** 2 + (Y - cy) ** 2 + (Z - cz) ** 2) - r)
    # a flatter, softer underside (the base of a lobe is where it joins the cloud below)
    sdf = np.maximum(sdf, -(Y + 0.42) * 0.8)
    warp = fbm(rng, n, 3.2)
    fine = fbm(rng, n, 3.0)
    sdf = sdf + 0.03 * warp
    # dense core, thin skin eaten by fine noise (wispy rim, crisp domes)
    skin = 0.06
    dens = np.clip(-sdf / skin, 0, 1) ** 1.5
    dens *= np.clip(1 + 0.15 * fine, 0.6, 1.3)
    # keep clear of the frame edge
    edge = np.clip((0.97 - np.maximum(np.abs(X), np.abs(Y))) / 0.1, 0, 1)
    return dens * edge


def transmit_along(dens, n, ly, lz, kext):
    """Optical depth from each voxel toward a light coming from (0, ly, lz) (ly > 0: from above),
    marched slice by slice down y with a fractional z shift per slice (shear)."""
    tau = np.zeros_like(dens)
    shift = lz / max(ly, 1e-3)  # z cells per y cell
    step = 1.0 / max(ly, 1e-3) * (2.0 / n) * kext
    acc = np.zeros((n, n))  # (x, z)
    for y in range(n - 1, -1, -1):
        # move the accumulated column one slice down along the light: z - shift
        i = int(np.floor(shift))
        f = shift - i
        a = np.roll(acc, i, axis=1) * (1 - f) + np.roll(acc, i + 1, axis=1) * f
        if i >= 0:
            a[:, : i + 1] = 0
        else:
            a[:, i:] = 0
        acc = a + dens[:, y, :] * step
        tau[:, y, :] = acc
    return tau


def render(dens, n, kext=40.0):
    """amb, sun_side, sun_back, alpha images (n x n, image rows top to bottom)."""
    step = (2.0 / n) * kext
    # view: looking along -z (from +z); front-to-back transmittance
    d = dens[:, :, ::-1]  # z index 0 = nearest the viewer
    tv = np.exp(-np.cumsum(d, axis=2) * step) / np.exp(-d * step)  # (transmittance before the voxel)
    w = (1 - np.exp(-d * step)) * tv  # each voxel's share of the pixel
    alpha = w.sum(axis=2)
    # sky light: a blurred optical depth upward and sideways (creases between domes get little)
    up = transmit_along(dens, n, 1.0, 0.0, kext)[:, :, ::-1]
    sky = 0.45 * np.exp(-0.5 * up) + 0.55 * np.exp(-0.15 * up)
    side = transmit_along(dens, n, 1.0, -0.15, kext)[:, :, ::-1]  # top, a little from behind
    back = transmit_along(dens, n, 0.55, -1.0, kext)[:, :, ::-1]  # behind and above
    front = transmit_along(dens, n, 0.7, 0.7, kext)[:, :, ::-1]  # above and behind the viewer
    # multiple scattering: a dim, wide second lobe so shadows aren't black
    sunS = np.exp(-side) + 0.45 * np.exp(-0.1 * side)
    sunB = np.exp(-back) + 0.45 * np.exp(-0.1 * back)
    sunF = np.exp(-front) + 0.45 * np.exp(-0.1 * front)
    def img(term):
        v = (w * term).sum(axis=2) / np.maximum(alpha, 1e-4)
        return v.T[::-1]  # (x, y) -> rows top-down
    return img(sky), img(sunS), img(sunB), img(sunF), alpha.T[::-1]


def upscale(a, f):
    """Bilinear resize of a square image to f x f."""
    n = a.shape[0]
    c = (np.arange(f) + 0.5) / f * n - 0.5
    i0 = np.clip(np.floor(c).astype(int), 0, n - 1)
    i1 = np.clip(i0 + 1, 0, n - 1)
    t = np.clip(c - i0, 0, 1)
    rows = a[i0] * (1 - t)[:, None] + a[i1] * t[:, None]
    return rows[:, i0] * (1 - t)[None] + rows[:, i1] * t[None]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--res", type=int, default=96)
    ap.add_argument("--out", default="roblox/assets/clouds")
    a = ap.parse_args()
    rng = np.random.default_rng(a.seed)
    n = a.res
    sheets = {k: np.zeros((F * N, F * N, 4), np.float32) for k in ("amb", "sun_side", "sun_back", "sun_front")}
    prev = np.zeros((F * N, F * N * 2, 3), np.float32)
    for k in range(N * N):
        dens = lobe_density(rng, n)
        sky, sunS, sunB, sunF, al = render(dens, n)
        sky, sunS, sunB, sunF, al = (upscale(x, F) for x in (sky, sunS, sunB, sunF, al))
        al = np.clip(al, 0, 1)
        r, c = divmod(k, N)
        sl = (slice(r * F, (r + 1) * F), slice(c * F, (c + 1) * F))
        amb = np.clip(sky / max(np.percentile(sky[al > 0.5], 98), 1e-3), 0, 1) if (al > 0.5).any() else sky
        for name, term in (("sun_side", sunS), ("sun_back", sunB), ("sun_front", sunF)):
            m = np.clip(term / 1.3, 0, 1) * al
            sheets[name][sl] = np.dstack([np.ones_like(al)] * 3 + [m])
        sheets["amb"][sl] = np.dstack([amb] * 3 + [al])
        # preview: the in-game composite with storm-ish colours
        shadow = np.array([0.36, 0.40, 0.47])
        lit = np.array([1.0, 0.96, 0.88])
        bg = np.array([0.42, 0.47, 0.55])
        for j, name in enumerate(("sun_side", "sun_back")):
            m = sheets[name][sl][..., 3:4]
            col = amb[..., None] * shadow * (1 - m) + lit * m
            out = bg * (1 - al[..., None]) + col * al[..., None]
            x0 = j * F * N + c * F  # (left half side-lit, right half back-lit)
            prev[r * F:(r + 1) * F, x0:x0 + F] = out
        print("lobe", k + 1, "of", N * N, flush=True)
    os.makedirs(a.out, exist_ok=True)
    for name, s in sheets.items():
        write_png(os.path.join(a.out, "lobe_" + name + ".png"), (np.clip(s, 0, 1) * 255 + 0.5).astype(np.uint8))
    write_png(os.path.join(a.out, "lobe_preview.png"),
              np.dstack([(np.clip(prev, 0, 1) * 255 + 0.5).astype(np.uint8), np.full(prev.shape[:2], 255, np.uint8)]))
    print("wrote", a.out)


if __name__ == "__main__":
    main()
