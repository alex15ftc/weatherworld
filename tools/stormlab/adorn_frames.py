"""Cut single frames out of the lobe sheets for ImageHandleAdornment cards (2026-10-29).

Adornments show a whole image (no ImageRect), so each frame is its own upload. Four frames a
sheet (main 4x4 sheets: frames 0, 5, 10, 15; near 2x2 sheets: all four), each padded with a
transparent border (adornments bleed opposite edges into each other, devforum 4015327).
Writes roblox/assets/clouds/adorn/<fam>_<pass>_<i>.png (main 272 px: 256 + 8 px border each side; near 544 px).
"""
import os
from PIL import Image

SRC = "roblox/assets/clouds"
OUT = os.path.join(SRC, "adorn")
FAMS = {
    "tower": ["front", "side", "back"], "tower_near": ["front", "side", "back"],
    "under": ["front", "side", "back", "amb"], "under_near": ["front", "side", "back", "amb"],
    "soft": ["front", "side", "back"],
}
PAD = 8

os.makedirs(OUT, exist_ok=True)
for fam, passes in FAMS.items():
    near = fam.endswith("_near")
    for p in passes:
        name = f"lobe_{fam}_amb.png" if p == "amb" else f"lobe_{fam}_lit_{p}.png"
        sheet = Image.open(os.path.join(SRC, name)).convert("RGBA")
        fs = 512 if near else 256
        per = 2 if near else 4
        frames = [0, 1, 2, 3] if near else [0, 5, 10, 15]
        for i, fr in enumerate(frames):
            x, y = (fr % per) * fs, (fr // per) * fs
            f = sheet.crop((x, y, x + fs, y + fs))
            pad = PAD * fs // 256
            out = Image.new("RGBA", (fs + 2 * pad, fs + 2 * pad), (0, 0, 0, 0))
            out.paste(f, (pad, pad))
            out.save(os.path.join(OUT, f"{fam}_{p}_{i}.png"))
print("ok", len(os.listdir(OUT)))
