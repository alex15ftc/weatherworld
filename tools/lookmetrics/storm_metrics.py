"""Measure how a storm capture looks against a real reference photo, region by region.

    py -3.12 tools/lookmetrics/storm_metrics.py <shot> <capture.png>
    py -3.12 tools/lookmetrics/storm_metrics.py --list

Shots live in tools/lookmetrics/storm_shots.json: the reference photo (docs/storm-reference/...),
and for the reference and for our capture the same named regions as boxes [x0, y0, x1, y1]
(shares of the image): sky, lit (sunlit cloud), shade (cloud in shadow), base (the storm's
underside), and optionally rain, ground. A Studio window capture is cropped to its viewport
(found by the blue border) first.

Per region: mean luminance, colour (R, G, B as shares of their sum, x3), and texture (std of the
high-pass luminance / mean). From these, the look in a few numbers, each against the reference:

  lit/sky     how much brighter the sunlit cloud is than the sky
  shade/lit   how dark the shadowed side is against the lit side
  base/lit    how dark the base is against the lit cloud
  warmth      (R - B) / L of the lit cloud (low sun: warm)
  sky blue    (B - R) / L of the sky
  texture     lit cloud texture

score = mean |log(capture / reference)| over the ratios + |difference| over warmth, sky blue
(0 = the same look; ~0.1 close; > 0.4 clearly different). Writes a side-by-side sheet with the
boxes and the numbers to tools/lookmetrics/out/storm_<shot>_<capture>.png and appends to
tools/lookmetrics/out/storm_log.jsonl.
"""
import argparse
import datetime
import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(HERE, "out")
REF_DIR = os.path.join(ROOT, "docs", "storm-reference")


def viewport(im):
    """A Studio window capture cropped to the game viewport (inside its blue border)."""
    a = np.asarray(im.convert("RGB")).astype(int)
    h, w, _ = a.shape
    blue = (a[..., 2] > 200) & (a[..., 0] < 90) & (a[..., 1] > 80) & (a[..., 1] < 160)
    row = blue[int(h * 0.45)]
    xs = np.where(row)[0]
    col_x = None
    if len(xs) >= 2 and xs[-1] - xs[0] > w * 0.3:
        x0, x1 = xs[0], xs[-1]
        col = blue[:, int((x0 + x1) / 2)]
        ys = np.where(col)[0]
        if len(ys) >= 2 and ys[-1] - ys[0] > h * 0.3:
            return im.crop((x0 + 3, ys[0] + 3, x1 - 2, ys[-1] - 2))
    return im  # not a window capture (or no border): as it is


def luminance(a):
    a = a.astype(np.float64) / 255.0
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def region_stats(im, box):
    w, h = im.size
    x0, y0, x1, y1 = [int(round(v)) for v in (box[0] * w, box[1] * h, box[2] * w, box[3] * h)]
    a = np.asarray(im.convert("RGB").crop((x0, y0, x1, y1)))
    L = luminance(a)
    rgb = a.reshape(-1, 3).astype(np.float64).mean(axis=0) / 255.0
    s = rgb.sum() + 1e-6
    blur = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))).astype(np.float64) / 255.0
    tex = float((L - blur).std() / max(L.mean(), 1e-3))
    return {"L": float(L.mean()), "rgb": [float(v) for v in rgb], "chroma": [float(v / s * 3) for v in rgb], "texture": tex}


def find_horizon(im):
    """Share of the height where the ground starts (scanning up from the bottom while rows look
    like ground: greenish or dark, not blue)."""
    a = np.asarray(im.convert("RGB")).astype(np.float64) / 255.0
    h = a.shape[0]
    y = h - 1
    while y > h * 0.2:
        r, g, b = a[y].mean(axis=0)
        L = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if b - r > 0.06 and L > 0.3:  # sky reached
            break
        if not (g >= b - 0.03 or L < 0.2):
            break
        y -= 1
    return (y + 1) / h


