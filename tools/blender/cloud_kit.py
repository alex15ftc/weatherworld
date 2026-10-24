# Cloud kit: the reusable cloud mesh pieces the game builds storm clouds from (tower caps and
# bodies, anvil sections, bases, shelf segments, a wall cloud, a mammatus panel). The game places,
# scales, turns, mirrors and tints them from the weather engine's fields; this script only makes
# the shapes. Rendered by Blender, headless:
#
#   blender --background --factory-startup --python tools/blender/cloud_kit.py -- [--piece NAME]
#   blender --background --factory-startup --python tools/blender/cloud_kit.py -- \
#       --from-blend art.blend --object MyShelf --name shelf_3 [--kind shelf]
#
# The first form makes every piece (or just NAME). The second exports an artist's object from a
# .blend file to the same format, with the same normalising and ambient occlusion bake.
#
# How a piece is made: many spheres and ellipsoids (big lobes covered in smaller lobes) or smooth
# lofted tubes (the shelf's laminar tiers) are joined, voxel remeshed into one clean closed
# surface (the union), squashed flat where the piece meets others, smoothed a little so creases
# between lobes are rounded but the lobes stay crisp, given a faint noise, then decimated to the
# vertex budget and triangulated.
#
# Then every piece:
#   - ambient occlusion is baked per vertex by casting rays over the hemisphere (creases dark),
#   - it is normalised to the unit box (x, z in -0.5..0.5, y in 0..1, game axes) per axis,
#   - it is written as a Luau data module roblox/src/shared/Weather/CloudKit/Pieces/<name>.luau,
#   - a preview is rendered to roblox/assets/cloudkit/previews/<name>.png,
# and the contact sheet (sheet.png) and roblox/src/shared/Weather/CloudKit/Index.luau are rebuilt
# from whatever pieces are on disk (so hand-made pieces are listed too).
#
# Axes. Model in Blender with Z up, X along the piece, and the FRONT of a directional piece (the
# shelf's nose, the way the storm moves) facing -Y, which is what Blender's Front view looks at.
# The game is Y up: game (x, y, z) = Blender (x, z, -y), a rotation, so triangles that are
# counter-clockwise seen from outside in Blender stay so in the game. See docs/storm-visuals/KIT.md.
import bpy
import bmesh
import math
import os
import random
import re
import sys
import time

import numpy as np
from mathutils import Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
PIECES_DIR = os.path.join(ROOT, "roblox", "src", "shared", "Weather", "CloudKit", "Pieces")
INDEX_PATH = os.path.join(ROOT, "roblox", "src", "shared", "Weather", "CloudKit", "Index.luau")
PREVIEW_DIR = os.path.join(ROOT, "roblox", "assets", "cloudkit", "previews")

KINDS = ["tower_cap", "tower_body", "anvil", "base", "shelf", "wall_cloud", "mammatus"]
MIN_VERTS, MAX_VERTS, TARGET_VERTS = 1500, 4000, 3000
AO_RAYS, AO_REACH = 48, 0.3      # rays per vertex; how far a ray looks, as a share of the piece's biggest size
TILE = 480                       # preview size in pixels


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"piece": "", "from-blend": "", "object": "", "name": "", "kind": "", "samples": 24,
           "no-preview": 0}
    i = 0
    while i < len(argv):
        key = argv[i].lstrip("-")
        if key == "no-preview":
            out[key] = 1
            i += 1
            continue
        val = argv[i + 1] if i + 1 < len(argv) else ""
        out[key] = type(out[key])(val) if key in out else val
        i += 2
    return out


def raise_priority():
    # This machine throttles normal-priority background processes after a few seconds.
    if os.name == "nt":
        try:
            import ctypes
            k = ctypes.windll.kernel32
            k.SetPriorityClass(k.GetCurrentProcess(), 0x8000)  # above normal
        except Exception:
            pass


# ---------------------------------------------------------------------------------------------
# Building blocks: a Shape collects primitives (Blender axes, modelled proportions) as vertex and
# face lists, joined into one mesh at the end (much faster than adding them to a bmesh one by one).

_ICO = {}


def icosphere(sub):
    if sub not in _ICO:
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
        bm.verts.index_update()
        _ICO[sub] = (np.array([v.co[:] for v in bm.verts]),
                     np.array([[v.index for v in f.verts] for f in bm.faces]))
        bm.free()
    return _ICO[sub]


