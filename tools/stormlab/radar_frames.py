"""Turn render_radar.luau's printed frames into PNG contact sheets (REF row over SRV row).

  py -3.12 tools/stormlab/radar_frames.py frames.txt out_prefix
Writes out_prefix_sheet.png and out_prefix_frames.txt (the frame captions).
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "smoke"))
from smoke_flipbook import write_png


def main():
    src, prefix = sys.argv[1], sys.argv[2]
    frames = []
    cur = None
    mode = None
    rows = []
    with open(src, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if line.startswith("FRAME"):
                cur = {"caption": line[6:], "REF": [], "SRV": []}
                frames.append(cur)
                mode = None
            elif line.startswith("REF ") or line.startswith("SRV "):
                mode = line[:3]
            elif cur is not None and mode and line:
                cur[mode].append(line)
    if not frames:
        print("no frames")
        return
    n = len(frames[0]["REF"])
    pad = 4
    cols = len(frames)
    per_row = min(cols, 7)
    nrows = (cols + per_row - 1) // per_row
    W = per_row * (n + pad) + pad
    H = nrows * (2 * n + 3 * pad) + pad
    img = np.full((H, W, 4), 255, np.uint8)
    img[..., :3] = 30
    for k, fr in enumerate(frames):
        r, c = divmod(k, per_row)
        x0 = pad + c * (n + pad)
        y0 = pad + r * (2 * n + 3 * pad)
        for m, mode in enumerate(("REF", "SRV")):
            for j, row in enumerate(fr[mode]):
                b = bytes.fromhex(row)
                arr = np.frombuffer(b, np.uint8).reshape(-1, 3)
                img[y0 + m * (n + pad) + j, x0:x0 + arr.shape[0], :3] = arr
    write_png(prefix + "_sheet.png", img)
    with open(prefix + "_frames.txt", "w", encoding="utf-8") as f:
        for k, fr in enumerate(frames):
            f.write(f"{k}: {fr['caption']}\n")
    print(f"{len(frames)} frames -> {prefix}_sheet.png")


if __name__ == "__main__":
    main()
