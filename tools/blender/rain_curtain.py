# The rain curtain: what a rain or hail shaft looks like from outside it, for camera-facing ribbons
# (Beams) hung from the cloud base to the ground (client/StormView). The texture scrolls down the
# ribbon as the rain falls. Rendered by Blender, headless:
#
#   blender --background --factory-startup --python tools/blender/rain_curtain.py -- \
#       --out roblox/assets/clouds --seed 1
#
# 512 x 1024 RGBA. It tiles top to bottom (the noise is sampled on a cylinder in v), so it can
# scroll; across it fades out at both sides, so ribbons overlap without edges. Fine streaks (the
# rain seen as a sheet), gathered into shafts that are denser in places (the noise wider across
# than the streaks, long down), in neutral grey (the game tints rain grey-blue and hail whiter).
#
# Writes rain_curtain.png and rain_curtain_preview.png (2 tiles high over a grey sky).
import bpy
import math
import os
import sys

import numpy as np

W, H = 512, 1024


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": "roblox/assets/clouds", "seed": 1}
    for i in range(0, len(argv) - 1, 2):
        key = argv[i].lstrip("-")
        out[key] = type(out[key])(argv[i + 1]) if key in out else argv[i + 1]
    return out


def node_math(nodes, links, op, a, b=None, value=None):
    n = nodes.new("ShaderNodeMath")
    n.operation = op
    links.new(a, n.inputs[0])
    if b is not None:
        links.new(b, n.inputs[1])
    elif value is not None:
        n.inputs[1].default_value = value
    return n.outputs[0]


def build(a):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    # A plane bigger than the view (edge pixels see texture, not background), x and y -1..1 seen.
    bpy.ops.mesh.primitive_plane_add(size=4)
    plane = bpy.context.object
    plane.scale = (1.0, 2.0, 1.0)  # the view is 1 wide, 2 tall
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 4.0
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, 0, 5)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = W, H

    mat = bpy.data.materials.new("rain")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    coord = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord.outputs["Object"], sep.inputs[0])
    # Object coords: x -1..1 across the view (plane scaled 2 tall: y -1..1 is the whole height).
    u = node_math(nodes, links, "MULTIPLY_ADD", sep.outputs[0], value=0.5)
    nodes[u.node.name].inputs[2].default_value = 0.5
    v = node_math(nodes, links, "MULTIPLY_ADD", sep.outputs[1], value=0.5)
    nodes[v.node.name].inputs[2].default_value = 0.5
    ang = node_math(nodes, links, "MULTIPLY", v, value=2 * math.pi)

    def cyl_noise(xscale, radius, scale, detail, rough, offset):
        vec = nodes.new("ShaderNodeCombineXYZ")
        links.new(node_math(nodes, links, "ADD", node_math(nodes, links, "MULTIPLY", u, value=xscale), value=offset), vec.inputs[0])
        links.new(node_math(nodes, links, "MULTIPLY", node_math(nodes, links, "COSINE", ang), value=radius), vec.inputs[1])
        links.new(node_math(nodes, links, "MULTIPLY", node_math(nodes, links, "SINE", ang), value=radius), vec.inputs[2])
        n = nodes.new("ShaderNodeTexNoise")
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        links.new(vec.outputs[0], n.inputs["Vector"])
        return n.outputs["Fac"]

    s = a["seed"] * 13.1
    # Streaks: fine across, long down (small radius: few features round the cylinder).
    streak = cyl_noise(60.0, 0.35, 1.0, 3, 0.5, s)
    # Shafts: broad across, slowly varying down.
    shaft = cyl_noise(3.0, 0.5, 1.0, 4, 0.55, s + 40)
    sm = nodes.new("ShaderNodeMapRange")
    sm.interpolation_type = "SMOOTHSTEP"
    sm.inputs["From Min"].default_value = 0.35
    sm.inputs["From Max"].default_value = 0.7
    links.new(shaft, sm.inputs["Value"])
    st = nodes.new("ShaderNodeMapRange")
    st.inputs["From Min"].default_value = 0.35
    st.inputs["From Max"].default_value = 0.75
    st.inputs["To Min"].default_value = 0.35
    links.new(streak, st.inputs["Value"])
    # Soft sides.
    side = nodes.new("ShaderNodeMapRange")
    side.interpolation_type = "SMOOTHSTEP"
    side.inputs["From Min"].default_value = 0.0
    side.inputs["From Max"].default_value = 0.3
    dist_edge = node_math(nodes, links, "MINIMUM", u, node_math(nodes, links, "SUBTRACT", node_math(nodes, links, "MULTIPLY", u, value=-1.0), value=-1.0))
    links.new(dist_edge, side.inputs["Value"])
    alpha = node_math(nodes, links, "MULTIPLY", node_math(nodes, links, "MULTIPLY", sm.outputs["Result"], st.outputs["Result"]), side.outputs["Result"])
    alpha = node_math(nodes, links, "MULTIPLY", alpha, value=0.85)

    emit = nodes.new("ShaderNodeEmission")
    emit.inputs["Color"].default_value = (0.85, 0.87, 0.9, 1)
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(alpha, mix.inputs["Fac"])
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
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"


def main():
    a = args()
    out_dir = os.path.abspath(a["out"])
    os.makedirs(out_dir, exist_ok=True)
    build(a)
    scene = bpy.context.scene
    path = os.path.join(out_dir, "rain_curtain.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    seam = float(np.abs(px[0] - px[-1]).mean())
    print(f"vertical seam mean jump {seam:.4f}, mean alpha {px[..., 3].mean():.3f}")
    tiled = np.concatenate([px, px], axis=0)
    rgb = tiled[..., :3] * tiled[..., 3:4] + np.array([0.45, 0.48, 0.53]) * (1 - tiled[..., 3:4])
    prev = bpy.data.images.new("prev", W, 2 * H, alpha=True)
    prev.pixels[:] = np.concatenate([rgb, np.ones_like(tiled[..., :1])], axis=2).ravel()
    prev.filepath_raw = os.path.join(out_dir, "rain_curtain_preview.png")
    prev.file_format = "PNG"
    prev.save()
    print("wrote", path)


main()