class Shape:
    def __init__(self, rng):
        self.rng = rng
        self.vs, self.fs, self.count = [], [], 0

    def add(self, verts, faces):
        self.vs.append(np.asarray(verts, dtype=np.float64))
        self.fs.append([[i + self.count for i in f] for f in faces] if isinstance(faces, list)
                       else np.asarray(faces) + self.count)
        self.count += len(verts)

    @property
    def bm(self):
        me = bpy.data.meshes.new("kit_prims")
        verts = np.concatenate(self.vs)
        faces = []
        for f in self.fs:
            faces += f.tolist() if isinstance(f, np.ndarray) else f
        me.from_pydata(verts.tolist(), [], faces)
        out = bmesh.new()
        out.from_mesh(me)
        bpy.data.meshes.remove(me)
        return out

    def ell(self, c, r, rotz=0.0, rotx=0.0):
        """An ellipsoid at c with radii r = (rx, ry, rz), optionally turned about Z then X."""
        big = max(r)
        sub = 3 if big > 0.15 else (2 if big > 0.05 else 1)
        v, f = icosphere(sub)
        m = (Matrix.Rotation(rotz, 3, "Z") @ Matrix.Rotation(rotx, 3, "X")
             @ Matrix.Diagonal((r[0], r[1], r[2])))
        self.add(v @ np.array(m).T + np.array(c, dtype=np.float64), f)

    def ball(self, c, r):
        self.ell(c, (r, r, r))

    def cluster(self, c, r, depth, kids, ratio=0.46, origin=(0, 0, 0), bias=(0, 0, 0), out=0.9,
                squash=(1.0, 1.0, 1.0), keep=None, sink=(0.62, 0.82)):
        """A fractal lobe: a ball covered in smaller balls pushed outward, `depth` levels deep."""
        rng = self.rng
        c = Vector(c)
        self.ell(c, (r * squash[0], r * squash[1], r * squash[2]))
        if depth <= 0:
            return
        away = c - Vector(origin)
        away = away.normalized() if away.length > 1e-6 else Vector((0, 0, 1))
        for _ in range(kids):
            d = Vector((rng.gauss(0, 1), rng.gauss(0, 1), rng.gauss(0, 1))).normalized()
            d = (d + away * out + Vector(bias)).normalized()
            cr = r * ratio * rng.uniform(0.75, 1.25)
            k = r * rng.uniform(*sink)
            cc = c + Vector((d.x * k * squash[0], d.y * k * squash[1], d.z * k * squash[2]))
            if keep is not None and not keep(cc, cr):
                continue
            self.cluster(cc, cr, depth - 1, max(2, kids - 1), ratio, origin, bias, out, keep=keep, sink=sink)

    def loft(self, xs, ring, n=28):
        """A closed tube along X: ring(x) -> (cy, cz, ry, rz, tilt) gives each cross-section ellipse
        (tilt turns it in the YZ plane)."""
        def prof(x):
            cy, cz, ry, rz, tilt = ring(x)
            t = np.linspace(0, 2 * math.pi, n, endpoint=False)
            u, v = ry * np.cos(t), rz * np.sin(t)
            ct, st = math.cos(tilt), math.sin(tilt)
            return np.stack([cy + u * ct - v * st, cz + u * st + v * ct], axis=1)
        self.loft_profile(xs, prof)

    def loft_profile(self, xs, prof):
        """A closed tube along X: prof(x) -> (n, 2) array of (y, z), a closed cross-section with the
        same number of points at every x. Ends are capped with a fan."""
        verts, faces = [], []
        for x in xs:
            for y, z in prof(x):
                verts.append((x, y, z))
        m = len(xs)
        n = len(verts) // m
        for k in range(m - 1):
            for i in range(n):
                j = (i + 1) % n
                faces.append([k * n + i, k * n + j, (k + 1) * n + j, (k + 1) * n + i])
        for k, flip in ((0, True), (m - 1, False)):
            ring_pts = np.array(verts[k * n:(k + 1) * n])
            mid = len(verts)
            verts.append(tuple(ring_pts.mean(axis=0)))
            for i in range(n):
                j = (i + 1) % n
                faces.append([mid, k * n + j, k * n + i] if flip else [mid, k * n + i, k * n + j])
        self.add(verts, faces)


def smooth_polygon(pts, rounds):
    """Chaikin corner cutting on a closed polygon, then resampled to a fixed count (96 points)."""
    for _ in range(rounds):
        nxt = np.roll(pts, -1, axis=0)
        pts = np.concatenate([0.75 * pts + 0.25 * nxt, 0.25 * pts + 0.75 * nxt], axis=1).reshape(-1, 2)
    seg = np.linalg.norm(np.roll(pts, -1, axis=0) - pts, axis=1)
    d = np.concatenate([[0], np.cumsum(seg)])
    closed = np.concatenate([pts, pts[:1]])
    want = np.linspace(0, d[-1], 96, endpoint=False)
    return np.stack([np.interp(want, d, closed[:, 0]), np.interp(want, d, closed[:, 1])], axis=1)


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bm_from_object_eval(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    out = bmesh.new()
    out.from_mesh(me)
    out.transform(ob.matrix_world)
    ev.to_mesh_clear()
    return out


def with_modifier(bm, kind, **props):
    me = bpy.data.meshes.new("kit_tmp")
    bm.to_mesh(me)
    ob = bpy.data.objects.new("kit_tmp", me)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new("m", kind)
    for k, v in props.items():
        setattr(mod, k, v)
    out = bm_from_object_eval(ob)
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    bm.free()
    return out


def remesh(bm, voxel):
    return with_modifier(bm, "REMESH", mode="VOXEL", voxel_size=voxel, adaptivity=0.0)


def warp(bm, fn):
    for v in bm.verts:
        v.co = fn(v.co.copy())


def squash_below(z0, k):
    return lambda p: Vector((p.x, p.y, z0 + (p.z - z0) * k)) if p.z < z0 else p


def squash_above(z0, k):
    return lambda p: Vector((p.x, p.y, z0 + (p.z - z0) * k)) if p.z > z0 else p


def domain_warp(amp, freq, seed, flat=False):
    """Push every point by a smooth noise vector, to break up grid patterns and straight edges."""
    off = Vector((seed * 1.37, seed * 2.11, seed * 0.73))

    def fn(p):
        d = noise.noise_vector(p * freq + off) * amp
        if flat:
            d.z = 0.0
        return p + d
    return fn


def streak(bm, amp, seed):
    """Fibrous streaks on the underside: noise stretched along X, pushed along the normal on faces
    that look down."""
    off = Vector((seed * 0.91, seed * 1.73, seed * 2.29))
    bm.normal_update()
    for v in bm.verts:
        down = max(0.0, -v.normal.z)
        if down > 0.2:
            q = Vector((v.co.x * 2.0, v.co.y * 45.0, v.co.z * 12.0)) + off
            v.co += v.normal * (amp * smoothstep(0.2, 0.7, down) * noise.noise(q))


def smooth(bm, iterations, factor=0.5):
    for _ in range(iterations):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=factor, use_axis_x=True, use_axis_y=True,
                              use_axis_z=True)


