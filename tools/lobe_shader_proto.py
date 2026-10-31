"""Prototype of the Luau lobe relight shader (numpy). Preview only."""
import sys
import numpy as np
from PIL import Image

FAM = {
    "tower": dict(spheres=(3, 6), sub=14, flat=0.3, flip=False, billow=[(2.2, 0.09), (4.5, 0.035)]),
    "under": dict(spheres=(3, 6), sub=12, flat=0.45, flip=True, billow=[(2.0, 0.08), (4.0, 0.03)]),
    "soft": dict(spheres=(2, 4), sub=6, flat=0.0, flip=False, billow=[(1.6, 0.06)]),
}
R = 128
CELL = 1.3


def spheres(rng, fam):
    lo, hi = fam["spheres"]
    sph = [(rng.uniform(-0.24, 0.24), rng.uniform(-0.14, 0.14), rng.uniform(-0.14, 0.1), rng.uniform(0.2, 0.3))
           for _ in range(rng.integers(lo, hi + 1))]
    base = list(sph)
    for _ in range(fam["sub"]):
        cx, cy, cz, r = base[rng.integers(len(base))]
        d = rng.normal(size=3)
        d[2] = abs(d[2]) * 0.8 + 0.2 * d[2]
        d /= np.linalg.norm(d)
        rs = rng.uniform(0.09, 0.16)
        sph.append((cx + d[0] * r * 0.9, cy + d[1] * r * 0.9, cz + d[2] * r * 0.9, rs))
    return sph


def vnoise(rng, x, y, sc):
    # smooth value noise (bicubic of a random lattice)
    n = 16
    g = rng.normal(size=(n, n))
    u = (x * sc) % n
    v = (y * sc) % n
    i, j = np.floor(u).astype(int), np.floor(v).astype(int)
    fu, fv = u - i, v - j
    fu, fv = fu * fu * (3 - 2 * fu), fv * fv * (3 - 2 * fv)
    a = g[i % n, j % n]; b = g[(i + 1) % n, j % n]; c = g[i % n, (j + 1) % n]; d = g[(i + 1) % n, (j + 1) % n]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv


def blur(a, r):
    k = 2 * r + 1
    p = np.pad(a, r, mode="edge")
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)


def shape(rng, fam):
    """front depth zf, back depth zb (toward the viewer +), on an R x R frame of CELL units"""
    c = ((np.arange(R) + 0.5) / R - 0.5) * CELL
    X, U = np.meshgrid(c, -c)  # x right, U up (row 0 = top)
    zf = np.full(X.shape, -9.0); zb = np.full(X.shape, 9.0)
    for cx, cy, cz, r in spheres(rng, fam):
        if fam["flip"]:
            cz = -cz
        d2 = (X - cx) ** 2 + (U - cz) ** 2
        h = np.sqrt(np.clip(r * r - d2, 0, None))
        hit = d2 < r * r
        # (depth: Blender's y is depth away from the camera; toward the viewer is -y)
        zf = np.where(hit, np.maximum(zf, -cy + h), zf)
        zb = np.where(hit, np.minimum(zb, -cy - h), zb)
    t = np.clip(zf - zb, 0, None)
    # billows: smooth noise moving the front surface
    for sc, amp in fam["billow"]:
        zf = zf + amp * vnoise(rng, X + 5, U + 5, sc * 2) * (t > 0)
    # the flat side where the lobe joins its cloud
    if fam["flat"] > 0:
        cut = (U + 0.36) if not fam["flip"] else (0.36 - U)
        k = np.clip(cut / 0.12, 0, 1)
        zf = np.where(t > 0, zb + (zf - zb) * (0.25 + 0.75 * k), zf)
    t = np.clip(zf - zb, 0, None)
    # rounded joins: smooth the surfaces where the cloud is
    w = blur((t > 0).astype(float), 6) + 1e-6
    zfs = blur(np.where(t > 0, zf, 0), 6) / w
    zbs = blur(np.where(t > 0, zb, 0), 6) / w
    zf = np.where(t > 0, zfs, zf); zb = np.where(t > 0, zbs, zb)
    t = np.clip(zf - zb, 0, None)
    # coverage: soft fringe, broken by noise
    edge = (vnoise(rng, X + 11, U + 3, 9) * 0.05 + vnoise(rng, X + 2, U + 7, 22) * 0.025) * (t > 0)
    cov = np.clip((t + edge - 0.02) / 0.4, 0, 1)
    cov = blur(cov, 6)
    cov = cov * cov * (3 - 2 * cov)
    return zf, zb, t, cov


