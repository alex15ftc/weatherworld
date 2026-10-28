"""Draw tools/stormlab/diag_structure.luau output as PNGs (north up, 60 km square, 10 km grid).

  py -3.12 tools/stormlab/structure_png.py structure.txt out_dir
Per frame: t<min>_ref.png (0.5 deg PPI | CAPPI 1 km | CAPPI 5 km | CAPPI 8 km | composite)
and t<min>_plan.png (composite greyscale + updraft 1 km (green) / 5 km (cyan) contours, anvil ice
(blue tint), cold pool edge (purple), feature markers, motion / anvil arrows).
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

REF = [(-10, .17, .17, .19), (0, .27, .27, .29), (5, .02, .92, .92), (10, 0, .62, .96), (15, 0, 0, .96),
       (20, 0, 1, 0), (25, 0, .78, 0), (30, 0, .56, 0), (35, 1, 1, 0), (40, .91, .75, 0), (45, 1, .56, 0),
       (50, 1, 0, 0), (55, .84, 0, 0), (60, .75, 0, 0), (65, 1, 0, 1), (70, .6, .33, .79), (75, 1, 1, 1)]
S = 4  # pixels per cell
HALF = 30.0


def colour(d):
    if d < 5:
        return (10, 12, 18)
    c = REF[0]
    for e in REF:
        if d >= e[0]:
            c = e
    return tuple(int(v * 255) for v in c[1:])


def ref_img(g, title):
    n = g.shape[0]
    a = np.zeros((n, n, 3), np.uint8)
    for j in range(n):
        for i in range(n):
            a[j, i] = colour(g[j, i])
    im = Image.fromarray(a).resize((n * S, n * S), Image.NEAREST)
    gridlines(im, n)
    ImageDraw.Draw(im).text((4, 4), title, fill=(255, 255, 255))
    return im


def gridlines(im, n):
    d = ImageDraw.Draw(im)
    for k in range(-20, 21, 10):
        p = (k + HALF) / (2 * HALF) * n * S
        d.line([(p, 0), (p, n * S)], fill=(60, 60, 70))
        d.line([(0, p), (n * S, p)], fill=(60, 60, 70))


def to_px(x, y, n):
    return ((x + HALF) / (2 * HALF) * n * S, (HALF - y) / (2 * HALF) * n * S)


def contour_mask(g, level):
    m = g >= level
    e = np.zeros_like(m)
    e[1:-1, 1:-1] = m[1:-1, 1:-1] & ~(m[:-2, 1:-1] & m[2:, 1:-1] & m[1:-1, :-2] & m[1:-1, 2:])
    return e


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    frames, cur, gname, rows = [], None, None, []
    for line in open(src, encoding="utf-8", errors="replace"):
        line = line.strip()
        if line.startswith("FRAME"):
            cur = {"cap": line[6:], "pts": [], "vec": {}, "g": {}}
            frames.append(cur)
            gname = None
        elif line.startswith("PT "):
            _, nm, x, y = line.split()
            cur["pts"].append((nm, float(x), float(y)))
        elif line.startswith("VEC "):
            _, nm, x, y = line.split()
            cur["vec"][nm] = (float(x), float(y))
        elif line.startswith("GRID "):
            gname = line.split()[1]
            cur["g"][gname] = []
        elif gname and line:
            cur["g"][gname].append([float(v) for v in line.split()])
    for f in frames:
        t = f["cap"].split()[0].split("=")[1]
        g = {k: np.array(v) for k, v in f["g"].items()}
        n = g["composite"].shape[0]
        panels = [ref_img(g["ppi05"], "0.5 deg PPI (site SW)"), ref_img(g["cappi1000"], "CAPPI 1 km"),
                  ref_img(g["cappi5000"], "CAPPI 5 km"), ref_img(g["cappi8000"], "CAPPI 8 km"),
                  ref_img(g["composite"], "composite")]
        sheet = Image.new("RGB", (len(panels) * (n * S + 6), n * S + 20), (0, 0, 0))
        for k, p in enumerate(panels):
            dr = ImageDraw.Draw(p)
            for nm, x, y in f["pts"]:
                if nm in ("LLM", "tornado"):
                    px, py = to_px(x, y, n)
                    dr.ellipse([px - 5, py - 5, px + 5, py + 5], outline=(255, 255, 255))
            sheet.paste(p, (k * (n * S + 6), 20))
        ImageDraw.Draw(sheet).text((4, 4), f["cap"] + "   (white ring = low-level meso)", fill=(255, 255, 255))
        sheet.save(os.path.join(out, f"t{t}_ref.png"))
        # plan view
        c = g["composite"]
        base = np.clip((c - 5) / 60, 0, 1) * 150
        a = np.stack([base, base, base], -1)
        ice = np.clip(g["anvilIce"] / 4, 0, 1)
        a[..., 2] = np.maximum(a[..., 2], ice * 170)
        a[..., 0] *= 1 - 0.4 * ice
        a = a.astype(np.uint8)
        for lvl, col in ((50, (0, 255, 0)), (150, (0, 255, 0))):
            a[contour_mask(g["w1km"], lvl)] = col
        for lvl, col in ((100, (0, 220, 255)), (300, (0, 220, 255))):
            a[contour_mask(g["w5km"], lvl)] = col
        a[contour_mask(g["coldpool"], 10)] = (200, 80, 255)
        a[contour_mask(c, 50)] = (255, 60, 60)
        im = Image.fromarray(a).resize((n * S, n * S), Image.NEAREST)
        gridlines(im, n)
        dr = ImageDraw.Draw(im)
        cols = {"updraftBase": (0, 255, 0), "updraft5km": (0, 220, 255), "LLM": (255, 255, 255),
                "midMeso": (255, 255, 0), "FFD": (255, 120, 0), "RFD": (255, 0, 255), "tornado": (255, 0, 0),
                "other": (180, 180, 180), "otherL": (120, 120, 255)}
        for nm, x, y in f["pts"]:
            if nm == "storm":
                continue
            px, py = to_px(x, y, n)
            col = cols.get(nm, (255, 255, 255))
            dr.ellipse([px - 4, py - 4, px + 4, py + 4], outline=col, width=2)
            dr.text((px + 6, py - 6), nm, fill=col)
        cx, cy = to_px(0, 0, n)
        for nm, col, L in (("motion", (255, 255, 255), 60), ("anvil", (120, 170, 255), 90)):
            ux, uy = f["vec"][nm]
            m = (ux * ux + uy * uy) ** 0.5 or 1
            ex, ey = cx + ux / m * L, cy - uy / m * L
            dr.line([(cx, cy), (ex, ey)], fill=col, width=2)
            dr.text((ex + 3, ey), nm, fill=col)
        dr.text((4, 4), "t=" + t + " min  composite(grey) 50dBZ(red) anvil ice>7km(blue)", fill=(255, 255, 255))
        dr.text((4, 16), "w1km 5,15 m/s(green)  w5km 10,30 m/s(cyan)  cold pool 1K(purple)", fill=(255, 255, 255))
        im.save(os.path.join(out, f"t{t}_plan.png"))
        print("wrote", t)


if __name__ == "__main__":
    main()