def displace(bm, amp, freq, seed):
    off = Vector((seed * 7.31, seed * 3.17, seed * 5.53))
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * (amp * noise.noise(v.co * freq + off))


# ---------------------------------------------------------------------------------------------
# The pieces. Each recipe builds the shape in Blender axes with the piece's rough proportions and
# returns (bmesh, settings). Settings: voxel size, smoothing passes, post warps, noise.

def recipe_tower_cap(sh, v):
    rng = sh.rng
    # The dome: wide, not tall; v changes how high the middle rises and how many big lobes.
    tall = (0.0, 0.07, 0.16)[v - 1]
    R, H = 0.4, 0.3 + tall
    sh.ell((0, 0, 0), (R, R, H))
    # Big lobes spread over the dome's upper surface (a jittered spiral), each covered in smaller
    # lobes, those in smaller ones again; sunk in so they bulge rather than sit on stalks.
    n1 = (11, 12, 10)[v - 1]
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n1):
        u = (i + 0.5) / n1
        zc = 1.0 - u * 0.95                       # from the top down to near the rim
        rho = math.sqrt(max(0.0, 1 - zc * zc))
        a = i * golden + rng.uniform(-0.3, 0.3)
        d = Vector((rho * math.cos(a), rho * math.sin(a), zc))
        c = Vector((d.x * R * 0.78, d.y * R * 0.78, d.z * H * 0.78))
        r = rng.uniform(0.15, 0.2) * (1.1 if zc > 0.6 else 1.0)
        sh.cluster(c, r, 2, 7, ratio=0.5, origin=(0, 0, -0.1), bias=(0, 0, 0.25), out=1.2)
    return dict(voxel=0.0075, smooth=2, warps=[squash_below(0.02, 0.12)], noise=(0.006, 14.0))


def recipe_tower_body(sh, v):
    rng = sh.rng
    h = 1.2

    def width(z):  # narrower at both ends, so stacked pieces tuck into each other
        return 0.62 + 0.38 * smoothstep(0.0, 0.4, min(z, h - z))

    for z in np.linspace(0.14, h - 0.14, 8):
        w = width(z)
        sh.ell((0, 0, z), (0.3 * w, 0.3 * w, 0.18))
    rows = (5, 6)[v - 1]
    inside = lambda cc, cr: cc.z - cr * 0.5 > 0.03 and cc.z + cr * 0.5 < h - 0.03
    for k, z in enumerate(np.linspace(0.2, h - 0.2, rows)):
        w = width(z)
        n = rng.randint(5, 7)
        for i in range(n):
            a = 2 * math.pi * (i + 0.5 * (k % 2) + rng.uniform(-0.2, 0.2)) / n
            c = (0.24 * w * math.cos(a), 0.24 * w * math.sin(a), z + rng.uniform(-0.05, 0.05))
            sh.cluster(c, rng.uniform(0.14, 0.19) * w, 2, 6, ratio=0.5, origin=(0, 0, z),
                       bias=(0, 0, 0.1), out=1.2, keep=inside)
    return dict(voxel=0.008, smooth=2, warps=[squash_below(0.07, 0.3), squash_above(h - 0.07, 0.3)],
                noise=(0.006, 14.0))


def edge_noise(rng):
    """A ragged outline: how far in from the box edge the cloud ends, varying along the edge."""
    ph = [rng.uniform(0, 6.3) for _ in range(6)]
    return lambda s, k: 0.04 * math.sin(7 * s + ph[k]) + 0.025 * math.sin(17 * s + ph[k + 1])


def recipe_anvil(sh, v):
    rng = sh.rng
    rag = edge_noise(rng)
    th = 0.24  # modelled thickness
    # Slab: broad flattened blobs on a jittered grid, thinning toward the ragged edges (the X ends,
    # where neighbouring sections overlap, most of all). The top is squashed flat afterwards.
    for x in np.arange(-0.5, 0.501, 0.1):
        for y in np.arange(-0.5, 0.501, 0.1):
            px, py = x + rng.uniform(-0.03, 0.03), y + rng.uniform(-0.03, 0.03)
            ex = 0.5 - abs(px) - 0.05 - rag(py, 0)
            ey = 0.5 - abs(py) - 0.03 - rag(px, 2) * 0.6
            if ex < -0.03 or ey < -0.03:
                continue
            f = smoothstep(-0.03, 0.2, ex) * (0.5 + 0.5 * smoothstep(-0.03, 0.14, ey))
            r = 0.13 * (0.55 + 0.45 * f)
            sh.ell((px, py, th * 0.55), (r, r, th * 0.3 * f + 0.012))
    # Billows along the long edges: the upwind side (-Y) has the bigger, sharper ones.
    for side, size in ((-1, 1.0), (1, 0.6)):
        for x in np.arange(-0.4, 0.401, 0.065):
            if rng.random() < 0.2:
                continue
            fx = smoothstep(0.0, 0.15, 0.5 - abs(x))
            y = side * (0.4 - rng.uniform(0.0, 0.07))
            r = size * rng.uniform(0.05, 0.075) * (0.5 + 0.5 * fx)
            sh.cluster((x, y, th * 0.66 + rng.uniform(0, 0.02)), r, 1, 4, origin=(x, 0, 0),
                       bias=(0, 0, 0.5))
    return dict(voxel=0.006, smooth=5, noise=(0.003, 12.0), streaks=0.012,
                warps=[domain_warp(0.035, 3.0, 31 + v, flat=True), squash_above(th * 0.72, 0.35)])


