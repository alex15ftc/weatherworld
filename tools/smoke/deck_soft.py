"""Soft disc for the overhead deck when every disc is soft (LabConfig.DECK.solid false, 2026-10-31):
white, alpha 1 out to 0.20 of the frame then a smoothstep fall to 0 by 0.48, perfectly round.

Picked by modelling the coverage of overlapping discs on BaseDeck's hex grid (spacing 0.60 of the
disc, on the grid): this profile adds up to the flattest layer (coverage 0.68-0.73 for a 0.7
mean; deck_edge's 0.30-0.48 fall at spacing 0.70 gave 0.60-0.80, a pattern of darker spots where
three discs overlap, seen from below). No billowed outline: it breaks the even sum.

    py -3.12 tools/smoke/deck_soft.py -> roblox/assets/tornado2/deck_soft.png
"""
import numpy as np
from PIL import Image

N = 512
y, x = np.mgrid[0:N, 0:N]
u, v = (x + 0.5) / N - 0.5, (y + 0.5) / N - 0.5
r = np.sqrt(u * u + v * v)
t = np.clip((r - 0.20) / 0.28, 0, 1)
a = 1 - t * t * (3 - 2 * t)
img = np.zeros((N, N, 4), np.uint8)
img[..., :3] = 255
img[..., 3] = (a * 255 + 0.5).astype(np.uint8)
Image.fromarray(img, "RGBA").save("roblox/assets/tornado2/deck_soft.png")
print("mean alpha", a.mean().round(3), "corner", a[0, 0])
