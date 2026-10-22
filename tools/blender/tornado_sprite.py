# The distant tornado: a sprite sheet of a rendered funnel for the game to stand in for the mesh
# far off (client/TornadoArt). Rendered by Blender, headless:
#
#   blender --background --factory-startup --python tools/blender/tornado_sprite.py -- \
#       --out roblox/assets/tornado --shape cone --light lit
#
# A procedural volume (as dust_flipbook.py): round an axis (straight, or snaking for a rope), the
# funnel's radius at each height from a profile (narrow at the ground, flaring into the cloud
# base), its edge broken by noise banded round the funnel (the condensation's striations); a debris
# cloud at the ground; the top fading out so the sprite blends into the storm's cloud base, which
# the game draws. The noise turns round the axis through the frames, one full turn over the sheet,
# so the loop is seamless.
#
# Two lights per shape: "lit" (the sun behind the viewer: a white funnel) and "back" (the sun
# behind the tornado: a dark funnel with a bright rim where the cloud scatters light forward). The
# game blends them by where the sun is, and tints them (rain, dusk).
#
# The frame is square: the ground at the bottom edge, the cloud base at the top, the funnel
# centred. Writes sprite_<shape>_<light>.png (1024 x 1024: 4 x 4 frames of 256 px) and prints the
# funnel's width / height at mid-height as rendered (Config.TORNADO_ART.sprites ratio).
import bpy
import math
import os
import sys

import numpy as np

GRID, CELL, RENDER = 4, 256, 512
FRAMES = GRID * GRID

# r0, r1: radius at the ground and at the top (frame heights / 2: 1 = half the frame);
# power: how the radius grows with height; flare: extra radius into the cloud base;
# snake: sideways swing of the axis (rope); billow: how far noise breaks the edge;
# debris: radius of the debris cloud (0 none) and its density; density: the funnel's.
SHAPES = {
    "rope": dict(r0=0.022, r1=0.05, power=1.6, flare=0.22, snake=0.22, snakeWaves=1.3, billow=0.35, debris=(0.12, 10.0), density=55.0),
    "cone": dict(r0=0.05, r1=0.3, power=1.7, flare=0.28, snake=0.025, snakeWaves=0.8, billow=0.28, debris=(0.3, 16.0), density=45.0),
    "wedge": dict(r0=0.5, r1=0.74, power=1.2, flare=0.12, snake=0.0, snakeWaves=0.0, billow=0.22, debris=(0.9, 12.0), density=30.0),
}
# Sun directions (towards the sun): behind the camera (which looks along +y), or behind the
# tornado; both fairly low, as on a storm afternoon.
LIGHTS = {
    "lit": dict(elevation=28, azimuth=200),
    "back": dict(elevation=18, azimuth=15),
}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"out": "roblox/assets/tornado", "shape": "cone", "light": "lit", "samples": 64, "seed": 2}
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

    def math(self, op, a, b=None, clamp=False):
        n = self.nodes.new("ShaderNodeMath")
        n.operation = op
        n.use_clamp = clamp
        self._in(n.inputs[0], a)
        if b is not None:
            self._in(n.inputs[1], b)
        return n.outputs[0]

    def smooth(self, x, a, b):
        """0 at a, 1 at b (smoothstep), either way round."""
        n = self.nodes.new("ShaderNodeMapRange")
        n.interpolation_type = "SMOOTHSTEP"
        n.inputs["From Min"].default_value = a
        n.inputs["From Max"].default_value = b
        self._in(n.inputs["Value"], x)
        return n.outputs["Result"]

    def xyz(self, x, y, z):
        n = self.nodes.new("ShaderNodeCombineXYZ")
        for i, v in enumerate((x, y, z)):
            self._in(n.inputs[i], v)
        return n.outputs[0]

    def split(self, v):
        n = self.nodes.new("ShaderNodeSeparateXYZ")
        self._in(n.inputs[0], v)
        return n.outputs[0], n.outputs[1], n.outputs[2]

    def noise(self, vec, scale, detail, roughness):
        n = self.nodes.new("ShaderNodeTexNoise")
        n.noise_dimensions = "3D"
        n.inputs["Scale"].default_value = scale
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = roughness
        self._in(n.inputs["Vector"], vec)
        return n.outputs["Fac"]

    def rotate_z(self, vec, angle_socket):
        n = self.nodes.new("ShaderNodeVectorRotate")
        n.rotation_type = "Z_AXIS"
        self._in(n.inputs["Vector"], vec)
        self._in(n.inputs["Angle"], angle_socket)
        return n.outputs[0]