def recipe_base(sh, v):
    rng = sh.rng
    rag = edge_noise(rng)
    th = 0.3
    # The deck: broad flattened blobs, thinner and smaller toward the ragged rim; flat on top.
    for x in np.arange(-0.5, 0.501, 0.1):
        for y in np.arange(-0.5, 0.501, 0.1):
            px, py = x + rng.uniform(-0.03, 0.03), y + rng.uniform(-0.03, 0.03)
            e = min(0.5 - abs(px) - rag(py, 0), 0.5 - abs(py) - rag(px, 2)) - 0.04
            if e < -0.03:
                continue
            f = smoothstep(-0.03, 0.18, e)
            r = 0.12 * (0.55 + 0.45 * f)
            sh.ell((px, py, th * 0.68), (r, r, 0.05 * f + 0.02))
    # Lumps hanging from the underside (scud-like): some big and soft, many small and ragged.
    for _ in range((26, 34)[v - 1]):
        x, y = rng.uniform(-0.38, 0.38), rng.uniform(-0.38, 0.38)
        r = rng.uniform(0.05, 0.1)
        sh.cluster((x, y, th * 0.52 - r * 0.4), r, 2, 4, ratio=0.5, origin=(x, y, th),
                   bias=(0, 0, -0.5), squash=(1.3, 1.3, 0.75))
    for _ in range(40):
        x, y = rng.uniform(-0.42, 0.42), rng.uniform(-0.42, 0.42)
        r = rng.uniform(0.025, 0.045)
        sh.ell((x, y, th * 0.45 - rng.uniform(0, 0.08)), (r * 1.5, r, r * 0.8), rotz=rng.uniform(0, 3.1))
    return dict(voxel=0.0065, smooth=3, noise=(0.005, 11.0),
                warps=[domain_warp(0.04, 2.5, 41 + v, flat=True), squash_above(th * 0.76, 0.15)])


def recipe_shelf(sh, v):
    rng = sh.rng
    # One lofted wedge, cross-section in the YZ plane (front is -Y): a rounded nose low at the
    # front, a smooth upper surface rising up and back in soft steps (the tiers), a rounded back,
    # and an underside that rises a little just behind the nose (the whale's mouth) and comes
    # down toward the back. Lumps hang from the underside. The ends shrink and are irregular so
    # segments laid end to end overlap without a seam.
    ph = [rng.uniform(0, 6.3) for _ in range(16)]

    def wob(x, k, a):
        return a * (math.sin(3.5 * x + ph[k]) + 0.5 * math.sin(8.0 * x + ph[k + 1]))

    if v == 1:
        steps = ((0.14, 0.09), (0.42, 0.1), (0.72, 0.09))
    else:
        steps = ((0.12, 0.07), (0.33, 0.07), (0.55, 0.07), (0.78, 0.07))
    H = 0.5

    def mouth_roof(y):
        # under the shelf: the nose is lowest; behind it the underside rises into the "mouth",
        # then comes down again toward the rain at the back
        return 0.04 + 0.1 * math.exp(-((y + 0.2) / 0.18) ** 2) + 0.02 * (y + 0.44)

    def profile(x):
        # Step positions drift a little along the segment.
        st = [(s + wob(x, 2 + i, 0.025), a) for i, (s, a) in enumerate(steps)]
        top = []
        for s in np.linspace(0.0, 1.0, 48):
            # each tier: a soft step up with a rounded lip just above it
            z = 0.13 + 0.08 * s + sum(a * smoothstep(c - 0.05, c + 0.02, s)
                                      + 0.3 * a * math.exp(-((s - c - 0.03) / 0.035) ** 2) for c, a in st)
            top.append((-0.43 + 0.89 * s, min(z, H)))
        pts = [(-0.5, 0.075)] + top                    # nose tip, then the upper surface
        yb, zt = top[-1]                               # the back rounds down to the bottom
        for t in np.linspace(0.15, 0.85, 6):
            pts.append((yb + 0.05 * math.sin(math.pi * t), zt * (1 - t) + 0.03 * t))
        for s in np.linspace(1.0, 0.0, 30):            # underside, back to front
            y = -0.44 + 0.9 * s
            pts.append((y, mouth_roof(y)))
        pts.append((-0.47, 0.035))                     # the nose's rounded underside
        pts.append((-0.5, 0.05))
        return smooth_polygon(np.array(pts), 3)

    def ring(x):
        pr = profile(x)
        end = 0.56 - abs(x) - 0.04 * (1 + math.sin(3 * x + ph[10]))
        f = 0.3 + 0.7 * smoothstep(0.0, 0.16, end)
        mid = np.array([pr[:, 0].mean(), 0.2])
        pr = mid + (pr - mid) * f
        pr[:, 0] += wob(x, 12, 0.02)
        return pr

    sh.loft_profile(np.linspace(-0.56, 0.56, 57), ring)
    # Whale's mouth: lumps under the shelf, behind the nose, bigger toward the back.
    for _ in range((44, 54)[v - 1]):
        x = rng.uniform(-0.44, 0.44)
        y = rng.uniform(-0.36, 0.4)
        f = smoothstep(0.0, 0.16, 0.5 - abs(x))
        r = rng.uniform(0.03, 0.06) * (0.7 + 0.5 * (y + 0.3)) * f
        if r < 0.012:
            continue
        sh.cluster((x, y, mouth_roof(y) + r * 0.1), r, 1, 4, ratio=0.55, origin=(x, y, 0.3),
                   bias=(0, 0, -0.4), squash=(1.6, 1.0, 0.75))
    return dict(voxel=0.006, smooth=4, warps=[], noise=(0.002, 8.0))


