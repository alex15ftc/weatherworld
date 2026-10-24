# Bakes a LIGHT BASIS for the cloud kit's tower pieces, so the game can relight the vapor sprites
# live for any sun direction. Light transport is linear in the lights, so each piece is rendered
# under six single-direction suns (one per axis and sign) and one uniform white sky; the game mixes
# them with weights from the sun direction.
#
#   blender --background --factory-startup --python tools/blender/cloud_relight_bake.py -- \
#       [--pieces tower_cap_1,tower_body_1] [--res 256] [--samples 64] [--encode-only 1] [--grid 1]
#
# --grid 1 (the format the game uses now; see "--grid 1" below): 17 suns on a directional grid
# (8 azimuths at 15 and at 50 degrees up, plus the zenith), interpolated locally, sqrt-encoded.
# Without it, the older 6-axis basis below (its .luau files were moved to
# roblox/assets/cloudkit/relight/axis_backup/: its squared-weight mix lost the lobes' shadows).
#
# Same volume, material, camera and framing (margin M = 0.15) as cloud_vapor_bake.py (its helpers
# are reused), so the look matches roblox/assets/cloudkit/vapor/. Camera: horizontal, ortho, from
# game +Z toward -Z; image right = game +X, image up = game +Y.
#
# Channels (directions are where the light comes FROM, game axes):
#   px  sun from +X (image right)        nx  sun from -X (image left)
#   py  sun from straight above (+Y)     ny  sun from straight below (-Y, ground-bounce stand-in)
#   pz  sun from behind the camera (+Z): front-lit     nz  sun from behind the cloud (-Z): backlit
#   sky no sun, uniform white world, strength SKY_BASIS (1.0)
#   alpha coverage (film transparency, from the sky render)
# Suns: white, strength 10 (as the vapor bake), 1 deg wide; world black. Rendered to 32-bit EXR, so
# nothing clips; the light channels are stored linear and PREMULTIPLIED by alpha (straight colour
# blows up in the faint backlit fringe), divided by one `scale` shared by every piece (brightest sun
# value of all pieces -> ~250/255). The game mixes them, then divides by alpha for a straight sprite.
#
# Writes roblox/src/shared/Weather/CloudKit/Relight/<piece>.luau (8 bytes per pixel, base64) and
# roblox/assets/cloudkit/relight/<piece>_basis.png (the 8 channels, 4 x 2: px nx py ny / pz nz sky
# alpha, display-encoded) and <piece>_check.png (the basis mixed for the vapor bake's `lit` light |
# the vapor bake's real `lit` cell, both over sky blue).
import base64
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, "cloud_vapor_bake.py"), encoding="utf-8").read()
_src = _src[:_src.rstrip().rfind("main()")]          # the helpers, without running that bake
_base = {"__file__": os.path.join(HERE, "cloud_vapor_bake.py"), "__name__": "cloud_vapor_bake"}
exec(compile(_src, "cloud_vapor_bake.py", "exec"), _base)
setup_scene, frame_camera, save, raise_priority = (_base[k] for k in ("setup_scene", "frame_camera", "save", "raise_priority"))
load_piece, distance_volume, cloud_material = (_base[k] for k in ("load_piece", "distance_volume", "cloud_material"))
ROOT, TRUE_SIZE, SUN_ENERGY = _base["ROOT"], _base["TRUE_SIZE"], _base["SUN_ENERGY"]
VAPOR_SKY, VAPOR_SKY_STRENGTH, VAPOR_LIGHTS = _base["SKY"], _base["SKY_STRENGTH"], _base["LIGHTS"]
PREVIEW_BG = np.array(_base["PREVIEW_BG"], dtype=np.float32)

PIECES = ["tower_cap_1", "tower_cap_2", "tower_cap_3", "tower_body_1", "tower_body_2"]
CHANNELS = ["px", "nx", "py", "ny", "pz", "nz", "sky", "alpha"]
# Direction toward the sun in BLENDER axes (game (x, y, z) -> Blender (x, -z, y)).
SUNS = {"px": (1, 0, 0), "nx": (-1, 0, 0), "py": (0, 0, 1), "ny": (0, 0, -1),
        "pz": (0, -1, 0), "nz": (0, 1, 0)}
