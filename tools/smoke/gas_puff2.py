"""Detailed gas puffs for the "gas" tornado style (2026-10-30, murk/resolution review): four
separate 1024 px puffs (Roblox caps an image at 1024, so a 2x2 sheet gave only 512 px a puff and
the close funnel looked low-res). Each puff is a soft sum of gaussian billows (smooth, blended -
not cauliflower), its edge frayed by fine multi-octave noise into a wispy fringe, and a gentle
direction-free relief inside (crevices a little darker, billow tops a little brighter: ambient
occlusion from the puff's own thickness). The renderer's per-card gradient does the directional
light; this only adds structure that survives under any light.

    py -3.12 tools/smoke/gas_puff2.py  ->  roblox/assets/tornado2/gas_puff2_{0..3}.png (+ preview)
"""
import numpy as np
from PIL import Image

N = 1024
OUT = "roblox/assets/tornado2/"


def fbm(n, octaves, base, seed, aniso=1.0):
    r = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :] * aniso
    f = np.sqrt(fx * fx + fy * fy)
    for o in range(octaves):
        freq = base * 2 ** o / n
        w = np.exp(-((f / freq) ** 2)) - np.exp(-((f / (0.5 * freq)) ** 2))  # a band
        layer = np.real(np.fft.ifft2(np.fft.fft2(r.standard_normal((n, n))) * w))
        layer /= layer.std() + 1e-9
        out += amp * layer
        tot += amp
        amp *= 0.55
    return out / tot


def blur(a, sigma):
    fy = np.fft.fftfreq(a.shape[0])[:, None]
    fx = np.fft.fftfreq(a.shape[1])[None, :]
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def puff(seed):
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:N, 0:N]
    u = (x + 0.5) / N - 0.5
    v = (y + 0.5) / N - 0.5
    # billows: a big soft core plus ~30 smaller gaussians, smaller toward the rim
    h = 1.0 * np.exp(-((u * u + v * v) / 0.25 ** 2))
    for _ in range(30):
        rr = 0.29 * np.sqrt(rng.random())
        a = rng.random() * 2 * np.pi
        cx, cy = rr * np.cos(a), rr * np.sin(a)
        s = 0.06 + 0.08 * (1 - rr / 0.29) * rng.random() + 0.03
        w = 0.25 + 0.35 * rng.random()
        h += w * np.exp(-(((u - cx) ** 2 + (v - cy) ** 2) / s ** 2))
    h /= h.max()
    # fine fraying at the edge (multi-octave, high frequency), broad gentle variation inside
    hi = fbm(N, 3, 12, seed + 1)
    mid = fbm(N, 3, 6, seed + 2)
    edge = np.clip(1 - h / 0.55, 0, 1)  # 1 at the rim .. 0 in the core
    d = h * (1 + 0.12 * mid) + 0.18 * edge * hi * h ** 0.5
    r = np.sqrt(u * u + v * v)
    d *= np.clip((0.49 - r) / 0.07, 0, 1)  # gone before the frame edge
    d = np.clip(d, 0, None)
    alpha = 1 - np.exp(-3.2 * d ** 1.4)
    # relief: thicker than its surroundings = a billow top (brighter), thinner = a crevice
    ao = d - blur(d, 18)
    ao2 = d - blur(d, 60)
    val = 0.9 + 0.55 * np.clip(ao, -0.15, 0.15) + 0.3 * np.clip(ao2, -0.2, 0.2)
    val += 0.03 * fbm(N, 3, 12, seed + 3)
    return np.clip(alpha, 0, 1), np.clip(val, 0, 1)


previews = []
for k in range(4):
    a, val = puff(300 + 29 * k)
    img = np.zeros((N, N, 4))
    img[..., :3] = val[..., None]
    img[..., 3] = a
    Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA").save(f"{OUT}gas_puff2_{k}.png")
    bg = np.ones((N, N, 3)) * np.array([0.27, 0.31, 0.37])
    tint = np.array([0.78, 0.76, 0.74])
    comp = bg * (1 - a[..., None]) + (val[..., None] * tint) * a[..., None]
    previews.append(comp)
top = np.concatenate(previews[:2], axis=1)
bot = np.concatenate(previews[2:], axis=1)
pv = np.concatenate([top, bot], axis=0)
Image.fromarray((pv * 255).astype(np.uint8)).resize((1024, 1024)).save(f"{OUT}gas_puff2_preview.png")
print("ok")
