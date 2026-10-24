# Bakes the cloud kit's puffy pieces (tower caps and bodies, anvils, mammatus) into camera-facing
# "vapor" sprites: each piece's mesh (roblox/src/shared/Weather/CloudKit/Pieces/<name>.luau) is
# turned into a cloud VOLUME and rendered with Cycles under four suns. Run headless:
#
#   blender --background --factory-startup --python tools/blender/cloud_vapor_bake.py -- \
#       [--pieces tower_cap_1,anvil_1] [--lights lit,side,back,high] [--res 512] [--samples 256]
#       [--out roblox/assets/cloudkit/vapor] [--sheet-only 1]
#
# How a piece becomes vapor:
#   1. The mesh (unit box, game axes) is put back to its modelled proportions in Blender axes
#      (game (x, y, z) -> Blender (x, -z, y), then scaled by the piece's true size).
#   2. OpenVDB turns it into a signed distance grid (negative inside), stored as "sdfp" =
#      OUT - distance, so it is zero (inactive) further than OUT outside the surface.
#   3. A volume shader reads the distance and moves the surface with noise: round cauliflower
#      bulbs on bulbs (Voronoi domes) for towers, X-wise streaks and soft billows for anvils, slow
#      smooth swells for mammatus; density ramps from the (moved) surface into a dense core, and a
#      fine noise eats the fringe into wisps. Detail is in the shader, so it has no voxel size.
#   4. Rendered with an orthographic camera at the piece's real proportions, with non-square
#      pixels so the 512 x 512 cell covers the unit box plus a margin M on every side: the image
#      is the piece as stretched into the unit box, exactly as the game stretches the mesh.
#
# Camera: horizontal, looking at the piece's front (Blender's Front view: from Blender -Y toward
# +Y, i.e. from game +Z toward -Z). Image right = game +X, image up = game +Y.
# Lights (direction the light comes FROM, relative to the camera; one sun strength for all four):
#   lit   sun 30 deg up, behind the camera and 30 deg to its left
#   side  sun 30 deg up, 90 deg to the camera's left
#   back  sun 30 deg up, 150 deg round from the camera (behind the cloud, a little left)
#   high  sun 75 deg up, behind the camera and 30 deg to its left
#
# Writes <out>/<piece>.png (1024 x 1024, 2 x 2 cells: lit | side over back | high, RGBA, straight
# alpha), <piece>_preview.png (over a sky blue) and sheet.png (every preview).
import bpy
import math
import os
import re
import sys
import time

import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PIECES_DIR = os.path.join(ROOT, "roblox", "src", "shared", "Weather", "CloudKit", "Pieces")
DEFAULT_PIECES = ["tower_cap_1", "tower_cap_2", "tower_cap_3", "tower_body_1", "tower_body_2",
                  "anvil_1", "anvil_2", "mammatus_1"]
M = 0.15                              # margin round the unit box, in unit-box sizes
CELLS = ["lit", "side", "back", "high"]  # top-left, top-right, bottom-left, bottom-right

# The pieces' modelled proportions (Blender x = length, y = depth, z = height), from
# docs/storm-visuals/KIT.md, scaled so the length is 1. The volume is built at these proportions so
# its noise is round, then the camera stretches it back into the unit box.
TRUE_SIZE = {
    "tower_cap_1": (1.0, 1.0, 0.50), "tower_cap_2": (1.0, 1.0, 0.57), "tower_cap_3": (1.0, 1.0, 0.65),
    "tower_body_1": (1.0, 1.0, 1.15), "tower_body_2": (1.0, 1.0, 1.15),
    "anvil_1": (1.0, 1.04, 0.14), "anvil_2": (1.0, 1.04, 0.14),
    "mammatus_1": (1.0, 1.0, 0.22),
}

