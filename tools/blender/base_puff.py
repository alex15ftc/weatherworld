# Puffs for the storm base's underside, seen from below (TornadoLab's CloudImpostors: hundreds
# of camera-facing sprites of these, placed and tinted from the storm field, give the base a soft,
# lumpy, layered underside and hide the base mesh's straight edges). Adapted from cloud_puff.py:
# flatter, lobes hanging DOWN, viewed from below at ~25 degrees, lit like the underside of a storm
# (weak sun from above through the cloud, a low warm light from the horizon slot, dim grey sky).
#
#   blender --background --factory-startup --python tools/blender/base_puff.py -- #       --out roblox/assets/clouds --name base_puff --seed 2
#
# 16 puffs in a 4 x 4 sheet (1024 px, 256 a puff), neutral grey (the game tints them).
import bpy
import math
import os
import sys

import numpy as np

GRID, CELL, RENDER = 4, 256, 512

LOOK = dict(
    radius=0.70,            # the ball, in frame halves
    squash=0.5,             # height / width (a flattened lump of base)
    lobes=0.6, lobeScale=2.6,   # how far the lobes push the edge, and their size
    wisps=0.35, wispScale=7.0,  # finer noise eating the edge into wisps
    density=26.0,
)


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": "roblox/assets/clouds", "name": "base_puff", "seed": 2, "samples": 64}
    for i in range(0, len(argv) - 1, 2):
        key = argv[i].lstrip("-")
        out[key] = type(out[key])(argv[i + 1]) if key in out else argv[i + 1]
    return out


class Graph:
    def __init__(self, tree):
        self.nodes, self.links = tree.nodes, tree.links

    def _in(self, socket, v):
        if isinstance(v, (int, float)):
            socket.default_value = v
        else:
            self.links.new(v, socket)

    def math(self, op, a, b=None):
        n = self.nodes.new("ShaderNodeMath")
        n.operation = op
        self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        return n.outputs[0]

    def smooth(self, x, a, b):
        n = self.nodes.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        n.inputs["From Min"].default_value = a
        n.inputs["From Max"].default_value = b
        self._in(n.inputs["Value"], x)
        return n.outputs["Result"]

    def noise(self, vec, w, scale, detail, roughness):
        n = self.nodes.new("ShaderNodeTexNoise")
        n.noise_dimensions = "4D"
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = roughness
        self._in(n.inputs["Vector"], vec)
        self._in(n.inputs["W"], w)
        return n.outputs["Fac"]


