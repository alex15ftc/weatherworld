"""
Single-wide mobile home for WeatherWorld (EF-scale DI 3): one skinned mesh ("Trailer") where every piece
that can break off has its own bone (rigid, 1 bone per vertex, weight 1.0), a generated texture atlas,
an FBX for Roblox, the piece data the damage model reads, and preview renders.

Run:
  blender -b --factory-startup -P tools/blender/mobile_home.py -- <output folder> [--data <luau path>]

<output folder> gets the FBX, .blend, atlas, previews and the ree/ror test mesh (large binaries: keep
them out of git; roblox/assets/structures/mobile_home/manifest.json records their hashes).
--data writes the plain piece data (numbers only, so the pure sim and offline luau tests can read it),
normally roblox/Shared/StormLab/Structures/MobileHomePieces.luau.

Units: 1 Blender unit = 1 foot (a 14 x 56 ft single-wide). X = length, Y = width (front is -Y), Z = up.
The data module says so (unit = 0.3048 m); Roblox scales it to the place's studs.
"""
import bpy, bmesh, math, os, sys, random
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DATA = None
if "--data" in argv:
    k = argv.index("--data")
    DATA = os.path.abspath(argv[k + 1])
    del argv[k:k + 2]
OUT = os.path.abspath(argv[0]) if argv else os.getcwd()
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT, "roblox"), exist_ok=True)

# ------------------------------------------------------------------ dimensions
HL, HW = 28.0, 7.0            # half length / half width
FT, WT = 3.6, 11.2            # floor top / wall top
RISE = 2.6
TAN_A = RISE / HW
ROOF_BASE = WT + 0.2          # bottom of sheathing at the wall line
RIDGE = ROOF_BASE + RISE      # bottom of sheathing at the ridge
SEGS = [(-28.0, -14.0), (-14.0, 0.0), (0.0, 14.0), (14.0, 28.0)]
ROOF_SEGS = [(-28.5, -14.0), (-14.0, 0.0), (0.0, 14.0), (14.0, 28.5)]
DECK_Z = 3.3
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
AX = (X, Y, Z)

# ------------------------------------------------------------------ atlas layout
ATLAS = 2048
CELLS = ["trim", "drywall", "shutter", "glass", "door", "backdoor", "deck", "concrete",
         "osb", "wood", "rim", "steel", "skirt", "metal", "floor", "dark"]
SIDING_RECT = (0.0, 0.5, 0.5, 1.0)
SHINGLE_RECT = (0.5, 0.5, 1.0, 1.0)
CELL_SCALE = {"concrete": 4.0, "shutter": 8.0, "door": 10.0, "backdoor": 10.0}


def cell_rect(name):
    k = CELLS.index(name)
    c, r = k % 8, k // 8
    return (c / 8, r / 8, (c + 1) / 8, (r + 1) / 8)


# ------------------------------------------------------------------ pieces / prims
class Piece:
    def __init__(self, name, cat, group=None, frame=None):
        self.name, self.cat, self.group = name, cat, group
        self.prims, self.req = [], []
        self.frame = frame if frame is not None else Matrix.Identity(3)


pieces, P = [], {}


def piece(name, cat, group=None, frame=None):
    p = Piece(name, cat, group, frame)
    pieces.append(p)
    P[name] = p
    return p


def frame_from(ex, ey):
    ex, ey = Vector(ex).normalized(), Vector(ey).normalized()
    ez = ex.cross(ey)
    return Matrix((ex, ey, ez)).transposed()


def add_box(prims, center, axes, size, mat, uv="cell"):
    prims.append(dict(kind="box", c=Vector(center), ax=[Vector(a).normalized() for a in axes],
                      s=tuple(size), mat=mat, uv=uv))


def add_poly(prims, wall, poly, d0, d1, mat, uv="cell"):
    prims.append(dict(kind="poly", wall=wall, poly=poly, d0=d0, d1=d1, mat=mat, uv=uv))


def add_cyl(prims, base, r, h, mat, seg=8):
    prims.append(dict(kind="cyl", c=Vector(base), r=r, h=h, mat=mat, seg=seg, uv="cell"))


def beam(prims, p0, p1, w, h, mat, up=Z):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    d.normalize()
    upv = Vector(up)
    if abs(d.dot(upv)) > 0.95:
        upv = X if abs(d.x) < 0.9 else Y
    side = d.cross(upv).normalized()
    up2 = side.cross(d).normalized()
    add_box(prims, (p0 + p1) / 2, (d, side, up2), (L, w, h), mat)


WALLS = {
    "F": dict(base=Vector((0, -HW, 0)), U=X, N=Vector((0, -1, 0))),
    "B": dict(base=Vector((0, HW, 0)), U=X, N=Vector((0, 1, 0))),
    "W": dict(base=Vector((-HL, 0, 0)), U=Y, N=Vector((-1, 0, 0))),
    "E": dict(base=Vector((HL, 0, 0)), U=Y, N=Vector((1, 0, 0))),
}


def wpt(w, u, z, d):
    return w["base"] + w["U"] * u + Z * z + w["N"] * d


def wbox(prims, w, u0, u1, z0, z1, d0, d1, mat, uv="cell"):
    add_box(prims, wpt(w, (u0 + u1) / 2, (z0 + z1) / 2, (d0 + d1) / 2), (w["U"], Z, w["N"]),
            (u1 - u0, z1 - z0, d1 - d0), mat, uv)


def rect_minus(u0, u1, z0, z1, holes):
    hs = [(max(a, u0), min(b, u1), max(c, z0), min(d, z1)) for (a, b, c, d) in holes
          if a < u1 and b > u0 and c < z1 and d > z0]
    xs = sorted(set([u0, u1] + [h[0] for h in hs] + [h[1] for h in hs]))
    out = []
    for xa, xb in zip(xs, xs[1:]):
        if xb - xa < 1e-6:
            continue
        mid = (xa + xb) / 2
        cov = sorted((h[2], h[3]) for h in hs if h[0] < mid < h[1])
        z = z0
        for c, d in cov:
            if c > z + 1e-6:
                out.append((xa, xb, z, c))
            z = max(z, d)
        if z1 > z + 1e-6:
            out.append((xa, xb, z, z1))
    return out


def seg_index(x):
    for i, (a, b) in enumerate(SEGS):
        if a <= x < b:
            return i
    return 0 if x < 0 else 3


def segs_touching(x, pad=0.3):
    return [i for i, (a, b) in enumerate(SEGS) if x + pad > a and x - pad < b]


def railing(prims, p0, p1, zb, height=3.0):
    p0, p1 = Vector((p0[0], p0[1], 0)), Vector((p1[0], p1[1], 0))
    for p in (p0, p1):
        beam(prims, (p.x, p.y, zb - 0.05), (p.x, p.y, zb + height + 0.15), 0.3, 0.3, "deck")
    beam(prims, (p0.x, p0.y, zb + height), (p1.x, p1.y, zb + height), 0.35, 0.15, "deck")
    beam(prims, (p0.x, p0.y, zb + 0.4), (p1.x, p1.y, zb + 0.4), 0.25, 0.15, "deck")
    L = (p1 - p0).length
    n = max(2, int(L / 0.6))
    for k in range(1, n):
        p = p0.lerp(p1, k / n)
        beam(prims, (p.x, p.y, zb + 0.47), (p.x, p.y, zb + height - 0.07), 0.14, 0.14, "deck")


