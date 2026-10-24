"""Storm billboard sheets for the storm lab (roblox/src/stormlab, Render/StormCards and Shafts).

Both are 1024 px, 4x4 frames of 256 px, white RGB with the shape in alpha (tinted in game),
like the other *Flat sheets (docs/stormlab/TEXTURE-REVIEW.md, steps 3 and 5).

  curtain   a rain shaft seen from outside: fine low-contrast vertical fibres gathered into a few
            denser strands, soft streaky sides, a soft top (it hangs from the cloud base) and a
            ragged foot that spreads a little at the ground. No hard edge anywhere.
  striation a mesocyclone band (the banded, ribbed updraft base) seen side-on: a wide soft band
            of long horizontal ribs, low contrast, with a firmer top edge and a ragged underside.

  dirtspray   flying dirt: a cluster of fine motion-blurred grains along +x, denser at the head
  debriscloud the tornado's debris cloud: an opaque turbulent dirt mass with a grainy surface and
            an edge torn into streaks along x

  py -3.12 tools/smoke/storm_sheets.py [--seed 5] [--out roblox/assets/clouds] [--only a,b]

Writes curtain_sheet.png, striation_sheet.png and *_preview.png (over a storm-grey background).
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke_flipbook import write_png

F = 256  # frame size
N = 4  # frames per row


def aniso_noise(rng, n, sx, sy, beta=2.6):
    """Periodic FFT noise, stretched: features sx times longer across x than a plain field, sy in y."""
    fx = np.fft.fftfreq(n)[None, :] * sx
    fy = np.fft.fftfreq(n)[:, None] * sy
    f = np.sqrt(fx * fx + fy * fy)
    f[0, 0] = 1
    spec = (rng.normal(size=(n, n)) + 1j * rng.normal(size=(n, n))) / f ** (beta / 2)
    spec[0, 0] = 0
    z = np.real(np.fft.ifft2(spec))
    return (z - z.mean()) / z.std()


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def curtain(rng):
    u = (np.arange(F) + 0.5) / F
    X, Y = np.meshgrid(u, u)  # Y = 0 at the top of the frame
    # fibres: long down, fine across; strands: wider across, long down
    fib = aniso_noise(rng, F, 0.08, 1.0)  # (stretched: features long in y)
    strands = aniso_noise(rng, F, 0.25, 4.0, beta=3.0)
    # sides: the half-width wanders down the curtain (streaky, not a straight edge)
    wobble = aniso_noise(rng, F, 0.15, 3.0, beta=3.2)[:, :1]  # one value per row
    half = 0.36 + 0.035 * wobble + 0.08 * smooth(0.7, 1.0, Y)  # wider at the foot (spreading)
    cx = 0.5 + 0.03 * aniso_noise(rng, F, 0.15, 3.0, beta=3.4)[:, :1]
    side = 1 - smooth(half * 0.55, half, np.abs(X - cx) + 0.025 * fib)
    # top: fades up into the cloud base; foot: ragged, densest just above the ground
    top = smooth(0.0, 0.22, Y + 0.03 * strands)
    foot = 1 - smooth(0.86, 1.0, Y + 0.02 * strands + 0.02 * wobble)  # (a soft, feathered foot)
    body = 0.78 + 0.22 * smooth(0.3, 0.9, Y)  # (more rain in the lower part of the column)
    tex = 0.8 + 0.12 * np.tanh(fib * 0.8) + 0.1 * np.tanh(strands)
    return np.clip(side * top * foot * body * tex, 0, 1)


def striation(rng):
    u = (np.arange(F) + 0.5) / F
    X, Y = np.meshgrid(u, u)
    ribs = aniso_noise(rng, F, 1.0, 0.06)  # long across, thin up and down
    lumps = aniso_noise(rng, F, 1.0, 0.3, beta=3.0)
    # the band: a lens, thick in the middle and tapering to soft ends, with a firmer top edge
    # and a soft ragged underside
    q = (2 * np.abs(X - 0.5)) ** 2
    top = smooth(0.25 + 0.14 * q, 0.32 + 0.14 * q, Y + 0.02 * lumps)
    under = 1 - smooth(0.6 - 0.12 * q, 0.76 - 0.12 * q, Y - 0.05 * lumps)
    ends = 1 - smooth(0.3, 0.44, np.abs(X - 0.5) + 0.03 * lumps)
    # ribs: low-contrast light and dark bands, plus a few deeper grooves
    band = 0.78 + 0.13 * np.tanh(ribs) + 0.09 * np.sin(Y * np.pi * 9 + 1.2 * lumps)
    return np.clip(top * under * ends * band, 0, 1)


def dirtspray(rng):
    """Flying dirt: a cluster of fine grains motion-blurred along +x (the card is turned to the
    grain's screen velocity in game), denser toward the head, with a faint dusty haze."""
    u = (np.arange(F) + 0.5) / F
    X, Y = np.meshgrid(u, u)
    a = np.zeros((F, F))
    n = rng.integers(70, 130)
    for _ in range(n):
        # grains: along x anywhere in the cluster, across y gathered to the middle
        cx = rng.uniform(0.12, 0.88)
        cy = 0.5 + rng.normal(0, 0.07)
        L = rng.uniform(0.03, 0.16)  # motion-blur length (frame units)
        wdt = rng.uniform(0.004, 0.014)
        # a streak: a tapered capsule (fades toward its tail, -x)
        t = np.clip((X - (cx - L)) / L, 0, 1)
        along = (X > cx - L) & (X < cx + wdt * 2)
        g = np.exp(-((Y - cy) / wdt) ** 2) * along * (0.25 + 0.75 * t)
        a = np.maximum(a, g * rng.uniform(0.55, 1.0))
    # haze: the finest dust between the grains, long in x
    haze = aniso_noise(rng, F, 1.0, 0.15, beta=3.0)  # (long in x)
    env = np.exp(-((Y - 0.5) / 0.14) ** 2) * smooth(0.02, 0.25, X) * (1 - smooth(0.75, 0.98, X))
    a = np.clip(0.8 * a + 0.32 * env * (0.6 + 0.4 * np.tanh(haze)), 0, 1)
    return a


def debriscloud(rng):
    """The dense debris cloud: a turbulent mass of dirt, opaque inside, with a grainy surface and
    an edge torn into streaks along x (the swirl; the card is turned to the flow in game)."""
    u = (np.arange(F) + 0.5) / F
    X, Y = np.meshgrid(u, u)
    big = aniso_noise(rng, F, 1.0, 1.0, beta=3.2)
    streak = aniso_noise(rng, F, 1.0, 0.1, beta=2.6)  # (long in x: torn along the swirl)
    grain = rng.normal(size=(F, F))
    r = np.sqrt(((X - 0.5) / 0.42) ** 2 + ((Y - 0.5) / 0.3) ** 2)
    edge = r + 0.12 * big + 0.22 * np.tanh(streak) * smooth(0.4, 0.9, r)
    body = 1 - smooth(0.55, 1.0, edge)
    tex = 0.82 + 0.1 * np.tanh(streak) + 0.08 * np.clip(grain, -2, 2) / 2
    return np.clip(body * tex, 0, 1)


def dirtgrain(rng):
    """Dirt thrown up at a tornado's foot: a dense core of fine grains thinning to a broken,
    speckled edge (sand and soil seen as a spray, not a smooth puff), slightly flattened."""
    u = (np.arange(F) + 0.5) / F
    X, Y = np.meshgrid(u, u)
    big = aniso_noise(rng, F, 1.0, 1.0, beta=3.0)
    mid = aniso_noise(rng, F, 1.0, 1.0, beta=2.2)
    r = np.sqrt(((X - 0.5) / 0.42) ** 2 + ((Y - 0.55) / 0.36) ** 2)
    edge = r + 0.18 * big + 0.08 * mid
    core = 1 - smooth(0.25, 1.0, edge)
    # grains: speckle whose density follows the core (dense inside, sparse at the edge)
    speck = rng.random((F, F))
    grains = (speck < 0.15 + 0.85 * core).astype(float)
    # blur the speckle a touch so grains read at a distance
    k = np.array([0.25, 0.5, 0.25])
    for ax in (0, 1):
        grains = np.apply_along_axis(lambda v: np.convolve(np.pad(v, 1, mode="wrap"), k, "valid"), ax, grains)
    a = core ** 1.3 * (0.55 + 0.45 * grains) + 0.25 * core * np.clip(mid, 0, 2) / 2
    return np.clip(a * (1 - smooth(0.85, 1.05, r)), 0, 1)


def fractus(rng):
    """Scud (fractus): a ragged tuft with a denser core and torn, fibrous ends pulled out to the
    sides and down, as low cloud fragments under a storm base."""
    u = (np.arange(F) + 0.5) / F
    X, Y = np.meshgrid(u, u)
    big = aniso_noise(rng, F, 1.0, 1.0, beta=3.2)
    fib = aniso_noise(rng, F, 1.0, 0.25, beta=2.4)  # fibres long in x
    tear = aniso_noise(rng, F, 0.6, 1.0, beta=2.0)
    # an irregular body, wider than tall, the lower edge more torn
    r = np.sqrt(((X - 0.5) / 0.38) ** 2 + ((Y - 0.48) / 0.24) ** 2)
    edge = r + 0.3 * big + 0.25 * np.tanh(fib) * smooth(0.5, 1.0, r) + 0.15 * np.tanh(tear) * smooth(0.45, 0.75, Y)
    body = 1 - smooth(0.45, 1.0, edge)
    tex = 0.75 + 0.15 * np.tanh(big) + 0.1 * np.tanh(fib)
    # (nothing reaches the frame's edge: no cut lines in game)
    win = (1 - smooth(0.36, 0.47, np.abs(X - 0.5))) * (1 - smooth(0.36, 0.47, np.abs(Y - 0.5)))
    return np.clip(body * tex * win, 0, 1)


def sheet(fn, rng):
    a = np.zeros((F * N, F * N))
    for i in range(N * N):
        r, c = divmod(i, N)
        a[r * F:(r + 1) * F, c * F:(c + 1) * F] = fn(rng)
    return a


def save(alpha, path):
    n = alpha.shape[0]
    img = np.zeros((n, n, 4), np.uint8)
    img[..., :3] = 255
    img[..., 3] = np.round(alpha * 255).astype(np.uint8)
    write_png(path, img)


def preview(alpha, path, grey=(70, 76, 86), tint=(150, 158, 170)):
    n = alpha.shape[0]
    a = alpha[..., None]
    rgb = np.array(grey, float)[None, None, :] * (1 - a) + np.array(tint, float)[None, None, :] * a
    img = np.zeros((n, n, 4), np.uint8)
    img[..., :3] = np.round(rgb).astype(np.uint8)
    img[..., 3] = 255
    write_png(path, img)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--out", default="roblox/assets/clouds")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rng = np.random.default_rng(a.seed)
    only = set(sys.argv[sys.argv.index("--only") + 1].split(",")) if "--only" in sys.argv else None
    for name, fn in (("curtain", curtain), ("striation", striation), ("dirtspray", dirtspray), ("debriscloud", debriscloud),
                     ("dirtgrain", dirtgrain), ("fractus", fractus)):
        if only and name not in only:
            continue
        al = sheet(fn, rng)
        save(al, os.path.join(a.out, f"{name}_sheet.png"))
        preview(al, os.path.join(a.out, f"{name}_sheet_preview.png"))
        print(name, "mean alpha %.2f" % al.mean())
