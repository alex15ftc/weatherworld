"""Offline mock of a billboard storm tower: the current card shading vs the two-layer lit lobes.

Same card layout for both; only Roblox-possible operations per card (ImageColor3 tint, alpha,
Rotation, a UIGradient-like ramp, stacked ImageLabels). Writes <out>/mock_<dist>km.png with
the current method on the left and the proposed one on the right.

  current   tornado2/body_flat.png (white, shape in alpha), one tint from sun . normal, a ramp
            across the card toward the sun, random rotation (as Render/StormCards today)
  proposed  lobe_amb.png tinted shadow colour + lobe_sun_side.png tinted lit colour on top,
            alpha x sun amount, the card rotated so the frame top faces the sun on screen

  py -3.12 tools/stormlab/card_mock.py --lobes <dir with lobe_*.png> --out <dir> [--dist 18,6]
"""
import argparse
import math
import os

import numpy as np
from PIL import Image

W, H = 900, 640
SUN_GAIN = 1.0  # (the sun masks' weight; StormCards uses the same)
HIER_BIG, HIER_LO, HIER_HI = 1.15, 0.85, 1.05  # (ring card sizes: a gentle mix, as CardPlan)
FRAME = 256


def load(path):
    return np.asarray(Image.open(path).convert("RGBA"), np.float32) / 255.0


def frame(sheet, k):
    r, c = divmod(k % 16, 4)
    return sheet[r * FRAME:(r + 1) * FRAME, c * FRAME:(c + 1) * FRAME]


def tower(rng):
    """Cards (x, y, z, size, nx, ny, nz) in metres: x east, y north (away from camera), z up."""
    cards = []
    base, top = 1500.0, 12500.0
    for z in np.arange(base + 600, top, 450):
        f = (z - base) / (top - base)
        R = 1800 + 900 * math.sin(f * math.pi * 0.9) + (1600 * (f - 0.85) / 0.15 if f > 0.85 else 0)
        n = int(6 + R / 300)
        for i in range(n):
            a = (i + rng.uniform(-0.3, 0.3)) / n * 2 * math.pi
            rr = R * rng.uniform(0.82, 1.05)
            nx, ny = math.cos(a), math.sin(a)
            nz = 0.25 + (0.6 if f > 0.85 else 0)
            m = math.sqrt(nx * nx + ny * ny + nz * nz)
            cards.append((rr * nx, rr * ny, z, R * rng.uniform(0.75, 1.1) * (HIER_BIG if rng.random() < 0.25 else rng.uniform(HIER_LO, HIER_HI)), nx / m, ny / m, nz / m))
        cards.append((0, 0, z, 2 * R, 0, -1, 0))  # (the centre card filling the column)
    # dome
    for i in range(14):
        a = rng.uniform(0, 2 * math.pi)
        rr = rng.uniform(0, 1500)
        cards.append((rr * math.cos(a), rr * math.sin(a), top + rng.uniform(-200, 500), rng.uniform(1300, 2000),
                      0.4 * math.cos(a), 0.4 * math.sin(a), 0.9))
    return cards