# Light directions (toward the sun) as (azimuth from "toward the camera", turning to the camera's
# left, degrees; elevation, degrees). The camera looks along Blender +Y, so "toward the camera" is -Y
# and its left is -X.
LIGHTS = {"lit": (30, 30), "side": (90, 30), "back": (150, 30), "high": (30, 75)}
SUN_ENERGY = 10.0          # W/m^2 (Cycles sun strength)
SUN_ANGLE = 1.0           # degrees: a slightly soft sun
SKY = (0.42, 0.55, 0.80)  # a clear blue sky, dim: it lights the shadows blue-grey
SKY_STRENGTH = 0.35
ANISOTROPY = 0.75        # forward scattering: the silver lining when backlit
PREVIEW_BG = (0.45, 0.6, 0.8)  # mid sky blue (display values)

# Volume looks per kind. Lengths are in true units (piece length = 1).
#   out, inn   the density ramp: from `out` outside the moved surface to `inn` inside it
#   density    in the core (per unit length); optical depth across the ramp ~ density * inn / 2
#   halo       (width, density): a thin, faint veil beyond the ramp; backlit it glows (silver lining)
#   bulbs      (cells per unit, height) Voronoi domes pushing the surface out, on top of each other
#   streak     (amplitude, along-X scale, across scale): fibrous X-wise noise (anvils)
#   swell      (amplitude, scale): slow smooth noise (mammatus)
#   wisp       (amount, scale): fine noise eating the fringe
#   top_only   bulbs fade out toward the bottom (a cap's flat base)
#   flat_top   the noise fades out toward the top (an anvil: flat, smooth top, fibrous underside)
CAULIFLOWER = [(5.0, 0.06), (11.0, 0.026), (24.0, 0.011), (50.0, 0.0045)]
LOOKS = {
    "tower_cap": dict(out=0.003, inn=0.015, density=140.0, halo=(0.02, 6.0),
                      bulbs=CAULIFLOWER, wisp=(0.35, 70.0), top_only=True),
    "tower_body": dict(out=0.003, inn=0.015, density=140.0, halo=(0.02, 6.0),
                       bulbs=CAULIFLOWER, wisp=(0.35, 70.0), top_only=False),
    "anvil": dict(out=0.002, inn=0.01, density=90.0, halo=(0.012, 3.0), flat_top=True,
                  bulbs=[(30.0, 0.004), (60.0, 0.002)], streak=(0.011, 5.0, 110.0),
                  wisp=(0.7, 90.0), top_only=False),
    "mammatus": dict(out=0.003, inn=0.015, density=100.0, halo=(0.01, 3.0), bulbs=[],
                     swell=(0.008, 7.0), wisp=(0.25, 60.0), top_only=False),
}

VOXEL = 0.006   # distance grid voxel, true units
OUT = 0.1       # the grid holds distances up to this far outside the surface


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"pieces": ",".join(DEFAULT_PIECES), "lights": ",".join(CELLS), "res": 512, "samples": 256,
           "out": os.path.join(ROOT, "roblox", "assets", "cloudkit", "vapor"), "sheet-only": 0,
           "bounces": 12, "tag": "", "true": 0}
    for i in range(0, len(argv) - 1, 2):
        k = argv[i].lstrip("-")
        out[k] = type(out[k])(argv[i + 1]) if k in out else argv[i + 1]
    return out


def raise_priority():
    # This machine throttles normal-priority background processes after a few seconds.
    if os.name == "nt":
        try:
            import ctypes
            k = ctypes.windll.kernel32
            k.SetPriorityClass(k.GetCurrentProcess(), 0x8000)  # above normal
        except Exception:
            pass


# ---------------------------------------------------------------------------------------------
# The piece's mesh and its distance grid

def load_piece(name):
    src = open(os.path.join(PIECES_DIR, name + ".luau"), encoding="utf-8").read()

    def table(key):
        m = re.search(r"\n\s*" + key + r"\s*=\s*\{(.*?)\}", src, re.S)
        return np.array([float(v) for v in re.findall(r"-?\d+(?:\.\d+)?(?:e-?\d+)?", m.group(1))])

    p = table("p").reshape(-1, 3)
    t = table("t").astype(np.int64).reshape(-1, 3) - 1
    kind = re.search(r'kind\s*=\s*"(\w+)"', src).group(1)
    sx, sy, sz = TRUE_SIZE[name]
    co = np.stack([p[:, 0] * sx, -p[:, 2] * sy, p[:, 1] * sz], axis=1)  # Blender axes, true size
    return kind, co.astype(np.float32), t.astype(np.int32)


