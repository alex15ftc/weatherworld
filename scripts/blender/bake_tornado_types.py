"""Bakes tornado types from the owner's procedural tornado (tz_0037_cone_R.blend), the look the game
uses for its tornadoes, for upload as the game's tornado sheets.

    blender -b <tz_0037_cone_R.blend> --python scripts/blender/bake_tornado_types.py -- \
        --out <dir> [--types cone,wedge] [--frames 64] [--size 128]

The .blend's TornadoDomain is a Cycles volume driven by object properties: P_* give the funnel's
shape (radii, taper, flare, spin, noise, dust, cloud collar, density) and tz_* its life (tip
height, collar, lean, snake, erosion), keyframed over 256 frames: lowering, mature (looping),
roping out, gone. A type is P_* values and, where it needs them, floors on the life curves (a
rope always leans; a partial wedge's tip never reaches the ground).

Each frame renders the tornado from 8 sides at once: 8 copies of the domain in a row, each turned
another 45 degrees, under one wide orthographic camera (the volume shader is switched from world
to object coordinates so a copy keeps its own funnel; at the origin the two are the same). Writes
<out>/<type>/f<NNN>.png, a strip of the 8 sides (camera bearings 0, 45 ... 315); scripts/
pack-tornado-strips.py turns them into the game's sheets. The file on disk is never saved.
"""

import math
import os
import sys
import time

import bpy

VIEWS = [0, 45, 90, 135, 180, 225, 270, 315]

# Types: P_* shape values (anything not given keeps the original cone's) and floors / scales on
# the life curves. Units are the .blend's: the domain is 129 across, the cloud base ~105 up.
TYPES = {
    "cone": {},
    "stovepipe": {"P": {"P_Funnel_Radius_Ground": 13.0, "P_Funnel_Radius_Top": 17.0, "P_Funnel_Taper": 1.0, "P_Funnel_Flare": 0.25, "P_Density": 0.9}},
    "wedge": {"P": {"P_Funnel_Radius_Ground": 34.0, "P_Funnel_Radius_Top": 44.0, "P_Funnel_Taper": 0.8, "P_Funnel_Flare": 0.3, "P_Cloud_Radius": 62.0, "P_Density": 0.95, "P_Noise_Coarse": 0.4, "P_Dust_Radius": 30.0}},
    "partial-wedge": {"P": {"P_Funnel_Radius_Ground": 30.0, "P_Funnel_Radius_Top": 42.0, "P_Funnel_Taper": 0.9, "P_Funnel_Flare": 0.35, "P_Cloud_Radius": 60.0, "P_Density": 0.9, "P_Dust_Radius": 28.0, "P_Dust_Height": 26.0}, "tipFloor": 35.0, "dustScale": 1.3},
    "drillbit": {"P": {"P_Funnel_Radius_Ground": 1.8, "P_Funnel_Radius_Top": 5.5, "P_Funnel_Taper": 1.3, "P_Funnel_Flare": 0.2, "P_Cloud_Radius": 38.0}, "snakeScale": 0.4, "leanScale": 0.3},
    "rope": {"P": {"P_Funnel_Radius_Ground": 1.4, "P_Funnel_Radius_Top": 4.0, "P_Funnel_Taper": 1.1, "P_Funnel_Flare": 0.25, "P_Cloud_Radius": 40.0}, "leanFloor": 4.0, "snakeFloor": 6.0},
    "elephant-trunk": {"leanFloor": 5.0, "snakeFloor": 3.0},
    "uncondensed": {"P": {"P_Dust_Radius": 16.0, "P_Dust_Height": 34.0}, "tipFloor": 80.0, "dustScale": 1.4},
}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": None, "types": list(TYPES), "frames": 64, "size": 128}
    for i in range(0, len(argv), 2):
        key, value = argv[i].lstrip("-"), argv[i + 1]
        out[key] = value.split(",") if key == "types" else (int(value) if key in ("frames", "size") else value)
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
        devices = [d for d in prefs.devices if d.type == kind]
        if devices:
            for d in prefs.devices:
                d.use = d.type == kind
            bpy.context.scene.cycles.device = "GPU"
            return kind
    bpy.context.scene.cycles.device = "CPU"
    return "CPU"