def relight(zf, zb, t, cov, vs, sigma=22.0, g=0.3):
    """vs: the sun toward the cloud from the viewer (-1 front lit .. 1 back lit)"""
    Lt = -vs
    Lu = np.sqrt(max(0.0, 1 - Lt * Lt))
    px = CELL / R
    # surface normal
    gx = np.gradient(zf, axis=1) / px; gu = -np.gradient(zf, axis=0) / px
    n = np.stack([-gx, -gu, np.ones_like(zf)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    ndl = n[..., 1] * Lu + n[..., 2] * Lt
    # march toward the sun from just under the front surface
    path = np.zeros_like(zf)
    ds = 0.03
    rows, cols = np.indices(zf.shape)
    z0 = zf - 0.03
    zfb, zbb, covb = blur(zf, 4), blur(zb, 4), blur(cov, 4)
    for k in range(1, 21):
        s = k * ds
        qr = np.clip(np.round(rows - s * Lu / px).astype(int), 0, R - 1)
        qz = z0 + s * Lt
        # (soft surfaces: density ramps in over 0.08 units, so shadows have soft edges)
        inside = np.clip((zfb[qr, cols] - qz) / 0.08, 0, 1) * np.clip((qz - zbb[qr, cols]) / 0.08, 0, 1) * covb[qr, cols]
        path += inside * ds
    T = 0.7 * np.exp(-sigma * path) + 0.3 * np.exp(-0.2 * sigma * path)
    def hg(c):
        return (1 - g * g) / (1 + g * g - 2 * g * c) ** 1.5
    phase = hg(-Lt) / hg(0.0)
    surf = 0.55 + 0.45 * np.clip(ndl * 0.5 + 0.5, 0, 1)
    sun = T * phase * surf
    ao = np.clip(1 - 3.0 * (blur(zf * (t > 0), 8) - zf * (t > 0)).clip(0), 0.5, 1)
    sky = ao * (0.75 + 0.25 * np.exp(-4 * blur(t, 4)))
    return 0.4 * sky + 0.6 * sun


def tone(raw, cov, mref=0.9, C=0.5):
    m = cov > 0.5
    mean = raw[m].mean()
    out = mref * (1 + C * (raw - mean) / mean)
    return np.clip(out, 0, 1)


def sheet(fam_name, seed=5):
    rng = np.random.default_rng(seed)
    fam = FAM[fam_name]
    frames = [shape(rng, fam) for _ in range(16)]
    outs = {}
    for name, vs in [("front", -0.85), ("side", 0.0), ("back", 0.85)]:
        img = np.zeros((4 * R, 4 * R, 4))
        raws = [relight(*f, vs) for f in frames]
        allm = np.concatenate([r[f[3] > 0.5] for r, f in zip(raws, frames)])
        mean = allm.mean()
        for i, (f, raw) in enumerate(zip(frames, raws)):
            L = np.clip(0.88 * (1 + 0.7 * (raw - mean) / mean), 0, 1)
            r0, c0 = (i // 4) * R, (i % 4) * R
            img[r0:r0 + R, c0:c0 + R, :3] = L[..., None]
            img[r0:r0 + R, c0:c0 + R, 3] = f[3]
        outs[name] = img
    return outs


def over(img, bg=0.45):
    a = img[..., 3:4]
    return img[..., :3] * a + bg * (1 - a)


if __name__ == "__main__":
    fam = sys.argv[1] if len(sys.argv) > 1 else "tower"
    o = sheet(fam)
    row = np.concatenate([over(o[k]) for k in ("front", "side", "back")], 1)
    old = []
    for k in ("front", "side", "back"):
        a = np.asarray(Image.open(f"roblox/assets/clouds/lobe_{fam}_lit_{k}.png").convert("RGBA").resize((4 * R, 4 * R)), np.float32) / 255
        old.append(over(a))
    row2 = np.concatenate(old, 1)
    Image.fromarray((np.concatenate([row, row2], 0) * 255).astype(np.uint8)).save(f"C:/Users/alex1/.claude/jobs/75ceb608/tmp/relit_{fam}.png")
    print("ok")
