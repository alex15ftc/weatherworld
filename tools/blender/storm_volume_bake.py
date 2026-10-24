# Real volumetric cloud textures for the lab storm (TornadoLab), rendered by Blender (Cycles):
#
#   blender --background --factory-startup --python tools/blender/storm_volume_bake.py -- \
#       --what base --out roblox/assets/clouds --size 1024
#   ... --what funnel --size 512
#
#   base    the storm base's underside seen from straight below: a slab of cloud whose lumpy
#           bottom and inner density come from 4D noise on a torus, so the texture tiles both
#           ways. Lit by the sun from above (light comes through, darker where the cloud is
#           thick) and a dim grey sky from the sides. Opaque RGB; the game multiplies it into the
#           base's own colours (StormBase).
#   funnel  a condensation funnel's column seen from the side (orthographic): a vertical cylinder
#           of cloud whose ragged edge and banded density come from torus noise in (angle round,
#           height), so it tiles top to bottom (the game scrolls it upward: the condensation
#           rising). Lit softly from the front and sky. RGBA: the alpha is the soft volumetric
#           edge. The game maps it across the funnel's visible width (RibbonFunnel, "baked").
#
# Writes <what>_volume.png and <what>_volume_tiled.png (2 x 2 / 1 x 2, to check the seams).
import bpy
import math
import os
import sys

import numpy as np


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": "roblox/assets/clouds", "size": 1024, "seed": 5, "what": "base", "samples": 96}
    for i in range(0, len(argv) - 1, 2):
        key = argv[i].lstrip("-")
        out[key] = type(out[key])(argv[i + 1]) if key in out else argv[i + 1]
    return out


def M(nodes, links, op, a, b=None, value=None, addend=None):
    n = nodes.new("ShaderNodeMath")
    n.operation = op
    if isinstance(a, (int, float)):
        n.inputs[0].default_value = a
    else:
        links.new(a, n.inputs[0])
    if b is not None:
        links.new(b, n.inputs[1])
    elif value is not None:
        n.inputs[1].default_value = value
    if addend is not None:
        n.inputs[2].default_value = addend
    return n.outputs[0]


def torus_noise(nodes, links, u, v, around, up, seed, detail, roughness, distortion=0.0):
    """4D noise on a torus: periodic in u and v (each 0..1)."""
    a = M(nodes, links, "MULTIPLY", u, value=2 * math.pi)
    b = M(nodes, links, "MULTIPLY", v, value=2 * math.pi)
    r1, r2 = around / math.pi, up / math.pi
    x = M(nodes, links, "MULTIPLY", M(nodes, links, "COSINE", a), value=r1)
    y = M(nodes, links, "MULTIPLY", M(nodes, links, "SINE", a), value=r1)
    z = M(nodes, links, "MULTIPLY", M(nodes, links, "COSINE", b), value=r2)
    w = M(nodes, links, "MULTIPLY", M(nodes, links, "SINE", b), value=r2)
    z = M(nodes, links, "ADD", z, value=seed * 17.3)
    w = M(nodes, links, "ADD", w, value=seed * 7.9)
    vec = nodes.new("ShaderNodeCombineXYZ")
    links.new(x, vec.inputs[0])
    links.new(y, vec.inputs[1])
    links.new(z, vec.inputs[2])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 1.0
    noise.inputs["Detail"].default_value = detail
    noise.inputs["Roughness"].default_value = roughness
    noise.inputs["Distortion"].default_value = distortion
    links.new(vec.outputs[0], noise.inputs["Vector"])
    links.new(w, noise.inputs["W"])
    return noise.outputs["Fac"]


def smooth(nodes, links, x, a, b):
    n = nodes.new("ShaderNodeMapRange")
    n.interpolation_type = "SMOOTHSTEP"
    n.inputs["From Min"].default_value = a
    n.inputs["From Max"].default_value = b
    links.new(x, n.inputs["Value"])
    return n.outputs["Result"]


