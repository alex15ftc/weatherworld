"""A tube piece with round ends (2026-10-30): crisp sides 0.86 of the frame wide, as sliceFlat,
and elliptical caps top and bottom, so pieces meeting at an angle on a bending rope join inside
the tube (round joins) instead of showing their corners. Alpha only (white); antialiased edge
~0.03 of the width, as sliceFlat's sides.

    py -3.12 tools/smoke/capsule.py   ->  roblox/assets/tornado2/capsule_flat.png (+ _preview)
"""
import numpy as np
from PIL import Image

N = 512
HW = 0.43    # half width (frame units), as sliceFlat's 0.86 wide sides
CAP = 0.22   # cap height (frame units, each end)
EDGE = 0.03  # antialiased edge

y, x = np.mgrid[0:N, 0:N]
u = (x + 0.5) / N - 0.5
v = (y + 0.5) / N - 0.5
# distance outside the stadium, in width units: inside the straight part |u| vs HW; in a cap the
# ellipse (u / HW)^2 + ((|v| - (0.5 - EDGE - CAP)) / CAP)^2 = 1, scaled back to u units
vc = 0.5 - 1.5 * EDGE - CAP
dv = np.maximum(np.abs(v) - vc, 0) / CAP
r = np.sqrt((u / HW) ** 2 + dv ** 2)          # 1 on the outline
d = (r - 1) * HW                               # ~distance outside, frame units
a = np.clip(0.5 - d / EDGE, 0, 1)
a = a * a * (3 - 2 * a)
rgba = np.zeros((N, N, 4), np.uint8)
rgba[..., :3] = 255
rgba[..., 3] = (a * 255 + 0.5).astype(np.uint8)
Image.fromarray(rgba, "RGBA").save("roblox/assets/tornado2/capsule_flat.png")
bg = Image.new("RGBA", (N, N), (110, 110, 110, 255))
bg.alpha_composite(Image.fromarray(rgba, "RGBA"))
bg.convert("RGB").save("roblox/assets/tornado2/capsule_flat_preview.png")
print("ok; alpha along centre:", [round(float(a[i, N // 2]), 2) for i in range(0, N, 32)])
