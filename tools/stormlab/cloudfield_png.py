"""Turn tools/stormlab/cloudfield_view.luau output into PNGs (and one contact sheet).
usage: python cloudfield_png.py out.txt prefix
"""
import sys
from PIL import Image

src, prefix = sys.argv[1], sys.argv[2]
imgs = []
cur = None
for line in open(src, encoding="utf-8"):
    line = line.rstrip("\n")
    if line.startswith("#"):
        print(line)
        continue
    if line.startswith("IMG "):
        _, name, w, h = line.split()
        cur = (name, int(w), int(h), [])
        imgs.append(cur)
        continue
    if cur is not None and line:
        cur[3].append(line)

out = []
for name, w, h, rows in imgs:
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y, row in enumerate(rows[:h]):
        for x in range(min(w, len(row) // 6)):
            px[x, y] = tuple(int(row[6 * x + k * 2: 6 * x + k * 2 + 2], 16) for k in range(3))
    if name == "slice":
        im = im.resize((w * 2, h * 2), Image.NEAREST)
    else:
        im = im.resize((w * 2, h * 2), Image.LANCZOS)
    im.save(f"{prefix}_{name}.png")
    out.append(im)

views = [im for (n, *_), im in zip(imgs, out) if n != "slice"]
if views:
    W, H = views[0].size
    cols = 3
    rows = (len(views) + cols - 1) // cols
    sheet = Image.new("RGB", (W * cols, H * rows), (0, 0, 0))
    for i, im in enumerate(views):
        sheet.paste(im, ((i % cols) * W, (i // cols) * H))
    sheet.save(f"{prefix}_sheet.png")
print("wrote", len(out), "images")