def distance_volume(name, co, tris, work):
    import openvdb as vdb
    xf = vdb.createLinearTransform(VOXEL)
    half = int(math.ceil(OUT / VOXEL)) + 2
    ls = vdb.FloatGrid.createLevelSetFromPolygons(co, triangles=tris, transform=xf, halfWidth=half)
    lo, hi = ls.evalActiveVoxelBoundingBox()
    shape = tuple(int(hi[i] - lo[i] + 1) for i in range(3))
    arr = np.zeros(shape, dtype=np.float32)
    ls.copyToArray(arr, ijk=lo)           # inactive interior reads as -background
    g = np.clip(OUT - arr, 0.0, None).astype(np.float32)   # OUT - distance, 0 beyond OUT outside
    out = vdb.FloatGrid(0.0)
    out.transform = vdb.createLinearTransform(VOXEL)
    out.copyFromArray(g, ijk=lo, tolerance=0.0)
    out.name = "sdfp"
    path = os.path.join(work, name + ".vdb")
    vdb.write(path, grids=[out])
    print(f"{name}: grid {shape}, inside depth max {float(-arr.min()):.3f}")
    return path


# ---------------------------------------------------------------------------------------------
# Shader graph helpers

class Graph:
    def __init__(self, tree):
        self.nodes, self.links = tree.nodes, tree.links

    def _in(self, socket, v):
        if isinstance(v, (int, float)):
            socket.default_value = v
        else:
            self.links.new(v, socket)

    def math(self, op, a, b=None, clamp=False):
        n = self.nodes.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
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
        """0 at a, 1 at b (either order), smooth."""
        n = self.nodes.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        n.inputs["From Min"].default_value = a
        n.inputs["From Max"].default_value = b
        self._in(n.inputs["Value"], x)
        return n.outputs["Result"]

    def vscale(self, vec, s):
        n = self.nodes.new("ShaderNodeVectorMath")
        n.operation = "SCALE"
        self.links.new(vec, n.inputs[0])
        n.inputs["Scale"].default_value = s
        return n.outputs["Vector"]

    def vadd(self, vec, off):
        n = self.nodes.new("ShaderNodeVectorMath")
        n.operation = "ADD"
        self.links.new(vec, n.inputs[0])
        if isinstance(off, tuple):
            n.inputs[1].default_value = off
        else:
            self.links.new(off, n.inputs[1])
        return n.outputs["Vector"]

    def noise(self, vec, scale, detail=4.0, rough=0.5):
        n = self.nodes.new("ShaderNodeTexNoise")
        n.noise_dimensions = "3D"
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        self.links.new(vec, n.inputs["Vector"])
        return n.outputs["Fac"], n.outputs["Color"]

    def voronoi(self, vec, scale, smooth=0.0):
        n = self.nodes.new("ShaderNodeTexVoronoi")
        n.voronoi_dimensions = "3D"
        n.feature = "SMOOTH_F1" if smooth > 0 else "F1"
        n.distance = "EUCLIDEAN"
        n.inputs["Scale"].default_value = scale
        n.inputs["Randomness"].default_value = 1.0
        if smooth > 0:
            n.inputs["Smoothness"].default_value = smooth   # rounds the creases
        self.links.new(vec, n.inputs["Vector"])
        return n.outputs["Distance"]

    def sep(self, vec):
        n = self.nodes.new("ShaderNodeSeparateXYZ")
        self.links.new(vec, n.inputs[0])
        return n.outputs[0], n.outputs[1], n.outputs[2]