def recipe_wall_cloud(sh, v):
    rng = sh.rng
    # Round-ish lowering: rings of lobes, flaring out toward the top (where it merges into the
    # base), squashed flat at the bottom, with ragged fragments round the bottom rim.
    sh.ell((0, 0, 0.22), (0.3, 0.29, 0.2))
    sh.ell((0, 0, 0.4), (0.4, 0.39, 0.05))
    for k, z in enumerate(np.linspace(0.06, 0.38, 8)):
        R = 0.28 + 0.1 * smoothstep(0.2, 0.4, z)
        r0 = 0.06 + 0.02 * smoothstep(0.1, 0.4, z)
        n = int(2 * math.pi * R / (r0 * 1.5))
        for i in range(n):
            a = 2 * math.pi * (i + rng.uniform(-0.3, 0.3)) / n + 0.4 * k
            c = (R * math.cos(a), R * 0.97 * math.sin(a), z + rng.uniform(-0.015, 0.015))
            sh.cluster(c, r0 * rng.uniform(0.8, 1.2), 1, 3, ratio=0.5, origin=(0, 0, z),
                       squash=(1.35, 1.35, 0.7))
    for _ in range(36):
        a = rng.uniform(0, 2 * math.pi)
        rr = 0.36 * math.sqrt(rng.uniform(0.05, 1.0))
        r = rng.uniform(0.025, 0.05)
        sh.ell((rr * math.cos(a), rr * math.sin(a), rng.uniform(0.02, 0.1)), (r * 1.7, r, r * 0.7),
               rotz=a + math.pi / 2)
    return dict(voxel=0.006, smooth=3, noise=(0.004, 10.0),
                warps=[domain_warp(0.02, 4.0, 61, flat=True), squash_below(0.05, 0.12),
                       squash_above(0.41, 0.25)])


def recipe_mammatus(sh, v):
    rng = sh.rng
    # A thin flat top with smooth round pouches hanging from it, packed on a jittered hex grid.
    for x in np.arange(-0.5, 0.501, 0.12):
        for y in np.arange(-0.5, 0.501, 0.12):
            sh.ell((x, y, 0.36), (0.1, 0.1, 0.035))
    sp = 0.14
    for row, y in enumerate(np.arange(-0.44, 0.45, sp * 0.87)):
        off = sp * 0.5 * (row % 2)
        for x in np.arange(-0.44 + off, 0.45, sp):
            px, py = x + rng.uniform(-0.025, 0.025), y + rng.uniform(-0.025, 0.025)
            if abs(px) > 0.46 or abs(py) > 0.46:
                continue
            r = rng.uniform(0.075, 0.1)
            drop = rng.uniform(0.07, 0.13)
            sh.ell((px, py, 0.33 - drop * 0.5), (r, r, drop))
    return dict(voxel=0.006, smooth=8, noise=(0.002, 8.0),
                warps=[domain_warp(0.02, 3.0, 71, flat=True), squash_above(0.37, 0.3)])


PIECES = {
    "tower_cap_1": ("tower_cap", recipe_tower_cap, 1, 101),
    "tower_cap_2": ("tower_cap", recipe_tower_cap, 2, 102),
    "tower_cap_3": ("tower_cap", recipe_tower_cap, 3, 103),
    "tower_body_1": ("tower_body", recipe_tower_body, 1, 201),
    "tower_body_2": ("tower_body", recipe_tower_body, 2, 202),
    "anvil_1": ("anvil", recipe_anvil, 1, 301),
    "anvil_2": ("anvil", recipe_anvil, 2, 302),
    "base_1": ("base", recipe_base, 1, 401),
    "base_2": ("base", recipe_base, 2, 402),
    "shelf_1": ("shelf", recipe_shelf, 1, 501),
    "shelf_2": ("shelf", recipe_shelf, 2, 502),
    "wall_cloud_1": ("wall_cloud", recipe_wall_cloud, 1, 601),
    "mammatus_1": ("mammatus", recipe_mammatus, 1, 701),
}


# ---------------------------------------------------------------------------------------------
# Cleaning, checking, budget.

def clean(bm):
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()


