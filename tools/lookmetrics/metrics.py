"""Measure how a tornado capture looks, against a reference, in numbers.

    py -3.12 tools/lookmetrics/metrics.py <shot> <capture.png> [--ref <reference.png>]
    py -3.12 tools/lookmetrics/metrics.py --list

Shots (framing, the funnel's rows and centre, the sky samples) live in
tools/lookmetrics/shots.json. Each row across the funnel is a luminance profile; from it:

  width       funnel width at that row (px, where the contrast with the sky is half the core's)
  edge        edge transition: 10%-90% contrast distance, as a share of the width (Ref1 ~ 0.05)
  inner       how much darker the cloud is just inside the edge than in the middle (Ref1 ~ 0.13)
  contrast    core against sky: (sky - core) / sky (positive = darker than the sky)
  texture     fine detail: std of the high-pass luminance inside the funnel / its mean
  colour      mean RGB of the core and of the sky

Writes a side-by-side sheet (capture | reference) with the numbers to
tools/lookmetrics/out/<shot>_<capture name>.png and appends the numbers to
tools/lookmetrics/out/log.jsonl, so every change leaves a record.
"""
import argparse
import datetime
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")


def luminance(rgb):
    a = rgb.astype(np.float64) / 255.0
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def crossing(profile, level, start, step):
    """First index from `start` going `step` where profile drops below `level`."""
    i = start
    n = len(profile)
    while 0 <= i < n:
        if profile[i] < level:
            # interpolate between i - step and i
            j = i - step
            a, b = profile[j], profile[i]
            t = 0.0 if a == b else (a - level) / (a - b)
            return j + t * step
        i += step
    return None


def measure_row(L, y, cx, sky_l, sky_r, smooth=2):
    row = L[y].copy()
    if smooth > 0:
        k = np.ones(2 * smooth + 1) / (2 * smooth + 1)
        row = np.convolve(row, k, mode="same")
    sky = 0.5 * (row[sky_l[0]:sky_l[1]].mean() + row[sky_r[0]:sky_r[1]].mean())
    core = row[max(cx - 3, 0):cx + 4].mean()
    span = core - sky
    if abs(span) < 0.02:
        return None
    # contrast: 1 in the core, 0 in the sky
    c = (row - sky) / span
    out = {}
    halves = []
    for step in (-1, 1):
        x50 = crossing(c, 0.5, cx, step)
        x10 = crossing(c, 0.1, cx, step)
        x90 = crossing(c, 0.9, cx, step)
        if x50 is None or x10 is None or x90 is None:
            return None
        halves.append((x50, x10, x90))
    (l50, l10, l90), (r50, r10, r90) = halves
    width = r50 - l50
    if width < 8:
        return None
    # the edge ramp, measured against the cloud just inside the edge (not the middle, so shading
    # across the funnel doesn't read as a soft edge): 10%-90% of the step from the sky to the
    # level 8-15% of the width inside
    ramps = []
    for x50, step in ((l50, 1), (r50, -1)):
        a = int(round(x50 + step * 0.08 * width))
        b = int(round(x50 + step * 0.15 * width))
        lo, hi = min(a, b), max(a, b)
        inside = row[lo:hi + 1].mean()
        local = (row - sky) / (inside - sky) if abs(inside - sky) > 0.01 else c
        start = int(round(x50))
        p10 = crossing(local, 0.1, start, -step)
        p90 = crossing(local, 0.9, start, step)
        if p10 is not None and p90 is not None:
            ramps.append(abs(p90 - p10))
    edge = (float(np.mean(ramps)) if ramps else 0.5 * (abs(l10 - l90) + abs(r10 - r90))) / width
    # just inside the edge: between the 50% crossing and 30% of the width in
    inner = []
    for x50, step in ((l50, 1), (r50, -1)):
        a = int(round(x50))
        b = int(round(x50 + step * 0.3 * width))
        lo, hi = min(a, b), max(a, b)
        seg = row[lo:hi + 1]
        if len(seg) == 0:
            continue
        # "darker" relative to the core, in the funnel's own luminance
        inner.append((core - seg.min()) / max(core, 1e-6))
    return {
        "y": int(y),
        "width": float(width),
        "edge": float(edge),
        "inner": float(np.mean(inner)) if inner else 0.0,
        "contrast": float((sky - core) / max(sky, 1e-6)),
        "left": float(l50),
        "right": float(r50),
    }


