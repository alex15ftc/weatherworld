"""2x2 sheet of fibrous cloud wisps (512 px frames): a dense middle that frays into streaks along
x at both ends, fine fibres running along x through it (condensation striations). Drawn with the
streaks horizontal; the renderers turn each sprite so its streaks follow the flow on screen.
White; alpha is the shape; faint fibre shading. Writes roblox/assets/clouds/wisp_sheet.png."""
import numpy as np
from PIL import Image, ImageFilter

F = 512


def aniso(rng, n, gx, gy, octaves):
    out = np.zeros((n, n)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        ax, ay = gx * 2 ** o, gy * 2 ** o
        lat = rng.normal(size=(ay + 1, ax + 1))
        xs = np.linspace(0, ax, n, endpoint=False); ys = np.linspace(0, ay, n, endpoint=False)
        ix = xs.astype(int); fx = xs - ix; fx = fx * fx * (3 - 2 * fx)
        iy = ys.astype(int); fy = ys - iy; fy = fy * fy * (3 - 2 * fy)
        a = lat[iy][:, ix]; b = lat[iy][:, ix + 1]; c = lat[iy + 1][:, ix]; d = lat[iy + 1][:, ix + 1]
        FX, FY = fx[None, :], fy[:, None]
        out += amp * ((a * (1 - FX) + b * FX) * (1 - FY) + (c * (1 - FX) + d * FX) * FY)
        tot += amp; amp *= 0.55
    return out / tot


def frame(seed):
    rng = np.random.default_rng(seed)
    c = (np.arange(F) + 0.5) / F * 2 - 1
    X, Y = np.meshgrid(c, c)
    fib = 0.35 * aniso(rng, F, 3, 26, 2) + 0.65 * aniso(rng, F, 2, 10, 2)  # medium + broad fibres along x
    broad = aniso(rng, F, 2, 3, 2)         # gentle bends of the body
    Yb = Y + 0.12 * broad                  # the body's centre line wanders a little
    # dense middle: an ellipse 0.8 x 0.42 of the frame, its edge frayed by the fibres
    e = (X / 0.8) ** 2 + (Yb / 0.42) ** 2
    body = np.clip((1.0 - e + 0.35 * fib) / 0.6, 0, 1)
    body = body * body * (3 - 2 * body)
    # streaks: fibres reaching out along x past the body, thinning toward the frame's ends
    along = np.clip(1 - np.abs(X) / 0.95, 0, 1) ** 0.7
    across = np.clip(1 - np.abs(Yb) / 0.5, 0, 1)
    # (soft, broad fibres: thin high-contrast ones read as fur up close, user 2026-10-30)
    streak = np.clip(0.55 + 1.0 * fib, 0, 1) ** 1.5 * along * across * 0.55
    a = np.maximum(body, streak)
    a[np.abs(X) > 0.97] = 0
    a[np.abs(Y) > 0.97] = 0
    a = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4.5)), np.float32) / 255
    lum = 1.0 - 0.12 * np.clip(e, 0, 1.5) + 0.07 * fib
    return np.clip(lum, 0, 1), a


sheet = np.zeros((2 * F, 2 * F, 4), np.uint8)
prev = np.full((2 * F, 2 * F, 3), 0.45)
for i in range(4):
    lum, a = frame(100 + i)
    r0, c0 = (i // 2) * F, (i % 2) * F
    sheet[r0:r0 + F, c0:c0 + F, :3] = (lum[..., None] * 255).astype(np.uint8)
    sheet[r0:r0 + F, c0:c0 + F, 3] = (a * 255).astype(np.uint8)
    prev[r0:r0 + F, c0:c0 + F] = (lum * 0.62)[..., None] * a[..., None] + 0.45 * (1 - a[..., None])
Image.fromarray(sheet).save("roblox/assets/clouds/wisp_sheet.png")
Image.fromarray((prev * 255).astype(np.uint8)).save("C:/Users/alex1/.claude/jobs/75ceb608/tmp/wisp_prev.png")
print("ok")
