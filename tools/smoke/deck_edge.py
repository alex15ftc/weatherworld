"""Soft edge disc for the overhead deck (2026-10-30): white, alpha 1 out to 0.3 of the frame
then a smooth fall to 0 by 0.48, with a gently billowed outline. Drawn as a Decal on the
underside of the deck's outermost discs (Render/BaseDeck), so the solid deck ends in a soft
cloud edge instead of a hard scalloped plate.

    py -3.12 tools/smoke/deck_edge.py -> roblox/assets/tornado2/deck_edge.png
"""
import numpy as np
from PIL import Image

N = 512
y, x = np.mgrid[0:N, 0:N]
u, v = (x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5
r = np.sqrt(u * u + v * v)
ang = np.arctan2(v, u)
rng = np.random.default_rng(7)
wob = sum(rng.uniform(0.3, 1) / k * np.cos(k * ang + rng.uniform(0, 6.28)) for k in range(3, 9))
rr = r / (1 + 0.04 * wob)
t = np.clip((rr - 0.3) / 0.18, 0, 1)
a = 1 - t * t * (3 - 2 * t)
img = np.zeros((N, N, 4), np.uint8)
img[..., :3] = 255
img[..., 3] = (a * 255 + 0.5).astype(np.uint8)
Image.fromarray(img, "RGBA").save("roblox/assets/tornado2/deck_edge.png")
print("mean alpha", a.mean().round(3), "corner", a[0, 0])
