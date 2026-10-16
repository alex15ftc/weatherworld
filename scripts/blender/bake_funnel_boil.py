"""Bakes the close-up funnel's edge boil from the owner's tornado (tz_0037_cone_R.blend): looping
frames of the funnel's own density, unwrapped onto the skinned funnel's UVs (u round it, v up it,
ground to cloud base; scripts/blender/build_funnel_rig.py), for the SurfaceAppearances the game
swaps through (roblox/Client/Modules/Weather/TornadoMesh.luau).

    blender -b <tz_0037_cone_R.blend> --python scripts/blender/bake_funnel_boil.py -- \
        --out <dir> [--frames 64] [--size 512]

The .blend's TornadoDomain is a volume whose density is computed from the point's position, the
P_* shape and the tz_* life (tz_t is its clock). Here that density is put on surfaces instead:
1. a vertical slice through the axis gives the funnel's radius at each height;
2. two tubes, the core (SHELLS["core"] of that radius) and the skin (further out, where the edge
   breaks up), get the density at their surface baked to images, as tz_t runs on.
The funnel is held upright (no lean or snake: the game leans its mesh) at its mature stage. 2 x
frames instants are baked and cross-faded so the last frame runs into the first.
Writes <out>/<shell>/fNNN.png (RGBA: grey, darker where denser; alpha from the density) and
<out>/boil.json. The file on disk is never saved.
"""

import json
import math
import os
import sys

import bpy
import numpy as np

SHELLS = {"core": 0.9, "skin": 1.03}
GAIN = {"core": 2.5, "skin": 4.0}  # alpha = 1 - exp(-density / reference x GAIN)
MATURE_FRAME = 96  # in the .blend's life curves: mature, looping
SECONDS = 4.0  # tz_t covered by one loop
CLOUD_BASE = 105.0
AROUND, ROWS = 96, 64  # the bake tubes' grid
SLICE = 256


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": None, "frames": 64, "size": 512}
    for i in range(0, len(argv), 2):
        key, value = argv[i].lstrip("-"), argv[i + 1]
        out[key] = value if key == "out" else int(value)
    if not out["out"]:
        raise SystemExit("--out is required")
    return out


def gpu():
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            bpy.context.scene.cycles.device = "GPU"
            return kind
    bpy.context.scene.cycles.device = "CPU"
    return "CPU"