SKY_BASIS = 1.0      # uniform white world strength of the sky channel (the game weights it)
TARGET = 250.0       # the brightest sun value of all pieces maps to this byte
LUAU_DIR = os.path.join(ROOT, "roblox", "src", "shared", "Weather", "CloudKit", "Relight")
PNG_DIR = os.path.join(ROOT, "roblox", "assets", "cloudkit", "relight")
VAPOR_DIR = os.path.join(ROOT, "roblox", "assets", "cloudkit", "vapor")


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"pieces": ",".join(PIECES), "res": 256, "samples": 64, "bounces": 12, "encode-only": 0, "grid": 0,
           "scale": 0.0, "skip-test": ""}
    for i in range(0, len(argv) - 1, 2):
        k = argv[i].lstrip("-")
        out[k] = type(out[k])(argv[i + 1]) if k in out else argv[i + 1]
    return out


def read_exr(path):
    """Top-down float RGBA as written by Cycles (premultiplied)."""
    import OpenImageIO as oiio
    inp = oiio.ImageInput.open(path)
    px = inp.read_image(format="float")
    inp.close()
    return np.asarray(px, dtype=np.float32).reshape(px.shape[0], px.shape[1], -1)[..., :4]


def render(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return read_exr(path)


def bake_piece(sc, sun, cam, name, work):
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

    bg = sc.world.node_tree.nodes["Background"]
    out = {}
    for ch in CHANNELS[:7]:
        t0 = time.time()
        if ch == "sky":
            sun.hide_render = True
            bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
            bg.inputs["Strength"].default_value = SKY_BASIS
        else:
            sun.hide_render = False
            bg.inputs["Strength"].default_value = 0.0
            sun.rotation_euler = Vector(SUNS[ch]).to_track_quat("Z", "Y").to_euler()
        px = render(sc, os.path.join(work, f"{name}_{ch}.exr"))
        out[ch] = px
        a = px[..., 3]
        lum = px[..., :3].mean(axis=2)
        print(f"RENDER {name} {ch}: {time.time() - t0:.1f} s, cover {float((a > 0.5).mean()):.2f}, "
              f"premul max {float(lum.max()):.3f}, p99.9 {float(np.percentile(lum, 99.9)):.3f}")
    # Alpha is the camera ray's transmittance: the same for every light, up to the denoiser's noise
    # in the fringe, so the mean of the seven renders is kept.
    alphas = np.stack([out[c][..., 3] for c in CHANNELS[:7]])
    print(f"ALPHA {name}: spread between renders max {float((alphas.max(0) - alphas.min(0)).max()):.4f}, "
          f"mean {float((alphas.max(0) - alphas.min(0)).mean()):.4f}")
    alpha = alphas.mean(axis=0)

    # For the check only: the vapor bake's own `lit` light (warm sun + blue sky) at this resolution.
    sun.hide_render = False
    bg.inputs["Color"].default_value = (*VAPOR_SKY, 1.0)
    bg.inputs["Strength"].default_value = VAPOR_SKY_STRENGTH
    sun.data.color = (1.0, 0.98, 0.95)
    _base["aim_sun"](sun, "lit")
    lit = render(sc, os.path.join(work, f"{name}_truth.exr"))
    sun.data.color = (1.0, 1.0, 1.0)
    np.save(os.path.join(work, f"{name}_truth.npy"), lit)
    stack = np.zeros(px.shape[:2] + (8,), dtype=np.float32)
    for i, ch in enumerate(CHANNELS[:7]):
        stack[..., i] = out[ch][..., :3].mean(axis=2)             # white light: r = g = b; premultiplied
    stack[..., 7] = alpha
    np.save(os.path.join(work, f"{name}_basis.npy"), stack)
    bpy.data.materials.remove(mat)


# ---------------------------------------------------------------------------------------------
# Encoding and checks

def srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def lin(x):
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def save_top_down(rgba, path):
    save(np.ascontiguousarray(rgba[::-1]), path)       # Blender images run bottom-up


def lit_weights():
    """The vapor bake's `lit` sun as basis weights: (component along the axis it points to)^2."""
    az, el = (math.radians(v) for v in VAPOR_LIGHTS["lit"])
    d = (-math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))   # Blender
    game = (d[0], d[2], -d[1])
    w = {}
    for axis, v in zip("xyz", game):
        w[("p" if v > 0 else "n") + axis] = v * v
    return w