def stairs(prims, top, out, width, n, rise, run, landing=0.0, rails=()):
    top = Vector(top)
    base = Vector((top.x, top.y, 0))
    out = Vector(out).normalized()
    side = Vector((-out.y, out.x, 0))
    if landing > 0:
        steps = [(0.0, landing, top.z)] + [(landing + (k - 1) * run, landing + k * run, top.z - k * rise)
                                          for k in range(1, n)]
    else:
        steps = [((k - 1) * run, k * run, top.z - k * rise) for k in range(1, n + 1)]
    for d0, d1, zt in steps:
        add_box(prims, base + out * ((d0 + d1) / 2) + Z * (zt - 0.1), (out, side, Z), (d1 - d0, width, 0.2), "deck")
    dend = steps[-1][1]
    zlast = steps[-1][2]
    for sg in (-1, 1):
        o = side * (sg * (width / 2 - 0.1))
        beam(prims, base + o + Z * (top.z - 0.35), base + o + out * dend + Z * 0.15, 0.15, 0.55, "deck")
        if landing > 0:
            for dd in (0.15, landing - 0.15):
                beam(prims, base + o + out * dd, base + o + out * dd + Z * (top.z - 0.2), 0.25, 0.25, "deck")
    for sg in rails:
        o = side * (sg * (width / 2 - 0.1))
        da, db = 0.15, dend - 0.15
        za, zb_ = top.z, zlast
        beam(prims, base + o + out * da + Z * (za - 0.2), base + o + out * da + Z * (za + 3.1), 0.3, 0.3, "deck")
        beam(prims, base + o + out * db, base + o + out * db + Z * (zb_ + 3.1), 0.3, 0.3, "deck")
        beam(prims, base + o + out * da + Z * (za + 3.0), base + o + out * db + Z * (zb_ + 3.0), 0.3, 0.15, "deck")
        m = max(2, int((db - da) / 0.6))
        for k in range(1, m):
            t = k / m
            d = da + (db - da) * t
            zs = za + (zb_ - za) * t
            beam(prims, base + o + out * d + Z * (zs + 0.05), base + o + out * d + Z * (zs + 2.95), 0.14, 0.14, "deck")


# ================================================================== BUILD PIECES
# ---------------- chassis + piers
ch = piece("Chassis", "Chassis")
for ys in (-3.5, 3.5):
    add_box(ch.prims, (0, ys, 2.275), AX, (54, 0.6, 0.15), "steel")
    add_box(ch.prims, (0, ys, 2.6), AX, (54, 0.12, 0.5), "steel")
    add_box(ch.prims, (0, ys, 2.925), AX, (54, 0.6, 0.15), "steel")
for x in (-26, -13, 0, 13, 26):
    add_box(ch.prims, (x, 0, 2.72), AX, (0.25, 6.4, 0.25), "steel")

k = 0
for ys in (-3.5, 3.5):
    for x in (-24, -16, -8, 0, 8, 16, 24):
        k += 1
        p = piece(f"Pier_{k:02d}", "Pier")
        s = 1.6 if abs(x) == 24 else 1.2
        add_box(p.prims, (x, ys, 1.0), AX, (s, s, 2.0), "concrete")
        add_box(p.prims, (x, ys, 2.1), AX, (s * 0.9, s * 0.7, 0.2), "wood")
        p.req = ["Chassis"]

# ---------------- floors
for i, (x0, x1) in enumerate(SEGS):
    p = piece(f"Floor_{i + 1}", "Floor")
    a, b = max(x0, -27.98), min(x1, 27.98)
    add_box(p.prims, ((a + b) / 2, 0, 3.3), AX, (b - a, 13.96, 0.6), {"top": "floor", "bottom": "rim", "side": "rim"})
ch.req = [f"Floor_{i + 1}" for i in range(4)]

# ---------------- skirting (optional group)
for side in "FB":
    for i, (x0, x1) in enumerate(SEGS):
        p = piece(f"Skirt_{side}{i + 1}", "Skirt", group="Skirt")
        wbox(p.prims, WALLS[side], x0, x1, 0, 3.2, -0.05, 0.03, "skirt")
for side in "WE":
    p = piece(f"Skirt_{side}", "Skirt", group="Skirt")
    wbox(p.prims, WALLS[side], -6.9, 6.9, 0, 3.2, -0.05, 0.03, "skirt")

# ---------------- openings
OPEN = {
    "F": [dict(name="Window_F1", kind="win", u=-23.0, w=4.6, zb=FT + 3.0, h=3.2),
          dict(name="Door_Back", kind="door", u=-17.5, w=2.4, zb=FT, h=6.4, mat="backdoor"),
          dict(name="Window_F2", kind="win", u=-4.0, w=2.8, zb=FT + 2.6, h=3.6),
          dict(name="Door_Front", kind="door", u=3.5, w=3.2, zb=FT, h=6.8, mat="door"),
          dict(name="Window_F3", kind="win", u=18.0, w=4.6, zb=FT + 3.0, h=3.2)],
    "B": [dict(name=f"Window_B{j + 1}", kind="win", u=u, w=3.6, zb=FT + 3.0, h=3.2)
          for j, u in enumerate((-21.0, -7.0, 8.0, 21.0))],
    "W": [dict(name="Window_W1", kind="win", u=0.0, w=2.8, zb=FT + 3.2, h=3.0)],
    "E": [],
}


def holes(side):
    return [(o["u"] - o["w"] / 2, o["u"] + o["w"] / 2, o["zb"], o["zb"] + o["h"]) for o in OPEN[side]]


