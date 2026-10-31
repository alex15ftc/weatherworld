"""A smooth, dense cloud puff: soft round body, gently lobed edge, no fine grain (the feathery
puff read as sandpaper, user 2026-10-29). White; alpha carries the shape; a little darker toward
the rim so overlapping puffs read as round lobes. Writes roblox/assets/clouds/smooth_puff.png."""
import numpy as np
from PIL import Image, ImageFilter

N = 512
rng = np.random.default_rng(11)


def fbm(n, octaves, base, rng):
    out = np.zeros((n, n)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        g = base * 2 ** o
        lat = rng.normal(size=(g + 1, g + 1))
        x = np.linspace(0, g, n, endpoint=False)
        i = x.astype(int); f = x - i; f = f * f * (3 - 2 * f)
        a = lat[i][:, i]; b = lat[i + 1][:, i]; c = lat[i][:, i + 1]; d = lat[i + 1][:, i + 1]
        F1, F2 = f[:, None], f[None, :]
        out += amp * ((a * (1 - F2) + c * F2) * (1 - F1) + (b * (1 - F2) + d * F2) * F1)
        tot += amp; amp *= 0.5
    return out / tot


c = (np.arange(N) + 0.5) / N * 2 - 1
X, Y = np.meshgrid(c, c)
r = np.sqrt(X * X + Y * Y)
lobes = fbm(N, 2, 3, rng)  # broad lobing only
edge = 0.68 + 0.07 * lobes
d = (edge - r) / 0.22
a = np.clip(d, 0, 1)
a = a * a * (3 - 2 * a)
a[r > 0.96] = 0
img_a = Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))
alpha = np.asarray(img_a, np.float32) / 255
lum = 1.0 - 0.16 * np.clip(r / 0.7, 0, 1) ** 2
rgb = (np.clip(lum, 0, 1) * 255).astype(np.uint8)
out = np.zeros((N, N, 4), np.uint8)
out[..., 0] = out[..., 1] = out[..., 2] = rgb
out[..., 3] = (alpha * 255).astype(np.uint8)
Image.fromarray(out).save("roblox/assets/clouds/smooth_puff.png")
bg = 0.45
prev = (lum * 0.6)[..., None] * alpha[..., None] + bg * (1 - alpha[..., None])
Image.fromarray((np.repeat(prev, 3, 2) * 255).astype(np.uint8)).save("C:/Users/alex1/.claude/jobs/75ceb608/tmp/smooth_prev.png")
print("ok")
