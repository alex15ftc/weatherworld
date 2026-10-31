"""Funnel outline ribbon (2026-10-31): white, alpha 1 across the whole width (the renderer's
UIGradient cuts the funnel's edge across it), along the length full over the middle third and a
linear fade over the outer thirds. Ribbons spaced a third of their length apart overlap so the
cover is near even at every point (no seams, no bands).

    py -3.12 tools/smoke/funnel_ribbon.py  ->  roblox/assets/tornado2/funnel_ribbon.png
"""
import numpy as np
from PIL import Image

W, H = 64, 768
v = (np.arange(H) + 0.5) / H  # 0 top .. 1 bottom
d = np.abs(v - 0.5) * 3  # 0 centre, 1.5 ends
a = np.clip(1.5 - d, 0, 1)
img = np.ones((H, W, 4))
img[..., 3] = a[:, None]
Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGBA").save("roblox/assets/tornado2/funnel_ribbon.png")
print("ok")
