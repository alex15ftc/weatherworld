"""A soft condensation streak for the tornado's ascending filaments (2026-10-31): flat white, a
gaussian across, tapered ends, a gentle low-frequency swell along its length, no grain.
Writes roblox/assets/tornado2/streak_soft.png (512 x 128; drawn stretched along the flow)."""
import numpy as np
from PIL import Image, ImageFilter

W, H = 512, 128
rng = np.random.default_rng(31)
x = (np.arange(W) + 0.5) / W
y = (np.arange(H) + 0.5) / H * 2 - 1
X, Y = np.meshgrid(x, y)
# a slow swell and a slight drift of the centre line along the length
k = np.arange(1, 4)
ph = rng.uniform(0, 2 * np.pi, (2, 3))
swell = 1 + 0.18 * sum(np.sin(2 * np.pi * kk * X + ph[0, i]) / kk for i, kk in enumerate(k))
drift = 0.08 * sum(np.sin(2 * np.pi * kk * X + ph[1, i]) / kk for i, kk in enumerate(k))
across = np.exp(-((Y - drift) / (0.38 * swell)) ** 2)
along = np.sin(np.pi * X) ** 1.2
a = across * along
a *= np.clip((0.98 - np.abs(Y)) / 0.1, 0, 1)
alpha = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 255
out = np.full((H, W, 4), 255, np.uint8)
out[..., 3] = (alpha * 255).astype(np.uint8)
Image.fromarray(out).save("roblox/assets/tornado2/streak_soft.png")
print("mean", alpha.mean().round(3))