def keep_largest_part(bm):
    """Drop small floating bits (a lone lump not touching the rest)."""
    bm.faces.index_update()
    seen, parts = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, part = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            part.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        parts.append(part)
    if len(parts) > 1:
        parts.sort(key=len, reverse=True)
        drop = [f for p in parts[1:] for f in p]
        bmesh.ops.delete(bm, geom=drop, context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    return len(parts)


def problems(bm):
    out = []
    bad_edges = sum(1 for e in bm.edges if len(e.link_faces) != 2)
    if bad_edges:
        out.append(f"{bad_edges} edges not shared by exactly two triangles")
    if any(len(f.verts) != 3 for f in bm.faces):
        out.append("not all triangles")
    tiny = sum(1 for f in bm.faces if f.calc_area() < 1e-9)
    if tiny:
        out.append(f"{tiny} degenerate triangles")
    nonman = sum(1 for v in bm.verts if not v.is_manifold)
    if nonman:
        out.append(f"{nonman} non-manifold vertices")
    vol = bm.calc_volume(signed=True)
    if vol <= 0:
        out.append("normals point inward (signed volume <= 0)")
    return out


def folded(bm):
    """Triangles that face against their own corners' normals (folds left by decimating)."""
    bm.normal_update()
    out = []
    for f in bm.faces:
        avg = f.verts[0].normal + f.verts[1].normal + f.verts[2].normal
        if f.normal.dot(avg) <= 0.0:
            out.append(f)
    return out


def fix_folds(bm, rounds=8):
    """Relax the vertices round folded triangles until none are left (or give up)."""
    for _ in range(rounds):
        bad = folded(bm)
        if not bad:
            return 0
        verts = set()
        for f in bad:
            for v in f.verts:
                verts.add(v)
                verts.update(e.other_vert(v) for e in v.link_edges)
        bm.verts.index_update()
        bmesh.ops.smooth_vert(bm, verts=sorted(verts, key=lambda v: v.index), factor=0.6, use_axis_x=True, use_axis_y=True,
                              use_axis_z=True)
    return len(folded(bm))


def to_budget(bm):
    """Decimate a closed mesh to about TARGET_VERTS vertices (triangles only)."""
    clean(bm)
    if len(bm.verts) <= MAX_VERTS:
        return bm
    target = TARGET_VERTS
    for _ in range(4):
        ratio = target / len(bm.verts)
        out = with_modifier(bm.copy(), "DECIMATE", decimate_type="COLLAPSE", ratio=ratio,
                            use_collapse_triangulate=True)
        clean(out)
        fix_folds(out)
        n = len(out.verts)
        if MIN_VERTS <= n <= MAX_VERTS and not problems(out):
            bm.free()
            return out
        out.free()
        target = int(target * TARGET_VERTS / max(n, 1))
    raise RuntimeError("could not decimate to the vertex budget")


# ---------------------------------------------------------------------------------------------
# Ambient occlusion, normalising, writing.

def hemisphere(nrays):
    """Cosine-weighted directions over the +Z hemisphere (a fixed spiral, so the bake is stable)."""
    out, golden = [], math.pi * (3 - math.sqrt(5))
    for i in range(nrays):
        u = (i + 0.5) / nrays
        r, phi = math.sqrt(u), i * golden
        out.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - u))))
    return out


def bake_ao(bm):
    bm.normal_update()
    lo = Vector([min(v.co[i] for v in bm.verts) for i in range(3)])
    hi = Vector([max(v.co[i] for v in bm.verts) for i in range(3)])
    reach = AO_REACH * max(hi - lo)
    tree = BVHTree.FromBMesh(bm)
    dirs = hemisphere(AO_RAYS)
    ao = []
    for v in bm.verts:
        n = v.normal.normalized()
        t = n.orthogonal().normalized()
        b = n.cross(t)
        o = v.co + n * (reach * 0.002)
        blocked = 0.0
        for d in dirs:
            w = t * d.x + b * d.y + n * d.z
            hit = tree.ray_cast(o, w, reach)
            if hit[0] is not None:
                blocked += 1.0 - hit[3] / reach
        ao.append(1.0 - blocked / len(dirs))
    return ao


def export_arrays(bm, ao):
    """Normalise to the unit box per axis and convert to game axes. Returns p, n, ao, t, size."""
    bm.verts.index_update()
    co = np.array([v.co[:] for v in bm.verts], dtype=np.float64)
    lo, hi = co.min(axis=0), co.max(axis=0)
    size = hi - lo
    unit = (co - lo) / size                       # 0..1 on each Blender axis
    bx, by, bz = unit[:, 0] - 0.5, unit[:, 1] - 0.5, unit[:, 2]
    p = np.stack([bx, bz, -by], axis=1)           # game (x, y, z) = Blender (x, z, -y)
    tris = np.array([[v.index for v in f.verts] for f in bm.faces], dtype=np.int64)
    # Normals from the unit-box positions (area weighted), as the data will be used.
    a, b, c = p[tris[:, 0]], p[tris[:, 1]], p[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    vn = np.zeros_like(p)
    for k in range(3):
        np.add.at(vn, tris[:, k], fn)
    vn /= np.linalg.norm(vn, axis=1, keepdims=True)
    # Winding checks, in game axes. 1: every edge is used once in each direction (all triangles wound
    # the same way). 2: the signed volume is positive (that way is counter-clockwise from outside).
    # 3 (reported): triangles agree with their corners' normals. A few disagree on thin rims once
    # the piece is stretched to the unit box; that is shading, not winding.
    directed = set(map(tuple, np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])))
    if len(directed) != 3 * len(tris) or any((b2, a2) not in directed for a2, b2 in directed):
        raise RuntimeError("triangles are not wound consistently")
    volume = np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0
    if volume <= 0:
        raise RuntimeError("triangles are wound inward")
    agree = np.einsum("ij,ij->i", fn, vn[tris[:, 0]] + vn[tris[:, 1]] + vn[tris[:, 2]]) > 0
    print(f"  winding ok (volume {volume:.3f} of the unit box); {100 * agree.mean():.2f}% of triangles "
          "agree with their corner normals")
    return p, vn, np.array(ao), tris, size