T = 0.25  # trim width
shutters_of = {}
for side, ops in OPEN.items():
    w = WALLS[side]
    for o in ops:
        u, ww, zb, h = o["u"], o["w"], o["zb"], o["h"]
        ua, ub, zt = u - ww / 2, u + ww / 2, zb + h
        p = piece(o["name"], "Window" if o["kind"] == "win" else "Door")
        wbox(p.prims, w, ua - T, ua, zb - (T if o["kind"] == "win" else 0), zt + T, 0, 0.12, "trim")
        wbox(p.prims, w, ub, ub + T, zb - (T if o["kind"] == "win" else 0), zt + T, 0, 0.12, "trim")
        wbox(p.prims, w, ua, ub, zt, zt + T, 0, 0.12, "trim")
        J = 0.08
        wbox(p.prims, w, ua, ua + J, zb, zt, -0.5, 0, "trim")
        wbox(p.prims, w, ub - J, ub, zb, zt, -0.5, 0, "trim")
        wbox(p.prims, w, ua + J, ub - J, zt - J, zt, -0.5, 0, "trim")
        if o["kind"] == "win":
            wbox(p.prims, w, ua, ub, zb - T, zb, 0, 0.16, "trim")          # sill
            wbox(p.prims, w, ua + J, ub - J, zb, zb + J, -0.5, 0, "trim")
            wbox(p.prims, w, ua + J, ub - J, zb + J, zt - J, -0.32, -0.28, "glass")
            mid = (zb + zt) / 2
            wbox(p.prims, w, ua + J, ub - J, mid - 0.06, mid + 0.06, -0.36, -0.2, "trim")
            if side in "FB":
                names = []
                for sg, (sa, sb) in (("L", (ua - T - 0.05 - 1.3, ua - T - 0.05)), ("R", (ub + T + 0.05, ub + T + 0.05 + 1.3))):
                    sp = piece(f"Shutter_{o['name'].split('_')[1]}{sg}", "Shutter", group="Shutters")
                    wbox(sp.prims, w, sa, sb, zb - 0.2, zt + 0.2, 0.0, 0.1, "shutter")
                    names.append(sp.name)
                    shutters_of.setdefault((side, seg_index((sa + sb) / 2)), []).append(sp.name)
                p.req = names
        else:
            wbox(p.prims, w, ua + 0.04, ub - 0.04, zb, zt - J, -0.3, -0.16, o["mat"])
            wbox(p.prims, w, ub - 0.55, ub - 0.32, zb + 3.0, zb + 3.25, -0.16, -0.02, "metal")

# ---------------- side walls: siding (outer) + wall (inner)
for side in "FB":
    w = WALLS[side]
    for i, (x0, x1) in enumerate(SEGS):
        sp = piece(f"Siding_{side}{i + 1}", "Siding")
        for (a, b, c, d) in rect_minus(x0, x1, 3.2, WT, holes(side)):
            wbox(sp.prims, w, a, b, c, d, -0.15, 0.0, "siding", uv="siding")
        sp.req = list(shutters_of.get((side, i), []))
        wp = piece(f"Wall_{side}{i + 1}", "Wall")
        for (a, b, c, d) in rect_minus(x0, x1, FT, WT, holes(side)):
            wbox(wp.prims, w, a, b, c, d, -0.5, -0.15, "drywall")
        wp.req = [sp.name] + [o["name"] for o in OPEN[side] if seg_index(o["u"]) == i] + [f"Ceiling_{i + 1}"]

# ---------------- end walls (with gable triangle on the outer layer)
for side, sx in (("W", -1), ("E", 1)):
    w = WALLS[side]
    es = piece(f"EndSiding_{side}", "Siding")
    for (a, b, c, d) in rect_minus(-7.0, 7.0, 3.2, WT, holes(side)):
        wbox(es.prims, w, a, b, c, d, -0.15, 0.0, "siding", uv="siding")
    add_poly(es.prims, w, [(-7.0, WT), (7.0, WT), (7.0, ROOF_BASE), (0.0, RIDGE), (-7.0, ROOF_BASE)], -0.15, 0.0,
             "siding", uv="siding")
    for ys in (-1, 1):
        add_box(es.prims, (sx * (HL - 0.03), ys * (HW - 0.03), (3.2 + WT) / 2), AX, (0.3, 0.3, WT - 3.2), "trim")
    ew = piece(f"EndWall_{side}", "Wall")
    for (a, b, c, d) in rect_minus(-6.5, 6.5, FT, WT, holes(side)):
        wbox(ew.prims, w, a, b, c, d, -0.5, -0.15, "drywall")
    ew.req = [es.name] + [o["name"] for o in OPEN[side]] + [f"Ceiling_{1 if sx < 0 else 4}"]

# ---------------- ceilings
for i, (x0, x1) in enumerate(SEGS):
    p = piece(f"Ceiling_{i + 1}", "Ceiling")
    a, b = max(x0, -27.5), min(x1, 27.5)
    add_box(p.prims, ((a + b) / 2, 0, WT - 0.1), AX, (b - a, 13.0, 0.2), "drywall")

# ---------------- interior walls
iw = piece("IW_1", "InteriorWall")
for (a, b) in ((-6.5, 1.0), (3.6, 6.5)):
    add_box(iw.prims, (-14.0, (a + b) / 2, (FT + WT - 0.2) / 2), AX, (0.34, b - a, WT - 0.2 - FT), "drywall")
add_box(iw.prims, (-14.0, 2.3, (FT + 6.8 + WT - 0.2) / 2), AX, (0.34, 2.6, WT - 0.2 - FT - 6.8), "drywall")
iw.req = ["Ceiling_1", "Ceiling_2"]
iw = piece("IW_2", "InteriorWall")
for (a, b) in ((-6.5, -4.0), (-1.4, 6.5)):
    add_box(iw.prims, (10.0, (a + b) / 2, (FT + WT - 0.2) / 2), AX, (0.34, b - a, WT - 0.2 - FT), "drywall")
add_box(iw.prims, (10.0, -2.7, (FT + 6.8 + WT - 0.2) / 2), AX, (0.34, 2.6, WT - 0.2 - FT - 6.8), "drywall")
iw.req = ["Ceiling_3"]
iw = piece("IW_3", "InteriorWall")
for (a, b) in ((-27.5, -23.0), (-20.6, -14.2)):
    add_box(iw.prims, ((a + b) / 2, 1.0, (FT + WT - 0.2) / 2), AX, (b - a, 0.34, WT - 0.2 - FT), "drywall")
add_box(iw.prims, (-21.8, 1.0, (FT + 6.8 + WT - 0.2) / 2), AX, (2.4, 0.34, WT - 0.2 - FT - 6.8), "drywall")
iw.req = ["Ceiling_1"]

# ---------------- trusses
truss_names = []
for k, xt in enumerate(-26.0 + 4.0 * j for j in range(14)):
    p = piece(f"Truss_{k + 1:02d}", "Truss")
    truss_names.append(p.name)
    wood = "wood"
    beam(p.prims, (xt, -7.0, WT + 0.1), (xt, 7.0, WT + 0.1), 0.15, 0.2, wood)
    for s in (-1, 1):
        beam(p.prims, (xt, s * 7.3, RIDGE - 7.3 * TAN_A - 0.13), (xt, 0, RIDGE - 0.13), 0.15, 0.25, wood)
        beam(p.prims, (xt, s * 3.5, WT + 0.2), (xt, s * 3.5, RIDGE - 3.5 * TAN_A - 0.25), 0.15, 0.18, wood)
        beam(p.prims, (xt, s * 3.5, WT + 0.2), (xt, s * 0.25, RIDGE - 0.35), 0.15, 0.18, wood)
        beam(p.prims, (xt, s * 6.0, WT + 0.2), (xt, s * 3.6, RIDGE - 3.6 * TAN_A - 0.3), 0.15, 0.18, wood)
    beam(p.prims, (xt, 0, WT + 0.2), (xt, 0, RIDGE - 0.25), 0.15, 0.18, wood)
    p.req = [f"Sheathing_{sd}{i + 1}" for i in segs_touching(xt) for sd in "FB"]
    for i in segs_touching(xt, 0.01):
        P[f"Ceiling_{i + 1}"].req.append(p.name)