def cloud_material(kind, name, size):
    L = LOOKS[kind]
    sx, sy, sz = size
    mat = bpy.data.materials.new("vapor_" + name)
    g = Graph(mat.node_tree)
    g.nodes.clear()

    p = g.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    px, py, pz = g.sep(p)
    attr = g.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "GEOMETRY"
    attr.attribute_name = "sdfp"
    dist = g.sub(OUT, attr.outputs["Fac"])          # signed distance, negative inside

    # A warp shared by all the noise, so nothing lines up with the axes.
    _, wcol = g.noise(p, 3.0, 2.0, 0.5)
    warped = g.vadd(p, g.vadd(g.vscale(wcol, 0.025), (-0.0125, -0.0125, -0.0125)))

    push = None
    # Cauliflower: domes on domes. A Voronoi cell's F1 distance d (in cell units) makes a dome
    # sqrt(r^2 - d^2): round lobes with sharp creases where cells meet.
    for i, (cells, height) in enumerate(L["bulbs"]):
        off = g.vadd(warped, (17.3 * (i + 1), 5.1 * i, 9.7 * i))
        d = g.voronoi(off, cells, 0.25 if i == 0 else 0.0)   # only the big lobes need rounding
        dome = g.math("SQRT", g.math("MAXIMUM", g.sub(0.36, g.mul(d, d)), 0.0))   # r = 0.6, 0..0.6
        b = g.mul(g.sub(g.math("DIVIDE", dome, 0.6), 0.45), height)
        push = b if push is None else g.add(push, b)
    if "streak" in L:
        amp, along, across = L["streak"]
        stretched = g.nodes.new("ShaderNodeVectorMath")
        stretched.operation = "MULTIPLY"
        g.links.new(warped, stretched.inputs[0])
        stretched.inputs[1].default_value = (along, across, across)
        f, _ = g.noise(stretched.outputs["Vector"], 1.0, 6.0, 0.6)
        s = g.mul(g.sub(f, 0.5), 2 * amp)
        push = s if push is None else g.add(push, s)
    if "swell" in L:
        amp, sc = L["swell"]
        f, _ = g.noise(p, sc, 1.0, 0.3)
        s = g.mul(g.sub(f, 0.5), 2 * amp)
        push = s if push is None else g.add(push, s)
    if L["top_only"] and push is not None:
        # A cap's base is flat-ish: the lobes fade out below a fifth of its height.
        push = g.mul(push, g.add(0.25, g.mul(g.smooth(pz, 0.05 * sz, 0.3 * sz), 0.75)))
    if L.get("flat_top") and push is not None:
        push = g.mul(push, g.sub(1.0, g.mul(g.smooth(pz, 0.35 * sz, 0.85 * sz), 0.75)))
    moved = dist if push is None else g.sub(dist, push)

    # Density: a ramp from the moved surface into the core.
    body = g.smooth(moved, L["out"], -L["inn"])
    # Fine wisps: near the surface a fine noise eats holes; deeper in it fades out.
    amt, wsc = L["wisp"]
    wn, _ = g.noise(g.vadd(warped, (3.3, 7.1, 1.9)), wsc, 3.0, 0.55)
    fringe = g.smooth(moved, -2.0 * L["inn"], 0.0)          # 1 at the surface, 0 deep inside
    eaten = g.smooth(wn, 0.3, 0.6)
    mod = g.sub(1.0, g.mul(g.mul(fringe, amt), g.sub(1.0, eaten)))
    dens = g.mul(g.mul(body, mod), L["density"])
    hw, hd = L["halo"]
    veil = g.mul(g.smooth(moved, L["out"] + hw, L["out"]), g.add(0.3, g.mul(eaten, 0.7)))
    dens = g.add(dens, g.mul(veil, hd))

    # Fade out (never crop) before the frame's edges in length and height.
    for coord, lo, hi in ((px, -(0.5 + M) * sx, (0.5 + M) * sx), (pz, -M * sz, (1 + M) * sz)):
        fw = 0.5 * M * (hi - lo) / (1 + 2 * M)
        dens = g.mul(dens, g.mul(g.smooth(coord, lo + 0.25 * fw, lo + fw), g.smooth(coord, hi - 0.25 * fw, hi - fw)))

    vol = g.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    vol.inputs["Absorption Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    vol.inputs["Anisotropy"].default_value = ANISOTROPY
    g.links.new(dens, vol.inputs["Density"])
    vol.inputs["Density Attribute"].default_value = ""
    out = g.nodes.new("ShaderNodeOutputMaterial")
    out.target = "ALL"
    g.links.new(vol.outputs[0], out.inputs["Volume"])
    return mat, vol


# ---------------------------------------------------------------------------------------------
# Scene

def setup_scene(a):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = a["samples"]
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = max(16, a["bounces"])
    sc.cycles.volume_bounces = a["bounces"]
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.diffuse_bounces = sc.cycles.glossy_bounces = sc.cycles.transmission_bounces = 0
    sc.cycles.use_volume_guiding = True
    sc.cycles.sample_clamp_indirect = 0.0
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.resolution_x = sc.render.resolution_y = a["res"]
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                gpus = [d for d in prefs.devices if d.type == kind]
                if gpus:
                    for d in prefs.devices:
                        d.use = d.type == kind
                    sc.cycles.device = "GPU"
                    print("Cycles on", kind, [d.name for d in gpus])
                    break
            except Exception:
                continue
    except Exception as e:
        print("GPU not used:", e)

    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*SKY, 1.0)
    bg.inputs["Strength"].default_value = SKY_STRENGTH
    sc.world = world

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = SUN_ENERGY
    sun_data.angle = math.radians(SUN_ANGLE)
    sun_data.color = (1.0, 0.98, 0.95)
    sun = bpy.data.objects.new("sun", sun_data)
    sc.collection.objects.link(sun)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start, cam_data.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new("cam", cam_data)
    cam.rotation_euler = (math.radians(90), 0, 0)   # looks along +Y, up = +Z
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, sun, cam