def object_space(material):
    """The volume shader reads world position; read object position instead (the same for the
    original domain at the origin), so each copy draws its own funnel."""
    nt = material.node_tree
    for n in list(nt.nodes):
        if n.bl_idname == "ShaderNodeNewGeometry":
            coords = nt.nodes.new("ShaderNodeTexCoord")
            for link in list(n.outputs["Position"].links):
                nt.links.new(coords.outputs["Object"], link.to_socket)


def life_curves(domain):
    """The tz_* curves, sampled from the action before it is removed."""
    action = domain.animation_data.action
    try:
        curves = list(action.fcurves)
    except Exception:
        curves = [fc for layer in action.layers for strip in layer.strips for bag in strip.channelbags for fc in bag.fcurves]
    return {fc.data_path.strip('[]"'): fc for fc in curves}


def main():
    a = args()
    scene = bpy.context.scene
    device = gpu()
    domain = bpy.data.objects["TornadoDomain"]
    curves = life_curves(domain)
    original_p = {k: domain[k] for k in domain.keys() if k.startswith("P_")}
    object_space(domain.active_material)

    # 8 copies in a row, each turned another 45 degrees: seen from the camera, copy k is the
    # tornado seen from bearing VIEWS[k].
    width = max(domain.dimensions.x, domain.dimensions.y) * 1.02
    copies = []
    for k, bearing in enumerate(VIEWS):
        ob = domain if k == 0 else domain.copy()
        if ob is not domain:
            scene.collection.objects.link(ob)
        ob.animation_data_clear()
        ob.location.x = (k - (len(VIEWS) - 1) / 2) * width
        ob.rotation_euler.z = math.radians(-bearing)
        copies.append(ob)

    cam = scene.camera
    cam.location.x = 0
    cam.data.ortho_scale = width * len(VIEWS)
    cam.data.clip_end = max(cam.data.clip_end, 1000)
    size = a["size"]
    scene.render.resolution_x = size * len(VIEWS)
    scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    cy = scene.cycles
    cy.samples = 16
    cy.volume_step_rate = 1.0
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    scene.render.use_persistent_data = True
    print(f"[bake] device {device}; {len(a['types'])} types x {a['frames']} frames, {size}px x {len(VIEWS)} sides", flush=True)

    start, end = scene.frame_start, scene.frame_end
    for name in a["types"]:
        spec = TYPES[name]
        out = os.path.join(a["out"], name)
        os.makedirs(out, exist_ok=True)
        for ob in copies:
            for key, value in original_p.items():
                ob[key] = value
            for key, value in spec.get("P", {}).items():
                ob[key] = value
        began = time.time()
        for f in range(a["frames"]):
            frame = start + round(f * (end - start) / max(1, a["frames"] - 1))
            target = os.path.join(out, f"f{f:03d}.png")
            if os.path.exists(target):
                continue
            values = {key: fc.evaluate(frame) for key, fc in curves.items()}
            values["tz_tip"] = max(values["tz_tip"], spec.get("tipFloor", 0.0))
            values["tz_lean"] = max(values["tz_lean"] * spec.get("leanScale", 1.0), spec.get("leanFloor", 0.0))
            values["tz_snake"] = max(values["tz_snake"] * spec.get("snakeScale", 1.0), spec.get("snakeFloor", 0.0))
            values["tz_dust"] = min(1.0, values["tz_dust"] * spec.get("dustScale", 1.0))
            for ob in copies:
                for key, value in values.items():
                    ob[key] = value
                ob.update_tag()
            scene.frame_set(frame)
            scene.render.filepath = target
            bpy.ops.render.render(write_still=True)
        print(f"[bake] {name}: {a['frames']} frames in {round(time.time() - began)} s", flush=True)


main()
