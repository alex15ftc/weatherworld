"""Motion in a funnel, from a burst of frames: the same number for a game capture and a real video.

    py tools/stormlab/motion_probe.py <frames dir or video> --box x,y,w,h --dt 0.5 [--out m.json]

For each pair of frames dt seconds apart, phase correlation of horizontal strips across the funnel
(box: the funnel's visible column) gives each strip's sideways shift (the turning surface, seen
side-on) and vertical shift (rising or sinking cloud). Divided by the box width, the funnel's
apparent turning rate is distance-free: a real clip and a game capture of different sizes and
distances compare directly. Physics' rate for a funnel's surface is V_t(r) / (2 r) (a point on
the near face crosses the width in pi r / V_t; its centre speed over the width).

A video path is unpacked with ffmpeg at 1/dt frames a second first.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image


def frames_from(src, dt, tmp):
    if os.path.isdir(src):
        names = sorted(f for f in os.listdir(src) if f.lower().endswith((".png", ".jpg")))
        return [os.path.join(src, f) for f in names]
    subprocess.run(["ffmpeg", "-v", "error", "-i", src, "-vf", f"fps={1 / dt}", os.path.join(tmp, "f%04d.png")], check=True)
    return sorted(os.path.join(tmp, f) for f in os.listdir(tmp))


def shift(a, b):
    """(dx, dy) of b against a by phase correlation, sub-pixel by a parabola about the peak."""
    a = a - a.mean()
    b = b - b.mean()
    win = np.outer(np.hanning(a.shape[0]), np.hanning(a.shape[1]))
    fa, fb = np.fft.fft2(a * win), np.fft.fft2(b * win)
    r = fb * np.conj(fa)
    r /= np.abs(r) + 1e-9
    c = np.real(np.fft.ifft2(r))
    iy, ix = np.unravel_index(np.argmax(c), c.shape)

    def sub(arr, i, n):
        l, m, rr = arr[(i - 1) % n], arr[i], arr[(i + 1) % n]
        d = l - 2 * m + rr
        return i + (0.5 * (l - rr) / d if abs(d) > 1e-9 else 0)

    sx = sub(c[iy, :], ix, c.shape[1])
    sy = sub(c[:, ix], iy, c.shape[0])
    if sx > c.shape[1] / 2:
        sx -= c.shape[1]
    if sy > c.shape[0] / 2:
        sy -= c.shape[0]
    return sx, sy, float(c.max())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--box", required=True, help="x,y,w,h of the funnel column in the frames")
    ap.add_argument("--dt", type=float, default=0.5)
    ap.add_argument("--strips", type=int, default=4)
    ap.add_argument("--out")
    a = ap.parse_args()
    x, y, w, h = (int(v) for v in a.box.split(","))
    with tempfile.TemporaryDirectory() as tmp:
        paths = frames_from(a.src, a.dt, tmp)
        if len(paths) < 2:
            sys.exit("need at least two frames")
        imgs = [np.asarray(Image.open(p).convert("L"), dtype=np.float64)[y:y + h, x:x + w] for p in paths]
    sh = h // a.strips
    strips = []
    for k in range(a.strips):
        dxs, dys, qs = [], [], []
        for i in range(len(imgs) - 1):
            sa, sb = imgs[i][k * sh:(k + 1) * sh], imgs[i + 1][k * sh:(k + 1) * sh]
            dx, dy, q = shift(sa, sb)
            dxs.append(dx)
            dys.append(dy)
            qs.append(q)
        dxs, dys = np.array(dxs), np.array(dys)
        strips.append({
            "strip": k, "from_top": round((k + 0.5) / a.strips, 2),
            "side_px_s": round(float(np.median(dxs)) / a.dt, 2), "rise_px_s": round(-float(np.median(dys)) / a.dt, 2),
            # the turning rate over the width: |sideways speed| / box width (1/s)
            "turn_per_s": round(abs(float(np.median(dxs))) / a.dt / w, 4),
            "rise_per_s": round(-float(np.median(dys)) / a.dt / w, 4),
            "steady": round(float(np.std(dxs)) / max(abs(float(np.median(dxs))), 0.1), 2),
            "match": round(float(np.median(qs)), 3),
        })
    res = {"src": a.src, "frames": len(imgs), "dt": a.dt, "box": [x, y, w, h], "strips": strips,
           "turn_per_s": round(float(np.median([s["turn_per_s"] for s in strips])), 4),
           "rise_per_s": round(float(np.median([s["rise_per_s"] for s in strips])), 4)}
    txt = json.dumps(res, indent=1)
    if a.out:
        with open(a.out, "w") as f:
            f.write(txt)
    print(txt)


if __name__ == "__main__":
    main()