def fmt(v, places):
    s = f"{v:.{places}f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "", "-") else s


def lines(values, places, width=190):
    out, cur = [], ""
    for v in values:
        s = fmt(v, places) if places is not None else str(int(v))
        if cur and len(cur) + len(s) + 2 > width:
            out.append("\t\t" + cur)
            cur = ""
        cur = f"{cur} {s}," if cur else f"{s},"
    if cur:
        out.append("\t\t" + cur)
    return "\n".join(out)


def write_luau(name, kind, p, n, ao, tris):
    os.makedirs(PIECES_DIR, exist_ok=True)
    text = "\n".join([
        "--!strict",
        f"-- Cloud kit piece {name} (tools/blender/cloud_kit.py; do not edit by hand)",
        "return {",
        f'\tname = "{name}",',
        f'\tkind = "{kind}",',
        f"\tvertices = {len(p)},",
        "\t-- x, y, z per vertex (unit box: x, z in -0.5..0.5, y in 0..1)",
        "\tp = {", lines(p.ravel(), 4), "\t},",
        "\t-- normal x, y, z per vertex",
        "\tn = {", lines(n.ravel(), 4), "\t},",
        "\t-- ambient occlusion per vertex (0..1, 1 = open)",
        "\tao = {", lines(np.clip(ao, 0, 1), 3), "\t},",
        "\t-- triangles: three 1-based vertex indices each, counter-clockwise seen from outside",
        "\tt = {", lines((tris + 1).ravel(), None), "\t},",
        "}",
        "",
    ])
    path = os.path.join(PIECES_DIR, f"{name}.luau")
    with open(path, "w", newline="\n") as f:
        f.write(text)
    return path


def write_index():
    found = {}
    for fn in sorted(os.listdir(PIECES_DIR)):
        if not fn.endswith(".luau"):
            continue
        with open(os.path.join(PIECES_DIR, fn)) as f:
            head = f.read(2000)
        m = re.search(r'kind\s*=\s*"([a-z_]+)"', head)
        if m and "-- Cloud kit piece " in head:   # made by this script (stand-ins are left out)
            found.setdefault(m.group(1), []).append(fn[:-5])
    order = [k for k in KINDS if k in found] + sorted(k for k in found if k not in KINDS)
    body = "\n".join(f"\t{k} = {{ " + ", ".join(f'"{x}"' for x in sorted(found[k], key=natural)) + " },"
                     for k in order)
    text = ("--!strict\n-- Cloud kit pieces by kind (tools/blender/cloud_kit.py rebuilds this from Pieces/; "
            "do not edit by hand)\nreturn {\n" + body + "\n}\n")
    with open(INDEX_PATH, "w", newline="\n") as f:
        f.write(text)
    return found


def natural(s):
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", s)]


# ---------------------------------------------------------------------------------------------
# Previews: the exported data (converted back to Blender axes, at the modelled proportions), lit
# by a sun from the upper left over a grey background, shaded by the baked occlusion.

def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.curves):
        for item in list(coll):
            coll.remove(item)


VIEW_FROM_BELOW = ("anvil", "base", "shelf", "wall_cloud", "mammatus")


def render_preview(name, p, ao, tris, size, samples, kind=""):
    clear_scene()
    scene = bpy.context.scene
    co = np.stack([p[:, 0], -p[:, 2], p[:, 1]], axis=1) * size   # back to Blender axes, real proportions
    co[:, 2] -= size[2] * 0.5
    me = bpy.data.meshes.new(name)
    me.from_pydata(co.tolist(), [], tris.tolist())
    me.shade_smooth()
    attr = me.color_attributes.new("ao", "FLOAT_COLOR", "POINT")
    attr.data.foreach_set("color", np.repeat(np.clip(ao, 0, 1), 4).astype(np.float32))
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)

    mat = bpy.data.materials.new("cloud")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = "ao"
    mul = nt.nodes.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = 0.85
    nt.links.new(at.outputs["Fac"], mul.inputs[0])
    nt.links.new(mul.outputs[0], bsdf.inputs["Base Color"])
    me.materials.append(mat)

    world = scene.world or bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.32, 0.33, 0.35, 1)
    bg.inputs["Strength"].default_value = 0.28

    # Camera: from the front (-Y), a little to the right and above, orthographic.
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    span = float(max(size[0], size[2] * 1.1, size[1] * 0.8)) * 1.45
    cam_data.ortho_scale = span
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    # Towers from a little above; pieces seen from the ground (bases, shelf, anvil...) from below.
    d = Vector((0.45, -1.0, -0.3 if kind in VIEW_FROM_BELOW else 0.42)).normalized()
    cam.location = d * 10
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.4
    sun_data.angle = 0.05
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    # Light travelling from upper left of the picture (and a bit from the camera side).
    rot = cam.rotation_euler.to_matrix()   # (matrix_world is not updated yet)
    right, up, fwd = rot @ Vector((1, 0, 0)), rot @ Vector((0, 1, 0)), rot @ Vector((0, 0, -1))
    travel = (right * 0.75 - up * 0.8 + fwd * 0.55).normalized()
    sun.rotation_euler = travel.to_track_quat("-Z", "Y").to_euler()

    # Label in the top-left corner.
    txt = bpy.data.curves.new("label", "FONT")
    txt.body = name
    txt.size = span * 0.055
    tob = bpy.data.objects.new("label", txt)
    scene.collection.objects.link(tob)
    tob.parent = cam
    tob.location = (-span * 0.47, span * 0.42, -1.0)
    tm = bpy.data.materials.new("label")
    tm.use_nodes = True
    tnt = tm.node_tree
    tnt.nodes.remove(tnt.nodes["Principled BSDF"])
    em = tnt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1, 1, 0.85, 1)
    tnt.links.new(em.outputs[0], tnt.nodes["Material Output"].inputs["Surface"])
    txt.materials.append(tm)

    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = scene.render.resolution_y = TILE
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    path = os.path.join(PREVIEW_DIR, f"{name}.png")
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def contact_sheet():
    names = []
    for kind in KINDS:
        names += [n for n in sorted(os.listdir(PREVIEW_DIR), key=natural)
                  if n.endswith(".png") and n != "sheet.png" and re.fullmatch(kind + r"_\d+\.png", n)]
    others = [n for n in sorted(os.listdir(PREVIEW_DIR), key=natural)
              if n.endswith(".png") and n != "sheet.png" and n not in names]
    names += others
    if not names:
        return None
    cols = 4
    rows = (len(names) + cols - 1) // cols
    sheet = np.full((rows * TILE, cols * TILE, 4), 0.2, dtype=np.float32)
    sheet[..., 3] = 1
    for i, fn in enumerate(names):
        img = bpy.data.images.load(os.path.join(PREVIEW_DIR, fn))
        w, h = img.size
        px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
        bpy.data.images.remove(img)
        if (w, h) != (TILE, TILE):
            continue
        if px.shape[2] == 3:
            px = np.concatenate([px, np.ones((h, w, 1), np.float32)], axis=2)
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * TILE
        sheet[y0:y0 + TILE, c * TILE:(c + 1) * TILE] = px
    img = bpy.data.images.new("sheet", cols * TILE, rows * TILE, alpha=True)
    img.pixels[:] = sheet.ravel()
    img.filepath_raw = os.path.join(PREVIEW_DIR, "sheet.png")
    img.file_format = "PNG"
    img.save()
    return img.filepath_raw