def measure(path, shot):
    im = Image.open(path).convert("RGB")
    if shot.get("crop"):
        im = im.crop(tuple(shot["crop"]))
    if shot.get("size"):
        im = im.resize(tuple(shot["size"]), Image.LANCZOS)
    rgb = np.asarray(im)
    L = luminance(rgb)
    H, W = L.shape
    rows = []
    y0, y1 = shot["rows"]
    n = shot.get("samples", 12)
    for k in range(n):
        y = int(round((y0 + (y1 - y0) * k / max(n - 1, 1)) * H))
        cx = int(round(np.interp(y / H, [y0, y1], shot["centre"]) * W))
        sl = [int(shot["skyLeft"][0] * W), int(shot["skyLeft"][1] * W)]
        sr = [int(shot["skyRight"][0] * W), int(shot["skyRight"][1] * W)]
        r = measure_row(L, y, cx, sl, sr)
        if r:
            rows.append(r)
    # fine detail inside the funnel (rows' central half)
    blur = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(4))).astype(np.float64) / 255.0
    hp = L - blur
    vals, core_rgb, sky_rgb = [], [], []
    for r in rows:
        a = int(r["left"] + 0.25 * r["width"])
        b = int(r["right"] - 0.25 * r["width"])
        if b > a:
            vals.append(hp[r["y"], a:b])
            core_rgb.append(rgb[r["y"], a:b].reshape(-1, 3).mean(axis=0))
    sl = [int(shot["skyLeft"][0] * W), int(shot["skyLeft"][1] * W)]
    for r in rows:
        sky_rgb.append(rgb[r["y"], sl[0]:sl[1]].reshape(-1, 3).mean(axis=0))
    texture = float(np.concatenate(vals).std() / max(np.mean([L[r["y"]].mean() for r in rows]), 1e-6)) if vals else 0.0
    summary = {
        "rows": len(rows),
        "edge": float(np.median([r["edge"] for r in rows])) if rows else None,
        "inner": float(np.median([r["inner"] for r in rows])) if rows else None,
        "contrast": float(np.median([r["contrast"] for r in rows])) if rows else None,
        "texture": texture,
        "coreRGB": [round(float(v)) for v in np.mean(core_rgb, axis=0)] if core_rgb else None,
        "skyRGB": [round(float(v)) for v in np.mean(sky_rgb, axis=0)] if sky_rgb else None,
        "widthTopBottom": [rows[0]["width"] / W, rows[-1]["width"] / W] if rows else None,
    }
    return im, rows, summary


def annotate(im, rows, title, summary):
    im = im.copy()
    d = ImageDraw.Draw(im)
    for r in rows:
        d.line([(r["left"], r["y"]), (r["right"], r["y"])], fill=(255, 60, 60), width=1)
    text = f"{title}\nedge {fmt(summary['edge'])}  inner {fmt(summary['inner'])}  contrast {fmt(summary['contrast'])}  texture {fmt(summary['texture'], 4)}"
    d.rectangle([0, 0, im.width, 34], fill=(0, 0, 0))
    d.text((6, 3), text, fill=(255, 255, 255))
    return im


def fmt(v, nd=3):
    return "-" if v is None else f"{v:.{nd}f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("shot", nargs="?")
    ap.add_argument("capture", nargs="?")
    ap.add_argument("--ref", help="override the shot's reference image")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--note", default="", help="what changed (goes into the log)")
    args = ap.parse_args()
    shots = json.load(open(os.path.join(HERE, "shots.json"), encoding="utf-8"))
    if args.list or not args.shot:
        for name, s in shots.items():
            print(f"{name:14s} {s.get('what', '')}")
        return
    shot = shots[args.shot]
    root = os.path.abspath(os.path.join(HERE, "..", ".."))
    os.makedirs(OUT, exist_ok=True)
    results = {}
    panels = []
    ref_path = args.ref or (os.path.join(root, shot["reference"]) if shot.get("reference") else None)
    ref_shot = dict(shot, **shot.get("referenceFrame", {}))
    if ref_path:
        im, rows, summ = measure(ref_path, ref_shot)
        results["reference"] = summ
        panels.append(annotate(im, rows, "reference: " + os.path.basename(ref_path), summ))
    if args.capture:
        cap_shot = dict(shot, **shot.get("captureFrame", {}))
        im, rows, summ = measure(args.capture, cap_shot)
        results["capture"] = summ
        panels.insert(0, annotate(im, rows, "ours: " + os.path.basename(args.capture), summ))
    # print
    print(f"{'':10s} {'edge':>7s} {'inner':>7s} {'contrast':>9s} {'texture':>8s}  core RGB        sky RGB")
    for k, s in results.items():
        print(f"{k:10s} {fmt(s['edge']):>7s} {fmt(s['inner']):>7s} {fmt(s['contrast']):>9s} {fmt(s['texture'], 4):>8s}  {s['coreRGB']}  {s['skyRGB']}")
    if "reference" in results and "capture" in results:
        r, c = results["reference"], results["capture"]
        gaps = {}
        for k in ("edge", "inner", "contrast", "texture"):
            if r[k] is not None and c[k] is not None and abs(r[k]) > 1e-6:
                gaps[k] = (c[k] - r[k]) / abs(r[k])
        print("gap vs reference: " + "  ".join(f"{k} {v:+.0%}" for k, v in gaps.items()))
        results["gap"] = gaps
    # sheet
    if panels:
        h = max(p.height for p in panels)
        panels = [p.resize((int(p.width * h / p.height), h)) for p in panels]
        sheet = Image.new("RGB", (sum(p.width for p in panels), h), "black")
        x = 0
        for p in panels:
            sheet.paste(p, (x, 0))
            x += p.width
        name = f"{args.shot}_{os.path.splitext(os.path.basename(args.capture or 'reference'))[0]}.png"
        sheet.save(os.path.join(OUT, name))
        print("sheet: " + os.path.join(OUT, name))
    with open(os.path.join(OUT, "log.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({
            "time": datetime.datetime.now().isoformat(timespec="seconds"),
            "shot": args.shot, "capture": args.capture, "note": args.note, "results": results,
        }) + "\n")


if __name__ == "__main__":
    sys.exit(main())