def build(a):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.mesh.primitive_cube_add(size=2.4, location=(0, 0, 0))
    box = bpy.context.object
    mat = bpy.data.materials.new("puff")
    g = Graph(mat.node_tree)
    g.nodes.clear()
    L = LOOK

    seed = g.nodes.new("ShaderNodeValue")
    seed.name = "seed"
    w = seed.outputs[0]

    p = g.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    sq = g.nodes.new("ShaderNodeCombineXYZ")
    sq.inputs[0].default_value = 1.0
    sq.inputs[1].default_value = 1.0
    sq.inputs[2].default_value = 1.0 / L["squash"]
    vm = g.nodes.new("ShaderNodeVectorMath")
    vm.operation = "MULTIPLY"
    g.links.new(p, vm.inputs[0])
    g.links.new(sq.outputs[0], vm.inputs[1])
    ln = g.nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    g.links.new(vm.outputs["Vector"], ln.inputs[0])
    dist = g.math("DIVIDE", ln.outputs["Value"], L["radius"])

    lobes = g.noise(p, w, L["lobeScale"], 5, 0.55)
    # Lobes bulge more on top (cauliflower), the base flatter.
    pz = g.nodes.new("ShaderNodeSeparateXYZ")
    g.links.new(p, pz.inputs[0])
    top = g.smooth(g.math("MULTIPLY", pz.outputs[2], -1.0), -0.4, 0.6)  # lobes hang below
    push = g.math("MULTIPLY", g.math("MULTIPLY", g.math("SUBTRACT", lobes, 0.5), 2 * L["lobes"]), g.math("ADD", 0.5, top))
    rel = g.math("SUBTRACT", dist, push)
    body = g.smooth(rel, 1.0, 0.6)
    wisp = g.noise(p, g.math("ADD", w, 4.2), L["wispScale"], 6, 0.6)
    eaten = g.smooth(g.math("SUBTRACT", wisp, g.math("MULTIPLY", g.math("SUBTRACT", 1.0, body), L["wisps"])), 0.25, 0.55)
    dens = g.math("MULTIPLY", g.math("MULTIPLY", body, eaten), L["density"])

    vol = g.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.9, 0.9, 0.92, 1)
    vol.inputs["Anisotropy"].default_value = 0.2
    vol.inputs["Absorption Color"].default_value = (0.25, 0.25, 0.28, 1)
    g.links.new(dens, vol.inputs["Density"])
    out = g.nodes.new("ShaderNodeOutputMaterial")
    g.links.new(vol.outputs[0], out.inputs["Volume"])
    box.data.materials.append(mat)

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 2.5
    sun_data.angle = math.radians(3)
    sun = bpy.data.objects.new("sun", sun_data)
    sun.rotation_euler = (math.radians(15), math.radians(-10), 0)  # from above (through the cloud)
    scene.collection.objects.link(sun)
    slot_data = bpy.data.lights.new("slot", "SUN")  # the bright horizon under the base edge
    slot_data.energy = 1.6
    slot_data.color = (1.0, 0.95, 0.85)
    slot_data.angle = math.radians(20)
    slot = bpy.data.objects.new("slot", slot_data)
    slot.rotation_euler = (math.radians(95), 0, math.radians(50))  # from just below the horizon, to one side
    scene.collection.objects.link(slot)
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.55, 0.6, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    scene.world = world

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.1
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, -10 * math.cos(math.radians(25)), -10 * math.sin(math.radians(25)))
    cam.rotation_euler = (math.radians(115), 0, 0)  # looking up at it, 25 degrees
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.engine = "CYCLES"
    scene.cycles.samples = a["samples"]
    scene.cycles.use_denoising = True
    scene.cycles.volume_bounces = 3
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
    return mat.node_tree.nodes["seed"]


def main():
    a = args()
    out_dir = os.path.abspath(a["out"])
    os.makedirs(out_dir, exist_ok=True)
    work = os.path.join(os.environ.get("CLAUDE_JOB_DIR", out_dir), "tmp", "puffs")
    os.makedirs(work, exist_ok=True)
    seed = build(a)
    scene = bpy.context.scene
    sheet = np.zeros((GRID * CELL, GRID * CELL, 4), dtype=np.float32)
    n = RENDER // CELL
    for i in range(GRID * GRID):
        seed.outputs[0].default_value = a["seed"] * 31.7 + i * 11.3
        path = os.path.join(work, f"p{i}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(RENDER, RENDER, 4)
        bpy.data.images.remove(img)
        cell = px.reshape(CELL, n, CELL, n, 4).mean(axis=(1, 3))
        edge = max(cell[0, :, 3].max(), cell[-1, :, 3].max(), cell[:, 0, 3].max(), cell[:, -1, 3].max())
        print(f"puff {i}: edge alpha {edge:.3f}")
        row, col = divmod(i, GRID)
        y0 = (GRID - 1 - row) * CELL
        sheet[y0:y0 + CELL, col * CELL:(col + 1) * CELL] = cell

    def save(pixels, name):
        img = bpy.data.images.new(name, pixels.shape[1], pixels.shape[0], alpha=True)
        img.pixels[:] = pixels.ravel()
        img.filepath_raw = os.path.join(out_dir, name)
        img.file_format = "PNG"
        img.save()

    save(sheet, f"{a['name']}.png")
    prev = sheet.copy()
    prev[..., :3] = sheet[..., :3] * sheet[..., 3:4] + np.array([0.42, 0.47, 0.55]) * (1 - sheet[..., 3:4])
    prev[..., 3] = 1
    save(prev, f"{a['name']}_preview.png")
    print("wrote", os.path.join(out_dir, f"{a['name']}.png"))


main()