# ---------------- roof: sheathing + shingles per segment & side
ang = math.atan(TAN_A)
ca, sa = math.cos(ang), math.sin(ang)
LS = 7.7 / ca
roof_frames = {}
for i, (x0, x1) in enumerate(ROOF_SEGS):
    xc, L = (x0 + x1) / 2, x1 - x0
    for side, s in (("F", -1), ("B", 1)):
        ex, ey, nu = X, Vector((0, s * ca, -sa)), Vector((0, s * sa, ca))
        fr = frame_from(ex if s > 0 else -ex, ey)
        roof_frames[side] = (ex, ey, nu)
        pr = Vector((xc, 0, RIDGE))
        sh = piece(f"Sheathing_{side}{i + 1}", "Sheathing", frame=fr)
        add_box(sh.prims, pr + ey * (LS / 2) + nu * 0.075, (ex, ey, nu), (L, LS, 0.15), "osb")
        add_box(sh.prims, (xc, s * 7.75, ROOF_BASE - 0.35), AX, (L, 0.1, 0.52), "trim")     # fascia
        add_box(sh.prims, (xc, s * 7.35, ROOF_BASE - 0.4), AX, (L, 0.7, 0.06), "trim")      # soffit
        if i in (0, 3):
            xr = x0 + 0.05 if i == 0 else x1 - 0.05
            beam(sh.prims, (xr, s * 7.75, ROOF_BASE - 0.21), (xr, 0, RIDGE + 0.05), 0.12, 0.45, "trim")
        sg = piece(f"Shingles_{side}{i + 1}", "Shingles", frame=fr)
        add_box(sg.prims, pr + ey * (LS / 2 + 0.05) + nu * 0.19, (ex, ey, nu), (L, LS + 0.1, 0.08), "shingle", uv="x")
        if s > 0:
            add_box(sg.prims, (xc, 0, RIDGE + 0.15 / ca + 0.2), AX, (L, 1.1, 0.12), "shingle", uv="x")
        sh.req = [sg.name]

# ---------------- roof vents / pipes
VENTS = [("Vent_1", -21.0, "B", 2.5, "box"), ("Vent_2", -3.0, "B", 2.5, "box"), ("Vent_3", 21.0, "B", 2.5, "box"),
         ("Vent_4", 11.0, "F", 2.5, "box"), ("Pipe_Plumb", -11.0, "F", 3.5, "pipe"),
         ("Pipe_Flue", 17.0, "B", 3.0, "flue")]
for name, x, side, yy, kind in VENTS:
    s = -1 if side == "F" else 1
    ex, ey, nu = roof_frames[side]
    surf = Vector((x, s * yy, RIDGE - yy * TAN_A + 0.23 / ca))
    p = piece(name, "Vent")
    if kind == "box":
        add_box(p.prims, surf + nu * 0.25, (ex, ey, nu), (1.0, 1.0, 0.5), "metal")
        add_box(p.prims, surf + nu * 0.55, (ex, ey, nu), (1.3, 1.3, 0.12), "dark")
    elif kind == "pipe":
        add_cyl(p.prims, surf - Z * 0.3, 0.18, 1.4, "metal")
    else:
        add_cyl(p.prims, surf - Z * 0.3, 0.3, 3.0, "metal")
        add_cyl(p.prims, surf + Z * 2.85, 0.5, 0.18, "metal")
    P[f"Shingles_{side}{seg_index(x) + 1}"].req.append(name)

# ---------------- cross gable over the front door (optional group)
GPEAK, GRUN, GRISE = 13.6, 6.6, 6.6 * (2.3 / 6.0)
gb = math.atan(2.3 / 6.0)
cb, sb = math.cos(gb), math.sin(gb)
LG = GRUN / cb
GY0, GY1 = -8.3, -0.6
gr = piece("Gable_Roof", "GableRoof", group="Gable")
for t in (-1, 1):
    ex, ey, nu = Y, Vector((t * cb, 0, -sb)), Vector((t * sb, 0, cb))
    c0 = Vector((0, (GY0 + GY1) / 2, GPEAK))
    add_box(gr.prims, c0 + ey * (LG / 2) + nu * 0.075, (ex, ey, nu), (GY1 - GY0, LG, 0.15), "osb")
    add_box(gr.prims, c0 + ey * (LG / 2 + 0.05) + nu * 0.19, (ex, ey, nu), (GY1 - GY0, LG + 0.1, 0.08), "shingle", uv="y")
    beam(gr.prims, (0, GY0 - 0.05, GPEAK + 0.05), (t * GRUN, GY0 - 0.05, GPEAK - GRISE + 0.05), 0.12, 0.45, "trim")
add_box(gr.prims, (0, (GY0 + GY1) / 2, GPEAK + 0.15 / cb + 0.2), AX, (1.0, GY1 - GY0, 0.12), "shingle", uv="y")
gf = piece("Gable_Face", "GableFace", group="Gable")
add_poly(gf.prims, WALLS["F"], [(-6.0, 11.0), (6.0, 11.0), (0.0, GPEAK - 0.05)], 0.82, 0.95, "siding", uv="siding")
wbox(gf.prims, WALLS["F"], -6.2, 6.2, 10.8, 11.02, 0.8, 1.0, "trim")
gf.req = ["Gable_Roof"]
for i in (1, 2):
    P[f"Shingles_F{i + 1}"].req.append("Gable_Roof")
    P[f"Sheathing_F{i + 1}"].req.append("Gable_Face")

# ---------------- back-door steps (always present)
p = piece("Steps_Back", "Steps")
stairs(p.prims, (-17.5, -7.02, DECK_Z), (0, -1, 0), 3.0, 5, DECK_Z / 5, 0.85, landing=1.3)

# ---------------- small porch + stairs at the front door (group "Porch")
pl = piece("Porch_Landing", "DeckFloor", group="Porch")
add_box(pl.prims, (3.5, -8.71, DECK_Z - 0.125), AX, (4.6, 3.38, 0.25), "deck")
for (x, y) in ((1.35, -10.25), (5.65, -10.25), (1.35, -7.3), (5.65, -7.3)):
    beam(pl.prims, (x, y, 0), (x, y, DECK_Z - 0.25), 0.35, 0.35, "deck")
railing(pl.prims, (1.35, -7.2), (1.35, -10.25), DECK_Z)
railing(pl.prims, (1.35, -10.25), (5.65, -10.25), DECK_Z)
ps = piece("Porch_Stairs", "Steps", group="Porch")
stairs(ps.prims, (5.8, -8.9, DECK_Z), (1, 0, 0), 2.8, 5, DECK_Z / 6, 0.9, rails=(-1,))
pl.req = ["Porch_Stairs"]

