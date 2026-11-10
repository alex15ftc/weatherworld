"""A firm-sided haze puff for the tornado body (2026-11-09). The haze puff (tools/haze_puff.py) falls
off slowly in every direction; ~6-8 stacked over each point of the funnel, it drew a funnel with no
outline - "very blurry even in close range", user. The body sprites are stretched along the funnel
(TornadoCards: width across it, height along it), so this one is firm ACROSS (a short smooth edge
at ~0.8 of the width, its place gently lobed along the length) and soft ALONG (a slow fade, no
end): stacked along a rope, no sprite's end shows - the smooth puff's rim drew a rope in rings,
2026-10-31 - while the funnel's sides are a defined edge. One flat white tone, no grain (the game
shades each card across its width).
Writes roblox/assets/tornado2/haze_firm.png (+ _preview.png)."""
import numpy as np
from PIL import Image, ImageFilter

N = 512
rng = np.random.default_rng(31)


def fbm1(n, octaves, base, rng):
    out = np.zeros(n); amp = 1.0; tot = 0.0
    for o in range(octaves):
        g = base * 2 ** o
        lat = rng.normal(size=g + 1)
        x = np.linspace(0, g, n, endpoint=False)
        i = x.astype(int); f = x - i; f = f * f * (3 - 2 * f)
        out += amp * (lat[i] * (1 - f) + lat[i + 1] * f)
        tot += amp; amp *= 0.5
    return out / tot


c = (np.arange(N) + 0.5) / N * 2 - 1
U, V = np.meshgrid(c, c)            # U across (x), V along (y)
# the edge's wobble along the length, each side its own (smoothed: the lattice noise's kinks drew
# pointed notches in the edge)
def soft1(x):
    k = np.exp(-0.5 * (np.arange(-40, 41) / 14) ** 2); k /= k.sum()
    return np.convolve(np.pad(x, 40, mode="edge"), k, mode="valid")
lobeL = soft1(fbm1(N, 2, 2, rng))
lobeR = soft1(fbm1(N, 2, 2, rng))
half = np.where(U < 0, 0.78 + 0.04 * lobeL[:, None], 0.78 + 0.04 * lobeR[:, None])
ramp = 0.1                          # the side edge: ~5% of the width (the haze puff's ~40%)
t = np.clip((half - np.abs(U)) / ramp, 0, 1)
across = t * t * (3 - 2 * t)
along = np.exp(-(V / 0.5) ** 2) * np.clip((0.98 - np.abs(V)) / 0.15, 0, 1)  # no end
a = across * along
alpha = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 255
out = np.full((N, N, 4), 255, np.uint8)
out[..., 3] = (alpha * 255 + 0.5).astype(np.uint8)
Image.fromarray(out).save("roblox/assets/tornado2/haze_firm.png")
bg = Image.new("RGBA", (N, N), (96, 104, 120, 255))
old = Image.open("roblox/assets/tornado2/haze_puff.png").convert("RGBA")
prev = Image.new("RGBA", (2 * N, N))
prev.paste(Image.alpha_composite(bg, old), (0, 0))
prev.paste(Image.alpha_composite(bg, Image.fromarray(out)), (N, 0))
prev.save("roblox/assets/tornado2/haze_firm_preview.png")
print("mean", alpha.mean().round(3), ">0.5", (alpha > 0.5).mean().round(3))