def load_vapor_lit(name, res):
    img = bpy.data.images.load(os.path.join(VAPOR_DIR, name + ".png"))
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]   # top-down, display values
    bpy.data.images.remove(img)
    cell = px[:h // 2, :w // 2]
    f = cell.shape[0] // res
    a = cell[..., 3:4]
    # Downscale with premultiplied (linear) colour, then back to straight display values.
    pre = np.concatenate([lin(cell[..., :3]) * a, a], axis=2)
    pre = pre.reshape(res, f, res, f, 4).mean(axis=(1, 3))
    a = pre[..., 3:4]
    rgb_lin = np.where(a > 1e-4, pre[..., :3] / np.maximum(a, 1e-4), 0.0)
    return rgb_lin, a[..., 0]


def over(rgb_lin, a):
    """Straight linear colour over the preview sky, in display values (as the vapor previews)."""
    return srgb(rgb_lin) * a[..., None] + PREVIEW_BG * (1 - a[..., None])


def encode(a, names, work):
    stacks = {n: np.load(os.path.join(work, f"{n}_basis.npy")) for n in names}
    peak = max(float(s[..., :6].max()) for s in stacks.values())
    p999 = max(float(np.percentile(s[..., :6][s[..., 7] > 0.05], 99.9)) for s in stacks.values())
    scale = peak * 255.0 / TARGET
    print(f"SCALE {scale:.4f} (brightest sun value {peak:.3f}, p99.9 {p999:.3f})")
    os.makedirs(LUAU_DIR, exist_ok=True)
    os.makedirs(PNG_DIR, exist_ok=True)
    w = lit_weights()
    print("LIT WEIGHTS", {k: round(v, 4) for k, v in w.items()}, "+ sky x", VAPOR_SKY_STRENGTH)
    sun_col = np.array([1.0, 0.98, 0.95], dtype=np.float32)
    sky_col = np.array(VAPOR_SKY, dtype=np.float32)
    report = []
    for n, s in stacks.items():
        res = s.shape[0]
        q = np.empty(s.shape, dtype=np.uint8)
        q[..., :7] = np.clip(np.round(s[..., :7] / scale * 255.0), 0, 255)
        q[..., 7] = np.clip(np.round(s[..., 7] * 255.0), 0, 255)
        b64 = base64.b64encode(q.tobytes()).decode("ascii")
        with open(os.path.join(LUAU_DIR, n + ".luau"), "w", encoding="utf-8", newline="\n") as f:
            f.write("--!strict\n")
            f.write(f"-- Light basis for {n} (tools/blender/cloud_relight_bake.py; do not edit)\n")
            f.write("return {\n")
            f.write(f'\tname = "{n}",\n')
            f.write(f"\tsize = {res},\n")
            f.write("\t-- channels per pixel, in order (one byte each, 0-255): px nx py ny pz nz sky alpha\n")
            f.write("\t-- px..sky: linear light PREMULTIPLIED by alpha, value = byte / 255 * scale (sun strength 10,\n")
            f.write(f"\t-- sky = uniform white world strength {SKY_BASIS:g}); mix them, then colour = mix / alpha.\n")
            f.write("\t-- alpha: byte / 255 = coverage (no scale)\n")
            f.write("\tchannels = 8,\n")
            f.write(f"\tscale = {scale:.6f},\n")
            f.write("\t-- base64 of size*size*channels bytes, rows top to bottom, pixels left to right, channels interleaved\n")
            f.write(f'\tdata = "{b64}",\n')
            f.write("}\n")

        dq = q.astype(np.float32) / 255.0                 # what the game decodes
        light = dq[..., :7] * scale
        alpha = dq[..., 7]
        # Contact sheet: 4 x 2, light channels display-encoded at exposure 1/scale, alpha as is.
        cells = [srgb(dq[..., i]) for i in range(7)] + [alpha]
        grid = np.ones((2 * res, 4 * res, 4), dtype=np.float32)
        for i, c in enumerate(cells):
            r, col = divmod(i, 4)
            disp = c if i == 7 else c + 0.12 * (1 - alpha)      # premultiplied over dark grey
            grid[r * res:(r + 1) * res, col * res:(col + 1) * res, :3] = disp[..., None]
        save_top_down(grid, os.path.join(PNG_DIR, f"{n}_basis.png"))

        # Check: the basis mixed for the vapor bake's `lit` light | the real `lit` cell (512, downscaled)
        # | the same light rendered here at this resolution (separates the mix's error from res/noise).
        def mixed(L, al):
            mix = sum(L[..., CHANNELS.index(k)] * v for k, v in w.items())
            pre = mix[..., None] * sun_col + L[..., 6:7] * VAPOR_SKY_STRENGTH * sky_col
            return np.where(al[..., None] > 1e-3, pre / np.maximum(al[..., None], 1e-3), 0.0)   # straight
        rgb = mixed(light, alpha)
        rgb_f = mixed(s[..., :7], s[..., 7])                  # before 8-bit quantisation
        ref_rgb, ref_a = load_vapor_lit(n, res)
        t = np.load(os.path.join(work, f"{n}_truth.npy"))
        tru_a = t[..., 3]
        tru_rgb = np.where(tru_a[..., None] > 1e-3, t[..., :3] / np.maximum(tru_a[..., None], 1e-3), 0.0)
        img = np.ones((res, 3 * res, 4), dtype=np.float32)
        img[:, :res, :3] = over(rgb, alpha)
        img[:, res:2 * res, :3] = over(ref_rgb, ref_a)
        img[:, 2 * res:, :3] = over(tru_rgb, tru_a)
        save_top_down(img, os.path.join(PNG_DIR, f"{n}_check.png"))

        # Numbers on pixels opaque in both: mean |difference| of display values (0..1), luminance
        # correlation; and the best any fixed weights of the 7 channels could do (least squares).
        Yw = np.array([0.2126, 0.7152, 0.0722])

        def compare(a_rgb, a_a, b_rgb, b_a):
            m = (a_a > 0.9) & (b_a > 0.9)
            dd = np.abs(srgb(a_rgb) - srgb(b_rgb)).mean(-1)[m]
            Ya, Yb = (a_rgb * Yw).sum(-1)[m], (b_rgb * Yw).sum(-1)[m]
            return m, Yb, (f"|diff| {float(dd.mean()):.3f} (p90 {float(np.percentile(dd, 90)):.3f}), "
                           f"lum {float(Ya.mean()):.3f} vs {float(Yb.mean()):.3f}, "
                           f"corr {float(np.corrcoef(Ya, Yb)[0, 1]):.3f}")
        _, _, c_ref = compare(rgb, alpha, ref_rgb, ref_a)
        m, Yt, c_tru = compare(rgb, alpha, tru_rgb, tru_a)
        _, _, c_truf = compare(rgb_f, s[..., 7], tru_rgb, tru_a)
        _, _, c_rt = compare(tru_rgb, tru_a, ref_rgb, ref_a)
        A = s[..., :7][m]
        coef, *_ = np.linalg.lstsq(A, Yt, rcond=None)
        fd = np.abs(srgb(A @ coef) - srgb(Yt)).mean()
        line = (f"CHECK {n}: mix vs vapor cell: {c_ref}\n"
                f"  mix vs 256 lit render: {c_tru}\n  unquantised mix vs 256 lit: {c_truf}\n"
                f"  256 lit vs vapor cell (res/noise floor): {c_rt}\n"
                f"  alpha |diff| vs vapor {float(np.abs(alpha - ref_a).mean()):.4f}; best-fit weights "
                f"{ {k: round(float(v), 3) for k, v in zip(CHANNELS[:7], coef)} } -> |diff| {float(fd):.3f}")
        print(line)
        report.append(line)
        print(f"WROTE {n}.luau {os.path.getsize(os.path.join(LUAU_DIR, n + '.luau'))} bytes")
    return scale, report


# ---------------------------------------------------------------------------------------------
# --grid 1: a directional grid of suns, interpolated locally by the game (replaces the axis basis,
# whose squared-weight mix lost the lobes' self-shadowing).
#   ring 0: elevation 15, azimuth 0, 45 .. 315   ring 1: elevation 50, same azimuths   zenith
# Azimuth in the camera frame: 0 = sun behind the viewer (+z, toward the viewer), 90 = image right
# (+x), 180 = behind the cloud, 270 = image left. Then sky (uniform white, strength 1) and alpha.
# Light channels: byte = round(255 * sqrt(v / scale)), premultiplied; one scale for every piece.

RINGS = (15.0, 50.0)
AZIMUTHS = [45.0 * i for i in range(8)]
GRID = [(e, az) for e in RINGS for az in AZIMUTHS] + [(90.0, 0.0)]
GRID_NAMES = [f"r{r}a{int(az)}" for r in range(2) for az in AZIMUTHS] + ["zenith"]
CHECKS = {"lit": (330.0, 30.0), "test110": (110.0, 35.0)}   # (azimuth, elevation)
# Bake name -> the game's piece name (the join slabs stand in for the kit's anvils and shelves).
GAME_NAMES = {"anvil_join_1": "anvil_1", "anvil_join_2": "anvil_2",
              "shelf_join_1": "shelf_1", "shelf_join_2": "shelf_2"}


def toward_sun(az, el):
    """Camera frame (x right, y up, z toward the viewer) -> Blender (x, -z, y)."""
    a, e = math.radians(az), math.radians(el)
    x, y, z = math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)
    return Vector((x, -z, y))


