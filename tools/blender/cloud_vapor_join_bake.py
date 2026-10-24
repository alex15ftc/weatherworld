# Bakes the "join" vapor sprites: anvil, base and shelf sections that are laid side by side in a
# row (overlapping ~30%) and must read as ONE continuous cloud. Unlike cloud_vapor_bake.py (which
# turns a piece's mesh into a volume) these are built procedurally: a slab of cloud that is dense
# all the way to the unit box's x edges and runs on into the margin, with only its top and bottom
# shaped. Same sheet, camera, margin and lights as cloud_vapor_bake.py (its helpers are reused).
#
#   blender --background --factory-startup --python tools/blender/cloud_vapor_join_bake.py -- \
#       [--pieces anvil_join_1,base_join_1] [--lights lit,side,back,high] [--res 512] [--samples 64]
#       [--out roblox/assets/cloudkit/vapor] [--tag _test] [--sheet-only 1]
#
# Writes <out>/<piece>.png (1024 x 1024 RGBA, straight alpha, lit | side over back | high),
# <piece>_preview.png (over a sky blue), <piece>_row.png (the lit cell laid three in a row at 30%
# overlap and squashed to the true proportions, for judging) and sheet_join.png.
import os
import sys
import time

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, "cloud_vapor_bake.py"), encoding="utf-8").read()
_src = _src[:_src.rstrip().rfind("main()")]          # the helpers, without running that bake
_base = {"__file__": os.path.join(HERE, "cloud_vapor_bake.py"), "__name__": "cloud_vapor_bake"}
exec(compile(_src, "cloud_vapor_bake.py", "exec"), _base)
Graph, setup_scene, frame_camera, aim_sun = _base["Graph"], _base["setup_scene"], _base["frame_camera"], _base["aim_sun"]
render_cell, save, over_sky, raise_priority = _base["render_cell"], _base["save"], _base["over_sky"], _base["raise_priority"]
M, CELLS, ROOT, ANISOTROPY = _base["M"], _base["CELLS"], _base["ROOT"], _base["ANISOTROPY"]

PIECES = ["anvil_join_1", "anvil_join_2", "base_join_1", "base_join_2", "shelf_join_1", "shelf_join_2"]

# True proportions (length, depth, height), length = 1: what the game's boxes are in studs
# (621 studs a km across, 1 stud a metre up):
#   anvil  a 16 km section x 2.4 km thick          -> 1 x 0.24; drawn at 0.22
#   base   an 18 km line section x 0.6 km (0.054); a supercell's 2 x 2 slabs ~5 km x 0.6 (0.12)
#          -> 0.08 between them
#   shelf  a ~12.5 km segment x ~1.3 km (nose to top), 4 km deep -> 1 x 0.32 x 0.17
TRUE_SIZE = {"anvil": (1.0, 0.8, 0.22), "base": (1.0, 0.6, 0.08), "shelf": (1.0, 0.34, 0.17)}
FADE_X = (0.5, 0.65)     # alpha full to |x| = 0.5 (the box edge), faded over the margin to 0 at the cell edge
SLAB_X = 2.0            # the volume runs on to |x| = 2 so the light at the box edges is that of an endless slab


class S:
    """A shader socket with arithmetic, so the density reads like a formula."""
    g = None

    def __init__(self, sock):
        self.s = sock

    @staticmethod
    def w(v):
        return v.s if isinstance(v, S) else v

    def _op(self, op, o, rev=False):
        a, b = (o, self) if rev else (self, o)
        return S(S.g.math(op, S.w(a), S.w(b)))

    def __add__(self, o): return self._op("ADD", o)
    def __radd__(self, o): return self._op("ADD", o, True)
    def __sub__(self, o): return self._op("SUBTRACT", o)
    def __rsub__(self, o): return self._op("SUBTRACT", o, True)
    def __mul__(self, o): return self._op("MULTIPLY", o)
    def __rmul__(self, o): return self._op("MULTIPLY", o, True)
    def __truediv__(self, o): return self._op("DIVIDE", o)
    def __neg__(self): return self._op("MULTIPLY", -1.0)


