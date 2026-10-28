# Lit cloud-lobe sheets for the storm lab's billboard cards (docs/stormlab/CONDENSATION-DETAIL.md).
#
# Roblox has no pixel shaders, so a card's inside shading comes from its texture. Each lobe is a
# small cloud volume (a cluster of spheres -> distance grid, then the cloud kit's Voronoi
# domes-on-domes and wispy fringe in the shader, as tools/blender/cloud_vapor_bake.py) rendered
# with Cycles, with the light always coming from the TOP of the frame. In game the card is
# rotated so the frame's top faces the sun on screen, and two ImageLabels are stacked:
#
#   amb          sky-only pass: grey = diffuse light (dark in the creases), alpha = coverage.
#                Tinted with the card's shadow colour.
#   sun_front    sun-only passes, white with alpha = where sunlight reaches the visible surface
#   sun_side     (normalised to the side pass's sunlit faces, shared by the three so the back
#   sun_back     pass stays a dark body with bright rims). Tinted with the card's lit colour.
#
# Families (16 lobes each):
#   tower   crisp cauliflower, domes facing up and out, a flatter base (towers, billows, tops)
#   under   the same turned over: domes hanging down (the base's underside, the wall cloud)
#   soft    low-contrast rounded lumps with a soft fringe (column interior, distance)
#
# All 16 lobes of a sheet are rendered in ONE frame (4 x 4, ortho). Each row sits deeper than the
# one above (ROW_DEPTH) so a lobe never shadows the one below it: the light comes from above.
#
#   blender --background --factory-startup --python tools/blender/lobe_bake.py -- \
#       [--families tower,under,soft] [--res 1024] [--samples 64] [--near 1] [--out roblox/assets/clouds]
#
# Writes <out>/lobe_<family>_<pass>.png (4 x 4 sheet, res px) and with --near 1 also
# lobe_<family>_near_<pass>.png (2 x 2 sheet of the first four lobes, res px: 512 px frames for
# big near cards), plus lobe_<family>_preview.png (side and back composites over storm grey).
import bpy
import math
import os
import sys
import time

import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CELL = 1.3          # a cell, in lobe units (a lobe is ~1 across)
ROW_DEPTH = 4 * CELL
VOXEL = 0.012
OUT = 0.3  # (the grid holds distances this far outside: the halo must end well inside it)
PASSES = {          # light FROM, relative to the camera: (toward the viewer, up)
    "front": (0.7, 0.7),
    "side": (-0.1, 1.0),
    "back": (-1.0, 0.55),
}
SUN_ENERGY = 8.0
ANISOTROPY = 0.75

# Looks (2026-10-25, second pass): the first bake's domes-on-domes read as cauliflower. The user's
# references (Severity, docs/storm-reference) show big soft volumes with smooth light-to-dark
# gradients and blurry low-contrast lumps, so the lobes are now smooth billows (low-frequency noise
# on a smooth-unioned sphere cluster), thin enough that light soaks in (soft shadows), with a wide
# soft fringe so overlapping cards blend.
#   billow   (scale, amplitude) smooth noise moving the surface (large, soft lumps)
#   bulbs    (cells, height) Voronoi domes (crisp lobes; left empty for the smooth look)
#   out/inn  the density ramp from outside to inside the moved surface (wide = soft edge)
#   blend    smooth-union radius of the sphere cluster (rounded joins)
#   mottle   (scale, amount) noise varying the density all through (a mottled, not plastic, inside)
FAMILIES = {
    "tower": dict(billow=[(2.2, 0.09), (4.5, 0.035)], bulbs=[], out=0.07, inn=0.2,
                  density=36.0, halo=(0.07, 1.0), wisp=(0.3, 9.0), mottle=(5.0, 0.35), flip=False, flat=0.3,
                  spheres=(3, 6), sub=14, blend=0.14),
    "under": dict(billow=[(2.0, 0.08), (4.0, 0.03)], bulbs=[], out=0.08, inn=0.22,
                  density=32.0, halo=(0.07, 1.0), wisp=(0.35, 8.0), mottle=(4.5, 0.35), flip=True, flat=0.45,
                  spheres=(3, 6), sub=12, blend=0.16),
    "soft": dict(billow=[(1.6, 0.06)], bulbs=[], out=0.09, inn=0.26,
                 density=26.0, halo=(0.08, 0.8), wisp=(0.25, 7.0), mottle=(4.0, 0.3), flip=False, flat=0.0,
                 spheres=(2, 4), sub=6, blend=0.18),
}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"families": "tower,under,soft", "res": 1024, "samples": 64, "near": 1, "seed": 5,
           "bounces": 8, "out": os.path.join(ROOT, "roblox", "assets", "clouds"), "only": ""}
    for i in range(0, len(argv) - 1, 2):
        k = argv[i].lstrip("-")
        out[k] = type(out[k])(argv[i + 1]) if k in out else argv[i + 1]
    return out