_join = None


def join_module():
    """cloud_vapor_join_bake.py's helpers (procedural join slabs), without running that bake."""
    global _join
    if _join is None:
        src = open(os.path.join(HERE, "cloud_vapor_join_bake.py"), encoding="utf-8").read()
        src = src[:src.rstrip().rfind("main()")]
        _join = {"__file__": os.path.join(HERE, "cloud_vapor_join_bake.py"), "__name__": "cloud_vapor_join_bake"}
        exec(compile(src, "cloud_vapor_join_bake.py", "exec"), _join)
    return _join


def build_piece(sc, cam, name, work):
    """Builds the piece's volume and frames the camera. Returns (material, per-column alpha fade or
    None): join pieces get the join bake's post-render fade over the x margin."""
    for ob in list(bpy.data.objects):
        if ob.type in ("VOLUME", "MESH"):
            bpy.data.objects.remove(ob)
    if "_join_" in name:
        J = join_module()
        ob, size = J["make_piece"](name, sc)
        frame_camera(sc, cam, size)
        return ob.data.materials[0], J["xfade"](sc.render.resolution_x)
    kind, co, tris = load_piece(name)
    size = TRUE_SIZE[name]
    path = distance_volume(name, co, tris, work)
    vdata = bpy.data.volumes.new(name)
    vdata.filepath = path
    vob = bpy.data.objects.new(name, vdata)
    sc.collection.objects.link(vob)
    mat, _ = cloud_material(kind, name, size)
    vdata.materials.append(mat)
    frame_camera(sc, cam, size)
    return mat, None