def smax(a, b): return S(S.g.math("MAXIMUM", S.w(a), S.w(b)))
def smin(a, b): return S(S.g.math("MINIMUM", S.w(a), S.w(b)))
def ssqrt(a): return S(S.g.math("SQRT", S.w(a)))
def sabs(a): return S(S.g.math("ABSOLUTE", S.w(a)))
def ss(x, a, b):
    """0 at a, 1 at b (either order), smooth; a and b may be sockets."""
    if not isinstance(a, S) and not isinstance(b, S):
        return S(S.g.smooth(S.w(x), a, b))
    t = S(S.g.math("DIVIDE", S.w(x - a), S.w(b - a), clamp=True))
    return t * t * (3.0 - 2.0 * t)
def mix(a, b, t): return a + (b - a) * t


def vec(x, y, z):
    n = S.g.nodes.new("ShaderNodeCombineXYZ")
    for i, v in enumerate((x, y, z)):
        S.g._in(n.inputs[i], S.w(v))
    return n.outputs[0]


def noise(x, y, z, scale, detail=3.0, rough=0.5, seed=0.0):
    """Perlin fBm, roughly 0.25..0.75 round 0.5, of (x, y, z) * scale (+ a seed offset)."""
    f, _ = S.g.noise(S.g.vadd(vec(x, y, z), (seed * 13.1, seed * 7.7, seed * 3.3)), scale, detail, rough)
    return S(f)


def domes(x, y, z, scale, seed=0.0, smooth=0.25):
    """Round Voronoi domes, 0..1: lumps."""
    d = S(S.g.voronoi(S.g.vadd(vec(x, y, z), (seed * 5.3, seed * 2.9, seed * 11.1)), scale, smooth))
    return ssqrt(smax(0.36 - d * d, 0.0)) / 0.6


