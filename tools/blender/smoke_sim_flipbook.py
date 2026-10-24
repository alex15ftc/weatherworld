# Real smoke-simulation flipbooks (Blender Mantaflow), rendered with Cycles volumes and packed as
# 4 x 4 sheets for ParticleEmitters / sprites (FlipbookLayout Grid4x4, FlipbookMode OneShot):
#
#   blender --background --factory-startup --python tools/blender/smoke_sim_flipbook.py -- \
#       --variant billow --out roblox/assets/smoke --res 128
#
#   billow  a puff that bursts from a source, rolls, curls and thins away (cloud lumps, scud, debris)
#   swirl   a smoke column rising through a vortex, twisting as it climbs (funnel surface and edge)
#
# Why a simulation: the noise-built textures (smoke_flipbook.py, wisp_flipbook.py) have no fluid
# structure. Real smoke has rolling eddies, curls and folds that come only from the flow.
#
# Writes <variant>.png (white, the smoke's lighting in the grey, alpha = its density) and
# <variant>_preview.png (over a storm-blue background).
import bpy
import math
import os
import sys

import numpy as np

GRID, CELL = 4, 256
FRAMES = GRID * GRID


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": "roblox/assets/smoke", "variant": "billow", "res": 128, "samples": 48, "seed": 3}
    for i in range(0, len(argv) - 1, 2):
        key = argv[i].lstrip("-")
        out[key] = type(out[key])(argv[i + 1]) if key in out else argv[i + 1]
    return out


VARIANTS = {
    # frames: the simulation frames sampled for the 16 flipbook frames (first, last)
    "billow": dict(end=90, inflowEnd=10, frames=(6, 62), source=(0, 0, -0.9), sourceSize=0.3,
                   vel=(0, 0, 1.6), turbulence=4.0, vortex=0.0, vorticity=0.3, dissolve=90, heat=0.6),
    "swirl": dict(end=140, inflowEnd=140, frames=(60, 136), source=(0, 0, -1.6), sourceSize=0.35,
                  vel=(0, 0, 1.4), turbulence=2.5, vortex=8.0, vorticity=0.25, dissolve=60, heat=1.0),
}


