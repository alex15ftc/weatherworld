# The cloud texture for a tornado funnel's shells in Roblox (the shells scroll it round and up to
# show the rotation; see roblox/src/client/StormView.luau). Rendered by Blender, headless:
#
#   blender --background --factory-startup --python tools/blender/funnel_texture.py -- \
#       --out roblox/assets/tornado --size 1024 --seed 3 --variant core
#
# The texture tiles both ways: Blender's 4D noise is sampled on a torus, u (round the funnel) on
# one circle and v (up it) on the other, so the left edge meets the right and the top the bottom.
# The noise runs longer round the funnel than up it (aroundFeatures < upFeatures), giving the
# horizontal banding of a condensation funnel's surface; the shells' UV shear turns that into the
# spiral. Grey is left mid-to-light (the part's colour and Roblox's light do the shading); alpha
# makes the wisps.
#
# Variants: "core" (the inner shell: mostly opaque, finer texture) and "wisp" (the outer shell:
# torn, mostly transparent).
#
# Writes <variant>.png (RGBA) and <variant>_tiled.png (2 x 2, for checking the seams by eye).
import bpy
import math
import os
import sys

import numpy as np

VARIANTS = {
    # aroundFeatures/upFeatures: how many noise features fit round the funnel and up it.
    # cover: the share of the texture that is cloud; soft: how gradually cloud fades into gaps.
    "core": dict(aroundFeatures=1.6, upFeatures=7.0, detail=9, roughness=0.58, cover=0.85, soft=0.25, grey=(0.55, 0.95)),
    "wisp": dict(aroundFeatures=1.2, upFeatures=5.0, detail=10, roughness=0.62, cover=0.45, soft=0.18, grey=(0.65, 1.0)),
}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": "roblox/assets/tornado", "size": 1024, "seed": 3, "variant": "core"}
    for i in range(0, len(argv) - 1, 2):
        key = argv[i].lstrip("-")
        out[key] = type(out[key])(argv[i + 1]) if key in out else argv[i + 1]
    return out


def math_node(nodes, links, op, a, b=None, value=None, addend=None):
    n = nodes.new("ShaderNodeMath")
    n.operation = op
    links.new(a, n.inputs[0])
    if b is not None:
        links.new(b, n.inputs[1])
    elif value is not None:
        n.inputs[1].default_value = value
    if addend is not None:
        n.inputs[2].default_value = addend
    return n.outputs[0]


def torus_noise(nodes, links, u, v, around, up, seed, detail, roughness):
    """4D noise on a torus: tiles in u and v. The radii set how many features fit each way."""
    a = math_node(nodes, links, "MULTIPLY", u, value=2 * math.pi)
    b = math_node(nodes, links, "MULTIPLY", v, value=2 * math.pi)
    r1, r2 = around / math.pi, up / math.pi
    x = math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "COSINE", a), value=r1)
    y = math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "SINE", a), value=r1)
    z = math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "COSINE", b), value=r2)
    w = math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "SINE", b), value=r2)
    # The seed moves the sample far from the origin, in all four dimensions.
    z = math_node(nodes, links, "ADD", z, value=seed * 17.3)
    w = math_node(nodes, links, "ADD", w, value=seed * 7.9)
    vec = nodes.new("ShaderNodeCombineXYZ")
    links.new(x, vec.inputs[0])
    links.new(y, vec.inputs[1])
    links.new(z, vec.inputs[2])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 1.0
    noise.inputs["Detail"].default_value = detail
    noise.inputs["Roughness"].default_value = roughness
    links.new(vec.outputs[0], noise.inputs["Vector"])
    links.new(w, noise.inputs["W"])
    return noise.outputs["Fac"]


def build(p, seed):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    # Bigger than the camera's view, so the edge pixels' filter sees texture, not background (the
    # torus noise repeats on past 0-1 by itself).
    bpy.ops.mesh.primitive_plane_add(size=4)
    plane = bpy.context.object
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, 0, 5)
    scene.collection.objects.link(cam)
    scene.camera = cam

    mat = bpy.data.materials.new("funnel")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord.outputs["Object"], sep.inputs[0])
    # The camera sees x and y from -1 to 1: u and v run 0-1 across it.
    u = math_node(nodes, links, "MULTIPLY_ADD", sep.outputs[0], value=0.5, addend=0.5)
    v = math_node(nodes, links, "MULTIPLY_ADD", sep.outputs[1], value=0.5, addend=0.5)

    # Grey: the fine structure. Cover: a second, broader noise for where cloud is.
    fine = torus_noise(nodes, links, u, v, p["aroundFeatures"] * 2, p["upFeatures"] * 2, seed, p["detail"], p["roughness"])
    broad = torus_noise(nodes, links, u, v, p["aroundFeatures"], p["upFeatures"], seed + 101, p["detail"] - 2, p["roughness"])

    grey = nodes.new("ShaderNodeMapRange")
    grey.inputs["From Min"].default_value = 0.3
    grey.inputs["From Max"].default_value = 0.7
    grey.inputs["To Min"].default_value = p["grey"][0]
    grey.inputs["To Max"].default_value = p["grey"][1]
    links.new(fine, grey.inputs["Value"])

    # Noise sits near 0.5; the threshold puts `cover` of the texture above it.
    threshold = 0.5 - (p["cover"] - 0.5) * 0.35
    # Where cloud is: the broad noise, its edges broken by the fine (centred on 0, so the
    # threshold keeps its meaning).
    edges = math_node(nodes, links, "MULTIPLY", math_node(nodes, links, "SUBTRACT", fine, value=0.5), value=0.35)
    alpha = nodes.new("ShaderNodeMapRange")
    alpha.interpolation_type = "SMOOTHSTEP"
    alpha.inputs["From Min"].default_value = threshold - p["soft"] / 2
    alpha.inputs["From Max"].default_value = threshold + p["soft"] / 2
    links.new(math_node(nodes, links, "ADD", broad, edges), alpha.inputs["Value"])
    alpha_adj = alpha.outputs["Result"]

    emit = nodes.new("ShaderNodeEmission")
    links.new(grey.outputs["Result"], emit.inputs["Color"])
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(alpha_adj, mix.inputs["Fac"])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emit.outputs[0], mix.inputs[2])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(mix.outputs[0], out.inputs["Surface"])
    plane.data.materials.append(mat)

    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "OPTIX"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception as e:  # CPU is fine, just slower
        print("GPU not used:", e)


def tile_preview(path, out):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    big = np.tile(px, (2, 2, 1))
    # Over a dark ground, so the alpha shows.
    rgb = big[..., :3] * big[..., 3:4] + 0.12 * (1 - big[..., 3:4])
    flat = np.concatenate([rgb, np.ones_like(big[..., :1])], axis=2)
    prev = bpy.data.images.new("tiled", 2 * w, 2 * h, alpha=True)
    prev.pixels[:] = flat.ravel()
    prev.filepath_raw = out
    prev.file_format = "PNG"
    prev.save()


def main():
    a = args()
    p = VARIANTS[a["variant"]]
    out_dir = os.path.abspath(a["out"])
    os.makedirs(out_dir, exist_ok=True)
    build(p, a["seed"])
    scene = bpy.context.scene
    scene.render.resolution_x = scene.render.resolution_y = a["size"]
    path = os.path.join(out_dir, f"funnel_{a['variant']}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    tile_preview(path, os.path.join(out_dir, f"funnel_{a['variant']}_tiled.png"))
    print("wrote", path)


main()