def raise_priority():
    if os.name == "nt":
        try:
            import ctypes
            k = ctypes.windll.kernel32
            k.SetPriorityClass(k.GetCurrentProcess(), 0x8000)  # above normal (background throttling)
        except Exception:
            pass


# ---------------------------------------------------------------------------------------------
# A lobe's coarse shape: a cluster of spheres as a distance grid (the shader adds the detail)

def lobe_grid(rng, fam, path):
    import openvdb as vdb
    n = int(round(1.3 / VOXEL))
    c = (np.arange(n) + 0.5) * VOXEL - n * VOXEL / 2
    X, Y, Z = np.meshgrid(c, c, c, indexing="ij")  # Blender axes: x right, y depth, z up
    lo, hi = fam["spheres"]
    sph = []
    for _ in range(rng.integers(lo, hi + 1)):
        sph.append((rng.uniform(-0.24, 0.24), rng.uniform(-0.14, 0.14), rng.uniform(-0.14, 0.1), rng.uniform(0.2, 0.3)))
    base = list(sph)
    for _ in range(fam["sub"]):
        cx, cy, cz, r = base[rng.integers(len(base))]
        d = rng.normal(size=3)
        d[2] = abs(d[2]) * 0.8 + 0.2 * d[2]  # mostly up and out
        d /= np.linalg.norm(d)
        rs = rng.uniform(0.09, 0.16)
        sph.append((cx + d[0] * r * 0.9, cy + d[1] * r * 0.9, cz + d[2] * r * 0.9, rs))
    sdf = np.full(X.shape, 9.0, np.float32)
    k = fam.get("blend", 0.0)
    for cx, cy, cz, r in sph:
        d = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2 + (Z - cz) ** 2) - r
        if k > 0:
            # polynomial smooth minimum: the spheres merge with rounded joins, no creases
            h = np.clip(0.5 + 0.5 * (d - sdf) / k, 0.0, 1.0)
            sdf = d * (1 - h) + sdf * h - k * h * (1 - h)
        else:
            sdf = np.minimum(sdf, d)
    if fam["flat"] > 0:
        # a flatter, softer side where the lobe joins the cloud (below for towers)
        sdf = np.maximum(sdf, -(Z + 0.36) * fam["flat"] * 2)
    if fam["flip"]:
        sdf = sdf[:, :, ::-1]
    g = np.clip(OUT - sdf, 0.0, None).astype(np.float32)
    grid = vdb.FloatGrid(0.0)
    grid.transform = vdb.createLinearTransform(VOXEL)
    grid.copyFromArray(np.ascontiguousarray(g), ijk=(-n // 2, -n // 2, -n // 2), tolerance=0.0)
    grid.name = "sdfp"
    vdb.write(path, grids=[grid])


# ---------------------------------------------------------------------------------------------
# Shader (as cloud_vapor_bake.cloud_material, for lobes)

class Graph:
    def __init__(self, tree):
        self.nodes, self.links = tree.nodes, tree.links

    def _in(self, s, v):
        if isinstance(v, (int, float)):
            s.default_value = v
        else:
            self.links.new(v, s)

    def math(self, op, a, b=None):
        n = self.nodes.new("ShaderNodeMath")
        n.operation = op
        self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        return n.outputs[0]

    def add(self, a, b):
        return self.math("ADD", a, b)

    def mul(self, a, b):
        return self.math("MULTIPLY", a, b)

    def sub(self, a, b):
        return self.math("SUBTRACT", a, b)

    def smooth(self, x, a, b):
        n = self.nodes.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        n.inputs["From Min"].default_value = a
        n.inputs["From Max"].default_value = b
        self._in(n.inputs["Value"], x)
        return n.outputs["Result"]

    def vec(self, op, a, b):
        n = self.nodes.new("ShaderNodeVectorMath")
        n.operation = op
        self.links.new(a, n.inputs[0])
        if b is None:
            pass
        elif isinstance(b, tuple):
            n.inputs[1].default_value = b
        elif isinstance(b, float):
            n.inputs["Scale"].default_value = b
        else:
            self.links.new(b, n.inputs[1])
        return n.outputs["Vector"] if op != "LENGTH" else n.outputs["Value"]

    def noise(self, v, scale, detail, rough):
        n = self.nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        self.links.new(v, n.inputs["Vector"])
        return n.outputs["Fac"], n.outputs["Color"]

    def voronoi(self, v, scale, smooth):
        n = self.nodes.new("ShaderNodeTexVoronoi")
        n.feature = "SMOOTH_F1" if smooth > 0 else "F1"
        n.inputs["Scale"].default_value = scale
        n.inputs["Randomness"].default_value = 1.0
        if smooth > 0:
            n.inputs["Smoothness"].default_value = smooth
        self.links.new(v, n.inputs["Vector"])
        return n.outputs["Distance"]


def lobe_material(fam, salt):
    mat = bpy.data.materials.new("lobe%d" % salt)
    g = Graph(mat.node_tree)
    g.nodes.clear()
    p = g.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    p = g.vec("ADD", p, (salt * 3.17, salt * 1.91, salt * 2.53))  # (each lobe its own noise)
    attr = g.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "GEOMETRY"
    attr.attribute_name = "sdfp"
    dist = g.sub(OUT, attr.outputs["Fac"])
    _, wcol = g.noise(p, 3.0, 2.0, 0.5)
    warped = g.vec("ADD", p, g.vec("ADD", g.vec("SCALE", wcol, 0.04), (-0.02, -0.02, -0.02)))
    push = None
    for i, (sc, amp) in enumerate(fam.get("billow", [])):
        f, _ = g.noise(g.vec("ADD", warped, (5.7 * (i + 1), 2.3 * i, 8.9 * i)), sc, 2.0, 0.45)
        b = g.mul(g.sub(f, 0.5), 2 * amp)
        push = b if push is None else g.add(push, b)
    for i, (cells, height) in enumerate(fam["bulbs"]):
        d = g.voronoi(g.vec("ADD", warped, (17.3 * (i + 1), 5.1 * i, 9.7 * i)), cells, 0.25 if i == 0 else 0.0)
        dome = g.math("SQRT", g.math("MAXIMUM", g.sub(0.36, g.mul(d, d)), 0.0))
        b = g.mul(g.sub(g.math("DIVIDE", dome, 0.6), 0.45), height)
        push = b if push is None else g.add(push, b)
    moved = dist if push is None else g.sub(dist, push)
    body = g.smooth(moved, fam["out"], -fam["inn"])
    amt, wsc = fam["wisp"]
    wn, _ = g.noise(g.vec("ADD", warped, (3.3, 7.1, 1.9)), wsc, 3.0, 0.55)
    fringe = g.smooth(moved, -2.0 * fam["inn"], 0.0)
    eaten = g.smooth(wn, 0.3, 0.6)
    dens = g.mul(g.mul(body, g.sub(1.0, g.mul(g.mul(fringe, amt), g.sub(1.0, eaten)))), fam["density"])
    if "mottle" in fam:
        msc, mam = fam["mottle"]
        mn, _ = g.noise(g.vec("ADD", warped, (11.1, 4.4, 6.6)), msc, 3.0, 0.5)
        dens = g.mul(dens, g.add(1.0 - mam, g.mul(g.smooth(mn, 0.3, 0.7), 2 * mam)))
    hw, hd = fam["halo"]
    dens = g.add(dens, g.mul(g.mul(g.smooth(moved, fam["out"] + hw, fam["out"]), g.add(0.3, g.mul(eaten, 0.7))), hd))
    # fade out well inside the cell (never cropped by the frame)
    r = g.vec("LENGTH", g.nodes.new("ShaderNodeTexCoord").outputs["Object"], None)
    dens = g.mul(dens, g.smooth(r, 0.63, 0.56))
    vol = g.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (1, 1, 1, 1)
    vol.inputs["Absorption Color"].default_value = (0, 0, 0, 1)
    vol.inputs["Anisotropy"].default_value = ANISOTROPY
    vol.inputs["Density Attribute"].default_value = ""
    g.links.new(dens, vol.inputs["Density"])
    out = g.nodes.new("ShaderNodeOutputMaterial")
    g.links.new(vol.outputs[0], out.inputs["Volume"])
    return mat


# ---------------------------------------------------------------------------------------------
# Scene: 4 x 4 lobes (or 2 x 2 near), ortho camera along +Y

def setup(a, res):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = a["samples"]
    sc.cycles.use_denoising = True
    sc.cycles.volume_bounces = a["bounces"]
    sc.cycles.max_bounces = max(12, a["bounces"])
    sc.cycles.diffuse_bounces = sc.cycles.glossy_bounces = sc.cycles.transmission_bounces = 0
    sc.cycles.transparent_max_bounces = 8
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type == kind for d in prefs.devices):
                    for d in prefs.devices:
                        d.use = d.type == kind
                    sc.cycles.device = "GPU"
                    print("Cycles on", kind)
                    break
            except Exception:
                continue
    except Exception as e:
        print("GPU not used:", e)
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = SUN_ENERGY
    sun.data.angle = math.radians(1.0)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.clip_start, cam.data.clip_end = 0.1, 200.0
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, sun, cam


def place_lobes(sc, cam, fam, grid, rng, work, tag):
    for ob in list(bpy.data.objects):
        if ob.type == "VOLUME":
            bpy.data.objects.remove(ob)
    for k in range(grid * grid):
        r, c = divmod(k, grid)
        path = os.path.join(work, "%s_%d.vdb" % (tag, k))
        lobe_grid(np.random.default_rng(rng + k * 101), fam, path)
        vd = bpy.data.volumes.new("%s%d" % (tag, k))
        vd.filepath = path
        ob = bpy.data.objects.new("%s%d" % (tag, k), vd)
        ob.location = ((c - (grid - 1) / 2) * CELL, r * ROW_DEPTH, ((grid - 1) / 2 - r) * CELL)
        sc.collection.objects.link(ob)
        vd.materials.append(lobe_material(fam, rng % 997 + k))
    cam.data.ortho_scale = grid * CELL
    cam.location = (0.0, -20.0, 0.0)


def light(sc, sun, which):
    bg = sc.world.node_tree.nodes["Background"]
    if which == "amb":
        sun.hide_render = True
        bg.inputs["Color"].default_value = (1, 1, 1, 1)
        bg.inputs["Strength"].default_value = 1.0
    else:
        sun.hide_render = False
        bg.inputs["Strength"].default_value = 0.0
        toward, up = PASSES[which]
        d = Vector((0.0, -toward, up)).normalized()  # (toward the camera is -Y)
        sun.rotation_euler = d.to_track_quat("Z", "Y").to_euler()


def render(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    w = img.size[0]
    px = np.array(img.pixels[:], dtype=np.float32).reshape(w, w, 4)[::-1]  # rows top-down
    bpy.data.images.remove(img)
    return px


def save(px, path):
    h, w = px.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.alpha_mode = "STRAIGHT"
    img.pixels[:] = np.ascontiguousarray(px[::-1]).ravel()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def bake_sheet(a, name, fam, grid, seed, work):
    sc, sun, cam = setup(a, a["res"])
    place_lobes(sc, cam, fam, grid, seed, work, name)
    raw = {}
    for which in ("amb", "front", "side", "back"):
        light(sc, sun, which)
        t0 = time.time()
        raw[which] = render(sc, os.path.join(work, "%s_%s.png" % (name, which)))
        print("RENDER %s %s %.1f s" % (name, which, time.time() - t0), flush=True)
    al = raw["amb"][..., 3]
    solid = al > 0.6
    lum = lambda px: px[..., :3].mean(axis=2)
    amb = lum(raw["amb"])
    amb = np.clip(amb / max(np.percentile(amb[solid], 98), 1e-4), 0, 1)
    ref = max(np.percentile(lum(raw["side"])[solid], 95), 1e-4)
    out = {"amb": np.dstack([amb, amb, amb, al])}
    for which in ("front", "side", "back"):
        m = np.clip(lum(raw[which]) / ref, 0, 1) * np.clip(raw[which][..., 3], 0, 1)
        out[which] = np.dstack([np.ones_like(m)] * 3 + [m])
    for which, px in out.items():
        save(px, os.path.join(a["out"], "%s_%s.png" % (name, which if which == "amb" else "sun_" + which)))
    # preview: the in-game composite (side | back) over storm grey
    shadow, lit, bg = np.array([0.5, 0.56, 0.66]), np.array([1.0, 0.96, 0.88]), np.array([0.42, 0.47, 0.55])
    tiles = []
    for which in ("front", "side", "back"):
        m = out[which][..., 3:4]
        col = amb[..., None] * shadow * (1 - m) + lit * m
        tiles.append(bg * (1 - al[..., None]) + col * al[..., None])
    prev = np.concatenate(tiles, axis=1)
    save(np.dstack([prev, np.ones(prev.shape[:2])]), os.path.join(a["out"], "%s_preview.png" % name))


def main():
    raise_priority()
    a = args()
    a["out"] = os.path.abspath(a["out"])
    os.makedirs(a["out"], exist_ok=True)
    work = os.path.join(os.environ.get("CLAUDE_JOB_DIR", os.path.join(ROOT, "tmp")), "tmp", "lobe_bake")
    os.makedirs(work, exist_ok=True)
    t0 = time.time()
    for i, f in enumerate(a["families"].split(",")):
        fam = FAMILIES[f]
        seed = a["seed"] * 1000 + i * 37
        if a["only"] != "near":
            bake_sheet(a, "lobe_" + f, fam, 4, seed, work)
        if a["near"] and f != "soft":
            bake_sheet(a, "lobe_" + f + "_near", fam, 2, seed, work)
    print("TOTAL %.1f s" % (time.time() - t0))


main()
