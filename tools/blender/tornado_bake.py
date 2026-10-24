# Bakes the procedural tornado (tz_0037_cone_R.blend: a volume shader on a cube, driven by
# custom properties on the object "TornadoDomain") into flipbook sheets for the game
# (client/TornadoArt). Run headless with the .blend opened and scripts in it NOT run:
#
#   blender --background --factory-startup --disable-autoexec <blend> --python tools/blender/tornado_bake.py -- \
#       --out roblox/assets/tornado/bake --stage mature --light lit --frames 16 --res 512
#
# Stages set the object's properties the way the file's own lifecycle animation does:
#   mature   frame 96 of the file (funnel down, collar and dust formed), tz_loop = 1, and tz_t
#            swept over one period (4): a seamless spin loop.
#   touch    frames 1-64 (the funnel lowering to the ground), one way.
#   rope     frames 128-256 (thinning, leaning, snaking, eroding, lifting), one way.
# Lights: "lit" with the sun behind the viewer, "back" with it behind the tornado.
#
# Writes <stage>_<light>_<n>.png sheets of 2 x 2 frames (2 * res square), n from 1, and a
# <stage>_<light>_preview.png of the first sheet over a grey sky.
import bpy
import math
import os
import sys

import numpy as np
from mathutils import Vector

SUN_ENERGY, SKY_STRENGTH = 6.0, 0.35
LIGHTS = {"lit": (0.35, -0.75, 0.55), "back": (0.25, 0.85, 0.35)}  # toward the sun (camera looks +Y)


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": "roblox/assets/tornado/bake", "stage": "mature", "light": "lit", "frames": 16, "res": 512, "samples": 64, "test": 0}
    for i in range(0, len(argv) - 1, 2):
        k = argv[i].lstrip("-")
        out[k] = type(out[k])(argv[i + 1]) if k in out else argv[i + 1]
    return out


def main():
    a = args()
    sc = bpy.context.scene
    ob = bpy.data.objects["TornadoDomain"]
    sun = bpy.data.objects["Key"]
    sun.rotation_euler = Vector(LIGHTS[a["light"]]).normalized().to_track_quat("Z", "Y").to_euler()
    # The file's sky (0.7) swamps its sun (3): the sun's side would barely show. A storm's light:
    # a stronger sun against a dimmer sky, so lit reads white and backlit dark with a bright rim.
    sun.data.energy = SUN_ENERGY
    bg = sc.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Strength"].default_value = SKY_STRENGTH
    # The file's animation drives the properties; settle them per frame ourselves.
    ob.animation_data_clear()

    def at_file_frame(f):
        """The lifecycle animation's values at a frame of the original file (sampled before clearing)."""
        return CURVES_AT(f)

    sc.render.engine = "CYCLES"
    sc.cycles.samples = a["samples"]
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = a["res"]
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        sc.cycles.device = "GPU"
    except Exception as e:
        print("GPU not used:", e)

    n = a["frames"] if not a["test"] else 1
    frames = []
    for i in range(n):
        u = i / n
        if a["stage"] == "mature":
            props = CURVES_AT(96)
            props["tz_loop"] = 1.0
            props["tz_t"] = 4.0 * u
        elif a["stage"] == "touch":
            props = CURVES_AT(1 + 63 * i / max(1, n - 1))
        else:
            props = CURVES_AT(128 + 128 * i / max(1, n - 1))
        for k, v in props.items():
            ob[k] = v
        ob.update_tag()
        sc.frame_set(sc.frame_current)
        path = os.path.join(WORK, f"f{i:02d}.png")
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(a["res"], a["res"], 4)
        bpy.data.images.remove(img)
        frames.append(px)
        print("FRAME", i, "alpha max", round(float(px[..., 3].max()), 3), {k: round(v, 3) for k, v in props.items() if k in ("tz_t", "tz_tip", "tz_rscale")})

    a["out"] = os.path.abspath(a["out"])
    os.makedirs(a["out"], exist_ok=True)
    r = a["res"]
    sheets = []
    for s in range(0, len(frames), 4):
        sheet = np.zeros((2 * r, 2 * r, 4), dtype=np.float32)
        for k, px in enumerate(frames[s:s + 4]):
            row, col = divmod(k, 2)
            y0 = (1 - row) * r  # Blender rows run bottom-up; the first frame at the top left
            sheet[y0:y0 + r, col * r:(col + 1) * r] = px
        sheets.append(sheet)
    for idx, sheet in enumerate(sheets):
        name = f"{a['stage']}_{a['light']}_{idx + 1}.png" if not a["test"] else f"test_{a['stage']}_{a['light']}.png"
        im = bpy.data.images.new(name, sheet.shape[1], sheet.shape[0], alpha=True)
        im.pixels[:] = sheet.ravel()
        im.filepath_raw = os.path.join(a["out"], name)
        im.file_format = "PNG"
        im.save()
        if idx == 0:
            prev = sheet.copy()
            prev[..., :3] = sheet[..., :3] * sheet[..., 3:4] + np.array([0.45, 0.5, 0.58]) * (1 - sheet[..., 3:4])
            prev[..., 3] = 1
            pim = bpy.data.images.new("prev", sheet.shape[1], sheet.shape[0], alpha=True)
            pim.pixels[:] = prev.ravel()
            pim.filepath_raw = os.path.join(a["out"], name.replace(".png", "_preview.png"))
            pim.file_format = "PNG"
            pim.save()
        print("WROTE", name)
    if len(frames) > 1 and a["stage"] == "mature":
        # Loop check: how far the last frame is from the one after it (the first).
        print("LOOP step last->first", round(float(np.abs(frames[-1] - frames[0]).mean()), 4), "typical step", round(float(np.abs(frames[1] - frames[0]).mean()), 4))


# Sample the file's lifecycle curves once, before any clearing.
def _sample_curves():
    ob = bpy.data.objects["TornadoDomain"]
    ad = ob.animation_data
    fcs = []
    if ad and ad.action:
        fcs = list(getattr(ad.action, "fcurves", []))
        for layer in getattr(ad.action, "layers", []):
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    fcs += list(bag.fcurves)
    curves = {}
    for fc in fcs:
        key = fc.data_path.strip('[]"')
        curves[key] = fc
    table = {f: {k: float(fc.evaluate(f)) for k, fc in curves.items()} for f in range(1, 257)}

    def at(f):
        lo = max(1, min(256, int(math.floor(f))))
        hi = min(256, lo + 1)
        w = f - lo
        return {k: table[lo][k] * (1 - w) + table[hi][k] * w for k in table[lo]}
    return at


CURVES_AT = _sample_curves()
WORK = os.path.join(os.environ.get("CLAUDE_JOB_DIR", "."), "tmp", "bake_frames")
os.makedirs(WORK, exist_ok=True)
main()