def build(kind, v, size):
    """Density and albedo for one piece. x, y in true units (length 1), h = height in the unit box
    (0 bottom, 1 top). Returns (density per true unit, albedo 0..1)."""
    sx, sy, sz = size
    p = S.g.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    px, py, pz = (S(o) for o in S.g.sep(p))
    seed = 3.7 * v
    # a gentle warp so nothing lines up
    wx = (noise(px, py, pz, 6.0, 2.0, 0.5, seed + 1) - 0.5) * 0.03
    x, y = px + wx, py + (noise(px, py, pz, 6.0, 2.0, 0.5, seed + 2) - 0.5) * 0.03
    h = pz / sz + (noise(px, py, pz, 9.0, 2.0, 0.5, seed + 3) - 0.5) * 0.08
    hz = pz / sz

    if kind == "anvil":
        # Flat, bright top with low billows; fibrous, streaky, ragged underside. Mild changes along x.
        top = 0.7 + (noise(x, 0, 0, 2.5, 2.0, 0.5, seed + 4) - 0.5) * 0.14 \
            + domes(x, y, 0, 11.0, seed + 5) * 0.22 + domes(x, y, 0, 28.0, seed + 6, 0.0) * 0.08
        bot = 0.16 + (noise(x, 0, 0, 2.0, 2.0, 0.5, seed + 7) - 0.5) * 0.18
        streak = noise(x * 0.12, y, h * 0.25, 30.0, 5.0, 0.6, seed + 8)        # long in x: fibres
        bot = bot - (streak - 0.5) * 0.35
        d = smax(h - top, bot - h)                               # < 0 inside, in box heights
        dens = ss(d, 0.03, -0.10)
        # fibres: the lower part is streaky, holes stretched along x
        fib = ss(noise(x * 0.1, y, hz * 0.3, 60.0, 4.0, 0.6, seed + 9), 0.42, 0.58)
        low = ss(hz, bot + 0.25, bot - 0.02)
        dens = dens * (1.0 - low * 0.97 * (1.0 - fib))
        wisp = ss(noise(x, y, hz * 0.7, 120.0, 3.0, 0.55, seed + 10), 0.3, 0.6)
        edge = ss(d, -0.08, 0.0)
        dens = dens * (1.0 - edge * 0.6 * (1.0 - wisp)) * 70.0
        alb = S(S.g.math("ADD", 0.0, 0.97))
    elif kind == "base":
        # Flat-ish top fading up into the cloud above; dark, lumpy, ragged underside with scud.
        top = 0.88 + (noise(x, y, 0, 3.0, 2.0, 0.5, seed + 4) - 0.5) * 0.1
        bot = 0.42 + (noise(x, 0, 0, 2.2, 2.0, 0.5, seed + 5) - 0.5) * 0.14 \
            - domes(x, y, 0, 14.0, seed + 6) * 0.3 - domes(x, y, 0, 34.0, seed + 7, 0.0) * 0.12
        # scud: some lumps hang much lower, only where a slow noise lets them
        scud = domes(x, y, 0, 22.0, seed + 8, 0.1) * ss(noise(x, y, 0, 7.0, 2.0, 0.5, seed + 9), 0.5, 0.62)
        bot = bot - scud * 0.38
        d = smax(bot - h, 0.0 - 1.0)                              # the underside only
        dens = ss(d, 0.04, -0.10)
        dens = dens * ss(h, top + 0.2, top - 0.15)                # fades up into the cloud above
        wisp = ss(noise(x, y, hz * 0.7, 110.0, 3.0, 0.55, seed + 10), 0.3, 0.6)
        edge = ss(d, -0.10, 0.0)
        dens = dens * (1.0 - edge * 0.65 * (1.0 - wisp)) * 60.0
        # dark slate below (in the storm's shadow), lighter grey toward the top
        lum = noise(x, y, hz * 0.5, 18.0, 3.0, 0.5, seed + 60)
        alb = mix(0.17 + (lum - 0.5) * 0.2, 0.66, ss(hz, 0.45, 1.05))
    else:  # shelf
        # Seen from the front (+Z, the nose toward the camera): smooth laminar tiers above, the
        # dark turbulent underside (whale's mouth) hanging below the nose.
        ys = -0.5 * sy
        tier_d = None
        tops = (0.6, 0.79, 0.97)
        bots = (0.42, 0.58, 0.77)
        for k in range(3):
            t_top = tops[k] + (noise(x, 0, 0, 1.3, 2.0, 0.5, seed + 20 + k) - 0.5) * 0.16
            t_bot = bots[k]
            # the tier's face: its lip juts forward near its top, the face under it undercut
            t = (h - t_bot) / (tops[k] - t_bot)
            under = (t - 0.8) * (t - 0.8) * 0.12
            y_face = ys + 0.075 * k + (noise(x, 0, 0, 1.7, 2.0, 0.5, seed + 30 + k) - 0.5) * 0.08 + under
            # laminar striations: shallow grooves along x
            y_face = y_face + (noise(x * 0.05, 0, h, 12.0, 3.0, 0.5, seed + 40 + k) - 0.5) * 0.012
            dk = smax(smax((y_face - y) / sz, h - t_top), t_bot - h - (0.0 if k == 0 else 0.3))
            tier_d = dk if tier_d is None else smin(tier_d, dk)
        upper = ss(tier_d, 0.015, -0.06)
        # underside: lumpy, dark, hanging below and a little behind the nose
        ub = 0.2 + (noise(x, 0, 0, 2.2, 2.0, 0.5, seed + 50) - 0.5) * 0.12 \
            - domes(x, y, 0, 12.0, seed + 51) * 0.25 - domes(x, y, 0, 30.0, seed + 52, 0.0) * 0.1
        ud = smax(smax(ub - h, h - 0.5), (ys + 0.04 - y) / sz)
        lower = ss(ud, 0.04, -0.08)
        uw = ss(noise(x, y, hz * 0.7, 100.0, 3.0, 0.55, seed + 53), 0.3, 0.6)
        lower = lower * (1.0 - ss(ud, -0.08, 0.0) * 0.6 * (1.0 - uw))
        dens = smax(upper, lower) * ss(y, 0.5 * sy, 0.5 * sy - 0.06) * 70.0
        # light grey laminar tiers, dark below the nose
        lum = noise(x, y, hz * 0.5, 18.0, 3.0, 0.5, seed + 60)
        alb = mix(0.22 + (lum - 0.5) * 0.3, 0.92, ss(hz + (lum - 0.5) * 0.15, 0.38, 0.5))

    # Dense far past the box in x (the alpha is faded over the margin after rendering); gone
    # before the cell's top and bottom.
    fade = ss(px, -SLAB_X, -SLAB_X + 0.2) * ss(px, SLAB_X, SLAB_X - 0.2) \
        * ss(hz, -0.14, -0.08) * ss(hz, 1.14, 1.08)
    return dens * fade, alb


