"""Put a Studio capture next to its reference photo (docs/stormlab/SHOTS.md).

    python tools/shot_compare.py <reference.jpg> <capture.png> <out.png> [--crop x,y,w,h]

Both are scaled to the same height, side by side, with a luminance line under each:
mean, p5 / p50 / p95 (0-255), and the share of the top third that is blue sky
(blue clearly above red), the quickest number for "does the storm own the sky".
--crop cuts the capture first (e.g. the game viewport out of a Studio window).
--horizon REF,LAB (fractions of the height, e.g. 0.85,0.58) also prints the same numbers for
the sky part above each image's horizon only: a panorama with a low horizon and a game shot
with half the frame ground differ in mean brightness through framing alone (2026-11-01).
"""
import sys
from PIL import Image, ImageDraw, ImageStat


def stats(im):
    g = im.convert("L")
    h = sorted(g.tobytes())
    n = len(h)
    p = lambda q: h[min(n - 1, int(q * n))]
    top = im.convert("RGB").crop((0, 0, im.width, im.height // 3))
    b = top.tobytes()
    px = [(b[i], b[i + 1], b[i + 2]) for i in range(0, len(b), 3)]
    blue = sum(1 for r, gg, b in px if b > r + 25 and b > 90) / max(1, len(px))
    return "mean %.0f  p5 %d  p50 %d  p95 %d  blue sky (top third) %.0f%%" % (
        ImageStat.Stat(g).mean[0], p(0.05), p(0.5), p(0.95), 100 * blue)


def main():
    args = sys.argv[1:]
    crop = None
    if "--crop" in args:
        i = args.index("--crop")
        crop = tuple(int(v) for v in args[i + 1].split(","))
        del args[i:i + 2]
    horizon = None
    if "--horizon" in args:
        i = args.index("--horizon")
        horizon = tuple(float(v) for v in args[i + 1].split(","))
        del args[i:i + 2]
    ref_path, cap_path, out_path = args
    ref = Image.open(ref_path).convert("RGB")
    cap = Image.open(cap_path).convert("RGB")
    if crop:
        x, y, w, h = crop
        cap = cap.crop((x, y, x + w, y + h))
    H = 540
    ref = ref.resize((round(ref.width * H / ref.height), H))
    cap = cap.resize((round(cap.width * H / cap.height), H))
    out = Image.new("RGB", (ref.width + cap.width + 10, H + 40), "black")
    out.paste(ref, (0, 0))
    out.paste(cap, (ref.width + 10, 0))
    d = ImageDraw.Draw(out)
    d.text((4, H + 4), "REFERENCE  " + stats(ref), fill="white")
    d.text((ref.width + 14, H + 4), "LAB  " + stats(cap), fill="white")
    out.save(out_path)
    print("reference:", stats(ref))
    print("lab:      ", stats(cap))
    if horizon:
        hr, hl = horizon
        print("reference above horizon:", stats(ref.crop((0, 0, ref.width, round(hr * ref.height)))))
        print("lab above horizon:      ", stats(cap.crop((0, 0, cap.width, round(hl * cap.height)))))


if __name__ == "__main__":
    main()