def auto_stats(im, horizon=None, skip_top_left=True):
    """Regions found from the image: sky = blue pixels above the horizon, cloud = the rest above
    it; lit / shade / base = the cloud's brightest 15%, its 25-45% band, its darkest 15%."""
    a = np.asarray(im.convert("RGB")).astype(np.float64) / 255.0
    h, w, _ = a.shape
    hz = horizon if horizon is not None else find_horizon(im)
    top = a[: max(int(h * hz) - 2, 1)]
    L = 0.2126 * top[..., 0] + 0.7152 * top[..., 1] + 0.0722 * top[..., 2]
    blueness = (top[..., 2] - top[..., 0]) / (L + 0.05)
    sky = blueness > 0.2
    if skip_top_left:  # Roblox's menu buttons
        sky[: int(h * 0.1), : int(w * 0.18)] = False
    cloud = ~sky
    if skip_top_left:
        cloud[: int(h * 0.1), : int(w * 0.18)] = False
    blur = np.asarray(Image.fromarray((np.clip(L, 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))).astype(np.float64) / 255.0
    hp = L - blur

    def stats_of(mask):
        if mask.sum() < 50:
            return None
        rgb = top[mask].mean(axis=0)
        return {"L": float(L[mask].mean()), "rgb": [float(v) for v in rgb], "texture": float(hp[mask].std() / max(L[mask].mean(), 1e-3))}

    out = {}
    if sky.sum() > 50:
        out["sky"] = stats_of(sky)
    if cloud.sum() > 50:
        cl = L[cloud]
        p15, p25, p45, p85 = np.percentile(cl, [15, 25, 45, 85])
        out["lit"] = stats_of(cloud & (L >= p85))
        out["shade"] = stats_of(cloud & (L >= p25) & (L <= p45))
        out["base"] = stats_of(cloud & (L <= p15))
        out["cloud"] = stats_of(cloud)
    out = {k: v for k, v in out.items() if v}
    out["_cover"] = float(cloud.sum() / cloud.size)
    out["_horizon"] = hz
    return out


def look(stats):
    out = {}
    if "lit" in stats and "sky" in stats:
        out["lit/sky"] = stats["lit"]["L"] / max(stats["sky"]["L"], 1e-3)
    if "shade" in stats and "lit" in stats:
        out["shade/lit"] = stats["shade"]["L"] / max(stats["lit"]["L"], 1e-3)
    if "base" in stats and "lit" in stats:
        out["base/lit"] = stats["base"]["L"] / max(stats["lit"]["L"], 1e-3)
    if "rain" in stats and "lit" in stats:
        out["rain/lit"] = stats["rain"]["L"] / max(stats["lit"]["L"], 1e-3)
    if "lit" in stats:
        r, g, b = stats["lit"]["rgb"]
        out["warmth"] = (r - b) / max(stats["lit"]["L"], 1e-3)
        out["texture"] = stats["lit"]["texture"]
    if "sky" in stats:
        r, g, b = stats["sky"]["rgb"]
        out["sky blue"] = (b - r) / max(stats["sky"]["L"], 1e-3)
    if "cloud" in stats:
        out["texture"] = stats["cloud"]["texture"]
    # the scene's overall exposure (an adapted eye, or the photographer's)
    out["exposure"] = float(np.mean([v["L"] for k, v in stats.items() if not k.startswith("_") and isinstance(v, dict)]))
    if "_cover" in stats:
        out["cover"] = max(stats["_cover"], 0.01)  # how much of the view above the horizon is cloud: the framing
    return out


def score(cap, ref, ignore=()):
    parts = []
    for k in ref:
        if k not in cap or k in ignore:
            continue
        if k in ("warmth", "sky blue"):
            parts.append(abs(cap[k] - ref[k]))
        else:
            parts.append(abs(math.log(max(cap[k], 1e-3) / max(ref[k], 1e-3))))
    return float(np.mean(parts)) if parts else float("nan")


def draw_boxes(im, regions, width):
    im = im.convert("RGB").copy()
    d = ImageDraw.Draw(im)
    w, h = im.size
    colours = {"sky": (80, 160, 255), "lit": (255, 220, 60), "shade": (180, 120, 255), "base": (255, 80, 80), "rain": (80, 255, 160), "ground": (160, 160, 160)}
    for name, box in regions.items():
        c = colours.get(name, (255, 255, 255))
        d.rectangle([box[0] * w, box[1] * h, box[2] * w, box[3] * h], outline=c, width=3)
        d.text((box[0] * w + 4, box[1] * h + 2), name, fill=c)
    return im.resize((width, int(h * width / w)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("shot", nargs="?")
    ap.add_argument("capture", nargs="?")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()
    shots = json.load(open(os.path.join(HERE, "storm_shots.json"), encoding="utf-8"))
    if args.list or not args.shot:
        for k, v in shots.items():
            print(f"{k}: {v['what']}")
        return
    shot = shots[args.shot]
    ref_im = Image.open(os.path.join(REF_DIR, shot["reference"]))
    cap_im = viewport(Image.open(args.capture))
    if shot.get("auto"):
        ref_stats = auto_stats(ref_im, shot.get("refHorizon"), skip_top_left=False)
        cap_stats = auto_stats(cap_im, shot.get("capHorizon"))
        shot = dict(shot)
        shot["ref"] = {"sky": [0, 0, 1, ref_stats["_horizon"]]}
        shot["cap"] = {"sky": [0, 0, 1, cap_stats["_horizon"]]}
    else:
        ref_stats = {k: region_stats(ref_im, b) for k, b in shot["ref"].items()}
        cap_stats = {k: region_stats(cap_im, b) for k, b in shot["cap"].items()}
    ref_look, cap_look = look(ref_stats), look(cap_stats)
    sc = score(cap_look, ref_look, shot.get("ignore", ()))
    lines = [f"{args.shot}: score {sc:.3f} (0 = same look)", f"{'':12s} {'capture':>9s} {'ref':>9s}"]
    for k in ref_look:
        if k in cap_look:
            lines.append(f"{k:12s} {cap_look[k]:9.3f} {ref_look[k]:9.3f}")
    for name in [n for n in ref_stats if not n.startswith("_")]:
        if name in cap_stats:
            c, r = cap_stats[name], ref_stats[name]
            lines.append(f"{name:6s} L {c['L']:.2f}/{r['L']:.2f}  rgb {tuple(round(v, 2) for v in c['rgb'])} / {tuple(round(v, 2) for v in r['rgb'])}")
    print("\n".join(lines))
    # sheet
    W = 900
    a = draw_boxes(cap_im, shot["cap"], W)
    b = draw_boxes(ref_im, shot["ref"], W)
    H = max(a.size[1], b.size[1])
    sheet = Image.new("RGB", (2 * W, H + 22 + 16 * len(lines)), (20, 20, 20))
    sheet.paste(a, (0, 22))
    sheet.paste(b, (W, 22))
    d = ImageDraw.Draw(sheet)
    d.text((6, 4), "capture: " + os.path.basename(args.capture), fill=(255, 255, 0))
    d.text((W + 6, 4), "reference: " + shot["reference"], fill=(255, 255, 0))
    for i, line in enumerate(lines):
        d.text((6, H + 26 + 16 * i), line, fill=(230, 230, 230))
    os.makedirs(OUT, exist_ok=True)
    name = f"storm_{args.shot}_{os.path.splitext(os.path.basename(args.capture))[0]}.png"
    sheet.save(os.path.join(OUT, name))
    with open(os.path.join(OUT, "storm_log.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"when": datetime.datetime.now().isoformat(timespec="seconds"), "shot": args.shot, "capture": args.capture, "score": sc, "capture_look": cap_look, "ref_look": ref_look}) + "\n")
    print("sheet:", os.path.join(OUT, name))


if __name__ == "__main__":
    sys.exit(main())