# ---------------- big deck (group "Deck")
for name, (x0, x1) in (("Deck_Floor_1", (-8.0, 3.5)), ("Deck_Floor_2", (3.5, 15.0))):
    p = piece(name, "DeckFloor", group="Deck")
    xc = (x0 + x1) / 2
    add_box(p.prims, (xc, -10.51, DECK_Z - 0.125), AX, (x1 - x0, 6.98, 0.25), "deck")
    add_box(p.prims, (xc, -13.93, DECK_Z - 0.55), AX, (x1 - x0, 0.15, 0.6), "deck")
    n = 3
    for j in range(n + 1):
        x = x0 + 0.3 + (x1 - x0 - 0.6) * j / n
        for y in (-13.75, -7.4):
            beam(p.prims, (x, y, 0), (x, y, DECK_Z - 0.25), 0.4, 0.4, "deck")
for name, a, b in (("Deck_Rail_F1", (-7.85, -13.85), (2.0, -13.85)),
                   ("Deck_Rail_F2", (2.0, -13.85), (11.6, -13.85)),
                   ("Deck_Rail_W", (-7.85, -7.2), (-7.85, -13.85)),
                   ("Deck_Rail_E", (14.85, -7.2), (14.85, -13.85))):
    p = piece(name, "Rail", group="Deck")
    railing(p.prims, a, b, DECK_Z)
p = piece("Deck_Stairs", "Steps", group="Deck")
stairs(p.prims, (13.25, -14.0, DECK_Z), (0, -1, 0), 3.0, 5, DECK_Z / 6, 0.9, rails=(-1, 1))
P["Deck_Floor_1"].req = ["Deck_Rail_F1", "Deck_Rail_W"]
P["Deck_Floor_2"].req = ["Deck_Rail_F2", "Deck_Rail_E", "Deck_Stairs"]

# floors need everything standing on them gone first
for i in range(4):
    req = [f"Wall_F{i + 1}", f"Wall_B{i + 1}"]
    if i == 0:
        req += ["EndWall_W", "IW_1", "IW_3"]
    if i == 1:
        req += ["IW_1"]
    if i == 2:
        req += ["IW_2"]
    if i == 3:
        req += ["EndWall_E"]
    P[f"Floor_{i + 1}"].req = req

for p in pieces:
    for r in p.req:
        assert r in P, (p.name, r)


# ================================================================== GEOMETRY
def prim_faces(pr):
    """-> list of (verts[world], mat_name, uvmode, prim_center) with outward winding"""
    faces = []
    if pr["kind"] == "box":
        a0, a1, a2 = pr["ax"]
        if a0.cross(a1).dot(a2) < 0:
            a0 = -a0
        h = [v / 2 for v in pr["s"]]
        c = pr["c"]

        def corner(i, j, k):
            return c + a0 * (h[0] * (1 if i else -1)) + a1 * (h[1] * (1 if j else -1)) + a2 * (h[2] * (1 if k else -1))

        quads = [((0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)), ((1, 0, 0), (1, 0, 1), (1, 1, 1), (1, 1, 0)),
                 ((0, 0, 0), (0, 0, 1), (1, 0, 1), (1, 0, 0)), ((0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)),
                 ((0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)), ((0, 0, 1), (0, 1, 1), (1, 1, 1), (1, 0, 1))]
        for q in quads:
            faces.append([corner(*ijk) for ijk in q])
        center = c
    elif pr["kind"] == "poly":
        w = pr["wall"]
        front = [wpt(w, u, z, pr["d1"]) for (u, z) in pr["poly"]]
        back = [wpt(w, u, z, pr["d0"]) for (u, z) in pr["poly"]]
        faces.append(front)
        faces.append(list(reversed(back)))
        n = len(front)
        for i in range(n):
            j = (i + 1) % n
            faces.append([front[i], back[i], back[j], front[j]])
        center = sum(front + back, Vector()) / (2 * n)
    else:
        n, c, r, h = pr["seg"], pr["c"], pr["r"], pr["h"]
        bot = [c + Vector((math.cos(2 * math.pi * i / n) * r, math.sin(2 * math.pi * i / n) * r, 0)) for i in range(n)]
        top = [v + Z * h for v in bot]
        faces.append(top)
        faces.append(list(reversed(bot)))
        for i in range(n):
            j = (i + 1) % n
            faces.append([bot[i], bot[j], top[j], top[i]])
        center = c + Z * (h / 2)
    out = []
    for f in faces:
        fc = sum(f, Vector()) / len(f)
        nrm = (f[1] - f[0]).cross(f[2] - f[0])
        if nrm.dot(fc - center) < 0:
            f = list(reversed(f))
            nrm = -nrm
        nrm.normalize()
        m = pr["mat"]
        if isinstance(m, dict):
            m = m["top"] if nrm.z > 0.6 else m["bottom"] if nrm.z < -0.6 else m["side"]
        out.append((f, nrm, m, pr["uv"], center))
    return out


def face_uvs(verts, nrm, mat, uvmode, center):
    nx, ny, nz = abs(nrm.x), abs(nrm.y), abs(nrm.z)
    uvs = []
    if mat == "siding":
        r = SIDING_RECT
        for p in verts:
            if nz > max(nx, ny):
                hcoord, t = p.x, 0.02
            else:
                hcoord = p.x if ny >= nx else p.y
                t = (p.z - 3.1) / 11.0
            s = (hcoord + 30.0) / 60.0
            uvs.append((r[0] + min(max(s, 0.002), 0.998) * (r[2] - r[0]), r[1] + min(max(t, 0.002), 0.998) * (r[3] - r[1])))
        return uvs
    if mat == "shingle":
        r = SHINGLE_RECT
        for p in verts:
            if uvmode == "y":
                s, t = (p.y + 30.0) / 60.0, (p.x + 9.0) / 18.0
            else:
                s, t = (p.x + 30.0) / 60.0, (p.y + 9.0) / 18.0
            uvs.append((r[0] + min(max(s, 0.002), 0.998) * (r[2] - r[0]), r[1] + min(max(t, 0.002), 0.998) * (r[3] - r[1])))
        return uvs
    r = cell_rect(mat)
    S = CELL_SCALE.get(mat, 16.0)
    for p in verts:
        d = p - center
        if nz >= max(nx, ny):
            a, b = d.x, d.y
        elif nx >= ny:
            a, b = d.y, d.z
        else:
            a, b = d.x, d.z
        s = min(max(0.5 + a / S, 0.05), 0.95)
        t = min(max(0.5 + b / S, 0.05), 0.95)
        uvs.append((r[0] + s * (r[2] - r[0]), r[1] + t * (r[3] - r[1])))
    return uvs


# ================================================================== TEXTURE ATLAS
rng = np.random.default_rng(1234)


def value_noise(h, w, gy, gx):
    g = rng.random((gy + 1, gx + 1))
    ys = np.linspace(0, gy, h, endpoint=False)
    xs = np.linspace(0, gx, w, endpoint=False)
    y0, x0 = ys.astype(int), xs.astype(int)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b = g[y0][:, x0], g[y0][:, x0 + 1]
    c, d = g[y0 + 1][:, x0], g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(h, w, gy, gx, octaves=3):
    s, amp, tot = 0, 1.0, 0
    for o in range(octaves):
        s = s + amp * value_noise(h, w, gy * 2 ** o, gx * 2 ** o)
        tot += amp
        amp *= 0.5
    return s / tot