def render(cards, sheets, method, cam, sun, rng_seed):
    rng = np.random.default_rng(rng_seed)
    img = np.zeros((H, W, 3), np.float32)
    # sky: blue-grey, lighter at the horizon
    yy = np.linspace(0, 1, H)[:, None]
    img[:] = (np.array([0.42, 0.55, 0.72]) * (1 - yy) + np.array([0.66, 0.72, 0.8]) * yy)[:, None, :][:, 0][:, None, :]
    cx, cy, cz = cam
    # camera looks north (+y), tilted up by `pitch`
    pitch = math.atan2(7000 - cz, -cy)
    fov = math.radians(62)
    fpx = (W / 2) / math.tan(fov / 2)
    cp, sp = math.cos(pitch), math.sin(pitch)
    fwd = np.array([0, cp, sp])
    up = np.array([0, -sp, cp])
    right = np.array([1.0, 0, 0])
    sunv = np.array(sun) / np.linalg.norm(sun)
    # the sun's direction on screen (the frame top is rotated to face it)
    sx, sy = sunv @ right, sunv @ up
    sun_ang = math.degrees(math.atan2(sx, sy))  # clockwise from screen-up
    shadow_col = np.array([0.36, 0.41, 0.50]) if method == "current" else np.array([0.5, 0.56, 0.66])
    lit_col = np.array([1.0, 0.96, 0.88])
    order = sorted(range(len(cards)), key=lambda i: -((cards[i][0] - cx) ** 2 + (cards[i][1] - cy) ** 2 + (cards[i][2] - cz) ** 2))
    for i in order:
        x, y, z, s, nx, ny, nz = cards[i]
        rel = np.array([x - cx, y - cy, z - cz])
        d = rel @ fwd
        if d < 100:
            continue
        u = W / 2 + fpx * (rel @ right) / d
        v = H / 2 - fpx * (rel @ up) / d
        px = int(fpx * s / d)
        if px < 3 or u < -px or u > W + px or v < -px or v > H + px:
            continue
        k = int(rng.integers(16))
        # the storm's own shadow: deeper into the tower away from the sun gets less
        depth = -(x * sunv[0] + y * sunv[1]) / 2500.0
        stormlit = float(np.clip(0.75 - 0.5 * depth + 0.3 * (z > 11000), 0.15, 1))
        facing = max(0.0, 0.25 + 0.75 * (nx * sunv[0] + ny * sunv[1] + nz * sunv[2]))
        sunamt = stormlit * (0.3 + 0.7 * facing)
        if method == "single":
            # one label: the baked grey (light from the frame's top) x the card's colour and ramp,
            # turned to the sun
            vs = float((rel / np.linalg.norm(rel)) @ sunv)
            fr = frame(sheets["front" if vs < -0.33 else ("back" if vs > 0.33 else "side")], k)
            col = shadow_col + (lit_col - shadow_col) * sunamt
            rot = -sun_ang
            def rs1(ch):
                return np.asarray(Image.fromarray((ch * 255).astype(np.uint8)).resize((px, px), Image.BILINEAR).rotate(rot), np.float32) / 255.0
            al = rs1(fr[..., 3])
            grey = rs1(fr[..., 0])
            g = np.linspace(-1, 1, px)
            GX, GY = np.meshgrid(g, -g)
            t = GY  # (the image is turned so its top faces the sun)
            ramp = np.clip(0.88 + 0.12 * t, 0.7, 1.0)
            rgb = col[None, None, :] * (ramp * grey)[..., None]
        elif method == "current":
            fr = frame(sheets["body"], k)
            rot = rng.uniform(0, 360)
            col = shadow_col + (lit_col - shadow_col) * sunamt
            a = Image.fromarray((fr[..., 3] * 255).astype(np.uint8)).resize((px, px), Image.BILINEAR).rotate(rot)
            al = np.asarray(a, np.float32) / 255.0
            # ramp: lit on the sun side, ~0.75 of it at the far edge
            g = np.linspace(-1, 1, px)
            GX, GY = np.meshgrid(g, -g)
            t = (GX * math.sin(math.radians(sun_ang)) + GY * math.cos(math.radians(sun_ang)))  # +1 toward the sun
            ramp = np.clip(0.88 + 0.12 * t, 0.7, 1.0)
            rgb = col[None, None, :] * ramp[..., None]
        else:
            amb = frame(sheets["amb"], k)
            # 6-way style: the sun mask for the sun's angle to the view (front / side / back)
            vs = float((rel / np.linalg.norm(rel)) @ sunv)  # +1: looking toward the sun
            if vs < 0:
                sun_l = frame(sheets["front"], k) * -vs + frame(sheets["sun"], k) * (1 + vs)
            else:
                sun_l = frame(sheets["back"], k) * vs + frame(sheets["sun"], k) * (1 - vs)
            rot = -sun_ang  # PIL rotates counter-clockwise; frame top -> the sun's screen direction
            def rs(ch):
                return np.asarray(Image.fromarray((ch * 255).astype(np.uint8)).resize((px, px), Image.BILINEAR).rotate(rot), np.float32) / 255.0
            al = rs(amb[..., 3])
            grey = rs(amb[..., 0])
            # big-scale light tints the shadow layer too (the sunny side's creases are lit by the
            # cloud around them); the sun layer adds the lit faces on top. As in Roblox: two
            # labels, the sun mask alpha-blended over the amb layer (its alpha carries coverage)
            shade = shadow_col + (lit_col * 0.85 - shadow_col) * 0.8 * sunamt
            rgb = grey[..., None] * shade
            sun_a = np.clip(rs(sun_l[..., 3]), 0, 1) * sunamt * SUN_GAIN
        # haze with distance
        hz = 1 - math.exp(-d / 60000)
        rgb = rgb * (1 - hz) + np.array([0.66, 0.72, 0.8]) * hz
        x0, y0 = int(u - px / 2), int(v - px / 2)
        xa, ya, xb, yb = max(x0, 0), max(y0, 0), min(x0 + px, W), min(y0 + px, H)
        if xa >= xb or ya >= yb:
            continue
        sl = (slice(ya - y0, yb - y0), slice(xa - x0, xb - x0))
        A = al[sl][..., None] * 0.95
        img[ya:yb, xa:xb] = img[ya:yb, xa:xb] * (1 - A) + rgb[sl] * A
        if method == "proposed":
            S = sun_a[sl][..., None] * 0.95
            litc = lit_col * (1 - hz) + np.array([0.66, 0.72, 0.8]) * hz
            img[ya:yb, xa:xb] = img[ya:yb, xa:xb] * (1 - S) + litc * S
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lobes", required=True)
    ap.add_argument("--body", default="roblox/assets/tornado2/body_flat.png")
    ap.add_argument("--out", required=True)
    ap.add_argument("--dist", default="18,6")
    ap.add_argument("--single", action="store_true", help="the one-layer lit sheets (lobe_lit_*)")
    a = ap.parse_args()
    sheets = {
        "body": load(a.body),
        "amb": load(os.path.join(a.lobes, "lobe_amb.png")),
        "sun": load(os.path.join(a.lobes, "lobe_sun_side.png")),
        "front": load(os.path.join(a.lobes, "lobe_sun_front.png")),
        "back": load(os.path.join(a.lobes, "lobe_sun_back.png")),
    }
    if a.single:
        # one-layer sheets: lobe_lit_<pass>.png
        sheets = {"body": sheets["body"], "_mode": "single"}
        for w in ("front", "side", "back"):
            sheets[w] = load(os.path.join(a.lobes, "lobe_lit_%s.png" % w))
    cards = tower(np.random.default_rng(7))
    sun = (-0.75, -0.25, 0.6)  # from the west, a little behind the camera, 37 deg up
    for dk in (float(x) for x in a.dist.split(",")):
        cam = (0, -dk * 1000, 2)
        L = render(cards, sheets, "current", cam, sun, 11)
        R = render(cards, sheets, "single" if "single" in sheets.get("_mode", "") else "proposed", cam, sun, 11)
        both = np.concatenate([L, np.ones((H, 6, 3)), R], axis=1)
        p = os.path.join(a.out, "mock_%gkm.png" % dk)
        Image.fromarray((np.clip(both, 0, 1) * 255).astype(np.uint8)).save(p)
        print("wrote", p)


if __name__ == "__main__":
    main()
