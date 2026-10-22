# A dust/debris puff for the debris cloud at a tornado's base, as a Roblox particle flipbook (an
# 8 x 8 sheet that a ParticleEmitter plays once over each particle's life: FlipbookLayout Grid8x8,
# FlipbookMode OneShot). Rendered by Blender, headless:
#
#   blender --background --factory-startup --python tools/blender/dust_flipbook.py -- \
#       --out roblox/assets/tornado --seed 1
#
# A procedural volume (no fluid simulation: detail does not depend on a grid, and nothing needs
# baking). Over its life t (0-1) the puff:
#   - grows from a burst to a broad cloud (radius ~ t ^ 0.6), wider than tall (dust hugs the ground)
#     and rising a little as it spreads;
#   - billows: its edge is pushed in and out by 4D noise whose fourth dimension is time, so the
#     lobes roll and change rather than slide;
#   - is eroded by finer noise into wisps, more as it ages;
#   - thins: dense at the burst, gone by the end.
# Rendered from the side in Cycles (lit by a sun from above and an even sky), transparent, in
# neutral grey: the game tints it with the debris's colour and lights it (LightInfluence).
#
# Writes dust_puff.png (1024 x 1024 RGBA sheet, 128 px a frame) and dust_puff_preview.png (the
# sheet over mid grey, to judge by eye).
import bpy
import math
import os
import sys

import numpy as np

FRAMES = 64      # frames in the sheet
GRID = 8         # the sheet is GRID x GRID
CELL = 128       # pixels a frame in the sheet
RENDER = 256     # pixels a rendered frame (averaged down to CELL)

LOOK = dict(
    startRadius=0.3, endRadius=1.45, growth=0.55,  # radius over life: start + (end - start) * t ^ growth
    squash=0.72,                                   # height / width
    rise=0.25,                                     # the centre rises this far over life
    billow=0.55, billowScale=2.6, billowSpeed=1.4, # edge pushed in and out by noise
    erode=(0.2, 0.48), erodeScale=3.2,             # fine noise eating it, young to old
    density=(16.0, 1.5),                           # density, young to old
)


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": "roblox/assets/tornado", "seed": 1, "samples": 48}
    for i in range(0, len(argv) - 1, 2):
        key = argv[i].lstrip("-")
        out[key] = type(out[key])(argv[i + 1]) if key in out else argv[i + 1]
    return out


class Graph:
    """A few helpers for building the material's node graph."""

    def __init__(self, tree):
        self.nodes, self.links = tree.nodes, tree.links

    def math(self, op, a, b=None, value=None):
        n = self.nodes.new("ShaderNodeMath")
        n.operation = op
        self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        elif value is not None:
            n.inputs[1].default_value = value
        return n.outputs[0]

    def vmath(self, op, a, b):
        n = self.nodes.new("ShaderNodeVectorMath")
        n.operation = op
        self._in(n.inputs[0], a)
        self._in(n.inputs[1], b)
        return n.outputs["Vector"] if op != "LENGTH" else n.outputs["Value"]

    def value(self, v, name):
        n = self.nodes.new("ShaderNodeValue")
        n.name = name
        n.outputs[0].default_value = v
        return n.outputs[0]

    def noise(self, vec, w, scale, detail, roughness):
        n = self.nodes.new("ShaderNodeTexNoise")
        n.noise_dimensions = "4D"
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = roughness
        self.links.new(vec, n.inputs["Vector"])
        self._in(n.inputs["W"], w)
        return n.outputs["Fac"]

    def _in(self, socket, v):
        if isinstance(v, (int, float)):
            socket.default_value = v
        else:
            self.links.new(v, socket)