def solid(color, n=256, amp=0.06, gy=8, gx=8):
    return np.array(color)[None, None, :] * (1 - amp + 2 * amp * fbm(n, n, gy, gx))[:, :, None]


def stripes(img, period, axis, dark=0.6, width=1.5):
    n = img.shape[0]
    idx = np.arange(n)
    m = ((idx % period) < width).astype(float)
    m = m[:, None] if axis == 0 else m[None, :]
    return img * (1 - (1 - dark) * m)[:, :, None]


atlas = np.ones((ATLAS, ATLAS, 4), dtype=np.float32)


def put(rect, arr):
    x0, y0 = int(rect[0] * ATLAS), int(rect[1] * ATLAS)
    atlas[y0:y0 + arr.shape[0], x0:x0 + arr.shape[1], :3] = np.clip(arr, 0, 1)


# siding: lap boards with a shadow line, grain streaks
N = 1024
z = np.arange(N) * (11.0 / N)
t = (z % 0.55) / 0.55
shade = 0.80 + 0.20 * np.clip(t / 0.18, 0, 1) - 0.06 * t
shade[t < 0.035] = 0.62
grain = fbm(N, N, 220, 10)
col = np.array([0.74, 0.69, 0.62])
put(SIDING_RECT, col[None, None, :] * (shade[:, None] * (0.90 + 0.16 * grain))[:, :, None])

# shingles: offset tabs, per-tab tone, granules
yy, xx = np.mgrid[0:N, 0:N]
row = yy // 34
off = (row % 2) * 8.5
tab = ((xx + off) // 17).astype(int)
tone = rng.random((row.max() + 2, tab.max() + 2))[row, tab]
tt = (yy % 34) / 34.0
sh = 0.72 + 0.28 * np.clip(tt / 0.15, 0, 1)
gap = (((xx + off) % 17) < 1.3) & (tt < 0.6)
sh = sh * np.where(gap, 0.7, 1.0)
gran = rng.random((N, N))
val = sh * (0.88 + 0.14 * tone) * (0.86 + 0.22 * gran)
put(SHINGLE_RECT, np.array([0.36, 0.335, 0.31])[None, None, :] * val[:, :, None])

n = 256
cells = {
    "trim": solid((0.93, 0.93, 0.93), amp=0.02),
    "drywall": solid((0.86, 0.85, 0.81), amp=0.03),
    "shutter": stripes(solid((0.09, 0.09, 0.10), amp=0.05), 12, 0, dark=0.55, width=2),
    "glass": np.dstack([np.linspace(0.50, 0.68, n)[:, None] * np.ones((n, n)) * k for k in (1.0, 1.04, 1.1)]),
    "door": solid((0.80, 0.80, 0.82), amp=0.02),
    "backdoor": solid((0.56, 0.50, 0.45), amp=0.05),
    "deck": stripes(solid((0.42, 0.37, 0.33), amp=0.12, gy=40, gx=4), 18, 0, dark=0.55, width=2),
    "concrete": solid((0.70, 0.71, 0.74), amp=0.08, gy=24, gx=24) * (1 - 0.45 * (rng.random((n, n)) > 0.985))[:, :, None],
    "osb": solid((0.82, 0.64, 0.42), amp=0.16, gy=32, gx=32),
    "wood": solid((0.80, 0.50, 0.27), amp=0.08, gy=4, gx=40),
    "rim": solid((0.82, 0.47, 0.22), amp=0.06),
    "steel": solid((0.16, 0.17, 0.19), amp=0.05),
    "skirt": stripes(solid((0.92, 0.92, 0.94), amp=0.02), 64, 1, dark=0.85, width=3),
    "metal": solid((0.62, 0.64, 0.67), amp=0.05),
    "floor": stripes(solid((0.36, 0.34, 0.33), amp=0.1, gy=40, gx=4), 20, 0, dark=0.7, width=2),
    "dark": solid((0.22, 0.22, 0.23), amp=0.04),
}
for name, arr in cells.items():
    put(cell_rect(name), arr)

img = bpy.data.images.new("trailer_atlas", ATLAS, ATLAS, alpha=False)
img.pixels.foreach_set(atlas.ravel())
tex_path = os.path.join(OUT, "trailer_atlas.png")
img.filepath_raw = tex_path
img.file_format = "PNG"
img.save()

# ================================================================== MESH
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
coll = scene.collection

bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
dl = bm.verts.layers.deform.verify()
info = []
for gi, pc in enumerate(pieces):
    allv = []
    for pr in pc.prims:
        for (verts, nrm, mat, uvmode, center) in prim_faces(pr):
            bv = [bm.verts.new(v) for v in verts]
            for v in bv:
                v[dl][gi] = 1.0
            f = bm.faces.new(bv)
            for loop, uv in zip(f.loops, face_uvs(verts, nrm, mat, uvmode, center)):
                loop[uvl].uv = uv
            allv.extend(verts)
    R = pc.frame
    Ri = R.transposed()
    loc = [Ri @ v for v in allv]
    mn = Vector((min(v.x for v in loc), min(v.y for v in loc), min(v.z for v in loc)))
    mx = Vector((max(v.x for v in loc), max(v.y for v in loc), max(v.z for v in loc)))
    pc.center = R @ ((mn + mx) / 2)
    pc.size = mx - mn

me = bpy.data.meshes.new("TrailerMesh")
bm.to_mesh(me)
tri_count = sum(len(f.verts) - 2 for f in bm.faces)
bm.free()
obj = bpy.data.objects.new("Trailer", me)
coll.objects.link(obj)
for pc in pieces:
    obj.vertex_groups.new(name=pc.name)

mat = bpy.data.materials.new("TrailerAtlas")
try:
    mat.use_nodes = True
except Exception:
    pass
nt = mat.node_tree
bsdf = next(nd for nd in nt.nodes if nd.type == "BSDF_PRINCIPLED")
texn = nt.nodes.new("ShaderNodeTexImage")
texn.image = img
nt.links.new(texn.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.85
nt.nodes.active = texn
me.materials.append(mat)

# ================================================================== ARMATURE
arm = bpy.data.armatures.new("TrailerRig")
ao = bpy.data.objects.new("TrailerRig", arm)
coll.objects.link(ao)
bpy.context.view_layer.objects.active = ao
ao.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
root = arm.edit_bones.new("Root")
root.head, root.tail = (0, 0, 0), (0, 0, 1)
for pc in pieces:
    b = arm.edit_bones.new(pc.name)
    b.head = pc.center
    b.tail = pc.center + Vector((0, 0, 0.6))
    b.parent = root
bpy.ops.object.mode_set(mode="OBJECT")
obj.parent = ao
mod = obj.modifiers.new("Armature", "ARMATURE")
mod.object = ao

print(f"[trailer] pieces/bones: {len(pieces)} (+Root)  triangles: {tri_count}")

# ================================================================== EXPORT FBX + BLEND
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
ao.select_set(True)
fbx_path = os.path.join(OUT, "MobileTrailer.fbx")
bpy.ops.export_scene.fbx(filepath=fbx_path, use_selection=True, object_types={"ARMATURE", "MESH"},
                         add_leaf_bones=False, bake_anim=False, path_mode="COPY", embed_textures=True,
                         mesh_smooth_type="FACE", use_armature_deform_only=False,
                         apply_scale_options="FBX_SCALE_NONE")

# ================================================================== LUAU DATA MODULE


def rbx_vec(v):
    return (v.x, v.z, -v.y)


C = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))
cat_rows = []
for pc in pieces:
    px, py, pz = rbx_vec(pc.center)
    Rr = C @ pc.frame @ C.transposed()
    rot = ", ".join(f"{Rr[i][j]:.5f}" for i in range(3) for j in range(3))
    sz = pc.size
    req = ", ".join(f'"{r}"' for r in pc.req)
    grp = f'"{pc.group}"' if pc.group else "nil"
    cat_rows.append(
        f'\t{pc.name} = {{ Category = "{pc.cat}", Group = {grp}, '
        f"CFrame = CFrame.new({px:.4f}, {py:.4f}, {pz:.4f}, {rot}), "
        f"Size = Vector3.new({max(sz.x, 0.2):.3f}, {max(sz.z, 0.2):.3f}, {max(sz.y, 0.2):.3f}), "
        f"Requires = {{ {req} }} }},")