def setup_render(scene, size_x, size_y, samples):
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.volume_bounces = 6
    scene.cycles.max_bounces = 8
    scene.cycles.volume_step_rate = 1.0
    scene.render.resolution_x, scene.render.resolution_y = size_x, size_y
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_depth = "8"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception as e:
        print("GPU not used:", e)


def world(scene, colour, strength):
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*colour, 1)
    bg.inputs["Strength"].default_value = strength
    scene.world = w


def storm_sky(scene, zenith, horizon, ground, glow_dir, glow):
    """Under a storm: dark overhead, a bright band along the horizon (strongest toward glow_dir,
    the clear slot under the base edge), dim ground below. Light from the horizon catches the
    sides of the base's lumps (what shows their relief from below)."""
    w = bpy.data.worlds.new("storm")
    w.use_nodes = True
    nodes, links = w.node_tree.nodes, w.node_tree.links
    nodes.clear()
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord.outputs["Generated"], sep.inputs[0])
    # world "Generated" coordinates are the view direction
    z = sep.outputs[2]
    toward = M(nodes, links, "ADD", M(nodes, links, "MULTIPLY", sep.outputs[0], value=glow_dir[0]),
               M(nodes, links, "MULTIPLY", sep.outputs[1], value=glow_dir[1]))
    band = M(nodes, links, "POWER", M(nodes, links, "SUBTRACT", 1.0, M(nodes, links, "ABSOLUTE", z)), value=6.0)
    side = M(nodes, links, "MULTIPLY_ADD", toward, value=0.5, addend=0.5)
    glowAmt = M(nodes, links, "MULTIPLY", M(nodes, links, "MULTIPLY", band, M(nodes, links, "POWER", side, value=2.0)), value=glow)
    up = smooth(nodes, links, z, -0.05, 0.4)
    base = nodes.new("ShaderNodeMix")
    base.data_type = "RGBA"
    base.inputs["A"].default_value = (*ground, 1)
    base.inputs["B"].default_value = (*zenith, 1)
    links.new(up, base.inputs["Factor"])
    add = nodes.new("ShaderNodeMix")
    add.data_type = "RGBA"
    add.blend_type = "ADD"
    add.inputs["Factor"].default_value = 1.0
    links.new(base.outputs["Result"], add.inputs["A"])
    hz = nodes.new("ShaderNodeMix")
    hz.data_type = "RGBA"
    hz.blend_type = "MULTIPLY"
    hz.inputs["Factor"].default_value = 1.0
    hz.inputs["A"].default_value = (*horizon, 1)
    comb = nodes.new("ShaderNodeCombineXYZ")
    links.new(glowAmt, comb.inputs[0])
    links.new(glowAmt, comb.inputs[1])
    links.new(glowAmt, comb.inputs[2])
    links.new(comb.outputs[0], hz.inputs["B"])
    links.new(hz.outputs["Result"], add.inputs["B"])
    bg = nodes.new("ShaderNodeBackground")
    links.new(add.outputs["Result"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    out = nodes.new("ShaderNodeOutputWorld")
    links.new(bg.outputs[0], out.inputs["Surface"])
    scene.world = w


def sun(rot_deg, strength, angle_deg=3.0):
    d = bpy.data.lights.new("sun", "SUN")
    d.energy = strength
    d.angle = math.radians(angle_deg)
    o = bpy.data.objects.new("sun", d)
    o.rotation_euler = tuple(math.radians(r) for r in rot_deg)
    bpy.context.scene.collection.objects.link(o)


def volume_material(name, density_socket_builder, colour=(0.92, 0.93, 0.95), anisotropy=0.35):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    dens = density_socket_builder(nodes, links)
    vol = nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (*colour, 1)
    vol.inputs["Anisotropy"].default_value = anisotropy
    links.new(dens, vol.inputs["Density"])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(vol.outputs[0], out.inputs["Volume"])
    return mat


def build_base(a):
    """A cloud slab 0..T thick over x, y in -2..2 (the camera sees -1..1); its bottom is lumpy."""
    scene = bpy.context.scene
    T = 0.5  # slab thickness (the view is 2 wide)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, T / 2 - 0.1))
    slab = bpy.context.object
    slab.scale = (4.2, 4.2, T + 0.2)

    def density(nodes, links):
        coord = nodes.new("ShaderNodeTexCoord")
        sep = nodes.new("ShaderNodeSeparateXYZ")
        links.new(coord.outputs["Object"], sep.inputs[0])
        # object coords: x, y in -0.5..0.5 x scale -> world -2.1..2.1; use world-ish via Generated? Use Object * scale
        x = M(nodes, links, "MULTIPLY", sep.outputs[0], value=4.2)
        y = M(nodes, links, "MULTIPLY", sep.outputs[1], value=4.2)
        z = M(nodes, links, "ADD", M(nodes, links, "MULTIPLY", sep.outputs[2], value=T + 0.2), value=T / 2 - 0.1)
        u = M(nodes, links, "MULTIPLY_ADD", x, value=0.5, addend=0.5)  # one period per 2 units
        v = M(nodes, links, "MULTIPLY_ADD", y, value=0.5, addend=0.5)
        # the bottom: broad lumps + medium + fine, hanging down to -0.12
        broad = torus_noise(nodes, links, u, v, 2.5, 2.5, a["seed"], 4, 0.5)
        mid = torus_noise(nodes, links, u, v, 7, 7, a["seed"] + 31, 6, 0.55, 0.3)
        fine = torus_noise(nodes, links, u, v, 22, 22, a["seed"] + 77, 8, 0.6, 0.6)
        bottom = M(nodes, links, "ADD",
                   M(nodes, links, "MULTIPLY", M(nodes, links, "SUBTRACT", broad, value=0.5), value=0.7),
                   M(nodes, links, "ADD",
                     M(nodes, links, "MULTIPLY", M(nodes, links, "SUBTRACT", mid, value=0.5), value=0.35),
                     M(nodes, links, "MULTIPLY", M(nodes, links, "SUBTRACT", fine, value=0.5), value=0.05)))
        bottom = M(nodes, links, "ADD", bottom, value=0.12)  # the bottom surface's height
        # inside: denser with height; soft bottom edge (~0.05 thick), wispy where fine noise is low
        above = M(nodes, links, "SUBTRACT", z, bottom)
        edge = smooth(nodes, links, above, -0.02, 0.06)
        body = smooth(nodes, links, z, -0.1, T)
        wisp = smooth(nodes, links, fine, 0.2, 0.55)
        d = M(nodes, links, "MULTIPLY", edge, M(nodes, links, "ADD", M(nodes, links, "MULTIPLY", body, value=1.5), value=0.5))
        d = M(nodes, links, "MULTIPLY", d, M(nodes, links, "ADD", M(nodes, links, "MULTIPLY", wisp, value=0.4), value=0.6))
        return M(nodes, links, "MULTIPLY", d, value=float(a.get("density", 9)))

    slab.data.materials.append(volume_material("base", density))
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2
    cam_data.clip_end = 100
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, 0, -3)
    cam.rotation_euler = (math.pi, 0, 0)  # looking straight up
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun((15, 10, 0), 4.0)  # from high above (light comes down through the slab)
    storm_sky(scene, zenith=(0.05, 0.06, 0.07), horizon=(0.95, 0.92, 0.85), ground=(0.08, 0.1, 0.07),
              glow_dir=(1.0, 0.3), glow=2.5)
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGB"
    setup_render(scene, a["size"], a["size"], a["samples"])


def build_funnel(a):
    """A vertical cylinder of cloud (radius 1) seen from the side; tiles top to bottom (height 2)."""
    scene = bpy.context.scene
    H = 2.0
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    box = bpy.context.object
    box.scale = (1.2, 1.2, H * 2.2)

    def density(nodes, links):
        coord = nodes.new("ShaderNodeTexCoord")
        sep = nodes.new("ShaderNodeSeparateXYZ")
        links.new(coord.outputs["Object"], sep.inputs[0])
        x = M(nodes, links, "MULTIPLY", sep.outputs[0], value=1.2)
        y = M(nodes, links, "MULTIPLY", sep.outputs[1], value=1.2)
        z = M(nodes, links, "MULTIPLY", sep.outputs[2], value=H * 2.2)
        r = M(nodes, links, "SQRT", M(nodes, links, "ADD", M(nodes, links, "MULTIPLY", x, x), M(nodes, links, "MULTIPLY", y, y)))
        ang = M(nodes, links, "ARCTAN2", y, x)
        u = M(nodes, links, "MULTIPLY_ADD", ang, value=1 / (2 * math.pi), addend=0.5)  # round the axis 0..1
        v = M(nodes, links, "MULTIPLY_ADD", z, value=1 / H, addend=0.5)  # one period per H
        # banding: features longer round the funnel than up it (spiral striations)
        band = torus_noise(nodes, links, u, v, 1.5, 4.0, a["seed"], 5, 0.5, 0.15)
        lump = torus_noise(nodes, links, u, v, 3.0, 3.0, a["seed"] + 13, 5, 0.55, 0.2)
        fine = torus_noise(nodes, links, u, v, 7.0, 8.0, a["seed"] + 51, 6, 0.55, 0.25)
        # the edge radius wanders (ragged), with fine tufts
        rad = M(nodes, links, "ADD", value=0.0, a=M(nodes, links, "MULTIPLY", M(nodes, links, "SUBTRACT", lump, value=0.5), value=0.12),
                b=M(nodes, links, "MULTIPLY", M(nodes, links, "SUBTRACT", fine, value=0.5), value=0.06))
        rad = M(nodes, links, "ADD", rad, value=0.36)
        inside = M(nodes, links, "SUBTRACT", rad, r)  # >0 inside
        edge = smooth(nodes, links, inside, -0.03, 0.1)
        bandc = smooth(nodes, links, band, 0.3, 0.7)  # stronger contrast: denser bands, thin gaps
        dens = M(nodes, links, "MULTIPLY", edge, M(nodes, links, "ADD", M(nodes, links, "MULTIPLY", bandc, value=1.6), value=0.15))
        return M(nodes, links, "MULTIPLY", dens, value=float(a.get("density", 6)))

    box.data.materials.append(volume_material("funnel", density, colour=(0.93, 0.94, 0.95), anisotropy=0.25))
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = H  # the view: 2 wide x 2 tall when square; funnel image is 1 x 2 (width 2, height H)
    cam_data.clip_end = 100
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, -6, 0)
    cam.rotation_euler = (math.pi / 2, 0, 0)  # looking along +y at the column
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun((75, 0, -55), 5.0)  # from the front-left, low: shading round the column
    world(scene, (0.55, 0.6, 0.66), 0.45)
    scene.render.film_transparent = True
    scene.render.image_settings.color_mode = "RGBA"
    setup_render(scene, a["size"], a["size"] * 2, a["samples"])  # 1 wide x 2 tall: one vertical period


def preview(path, out, nx, ny):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    big = np.tile(px, (ny, nx, 1))
    rgb = big[..., :3] * big[..., 3:4] + 0.15 * (1 - big[..., 3:4])
    flat = np.concatenate([rgb, np.ones_like(big[..., :1])], axis=2)
    prev = bpy.data.images.new("prev", nx * w, ny * h, alpha=True)
    prev.pixels[:] = flat.ravel()
    prev.filepath_raw = out
    prev.file_format = "PNG"
    prev.save()


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if a["what"] == "base":
        build_base(a)
    else:
        build_funnel(a)
    out_dir = os.path.abspath(a["out"])
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f"{a['what']}_volume.png")
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    if a["what"] == "base":
        preview(path, os.path.join(out_dir, f"{a['what']}_volume_tiled.png"), 2, 2)
    else:
        preview(path, os.path.join(out_dir, f"{a['what']}_volume_tiled.png"), 1, 2)
    print("wrote", path)


main()