def frame_camera(sc, cam, size):
    """Ortho frame over the unit box plus M, at true proportions, with non-square pixels so the
    square image is the unit-box view."""
    sx, _, sz = size
    w, h = (1 + 2 * M) * sx, (1 + 2 * M) * sz
    cam.location = (0.0, -10.0, 0.5 * sz)
    cam.data.sensor_fit = "AUTO"
    if w >= h:
        sc.render.pixel_aspect_x, sc.render.pixel_aspect_y = w / h, 1.0
    else:
        sc.render.pixel_aspect_x, sc.render.pixel_aspect_y = 1.0, h / w
    cam.data.ortho_scale = max(w, h)
    # Check: the frame's corners land on the image's corners.
    from bpy_extras.object_utils import world_to_camera_view
    bpy.context.view_layer.update()
    c0 = world_to_camera_view(sc, cam, Vector((-w / 2, 0, -M * sz)))
    c1 = world_to_camera_view(sc, cam, Vector((w / 2, 0, (1 + M) * sz)))
    err = max(abs(c0.x), abs(c0.y), abs(c1.x - 1), abs(c1.y - 1))
    if err > 1e-3:
        raise RuntimeError(f"camera frame off by {err:.4f}: {c0} {c1}")


def aim_sun(sun, light):
    az, el = (math.radians(v) for v in LIGHTS[light])
    # Toward the camera is -Y; turning to the camera's left (-X).
    d = Vector((-math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    sun.rotation_euler = d.to_track_quat("Z", "Y").to_euler()


def render_cell(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    r = sc.render.resolution_x
    px = np.array(img.pixels[:], dtype=np.float32).reshape(r, r, 4)
    bpy.data.images.remove(img)
    return px


def save(pixels, path):
    img = bpy.data.images.new(os.path.basename(path), pixels.shape[1], pixels.shape[0], alpha=True)
    img.alpha_mode = "STRAIGHT"
    img.pixels[:] = np.ascontiguousarray(pixels).ravel()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def over_sky(sheet):
    prev = sheet.copy()
    a = sheet[..., 3:4]
    prev[..., :3] = sheet[..., :3] * a + np.array(PREVIEW_BG, dtype=np.float32) * (1 - a)
    prev[..., 3] = 1
    return prev


def bake_piece(sc, sun, cam, name, a, work):
    kind, co, tris = load_piece(name)
    size = TRUE_SIZE[name]
    path = distance_volume(name, co, tris, work)
    for ob in list(bpy.data.objects):
        if ob.type == "VOLUME":
            bpy.data.objects.remove(ob)
    vdata = bpy.data.volumes.new(name)
    vdata.filepath = path
    vob = bpy.data.objects.new(name, vdata)
    sc.collection.objects.link(vob)
    mat, _ = cloud_material(kind, name, size)
    vdata.materials.append(mat)
    frame_camera(sc, cam, size)

    r = a["res"]
    lights = a["lights"].split(",")
    sheet = np.zeros((2 * r, 2 * r, 4), dtype=np.float32)
    times = {}
    for light in lights:
        aim_sun(sun, light)
        t0 = time.time()
        px = render_cell(sc, os.path.join(work, f"{name}_{light}.png"))
        times[light] = time.time() - t0
        k = CELLS.index(light)
        row, col = divmod(k, 2)
        y0 = (1 - row) * r          # Blender rows run bottom-up: row 0 is the top
        sheet[y0:y0 + r, col * r:(col + 1) * r] = px
        a_ = px[..., 3]
        lit = px[..., :3][a_ > 0.9]
        edge = max(a_[0].max(), a_[-1].max(), a_[:, 0].max(), a_[:, -1].max())
        print(f"RENDER {name} {light}: {times[light]:.1f} s, cover {float((a_ > 0.5).mean()):.2f}, "
              f"edge alpha {float(edge):.3f}, opaque rgb p50 {np.percentile(lit, 50) if lit.size else 0:.2f} "
              f"p95 {np.percentile(lit, 95) if lit.size else 0:.2f}")
    tag = a["tag"]
    os.makedirs(a["out"], exist_ok=True)
    save(sheet, os.path.join(a["out"], f"{name}{tag}.png"))
    save(over_sky(sheet), os.path.join(a["out"], f"{name}{tag}_preview.png"))
    if a["true"]:
        # For judging the look: the preview squashed back to the piece's real proportions.
        im = bpy.data.images.load(os.path.join(a["out"], f"{name}{tag}_preview.png"))
        w, h = (1.0, size[2]) if size[2] < 1 else (1.0 / size[2], 1.0)
        im.scale(int(2 * r * w), int(2 * r * h))
        im.filepath_raw = os.path.join(a["out"], f"{name}{tag}_true.png")
        im.save()
        bpy.data.images.remove(im)
    bpy.data.materials.remove(mat)
    return times


def contact_sheet(a):
    """Every piece's preview, halved, four to a row."""
    previews = []
    for name in DEFAULT_PIECES:
        p = os.path.join(a["out"], f"{name}{a['tag']}_preview.png")
        if os.path.exists(p):
            img = bpy.data.images.load(p)
            w, h = img.size
            px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
            bpy.data.images.remove(img)
            previews.append(px.reshape(h // 2, 2, w // 2, 2, 4).mean(axis=(1, 3)))
    if not previews:
        return
    h, w = previews[0].shape[:2]
    cols = 4
    rows = (len(previews) + cols - 1) // cols
    sheet = np.full((rows * h, cols * w, 4), 0.2, dtype=np.float32)
    sheet[..., 3] = 1
    for i, px in enumerate(previews):
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * h
        sheet[y0:y0 + h, c * w:(c + 1) * w] = px
    save(sheet, os.path.join(a["out"], f"sheet{a['tag']}.png"))


def main():
    raise_priority()
    a = args()
    a["out"] = os.path.abspath(a["out"])
    work = os.path.join(os.environ.get("CLAUDE_JOB_DIR", os.path.join(ROOT, "tmp")), "tmp", "vapor_bake")
    os.makedirs(work, exist_ok=True)
    if not a["sheet-only"]:
        sc, sun, cam = setup_scene(a)
        total = time.time()
        for name in a["pieces"].split(","):
            t = bake_piece(sc, sun, cam, name, a, work)
            print(f"PIECE {name}: {sum(t.values()):.1f} s")
        print(f"TOTAL {time.time() - total:.1f} s, {a['samples']} samples, {a['res']} px")
    contact_sheet(a)


main()