# NOTE size: frame-local (x, y, z) in Blender -> rbx frame-local (x, z, y) since C maps y->-z, z->y


def anchor(name):
    x, y, z = rbx_vec(P[name].center)
    return f'{{ Bone = "{name}", Position = Vector3.new({x:.4f}, {y:.4f}, {z:.4f}) }}'


lua = f"""-- AUTO-GENERATED by build_trailer.py. Do not edit by hand; re-run the Blender script.
-- Piece data for the MobileTrailer skinned mesh. Coordinates are trailer-local (studs),
-- origin = ground under the trailer centre, Y up. Every key is also the Bone name.
return {{
\tAnchors = {{
\t\t{{ Bone = "Root", Position = Vector3.zero }},
\t\t{anchor(truss_names[0])},
\t\t{anchor(truss_names[-1])},
\t}},
\tPieces = {{
""" + "\n".join("\t" + r for r in cat_rows) + "\n\t},\n}\n"
os.makedirs(os.path.join(OUT, "roblox", "PieceSets"), exist_ok=True)
with open(os.path.join(OUT, "roblox", "PieceSets", "MobileTrailer.lua"), "w", encoding="utf-8") as fh:
    fh.write(lua)

# plain piece data for the pure sim (Shared/StormLab/Structures): numbers only, Roblox axes
# (x along the length, y up, z = Blender -y), feet. rot is the piece frame's rotation matrix, row major.
if DATA:
    rows = []
    for pc in pieces:
        px, py, pz = rbx_vec(pc.center)
        Rr = C @ pc.frame @ C.transposed()
        rot = ", ".join(f"{Rr[i][j]:.5f}" for i in range(3) for j in range(3))
        sz = pc.size
        req = ", ".join(f'"{r}"' for r in pc.req)
        grp = f'"{pc.group}"' if pc.group else "nil"
        rows.append(f'		{pc.name} = {{ cat = "{pc.cat}", group = {grp}, pos = {{ {px:.4f}, {py:.4f}, {pz:.4f} }}, '
                    f"rot = {{ {rot} }}, size = {{ {max(sz.x, 0.2):.3f}, {max(sz.z, 0.2):.3f}, {max(sz.y, 0.2):.3f} }}, "
                    f"req = {{ {req} }} }},")
    header = [
        "-- AUTO-GENERATED by tools/blender/mobile_home.py (--data). Do not edit by hand; re-run the script.",
        "-- The single-wide mobile home's pieces (each one bone of the skinned mesh): category, optional",
        "-- group, centre, rotation (row major), size and the pieces that must be gone before it can go (req).",
        "-- Roblox axes (x along the length, y up, z across; the front, with the doors, is +z), in feet;",
        "-- origin = the ground under the centre. Read by Sim/MobileHome.",
    ]
    lines = header + ["return {", "\tunit = 0.3048, -- metres per unit", "\tpieces = {"] + rows + ["\t},", "}", ""]
    os.makedirs(os.path.dirname(DATA), exist_ok=True)
    with open(DATA, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(lines))
    print("[trailer] piece data ->", DATA)

# ================================================================== OFFLINE TEST ASSETS
# A Roblox FileMesh (version 4.00, skinned) + an .rbxmx model that points at it with file:// URIs.
# Only for offline testing with ree/ror; in Studio you import the FBX instead.
import struct
from xml.sax.saxutils import escape

TEST = os.path.join(OUT, "test")
os.makedirs(TEST, exist_ok=True)
nv = len(me.vertices)
uv_data = me.uv_layers[0].data
pos = [None] * nv
nrm = [None] * nv
uvs = [None] * nv
grp = [0] * nv
for poly in me.polygons:
    n = rbx_vec(poly.normal)
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        pos[vi] = rbx_vec(me.vertices[vi].co)
        nrm[vi] = n
        u, v = uv_data[li].uv
        uvs[vi] = (u, 1.0 - v)
for v in me.vertices:
    grp[v.index] = v.groups[0].group
mn = [min(p[i] for p in pos) for i in range(3)]
mx = [max(p[i] for p in pos) for i in range(3)]
mesh_c = [(a + b) / 2 for a, b in zip(mn, mx)]
mesh_size = [b - a for a, b in zip(mn, mx)]
tris, tri_piece = [], []
for poly in me.polygons:
    vs = list(poly.vertices)
    for k in range(1, len(vs) - 1):
        tris.append((vs[0], vs[k], vs[k + 1]))
        tri_piece.append(grp[vs[0]])

bone_names = ["Root"] + [pc.name for pc in pieces]
bind = [(0.0, 0.0, 0.0)] + [rbx_vec(pc.center) for pc in pieces]
CHUNK = 26
subsets = []
for start in range(0, len(pieces), CHUNK):
    ids = list(range(start, min(start + CHUNK, len(pieces))))
    vsel = [i for i in range(nv) if grp[i] in ids]
    fsel = [i for i, g in enumerate(tri_piece) if g in ids]
    assert vsel == list(range(vsel[0], vsel[-1] + 1)) and fsel == list(range(fsel[0], fsel[-1] + 1))
    subsets.append((fsel[0], len(fsel), vsel[0], len(vsel), [g + 1 for g in ids]))
slot_of = {}
for si, s in enumerate(subsets):
    for slot, b in enumerate(s[4]):
        slot_of[b - 1] = slot

names_blob = b""
name_off = []
for nm in bone_names:
    name_off.append(len(names_blob))
    names_blob += nm.encode() + b"\0"