def grid_bake_piece(sc, sun, cam, name, work, test=True):
    mat, fade = build_piece(sc, cam, name, work)
    colfade = 1.0 if fade is None else fade[None, :, None]   # premultiplied: fades light and alpha alike
    bg = sc.world.node_tree.nodes["Background"]
    sun.hide_render = False
    bg.inputs["Strength"].default_value = 0.0
    sun.data.color = (1.0, 1.0, 1.0)
    chans, alphas = [], []
    for nm, (el, az) in zip(GRID_NAMES, GRID):
        t0 = time.time()
        sun.rotation_euler = toward_sun(az, el).to_track_quat("Z", "Y").to_euler()
        px = render(sc, os.path.join(work, f"{name}_g_{nm}.exr"))
        chans.append(px[..., :3].mean(axis=2))
        alphas.append(px[..., 3])
        print(f"RENDER {name} {nm}: {time.time() - t0:.1f} s, premul max {float(chans[-1].max()):.3f}")
    sky_path = os.path.join(work, f"{name}_sky.exr")
    if not os.path.exists(sky_path):           # same settings as the axis bake's sky: reuse it
        sun.hide_render = True
        bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        bg.inputs["Strength"].default_value = SKY_BASIS
        render(sc, sky_path)
    sky = read_exr(sky_path)
    chans.append(sky[..., :3].mean(axis=2))
    alphas.append(sky[..., 3])
    alphas = np.stack(alphas)
    print(f"ALPHA {name}: spread max {float((alphas.max(0) - alphas.min(0)).max()):.4f}, "
          f"mean {float((alphas.max(0) - alphas.min(0)).mean()):.4f}")
    stack = np.concatenate([np.stack(chans, axis=2), alphas.mean(axis=0)[..., None]], axis=2) * colfade
    np.save(os.path.join(work, f"{name}_grid.npy"), stack.astype(np.float32))

    # Check renders: the vapor bake's warm sun + blue sky, at the check directions.
    sun.hide_render = False
    bg.inputs["Color"].default_value = (*VAPOR_SKY, 1.0)
    bg.inputs["Strength"].default_value = VAPOR_SKY_STRENGTH
    sun.data.color = (1.0, 0.98, 0.95)
    for ck, (az, el) in CHECKS.items():
        p = os.path.join(work, f"{name}_check_{ck}.npy")
        if ck == "lit" and os.path.exists(os.path.join(work, f"{name}_truth.npy")):
            np.save(p, np.load(os.path.join(work, f"{name}_truth.npy")))   # rendered by the axis bake
            continue
        if ck != "lit" and not test:
            if os.path.exists(p):
                os.remove(p)
            continue
        t0 = time.time()
        sun.rotation_euler = toward_sun(az, el).to_track_quat("Z", "Y").to_euler()
        np.save(p, render(sc, os.path.join(work, f"{name}_check_{ck}.exr")) * colfade)
        print(f"RENDER {name} check {ck}: {time.time() - t0:.1f} s")
    sun.data.color = (1.0, 1.0, 1.0)
    bpy.data.materials.remove(mat)