def make_piece(name, sc):
    kind, v = name.split("_join_")
    v = int(v)
    size = TRUE_SIZE[kind]
    sx, sy, sz = size
    # a box covering the whole frame; the shader decides where the cloud is
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0))
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (1.0, 1.0, 1.0)
    me = ob.data
    for vt in me.vertices:
        vt.co.x *= 2 * SLAB_X * sx
        vt.co.y *= sy + 0.1
        vt.co.z = (vt.co.z + 0.5) * 1.32 * sz - 0.16 * sz
    mat = bpy.data.materials.new("vapor_" + name)
    g = Graph(mat.node_tree)
    g.nodes.clear()
    S.g = g
    dens, alb = build(kind, v, size)
    vol = g.nodes.new("ShaderNodeVolumePrincipled")
    vc = g.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        g.links.new(alb.s, vc.inputs[i])
    g.links.new(vc.outputs[0], vol.inputs["Color"])
    vol.inputs["Absorption Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    vol.inputs["Anisotropy"].default_value = ANISOTROPY
    g.links.new(dens.s, vol.inputs["Density"])
    out = g.nodes.new("ShaderNodeOutputMaterial")
    out.target = "ALL"
    g.links.new(vol.outputs[0], out.inputs["Volume"])
    me.materials.append(mat)
    return ob, size


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"pieces": ",".join(PIECES), "lights": ",".join(CELLS), "res": 512, "samples": 64,
           "out": os.path.join(ROOT, "roblox", "assets", "cloudkit", "vapor"), "sheet-only": 0,
           "bounces": 12, "tag": ""}
    for i in range(0, len(argv) - 1, 2):
        k = argv[i].lstrip("-")
        out[k] = type(out[k])(argv[i + 1]) if k in out else argv[i + 1]
    return out


def load_px(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return px


def resample(px, w, h):
    """Box/bilinear-ish resize with numpy (nearest on a supersampled grid)."""
    H, W = px.shape[:2]
    ys = (np.arange(h) + 0.5) * H / h - 0.5
    xs = (np.arange(w) + 0.5) * W / w - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, H - 1); y1 = np.clip(y0 + 1, 0, H - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, W - 1); x1 = np.clip(x0 + 1, 0, W - 1)
    fy = np.clip(ys - y0, 0, 1)[:, None, None]; fx = np.clip(xs - x0, 0, 1)[None, :, None]
    a = px[y0][:, x0] * (1 - fx) + px[y0][:, x1] * fx
    b = px[y1][:, x0] * (1 - fx) + px[y1][:, x1] * fx
    return a * (1 - fy) + b * fy


def xfade(r):
    """Per image column: 1 across the box (|x| <= FADE_X[0]), smoothly to 0 at the cell's edge."""
    x = -(0.5 + M) + (np.arange(r) + 0.5) / r * (1 + 2 * M)
    t = np.clip((FADE_X[1] - np.abs(x)) / (FADE_X[1] - FADE_X[0]), 0.0, 1.0)
    return (t * t * (3 - 2 * t)).astype(np.float32)


def row_preview(cell, size, path, n=3, step=0.7):
    """The lit cell drawn n times in a row, each sprite 1.3 box widths, sections step box widths
    apart (30% overlap), over sky, at the true proportions: what a row looks like in game."""
    r = cell.shape[0]
    box = r / (1 + 2 * M)
    W = int(round((n - 1) * step * box)) + r
    canvas = np.zeros((r, W, 3), dtype=np.float32) + np.array(_base["PREVIEW_BG"], dtype=np.float32)
    # premultiplied "over", right to left so the left is in front (order barely matters)
    for i in range(n):
        x0 = int(round(i * step * box))
        c = cell[..., :3] * cell[..., 3:4]
        canvas[:, x0:x0 + r] = c + canvas[:, x0:x0 + r] * (1 - cell[..., 3:4])
    tw = 1600
    th = max(8, int(round(tw * (r * size[2]) / W)))
    img = np.ones((th, tw, 4), dtype=np.float32)
    img[..., :3] = resample(canvas, tw, th)
    save(img, path)