buf = bytearray(b"version 4.00\n")
buf += struct.pack("<HHIIHHIHBB", 24, 0, nv, len(tris), 2, len(bone_names), len(names_blob), len(subsets), 0, 0)
for i in range(nv):
    p = [pos[i][k] - mesh_c[k] for k in range(3)]
    buf += struct.pack("<3f3f2f4B4B", *p, *nrm[i], *uvs[i], 127, 127, 127, 127, 255, 255, 255, 255)
for i in range(nv):
    buf += struct.pack("<8B", slot_of[grp[i]], 0, 0, 0, 255, 0, 0, 0)
for t in tris:
    buf += struct.pack("<3I", *t)
buf += struct.pack("<2I", 0, len(tris))
for bi, nm in enumerate(bone_names):
    b = [bind[bi][k] - mesh_c[k] for k in range(3)]
    buf += struct.pack("<IHHf9f3f", name_off[bi], 0xFFFF if bi == 0 else 0, 0xFFFF, 0.0,
                       1, 0, 0, 0, 1, 0, 0, 0, 1, *b)
buf += names_blob
for (fb, fl, vb, vl, ids) in subsets:
    slots = ids + [0xFFFF] * (26 - len(ids))
    buf += struct.pack("<5I26H", fb, fl, vb, vl, len(ids), *slots)
mesh_path = os.path.join(TEST, "MobileTrailer.mesh")
with open(mesh_path, "wb") as fh:
    fh.write(buf)


def file_uri(p):
    return "file:///" + os.path.abspath(p).replace("\\", "/")


def cf_xml(name, x, y, z):
    return (f'<CoordinateFrame name="{name}"><X>{x}</X><Y>{y}</Y><Z>{z}</Z><R00>1</R00><R01>0</R01><R02>0</R02>'
            f"<R10>0</R10><R11>1</R11><R12>0</R12><R20>0</R20><R21>0</R21><R22>1</R22></CoordinateFrame>")


ref = [0]


def item(cls, props, children=""):
    ref[0] += 1
    return f'<Item class="{cls}" referent="RBX{ref[0]}"><Properties>{props}</Properties>{children}</Item>'


bones_xml = "".join(
    item("Bone", f'<string name="Name">{escape(pc.name)}</string>' + cf_xml("CFrame", *rbx_vec(pc.center)))
    for pc in pieces)
root_xml = item("Bone", '<string name="Name">Root</string>' + cf_xml("CFrame", *[-c for c in mesh_c]), bones_xml)
vec = lambda name, v: f'<Vector3 name="{name}"><X>{v[0]}</X><Y>{v[1]}</Y><Z>{v[2]}</Z></Vector3>'
mesh_xml = item("MeshPart",
                '<string name="Name">Trailer</string><bool name="Anchored">true</bool><bool name="HasSkinnedMesh">true</bool>'
                + cf_xml("CFrame", *mesh_c) + vec("size", mesh_size) + vec("InitialSize", mesh_size)
                + f'<Content name="MeshId"><url>{file_uri(mesh_path)}</url></Content>'
                + f'<Content name="TextureID"><url>{file_uri(tex_path)}</url></Content>', root_xml)
model_xml = item("Model", '<string name="Name">TrailerTemplate</string>', mesh_xml)
with open(os.path.join(TEST, "TrailerTemplate.rbxmx"), "w", encoding="utf-8") as fh:
    fh.write('<roblox version="4">' + model_xml + "</roblox>")
print(f"[trailer] test mesh: {nv} verts, {len(tris)} tris, {len(subsets)} subsets")

# ================================================================== PREVIEW RENDERS
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
ground = bpy.context.active_object
gm = bpy.data.materials.new("Ground")
gm.diffuse_color = (0.33, 0.45, 0.22, 1)
try:
    gm.use_nodes = True
    gb_ = next(nd for nd in gm.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")
    gb_.inputs["Base Color"].default_value = (0.33, 0.45, 0.22, 1)
except Exception:
    pass
ground.data.materials.append(gm)

cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
coll.objects.link(cam)
scene.camera = cam
target = bpy.data.objects.new("Target", None)
coll.objects.link(target)
con = cam.constraints.new("TRACK_TO")
con.target = target
con.track_axis = "TRACK_NEGATIVE_Z"
con.up_axis = "UP_Y"

scene.render.engine = "BLENDER_WORKBENCH"
sh_ = scene.display.shading
sh_.light = "STUDIO"
sh_.color_type = "TEXTURE"
sh_.show_shadows = True
sh_.show_cavity = True
try:
    sh_.cavity_type = "WORLD"
except Exception:
    pass
scene.display.shadow_focus = 0.2
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.image_settings.file_format = "PNG"
try:
    scene.world.color = (0.55, 0.65, 0.75)
except Exception:
    pass

HIDE = {"Skirt": "Skirt_", "Porch": "Porch_", "Deck": "Deck_", "Shutters": "Shutter_", "Gable": "Gable_"}


def pose_reset():
    for pb in ao.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = (0, 0, 0)


def hide_groups(groups):
    # bone local +Y == world +Z (bones point up), so -Y moves a piece underground
    for pc in pieces:
        if pc.group in groups:
            ao.pose.bones[pc.name].location = (0, -200, 0)


def render(name, cam_loc, look=(0, 0, 6), lens=35):
    cam.location = cam_loc
    target.location = look
    cam_data.lens = lens
    bpy.context.view_layer.update()
    scene.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)


pose_reset()
hide_groups({"Deck"})
render("preview_skirting_porch.png", (-18, -62, 26), (0, 0, 6), 38)
pose_reset()
hide_groups({"Porch", "Skirt", "Shutters", "Gable"})
render("preview_piers_deck.png", (40, -55, 30), (0, -2, 5), 35)

# torn-apart preview: roof + some walls flung by "tornado"
rnd = random.Random(3)
pose_reset()
hide_groups({"Porch", "Skirt", "Gable"})
gone_cats = {"Shingles", "Vent", "Shutter"}
for pc in pieces:
    pb = ao.pose.bones[pc.name]
    torn = pc.cat in gone_cats or (pc.cat == "Sheathing" and rnd.random() < 0.75) or \
        (pc.cat == "Siding" and rnd.random() < 0.4) or (pc.cat in ("Window", "Truss") and rnd.random() < 0.3) or \
        pc.name in ("Deck_Rail_F1", "Deck_Stairs", "Wall_F2", "Ceiling_2")
    if torn and pc.group not in ("Porch", "Skirt", "Gable"):
        pb.location = (rnd.uniform(-25, 25), rnd.uniform(5, 30), rnd.uniform(-25, 25))
        pb.rotation_euler = (rnd.uniform(-3, 3), rnd.uniform(-3, 3), rnd.uniform(-3, 3))
render("preview_destroyed.png", (-30, -75, 45), (0, 0, 12), 30)

pose_reset()
hide_groups({"Deck"})
for o in (ground, cam, target):
    o.hide_viewport = False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "MobileTrailer.blend"))
print("[trailer] done ->", OUT)