def setup(a, v):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, v["end"]

    # the domain
    bpy.ops.mesh.primitive_cube_add(size=6, location=(0, 0, 0))  # bigger than the view: smoke never piles against a wall in shot
    dom = bpy.context.object
    dom.name = "Domain"
    mod = dom.modifiers.new("Fluid", "FLUID")
    mod.fluid_type = "DOMAIN"
    ds = mod.domain_settings
    ds.domain_type = "GAS"
    ds.resolution_max = a["res"]
    ds.use_adaptive_domain = False
    ds.vorticity = v["vorticity"]
    ds.alpha = -0.0005  # density buoyancy
    ds.beta = v["heat"]  # heat buoyancy
    ds.use_noise = True  # high-resolution noise upres: fine curls on top of the sim
    ds.noise_scale = 2
    ds.noise_strength = 1.2
    ds.cache_type = "ALL"
    work = os.path.join(os.environ.get("CLAUDE_JOB_DIR", os.path.abspath(a["out"])), "tmp", "smoke_" + a["variant"])
    os.makedirs(work, exist_ok=True)
    ds.cache_directory = work
    ds.cache_frame_start, ds.cache_frame_end = 1, v["end"]
    ds.use_collision_border_top = False
    ds.use_dissolve_smoke = v["dissolve"] > 0
    if v["dissolve"] > 0:
        ds.dissolve_speed = v["dissolve"]
        ds.use_dissolve_smoke_log = True

    # the source
    bpy.ops.mesh.primitive_uv_sphere_add(radius=v["sourceSize"], location=v["source"])
    src = bpy.context.object
    src.name = "Source"
    fm = src.modifiers.new("Fluid", "FLUID")
    fm.fluid_type = "FLOW"
    fs = fm.flow_settings
    fs.flow_type = "SMOKE"
    fs.flow_behavior = "INFLOW"
    fs.flow_source = "MESH"
    fs.surface_distance = 0.6
    fs.use_initial_velocity = True
    fs.velocity_coord = v["vel"]
    fs.temperature = 1.5
    fs.density = 1.0
    fs.use_plane_init = False
    # inflow only for the first frames (billow), keyed off after
    fs.use_inflow = True
    fs.keyframe_insert(data_path="use_inflow", frame=1)
    if v["inflowEnd"] < v["end"]:
        fs.use_inflow = False
        fs.keyframe_insert(data_path="use_inflow", frame=v["inflowEnd"])
    src.hide_render = True

    # forces: turbulence (rolling eddies) and a vortex (the swirl)
    if v["turbulence"] > 0:
        bpy.ops.object.effector_add(type="TURBULENCE", location=(0, 0, 0))
        t = bpy.context.object
        t.field.strength = v["turbulence"]
        t.field.size = 0.6
        t.field.seed = a["seed"]
        t.field.noise = 1.0
    if v["vortex"] > 0:
        bpy.ops.object.effector_add(type="VORTEX", location=(0, 0, -2))
        vx = bpy.context.object
        vx.field.strength = v["vortex"]
        vx.field.shape = "LINE"
        bpy.ops.object.effector_add(type="FORCE", location=(0, 0, 0))
        f = bpy.context.object
        f.field.strength = -1.5  # pulls inward: keeps the column tight
        f.field.shape = "LINE"

    # the smoke's material: density -> volume, lit by the scene
    mat = bpy.data.materials.new("smoke")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    nodes.clear()
    attr = nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "density"
    mul = nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = 12.0
    links.new(attr.outputs["Fac"], mul.inputs[0])
    vol = nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.92, 0.93, 0.95, 1)
    vol.inputs["Anisotropy"].default_value = 0.3
    links.new(mul.outputs[0], vol.inputs["Density"])
    out = nodes.new("ShaderNodeOutputMaterial")
    links.new(vol.outputs[0], out.inputs["Volume"])
    dom.data.materials.append(mat)

    # light: sun from above-left (lit tops, shaded bellies), dim grey sky
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = 4.0
    sun_d.angle = math.radians(4)
    sun = bpy.data.objects.new("sun", sun_d)
    sun.rotation_euler = (math.radians(35), math.radians(-30), 0)
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.5, 0.55, 0.62, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    scene.world = world

    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = 4.0
    cam = bpy.data.objects.new("cam", cam_d)
    cam.location = (0, -10, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.engine = "CYCLES"
    scene.cycles.samples = a["samples"]
    scene.cycles.use_denoising = True
    scene.cycles.volume_bounces = 4
    scene.cycles.volume_step_rate = 0.5
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = scene.render.resolution_y = CELL * 2
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
    return dom, work


def main():
    a = args()
    v = VARIANTS[a["variant"]]
    dom, work = setup(a, v)
    scene = bpy.context.scene
    print("baking", a["variant"], "res", a["res"])
    with bpy.context.temp_override(object=dom, active_object=dom, selected_objects=[dom]):
        bpy.ops.fluid.bake_all()
    print("baked")
    first, last = v["frames"]
    sheet = np.zeros((GRID * CELL, GRID * CELL, 4), dtype=np.float32)
    R = CELL * 2
    for i in range(FRAMES):
        f = round(first + (last - first) * i / (FRAMES - 1))
        scene.frame_set(f)
        path = os.path.join(work, f"f{i:02d}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(R, R, 4)
        bpy.data.images.remove(img)
        cell = px.reshape(CELL, 2, CELL, 2, 4).mean(axis=(1, 3))
        yy, xx = np.mgrid[0:CELL, 0:CELL]
        edge = np.minimum.reduce([xx, yy, CELL - 1 - xx, CELL - 1 - yy]) / (CELL * 0.08)
        cell[..., 3] *= np.clip(edge, 0, 1)  # frame borders kept clear (no hard square edge in game)
        row, col = divmod(i, GRID)
        y0 = (GRID - 1 - row) * CELL  # Blender's pixels start at the bottom
        sheet[y0:y0 + CELL, col * CELL:(col + 1) * CELL] = cell
        print(f"frame {i} (sim {f}) alpha max {cell[..., 3].max():.2f}")

    out_dir = os.path.abspath(a["out"])
    os.makedirs(out_dir, exist_ok=True)

    def save(pixels, name):
        img = bpy.data.images.new(name, pixels.shape[1], pixels.shape[0], alpha=True)
        img.pixels[:] = pixels.ravel()
        img.filepath_raw = os.path.join(out_dir, name)
        img.file_format = "PNG"
        img.save()

    # straight (unpremultiplied) colour where there is smoke
    a_ = np.clip(sheet[..., 3:4], 1e-4, 1)
    colour = np.where(sheet[..., 3:4] > 1e-3, sheet[..., :3] / a_, 0.5)
    final = np.concatenate([np.clip(colour, 0, 1), sheet[..., 3:4]], axis=2)
    save(final, f"{a['variant']}.png")
    prev = final.copy()
    prev[..., :3] = final[..., :3] * final[..., 3:4] + np.array([0.24, 0.29, 0.35]) * (1 - final[..., 3:4])
    prev[..., 3] = 1
    save(prev, f"{a['variant']}_preview.png")
    print("wrote", os.path.join(out_dir, f"{a['variant']}.png"))


main()