def bake(sc, sun, cam, name, a):
    for ob in list(bpy.data.objects):
        if ob.type == "MESH":
            bpy.data.objects.remove(ob)
    ob, size = make_piece(name, sc)
    frame_camera(sc, cam, size)
    r = a["res"]
    sheet = np.zeros((2 * r, 2 * r, 4), dtype=np.float32)
    work = os.path.join(ROOT, "tmp", "vapor_join")
    os.makedirs(work, exist_ok=True)
    times = {}
    lit_cell = None
    for light in a["lights"].split(","):
        aim_sun(sun, light)
        t0 = time.time()
        px = render_cell(sc, os.path.join(work, f"{name}_{light}.png"))
        times[light] = time.time() - t0
        k = CELLS.index(light)
        row, col = divmod(k, 2)
        y0 = (1 - row) * r
        px[..., 3] *= xfade(r)[None, :]
        sheet[y0:y0 + r, col * r:(col + 1) * r] = px
        if light == "lit":
            lit_cell = px
        al = px[..., 3]
        rgb = px[..., :3][al > 0.9]
        # lightness of the lowest and highest opaque rows (straight colour)
        rows = np.where((al > 0.9).mean(axis=1) > 0.3)[0]
        lo = px[rows[0]:rows[0] + max(1, r // 40), :, :3][al[rows[0]:rows[0] + max(1, r // 40)] > 0.9].mean() if rows.size else 0
        hi = px[rows[-1] - max(1, r // 40):rows[-1] + 1, :, :3][al[rows[-1] - max(1, r // 40):rows[-1] + 1] > 0.9].mean() if rows.size else 0
        edge = max(al[0].max(), al[-1].max(), al[:, 0].max(), al[:, -1].max())
        xprof = al[r // 2 - r // 8: r // 2 + r // 8].mean(axis=0)
        bl, br = int(M / (1 + 2 * M) * r), int((1 + M) / (1 + 2 * M) * r) - 1
        print(f"RENDER {name} {light}: {times[light]:.1f} s, cover {float((al > 0.5).mean()):.2f}, "
              f"edge alpha {float(edge):.3f}, alpha at box x-edges {xprof[bl]:.2f}/{xprof[br]:.2f}, mid {xprof[r // 2]:.2f}, "
              f"rgb p50 {np.percentile(rgb, 50) if rgb.size else 0:.2f}, bottom rows {float(lo):.2f}, top rows {float(hi):.2f}")
    os.makedirs(a["out"], exist_ok=True)
    tag = a["tag"]
    save(sheet, os.path.join(a["out"], f"{name}{tag}.png"))
    save(over_sky(sheet), os.path.join(a["out"], f"{name}{tag}_preview.png"))
    if lit_cell is not None:
        row_preview(lit_cell, size, os.path.join(a["out"], f"{name}{tag}_row.png"))
    return times


def contact_sheet(a):
    previews = []
    for name in PIECES:
        p = os.path.join(a["out"], f"{name}{a['tag']}_preview.png")
        if os.path.exists(p):
            px = load_px(p)
            h, w = px.shape[:2]
            previews.append(px.reshape(h // 2, 2, w // 2, 2, 4).mean(axis=(1, 3)))
    if not previews:
        return
    h, w = previews[0].shape[:2]
    cols = 2
    rows = (len(previews) + cols - 1) // cols
    sheet = np.full((rows * h, cols * w, 4), 0.2, dtype=np.float32)
    sheet[..., 3] = 1
    for i, px in enumerate(previews):
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * h
        sheet[y0:y0 + h, c * w:(c + 1) * w] = px
    save(sheet, os.path.join(a["out"], f"sheet_join{a['tag']}.png"))


def main():
    raise_priority()
    a = args()
    a["out"] = os.path.abspath(a["out"])
    if not a["sheet-only"]:
        sc, sun, cam = setup_scene(a)
        total = time.time()
        for name in a["pieces"].split(","):
            t = bake(sc, sun, cam, name, a)
            print(f"PIECE {name}: {sum(t.values()):.1f} s")
        print(f"TOTAL {time.time() - total:.1f} s, {a['samples']} samples, {a['res']} px")
    contact_sheet(a)


main()