def life_curves(domain):
    action = domain.animation_data.action
    try:
        curves = list(action.fcurves)
    except Exception:
        curves = [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    return {fc.data_path.strip('[]"'): fc for fc in curves}


def surface_material(volume):
    """The volume's material with its density as a surface emission (grey = density / 8, so
    densities up to 8 fit), plus an image node to bake into."""
    mat = volume.copy()
    mat.name = "BoilBake"
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeOutputMaterial")
    scatter = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeVolumeScatter")
    density = scatter.inputs["Density"].links[0].from_socket
    for link in list(out.inputs["Volume"].links):
        nt.links.remove(link)
    scale = nt.nodes.new("ShaderNodeMath")
    scale.operation = "MULTIPLY"
    scale.inputs[1].default_value = 1 / 8
    scale.use_clamp = True
    nt.links.new(density, scale.inputs[0])
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(scale.outputs[0], emit.inputs["Color"])
    nt.links.new(emit.outputs[0], out.inputs["Surface"])
    image = nt.nodes.new("ShaderNodeTexImage")
    nt.nodes.active = image
    return mat, image


def mesh_object(name, verts, faces, uvs, props, mat):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            layer.data[li].uv = uvs[mesh.loops[li].vertex_index]
    mesh.materials.append(mat)
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    for key, value in props.items():
        ob[key] = value
    return ob


def bake(ob, image):
    for other in bpy.context.scene.objects:
        other.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    ob.active_material.node_tree.nodes.active.image = image
    bpy.ops.object.bake(type="EMIT", margin=2)
    w, h = image.size
    return np.array(image.pixels[:], dtype=np.float32).reshape(h, w, 4)[:, :, 0] * 8  # density


def tube(name, radius_at, props, mat):
    verts, uvs, faces = [], [], []
    for j in range(ROWS + 1):
        v = j / ROWS
        r = radius_at(v)
        for i in range(AROUND + 1):
            a = 2 * math.pi * i / AROUND
            verts.append((math.cos(a) * r, math.sin(a) * r, v * CLOUD_BASE))
            uvs.append((i / AROUND, v))
    for j in range(ROWS):
        for i in range(AROUND):
            v0 = j * (AROUND + 1) + i
            faces.append((v0, v0 + 1, v0 + AROUND + 2, v0 + AROUND + 1))
    return mesh_object(name, verts, faces, uvs, props, mat)


def main():
    a = args()
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    device = gpu()
    scene.cycles.samples = 4
    domain = bpy.data.objects["TornadoDomain"]
    props = {k: domain[k] for k in domain.keys() if k.startswith(("P_", "tz_"))}
    for key, fc in life_curves(domain).items():
        props[key] = fc.evaluate(MATURE_FRAME)
    props["tz_lean"], props["tz_snake"] = 0.0, 0.0
    t0 = props["tz_t"]
    mat, image_node = surface_material(domain.active_material)
    domain.hide_render = True

    # 1. The slice: x across (-60..60), z up (0..CLOUD_BASE); its rows give the radius.
    half = 64.0
    slice_ob = mesh_object("Slice", [(-half, 0, 0), (half, 0, 0), (half, 0, CLOUD_BASE), (-half, 0, CLOUD_BASE)],
                           [(0, 1, 2, 3)], [(0, 0), (1, 0), (1, 1), (0, 1)], props, mat)
    img = bpy.data.images.new("slice", SLICE, SLICE, float_buffer=True)
    density = bake(slice_ob, img)
    reference = float(np.percentile(density[density > 1e-3], 90)) if (density > 1e-3).any() else 1.0
    xs = (np.arange(SLICE) + 0.5) / SLICE * 2 * half - half
    radii = []
    for row in density:
        inside = np.abs(xs[row > reference * 0.35])
        radii.append(float(inside.max()) if inside.size else 0.0)
    radii = np.array(radii)
    # Smooth, and give the uncondensed rows the nearest condensed radius.
    filled = radii.copy()
    known = np.nonzero(radii > 0)[0]
    if known.size:
        filled = np.interp(np.arange(SLICE), known, radii[known])
    filled = np.convolve(np.pad(filled, 4, mode="edge"), np.ones(9) / 9, mode="valid")
    radius_at = lambda v: float(np.interp(v * (SLICE - 1), np.arange(SLICE), filled))
    bpy.data.objects.remove(slice_ob)
    print(f"[boil] device {device}; density reference {reference:.3f}; radius {filled[0]:.1f} at the ground, {filled[SLICE // 2]:.1f} halfway, {filled[-1]:.1f} at the base", flush=True)

    # 2. The shells, baked at 2 x frames instants.
    n, size = a["frames"], a["size"]
    raw = {}
    for shell, share in SHELLS.items():
        ob = tube(f"Shell_{shell}", lambda v, s=share: max(0.5, radius_at(v) * s), props, mat)
        img = bpy.data.images.new(f"bake_{shell}", size, size, float_buffer=True)
        frames = []
        for k in range(2 * n):
            ob["tz_t"] = t0 + SECONDS * k / n
            ob.update_tag()
            frames.append(bake(ob, img))
            if k % 16 == 15:
                print(f"[boil] {shell}: {k + 1} of {2 * n}", flush=True)
        raw[shell] = frames
        ob.hide_render = True

    # 3. The loop: frame k fades from the instant k + n into the instant k, so frame n - 1
    # runs on into frame 0 (the instant n). Then density to colour and alpha.
    for shell, frames in raw.items():
        folder = os.path.join(a["out"], shell)
        os.makedirs(folder, exist_ok=True)
        out = bpy.data.images.new(f"out_{shell}", size, size, alpha=True)
        for k in range(n):
            w = k / n
            d = frames[k] * w + frames[k + n] * (1 - w)
            alpha = 1 - np.exp(-d / reference * GAIN[shell])
            grey = 0.72 - 0.22 * np.clip(d / reference, 0, 1)
            rgba = np.stack([grey, grey, grey * 1.03, alpha], axis=-1).clip(0, 1)
            out.pixels[:] = rgba.ravel()
            out.filepath_raw = os.path.join(folder, f"f{k:03d}.png")
            out.file_format = "PNG"
            out.save()
    json.dump({"frames": n, "seconds": SECONDS, "shells": SHELLS, "size": size,
               "radiusShare": [float(r) / CLOUD_BASE for r in filled[:: SLICE // 32]]},
              open(os.path.join(a["out"], "boil.json"), "w"), indent=2)
    print(f"[boil] wrote {n} frames x {len(SHELLS)} shells -> {a['out']}", flush=True)


main()
