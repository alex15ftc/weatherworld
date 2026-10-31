"""A dense round cloud puff with a fine feathery rim (the reference wall cloud's sprite).
White, alpha carries the shape; slightly darker toward the rim so overlapping puffs read as
round lobes. Writes roblox/assets/clouds/feather_puff.png (512, transparent border for edge
bleeding) and a preview on grey."""
import numpy as np
from PIL import Image

N = 512
rng = np.random.default_rng(7)


def fbm(n, octaves, base, rng):
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        g = base * 2 ** o
        lat = rng.normal(size=(g + 1, g + 1))
        x = np.linspace(0, g, n, endpoint=False)
        i = x.astype(int); f = x - i; f = f * f * (3 - 2 * f)
        a = lat[i][:, i]; b = lat[i + 1][:, i]; c = lat[i][:, i + 1]; d = lat[i + 1][:, i + 1]
        F1, F2 = f[:, None], f[None, :]
        out += amp * ((a * (1 - F2) + c * F2) * (1 - F1) + (b * (1 - F2) + d * F2) * F1)
        tot += amp; amp *= 0.55
    return out / tot


c = (np.arange(N) + 0.5) / N * 2 - 1
X, Y = np.meshgrid(c, c)
r = np.sqrt(X * X + Y * Y)
ang = np.arctan2(Y, X)
# edge: a round body (radius ~0.72) whose rim is pushed in and out by fine noise; wisps are the
# fine octaves only showing near the rim
coarse = fbm(N, 3, 3, rng)
fine = fbm(N, 4, 24, rng)
edge = 0.70 + 0.05 * coarse + 0.07 * fine
d = (edge - r) / 0.16  # >0 inside
body = np.clip(d, 0, 1)
body = body * body * (3 - 2 * body)
# a faint fibrous halo just outside the rim
halo = np.clip((edge + 0.12 - r) / 0.14, 0, 1) ** 1.5 * np.clip(0.45 + 2.2 * fine, 0, 1) * 0.6
alpha = np.clip(np.maximum(body, halo), 0, 1)
# keep a 6 px clear border (ImageHandleAdornment / billboard edge bleeding)
alpha[r > 0.97] = 0
lum = 1.0 - 0.14 * np.clip(r / 0.72, 0, 1) ** 2 + 0.03 * coarse
rgb = np.clip(lum, 0, 1)
img = np.zeros((N, N, 4), np.uint8)
img[..., 0] = img[..., 1] = img[..., 2] = (rgb * 255).astype(np.uint8)
img[..., 3] = (alpha * 255).astype(np.uint8)
Image.fromarray(img).save("roblox/assets/clouds/feather_puff.png")
bg = np.full((N, N, 3), 0.45)
a = alpha[..., None]
prev = rgb[..., None] * 0.6 * a + bg * (1 - a)
Image.fromarray((prev * 255).astype(np.uint8)).save("C:/Users/alex1/.claude/jobs/75ceb608/tmp/feather_prev.png")
print("ok")
