"""Side-by-side sheet: engine (main game) supercell REF/SRV previews vs the lab radar's REF/SRV
(full volume and precipLite).  py -3.12 tools/radar_compare/side_by_side.py"""
from PIL import Image, ImageDraw
import os
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "docs", "radar-compare")
sheet = Image.open(os.path.join(root, "lab_supercell_sheet.png")).convert("RGB")
W = sheet.width
# radar_frames.py lays frames 160 px with a gap; find tiles by scanning
n = 5; gap = (W - n * 160) // (n + 1)
def tile(i, row):
    x = gap + i * (160 + gap); y = gap + row * (160 + gap)
    return sheet.crop((x, y, x + 160, y + 160)).resize((400, 400), Image.NEAREST)
eng_ref = Image.open(os.path.join(root, "engine", "supercell-0.5-reflectivity.png")).convert("RGB").resize((400, 400), Image.LANCZOS)
eng_srv = Image.open(os.path.join(root, "engine", "supercell-0.5-stormRelativeVelocity.png")).convert("RGB").resize((400, 400), Image.LANCZOS)
cols = [("Main game (engine RadarSimulator) 80 km", eng_ref, eng_srv),
        ("Lab, full volume 60 km", tile(1, 0), tile(1, 1)),
        ("Lab, precipLite rebuild 60 km", tile(2, 0), tile(2, 1)),
        ("Lab 2.4 deg full / lite", tile(3, 0), tile(4, 0))]
out = Image.new("RGB", (4 * 410 + 10, 2 * 410 + 40), (20, 20, 24))
d = ImageDraw.Draw(out)
for k, (name, a, b) in enumerate(cols):
    x = 10 + k * 410
    d.text((x, 8), name, fill=(230, 230, 230))
    out.paste(a, (x, 30)); out.paste(b, (x, 440))
d.text((10, 30 + 395), "", fill=(255, 255, 255))
out.save(os.path.join(root, "radar_side_by_side.png"))
print("ok")