def build(a):
    s = SHAPES[a["shape"]]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # The volume: x, y in -1..1 (the frame is 2 wide), z 0..2 (ground to cloud base).
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 1))
    box = bpy.context.object
    mat = bpy.data.materials.new("tornado")
    g = Graph(mat.node_tree)
    g.nodes.clear()

    turn = g.nodes.new("ShaderNodeValue")
    turn.name = "turn"
    turn = turn.outputs[0]

    obj = g.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    x, y, z = g.split(obj)
    h = g.math("MULTIPLY", g.math("ADD", z, 1.0), 0.5)  # 0 at the ground, 1 at the cloud base

    # The axis, swinging sideways for a rope.
    swing = g.math("MULTIPLY", g.math("SINE", g.math("ADD", g.math("MULTIPLY", h, 2 * math.pi * max(s["snakeWaves"], 1e-3)), 0.7)), s["snake"])
    swing = g.math("MULTIPLY", swing, g.math("SINE", g.math("MULTIPLY", h, math.pi)))  # pinned at both ends
    px = g.math("SUBTRACT", x, swing)
    rho = g.math("SQRT", g.math("ADD", g.math("MULTIPLY", px, px), g.math("MULTIPLY", y, y)))

    # The funnel's radius at this height.
    grow = g.math("POWER", h, s["power"])
    radius = g.math("ADD", s["r0"], g.math("MULTIPLY", grow, s["r1"] - s["r0"]))
    radius = g.math("ADD", radius, g.math("MULTIPLY", g.smooth(h, 0.7, 1.0), s["flare"]))

    # Noise turning round the axis: banded (stretched round, fine up the funnel).
    local = g.rotate_z(g.xyz(px, y, z), turn)
    lx, ly, lz = g.split(local)
    banded = g.xyz(g.math("MULTIPLY", lx, 2.5), g.math("MULTIPLY", ly, 2.5), g.math("MULTIPLY", lz, 9.0))
    n1 = g.noise(banded, 1.6, 7, 0.6)
    # (a second, rounder noise for lobes)
    lobes = g.noise(g.xyz(g.math("ADD", g.math("MULTIPLY", lx, 4.0), a["seed"] * 7.1), g.math("MULTIPLY", ly, 4.0), g.math("MULTIPLY", lz, 4.0)), 1.0, 5, 0.55)
    edge = g.math("ADD", g.math("MULTIPLY", g.math("SUBTRACT", n1, 0.5), 2 * s["billow"]), g.math("MULTIPLY", g.math("SUBTRACT", lobes, 0.5), s["billow"]))
    rel = g.math("SUBTRACT", g.math("DIVIDE", rho, radius), edge)
    funnel = g.math("MULTIPLY", g.smooth(rel, 1.0, 0.72), s["density"])
    # Fading into the cloud base at the top.
    funnel = g.math("MULTIPLY", funnel, g.smooth(h, 1.0, 0.7))

    # The debris cloud at the ground.
    dr, dd = s["debris"]
    if dr > 0:
        lift = g.math("ADD", z, 1.0)  # height above the ground (z is -1 there)
        ell = g.math("SQRT", g.math("ADD", g.math("MULTIPLY", rho, rho), g.math("MULTIPLY", g.math("MULTIPLY", lift, 1.6), g.math("MULTIPLY", lift, 1.6))))
        dn = g.noise(local, 5.0, 6, 0.6)
        drel = g.math("SUBTRACT", g.math("DIVIDE", ell, dr), g.math("MULTIPLY", g.math("SUBTRACT", dn, 0.5), 0.9))
        debris = g.math("MULTIPLY", g.smooth(drel, 1.0, 0.55), dd)
        density = g.math("ADD", funnel, debris)
        dust = g.smooth(drel, 0.9, 0.4)  # how much of the colour is the debris's
    else:
        density = funnel
        dust = 0.0

    vol = g.nodes.new("ShaderNodeVolumePrincipled")
    # Cloud: bright, scattering a little forward (a thin funnel glows when backlit, a thick one
    # goes dark with a bright rim; front-lit, enough comes back to look white). Debris darker.
    mix = g.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    g._in(mix.inputs["Factor"], dust)
    mix.inputs["A"].default_value = (0.86, 0.86, 0.88, 1)
    mix.inputs["B"].default_value = (0.42, 0.4, 0.38, 1)
    g.links.new(mix.outputs["Result"], vol.inputs["Color"])
    vol.inputs["Anisotropy"].default_value = 0.25
    vol.inputs["Absorption Color"].default_value = (0.2, 0.2, 0.22, 1)
    g._in(vol.inputs["Density"], density)
    out = g.nodes.new("ShaderNodeOutputMaterial")
    g.links.new(vol.outputs[0], out.inputs["Volume"])
    box.data.materials.append(mat)

    light = LIGHTS[a["light"]]
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 7.0
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("sun", sun_data)
    # A sun light shines along its -Z: point -Z away from the sun's direction.
    el, az = math.radians(light["elevation"]), math.radians(light["azimuth"])
    to_sun = (math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el))
    sun.rotation_euler = _rotation_pointing(to_sun)
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.45, 0.5, 0.58, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    scene.world = world

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.0
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, -10, 1)          # looking along +y
    cam.rotation_euler = (math.radians(90), 0, 0)
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
    return mat.node_tree.nodes["turn"]


