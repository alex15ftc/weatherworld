"""A soft haze puff for the tornado body (2026-10-31): one flat white tone, alpha falling off slowly
from the middle (no dense disc, no rim), broad gentle lobing only. The smooth cloud puff has a dense
disc and a darker rim; stacked along a rope each puff's end drew an arc - a rope in rings, user.
Writes roblox/assets/tornado2/haze_puff.png."""
import numpy as np
from PIL import Image, ImageFilter

N = 512
rng = np.random.default_rng(23)


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
lobes = fbm(N, 2, 3, rng)
rr = r / (1 + 0.12 * lobes)          # gently lobed radius
a = np.exp(-(rr / 0.42) ** 2)         # slow falloff: no disc, no rim
a *= np.clip((0.97 - r) / 0.12, 0, 1)  # zero at the frame edge
alpha = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(2)), np.float32) / 255
out = np.full((N, N, 4), 255, np.uint8)
out[..., 3] = (alpha * 255).astype(np.uint8)
Image.fromarray(out).save("roblox/assets/tornado2/haze_puff.png")
print("mean", alpha.mean().round(3), ">0.5", (alpha > 0.5).mean().round(3))