# ---------------------------------------------------------------------------------------------

def finish(name, kind, bm, a):
    t0 = time.time()
    bm = to_budget(bm)
    if len(bm.verts) < MIN_VERTS:
        print(f"warning: {name} has only {len(bm.verts)} vertices (the budget is {MIN_VERTS}..{MAX_VERTS})")
    bad = problems(bm)
    if bad:
        raise RuntimeError(f"{name}: " + "; ".join(bad))
    ao = bake_ao(bm)
    p, n, ao, tris, size = export_arrays(bm, ao)
    path = write_luau(name, kind, p, n, ao, tris)
    bm.free()
    if not a["no-preview"]:
        render_preview(name, p, ao, tris, size, a["samples"], kind)
    print(f"{name}: {len(p)} vertices, {len(tris)} triangles, size {size.round(3).tolist()}, "
          f"ao {ao.min():.2f}..{ao.max():.2f} (mean {ao.mean():.2f}), {time.time() - t0:.1f}s finish -> {path}")


def make_piece(name, a):
    kind, recipe, variant, seed = PIECES[name]
    t0 = time.time()
    noise.seed_set(seed)   # noise_vector is randomly seeded otherwise
    sh = Shape(random.Random(seed))
    cfg = recipe(sh, variant)
    print(f"{name}: {sh.count} primitive vertices in {time.time() - t0:.1f}s")
    bm = remesh(sh.bm, cfg["voxel"])
    print(f"{name}: remesh done {time.time() - t0:.1f}s")
    parts = keep_largest_part(bm)
    for w in cfg["warps"]:
        warp(bm, w)
    smooth(bm, cfg["smooth"])
    amp, freq = cfg["noise"]
    displace(bm, amp, freq, seed)
    if cfg.get("streaks"):
        streak(bm, cfg["streaks"], seed)
    print(f"{name}: remeshed {len(bm.verts)} vertices ({parts} part(s)) in {time.time() - t0:.1f}s")
    finish(name, kind, bm, a)


def from_blend(a):
    path, obname, name = os.path.abspath(a["from-blend"]), a["object"], a["name"]
    if not (obname and name):
        raise SystemExit("--from-blend needs --object NAME and --name PIECE")
    kind = a["kind"] or re.sub(r"_\d+$", "", name)
    if kind not in KINDS:
        print(f"warning: kind '{kind}' is not one of {KINDS}")
    bpy.ops.wm.open_mainfile(filepath=path)
    ob = bpy.data.objects.get(obname)
    if ob is None or ob.type != "MESH":
        raise SystemExit(f"no mesh object '{obname}' in {path}")
    bm = bm_from_object_eval(ob)   # modifiers and transforms applied
    clean(bm)
    bad = problems(bm)
    if bad:
        print("warning (will try a voxel remesh to close it):", "; ".join(bad))
        span = max(max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3))
        bm = remesh(bm, span / 160)
        keep_largest_part(bm)
    finish(name, kind, bm, a)


def main():
    raise_priority()
    a = args()
    t0 = time.time()
    if a["from-blend"]:
        from_blend(a)
    else:
        names = a["piece"].split(",") if a["piece"] else list(PIECES)
        for n in names:
            if n not in PIECES:
                raise SystemExit(f"unknown piece {n}; pieces: {', '.join(PIECES)}")
            make_piece(n, a)
    found = write_index()
    print("index:", {k: len(v) for k, v in found.items()}, "->", INDEX_PATH)
    if not a["no-preview"]:
        print("sheet:", contact_sheet())
    print(f"done in {time.time() - t0:.1f}s")


main()