def build(a):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    bpy.ops.mesh.primitive_cube_add(size=3.2, location=(0, 0, 0))
    box = bpy.context.object
    mat = bpy.data.materials.new("dust")
    g = Graph(mat.node_tree)
    g.nodes.clear()

    # Per frame (set before each render): the puff's radius, centre height, billow time,
    # erosion and density.
    radius = g.value(0.3, "radius")
    centre_z = g.value(0.0, "centreZ")
    time = g.value(0.0, "time")
    erode = g.value(0.3, "erode")
    density = g.value(10.0, "density")

    coord = g.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    comb = g.nodes.new("ShaderNodeCombineXYZ")
    g.links.new(centre_z, comb.inputs[2])
    p = g.vmath("SUBTRACT", coord, comb.outputs[0])
    # Squashed: scale z up so the same distance reaches less high.
    sq = g.nodes.new("ShaderNodeCombineXYZ")
    sq.inputs[0].default_value = 1.0
    sq.inputs[1].default_value = 1.0
    sq.inputs[2].default_value = 1.0 / LOOK["squash"]
    q = g.vmath("MULTIPLY", p, sq.outputs[0])
    dist = g.math("DIVIDE", g.vmath("LENGTH", q, q), radius)

    seed_w = a["seed"] * 13.7
    w = g.math("ADD", g.math("MULTIPLY", time, value=LOOK["billowSpeed"]), value=seed_w)
    big = g.noise(p, w, LOOK["billowScale"], 6, 0.6)
    # Billow: push the edge in and out (noise sits near 0.5).
    pushed = g.math("SUBTRACT", dist, g.math("MULTIPLY", g.math("SUBTRACT", big, value=0.5), value=2 * LOOK["billow"]))
    body = g.nodes.new("ShaderNodeMapRange")
    body.interpolation_type = "SMOOTHSTEP"
    body.inputs["From Min"].default_value = 1.0
    body.inputs["From Max"].default_value = 0.55
    g.links.new(pushed, body.inputs["Value"])

    # Erosion: fine noise eats into it, more with age.
    fine = g.noise(p, g.math("ADD", w, value=3.1), LOOK["erodeScale"], 4, 0.5)
    eaten = g.nodes.new("ShaderNodeMapRange")
    g.links.new(fine, eaten.inputs["Value"])
    g.links.new(erode, eaten.inputs["From Min"])
    g.links.new(g.math("ADD", erode, value=0.3), eaten.inputs["From Max"])

    dens = g.math("MULTIPLY", g.math("MULTIPLY", body.outputs["Result"], eaten.outputs["Result"]), density)

    vol = g.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.82, 0.82, 0.82, 1)
    vol.inputs["Absorption Color"].default_value = (0.4, 0.4, 0.4, 1)
    vol.inputs["Anisotropy"].default_value = 0.25
    g.links.new(dens, vol.inputs["Density"])
    out = g.nodes.new("ShaderNodeOutputMaterial")
    g.links.new(vol.outputs[0], out.inputs["Volume"])
    box.data.materials.append(mat)

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.5
    sun_data.angle = math.radians(8)
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(35), math.radians(20), math.radians(30))
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.52, 0.55, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    scene.world = world

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.75
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, -10, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.engine = "CYCLES"
    scene.cycles.samples = a["samples"]
    scene.cycles.use_denoising = True
    scene.cycles.volume_bounces = 2
    scene.cycles.volume_step_rate = 0.5
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = scene.render.resolution_y = RENDER
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception as e:
        print("GPU not used:", e)
    return mat.node_tree.nodes


def at_life(nodes, t):
    L = LOOK
    radius = L["startRadius"] + (L["endRadius"] - L["startRadius"]) * t ** L["growth"]
    nodes["radius"].outputs[0].default_value = radius
    # It starts on the ground (its bottom at the frame's lower edge) and rises as it spreads.
    nodes["centreZ"].outputs[0].default_value = -0.85 + radius * L["squash"] * 0.6 + L["rise"] * t
    nodes["time"].outputs[0].default_value = t
    nodes["erode"].outputs[0].default_value = L["erode"][0] + (L["erode"][1] - L["erode"][0]) * t
    # Dense at the burst, thinning to nothing (a quick rise over the first frames, so it does not pop).
    fade = min(1.0, t * 12) * (1 - t) ** 0.8
    nodes["density"].outputs[0].default_value = (L["density"][0] + (L["density"][1] - L["density"][0]) * t) * fade


def main():
    a = args()
    out_dir = os.path.abspath(a["out"])
    os.makedirs(out_dir, exist_ok=True)
    work = os.path.join(os.environ.get("CLAUDE_JOB_DIR", out_dir), "tmp", "dust_frames")
    os.makedirs(work, exist_ok=True)
    nodes = build(a)
    scene = bpy.context.scene

    sheet = np.zeros((GRID * CELL, GRID * CELL, 4), dtype=np.float32)
    n = RENDER // CELL
    for i in range(FRAMES):
        at_life(nodes, (i + 0.5) / FRAMES)
        path = os.path.join(work, f"f{i:02d}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(RENDER, RENDER, 4)
        bpy.data.images.remove(img)
        cell = px.reshape(CELL, n, CELL, n, 4).mean(axis=(1, 3))
        row, col = divmod(i, GRID)
        # Blender's pixels run bottom-up; the sheet's first frame is at the top left.
        y0 = (GRID - 1 - row) * CELL
        sheet[y0:y0 + CELL, col * CELL:(col + 1) * CELL] = cell
        if i % 8 == 0:
            print("frame", i, "alpha max", round(float(cell[..., 3].max()), 3))

    def save(pixels, name):
        img = bpy.data.images.new(name, pixels.shape[1], pixels.shape[0], alpha=True)
        img.pixels[:] = pixels.ravel()
        img.filepath_raw = os.path.join(out_dir, name)
        img.file_format = "PNG"
        img.save()

    save(sheet, "dust_puff.png")
    prev = sheet.copy()
    prev[..., :3] = sheet[..., :3] * sheet[..., 3:4] + 0.45 * (1 - sheet[..., 3:4])
    prev[..., 3] = 1
    save(prev, "dust_puff_preview.png")
    print("wrote", os.path.join(out_dir, "dust_puff.png"))


main()