def _rotation_pointing(to_sun):
    from mathutils import Vector
    # Rotate -Z onto the direction the light travels (away from the sun).
    return Vector(to_sun).to_track_quat("Z", "Y").to_euler()


def main():
    a = args()
    out_dir = os.path.abspath(a["out"])
    os.makedirs(out_dir, exist_ok=True)
    work = os.path.join(os.environ.get("CLAUDE_JOB_DIR", out_dir), "tmp", f"sprite_{a['shape']}_{a['light']}")
    os.makedirs(work, exist_ok=True)
    turn = build(a)
    scene = bpy.context.scene
    sheet = np.zeros((GRID * CELL, GRID * CELL, 4), dtype=np.float32)
    n = RENDER // CELL
    for i in range(FRAMES):
        # One full turn over the sheet. The noise is sampled turned back by the angle, so the cloud
        # itself turns anticlockwise seen from above (cyclonic).
        turn.outputs[0].default_value = -2 * math.pi * i / FRAMES
        path = os.path.join(work, f"f{i:02d}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(RENDER, RENDER, 4)
        bpy.data.images.remove(img)
        cell = px.reshape(CELL, n, CELL, n, 4).mean(axis=(1, 3))
        row, col = divmod(i, GRID)
        y0 = (GRID - 1 - row) * CELL
        sheet[y0:y0 + CELL, col * CELL:(col + 1) * CELL] = cell
        if i == 0:
            # Width / height at mid-height, as rendered (Blender rows run bottom-up).
            mid = cell[CELL // 2, :, 3] > 0.3
            cols = np.nonzero(mid)[0]
            ratio = (cols.max() - cols.min() + 1) / CELL if len(cols) else 0
            print(f"RATIO {a['shape']}: {ratio:.3f}")

    img = bpy.data.images.new("sheet", sheet.shape[1], sheet.shape[0], alpha=True)
    img.pixels[:] = sheet.ravel()
    path = os.path.join(out_dir, f"sprite_{a['shape']}_{a['light']}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    prev = sheet.copy()
    prev[..., :3] = sheet[..., :3] * sheet[..., 3:4] + np.array([0.55, 0.6, 0.68]) * (1 - sheet[..., 3:4])
    prev[..., 3] = 1
    pimg = bpy.data.images.new("prev", sheet.shape[1], sheet.shape[0], alpha=True)
    pimg.pixels[:] = prev.ravel()
    pimg.filepath_raw = os.path.join(out_dir, f"sprite_{a['shape']}_{a['light']}_preview.png")
    pimg.file_format = "PNG"
    pimg.save()
    print("wrote", path)


main()