def grid_weights(az, el):
    """Bilinear in azimuth between the two nearest grid azimuths, linear between rings (or ring 1
    and the zenith above 50 degrees). Returns {channel index: weight}."""
    az = az % 360.0
    i0 = int(az // 45.0) % 8
    i1 = (i0 + 1) % 8
    t = (az - 45.0 * int(az // 45.0)) / 45.0
    w = {}

    def ring(r, k):
        w[r * 8 + i0] = w.get(r * 8 + i0, 0.0) + k * (1 - t)
        w[r * 8 + i1] = w.get(r * 8 + i1, 0.0) + k * t
    if el <= RINGS[0]:
        ring(0, 1.0)
    elif el <= RINGS[1]:
        u = (el - RINGS[0]) / (RINGS[1] - RINGS[0])
        ring(0, 1 - u)
        ring(1, u)
    else:
        u = (el - RINGS[1]) / (90.0 - RINGS[1])
        ring(1, 1 - u)
        w[16] = u
    return w


def grid_encode(names, work, fixed_scale=0.0):
    stacks = {n: np.load(os.path.join(work, f"{n}_grid.npy")) for n in names}
    light = np.concatenate([s[..., :18].ravel() for s in stacks.values()])
    peak = float(light.max())
    p9995 = float(np.percentile(light[light > 1e-4], 99.95))
    if fixed_scale > 0:
        scale = fixed_scale          # shared with pieces baked earlier, so all relight alike
    else:
        scale = peak if peak <= 1.2 * p9995 else p9995
    clipped = float((light > scale).mean())
    print(f"SCALE {scale:.6f} (max {peak:.3f}, p99.95 of lit pixels {p9995:.3f}; clipped fraction {clipped:.2e})")
    for n, s in stacks.items():
        L = s[..., :18]
        lit = L[s[..., 18:19].repeat(18, axis=2) > 0.05]
        print(f"CLIP {n}: max {float(L.max()):.3f}, clipped share of all light samples "
              f"{float((L > scale).mean()):.2e}, of covered (alpha > 0.05) samples {float((lit > scale).mean()):.2e}, "
              f"of sun channels by direction: "
              + ", ".join(f"{GRID_NAMES[i]} {float((L[..., i] > scale).mean()):.1e}" for i in range(17) if (L[..., i] > scale).any()))
    os.makedirs(LUAU_DIR, exist_ok=True)
    sun_col = np.array([1.0, 0.98, 0.95], dtype=np.float32)
    sky_col = np.array(VAPOR_SKY, dtype=np.float32)
    Yw = np.array([0.2126, 0.7152, 0.0722])
    for n, s in stacks.items():
        res = s.shape[0]
        q = np.empty(s.shape, dtype=np.uint8)
        q[..., :18] = np.round(255.0 * np.sqrt(np.clip(s[..., :18] / scale, 0.0, 1.0)))
        q[..., 18] = np.clip(np.round(s[..., 18] * 255.0), 0, 255)
        b64 = base64.b64encode(q.tobytes()).decode("ascii")
        g = GAME_NAMES.get(n, n)
        with open(os.path.join(LUAU_DIR, g + ".luau"), "w", encoding="utf-8", newline="\n") as f:
            f.write("--!strict\n")
            f.write(f"-- Light grid for {g} (tools/blender/cloud_relight_bake.py --grid 1; do not edit)\n")
            f.write("return {\n")
            f.write(f'\tname = "{g}",\n')
            f.write('\tformat = "grid",\n')
            f.write(f"\tsize = {res},\n")
            f.write("\tchannels = 19, -- 8 at 15 deg (azimuth 0,45..315; 0 = sun behind the viewer, 90 = image right), 8 at 50 deg, zenith, sky, alpha\n")
            f.write('\tencoding = "sqrt", -- light channels: v = (byte/255)^2 * scale, premultiplied by alpha; alpha: byte/255\n')
            f.write(f"\tscale = {scale:.6f},\n")
            f.write(f'\tdata = "{b64}",\n')
            f.write("}\n")
        print(f"WROTE {g}.luau {os.path.getsize(os.path.join(LUAU_DIR, g + '.luau'))} bytes")

        dq = q.astype(np.float32) / 255.0
        lightq = dq[..., :18] ** 2 * scale
        alpha = dq[..., 18]

        def interp(az, el):
            pre = sum(lightq[..., i] * k for i, k in grid_weights(az, el).items())
            pre = pre[..., None] * sun_col + lightq[..., 17:18] * VAPOR_SKY_STRENGTH * sky_col
            return np.where(alpha[..., None] > 1e-3, pre / np.maximum(alpha[..., None], 1e-3), 0.0)

        def straight(t):
            a_ = t[..., 3]
            return np.where(a_[..., None] > 1e-3, t[..., :3] / np.maximum(a_[..., None], 1e-3), 0.0), a_

        def compare(a_rgb, a_a, b_rgb, b_a):
            m = (a_a > 0.9) & (b_a > 0.9)
            dd = np.abs(srgb(a_rgb) - srgb(b_rgb)).mean(-1)[m]
            Ya, Yb = (a_rgb * Yw).sum(-1)[m], (b_rgb * Yw).sum(-1)[m]
            return (f"|diff| {float(dd.mean()):.3f} (p90 {float(np.percentile(dd, 90)):.3f}), "
                    f"lum {float(Ya.mean()):.3f} vs {float(Yb.mean()):.3f}, "
                    f"corr {float(np.corrcoef(Ya, Yb)[0, 1]):.3f}")
        panels = []
        ref_rgb, ref_a = load_vapor_lit(n, res)
        for ck, (az, el) in CHECKS.items():
            mix = interp(az, el)
            cp = os.path.join(work, f"{n}_check_{ck}.npy")
            if not os.path.exists(cp):
                print(f"CHECK {n} {ck}: no fresh render (skipped)")
                continue
            tru_rgb, tru_a = straight(np.load(cp))
            print(f"CHECK {n} {ck} (A {az:g}, E {el:g}): grid vs fresh 256 render: {compare(mix, alpha, tru_rgb, tru_a)}")
            if ck == "lit":
                print(f"  grid vs vapor cell: {compare(mix, alpha, ref_rgb, ref_a)}")
                print(f"  fresh 256 vs vapor cell (floor): {compare(tru_rgb, tru_a, ref_rgb, ref_a)}")
                panels.append([over(mix, alpha), over(ref_rgb, ref_a), over(tru_rgb, tru_a)])
            else:
                panels.append([over(mix, alpha), over(tru_rgb, tru_a), np.tile(PREVIEW_BG, (res, res, 1))])
        img = np.ones((len(panels) * res, 3 * res, 4), dtype=np.float32)
        for r, row in enumerate(panels):
            for c, p in enumerate(row):
                img[r * res:(r + 1) * res, c * res:(c + 1) * res, :3] = p
        save_top_down(img, os.path.join(PNG_DIR, f"{n}_grid_check.png"))

        # Contact sheet: 8 x 3 (ring 0 / ring 1 / zenith sky alpha), sqrt bytes shown directly.
        grid = np.full((3 * res, 8 * res, 4), 1.0, dtype=np.float32)
        for i in range(19):
            r, c = (i // 8, i % 8) if i < 16 else (2, i - 16)
            v = dq[..., i]
            disp = v if i == 18 else v + 0.12 * (1 - alpha)
            grid[r * res:(r + 1) * res, c * res:(c + 1) * res, :3] = disp[..., None]
        grid[2 * res:, 3 * res:, :3] = 0.12
        save_top_down(grid, os.path.join(PNG_DIR, f"{n}_grid_basis.png"))
    return scale


def main():
    raise_priority()
    a = args()
    if a["grid"]:
        work = os.path.join(os.environ.get("CLAUDE_JOB_DIR", os.path.join(ROOT, "tmp")), "tmp", "relight_bake")
        os.makedirs(work, exist_ok=True)
        os.makedirs(PNG_DIR, exist_ok=True)
        names = a["pieces"].split(",")
        t0 = time.time()
        if not a["encode-only"]:
            sc, sun, cam = setup_scene(dict(a, sheet_only=0))
            sc.render.image_settings.file_format = "OPEN_EXR"
            sc.render.image_settings.color_depth = "32"
            sc.render.image_settings.color_mode = "RGBA"
            sun.data.energy = SUN_ENERGY
            sun.visible_camera = False
            skip = [s for s in a["skip-test"].split(",") if s]
            for n in names:
                t = time.time()
                grid_bake_piece(sc, sun, cam, n, work, test=not any(s in n for s in skip))
                print(f"PIECE {n}: {time.time() - t:.1f} s")
        grid_encode(names, work, a["scale"])
        print(f"TOTAL {time.time() - t0:.1f} s")
        return
    work = os.path.join(os.environ.get("CLAUDE_JOB_DIR", os.path.join(ROOT, "tmp")), "tmp", "relight_bake")
    os.makedirs(work, exist_ok=True)
    names = a["pieces"].split(",")
    t0 = time.time()
    if not a["encode-only"]:
        sc, sun, cam = setup_scene(dict(a, sheet_only=0))
        sc.render.image_settings.file_format = "OPEN_EXR"
        sc.render.image_settings.color_depth = "32"
        sc.render.image_settings.color_mode = "RGBA"
        sun.data.energy = SUN_ENERGY
        sun.data.color = (1.0, 1.0, 1.0)
        sun.visible_camera = False      # nz points the sun straight down the ortho camera's rays
        for n in names:
            t = time.time()
            bake_piece(sc, sun, cam, n, work)
            print(f"PIECE {n}: {time.time() - t:.1f} s")
    encode(a, names, work)
    print(f"TOTAL {time.time() - t0:.1f} s")


main()
