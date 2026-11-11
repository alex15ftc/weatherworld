"""Skinned trees for the foliage runtime (roblox/Shared/Foliage, Client FoliageController).

One run makes one tree (a kind and a variant) from Blender's Sapling Tree Gen:

  * Sapling grows the stems (curves) with an armature over every stem, which gives the stem
    hierarchy: bone NNN.SSS belongs to spline NNN, and its parent names the stem and point a
    stem grows from.
  * A small rig is built over that: the trunk (and any level-0 split) in up to 4 bones, each
    limb (level 1) in 1-2 bones, and the limbs' largest side branches (level 2, by the leaves
    they carry) in 1 bone each until the rig budget. Every finer stem and every leaf card is
    owned rigidly by the rig bone it grows from.
  * The bark is meshed here from the curves (rings of 3-10 sides by radius, no Sapling mesh),
    so every vertex knows its stem and arc position: its weights blend between neighbouring
    rig bones across each joint, and a limb's first rings blend into the bone it grows from,
    so the whole tree bends as one surface with no seams.
  * Leaves are alpha cards (leaf clusters, or cedar sprays) along the fine stems, with normals
    bent outward from the crown's middle so the crown shades as one soft mass.
  * One 1024x1024 atlas: bark (tiling round and along the stems; bottom half) and two leaf
    cards (top half), drawn here with numpy.
  * Break pieces: for each rig bone, the faces it dominates, as a separate static mesh at the
    same rest position. The runtime swaps the skinned tree for these, each placed at its
    bone's current pose, at the moment a tree breaks: the first frame of the pieces is the last
    frame of the skinned tree.
  * Impostors: the tree rendered orthographic from 8 directions (EEVEE, transparent) for the
    far billboards.
  * Rig data: roblox/Shared/Foliage/Kinds/<kind>_<variant>.luau, the bones' physical make-up
    (length, radii, wood volume and frontal area, leaf area) that the sway and breaking
    mechanics run from.

Run (Blender 5.1, Sapling enabled in its extensions; no --factory-startup, which drops it):
  blender --background --python tools/blender/foliage_trees.py -- --kind hardwood --variant 1
  ... --kind all            every kind and variant
  ... --no-render           skip the impostor renders (fast iteration)
Outputs: roblox/assets/foliage/<kind>_<variant>/ (tree.fbx, atlas.png, impostor_0..7.png,
preview.png) and the rig data module.
"""
import argparse
import ast
import math
import os
import random
import sys

import addon_utils
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.geometry import interpolate_bezier

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_ASSETS = os.path.join(ROOT, "roblox", "assets", "foliage")
OUT_DATA = os.path.join(ROOT, "roblox", "Shared", "Foliage", "Kinds")
STUDS_PER_M = 1 / 0.28  # roblox/Shared/World/Config.luau STUDS_PER_METRE
SAPLING = "bl_ext.blender_org.sapling_tree_gen"
PRESETS = os.path.join(os.environ.get("APPDATA", ""), "Blender Foundation", "Blender", "5.1", "extensions",
                       "blender_org", "sapling_tree_gen", "presets")
ATLAS = 1024
IMPOSTOR_VIEWS = 8

# Each kind: the Sapling preset it starts from and what is changed; its height range (m); the
# rig budget (bones); the leaf card style, size (m) and colours; the bark colour. The kinds are
# the chunk generator's (roblox/Server/World/Props/Trees.luau).
KINDS = {
    "hardwood": dict(
        preset="small_maple", height=(14.0, 18.0), budget=40, leaf="broad", card=1.7, cards=1400,
        leafColors=((64, 100, 48), (84, 118, 50)), bark=(92, 76, 60), variants=2,
        over=dict(levels=3, ratioPower=1.6, branches=(0, 30, 10, 7), length=(1.0, 0.5, 0.45, 0.4), baseSize=0.3, ratio=0.022,
                  baseSplits=0, segSplits=(0.12, 0.3, 0.5, 0.0)),
    ),
    "cottonwood": dict(
        preset="small_maple", height=(19.0, 24.0), budget=44, leaf="broad", card=2.0, cards=1500,
        leafColors=((96, 128, 58), (110, 138, 62)), bark=(150, 140, 124), variants=2,
        over=dict(levels=3, ratioPower=1.6, branches=(0, 26, 10, 7), length=(1.0, 0.55, 0.45, 0.4), baseSize=0.34, ratio=0.026,
                  downAngle=(90.0, 55.0, 45.0, 45.0), baseSplits=1, segSplits=(0.15, 0.3, 0.5, 0.0)),
    ),
    "yard": dict(
        preset="small_maple", height=(8.0, 11.0), budget=28, leaf="broad", card=1.3, cards=900,
        leafColors=((70, 112, 50), (86, 124, 54)), bark=(88, 72, 58), variants=2,
        over=dict(levels=3, ratioPower=1.6, branches=(0, 18, 8, 6), length=(1.0, 0.48, 0.45, 0.4), baseSize=0.32, ratio=0.02,
                  baseSplits=0, segSplits=(0.1, 0.3, 0.5, 0.0)),
    ),
    "cedar": dict(
        preset="small_pine", height=(8.0, 11.0), budget=30, leaf="spray", card=1.6, cards=1500,
        leafColors=((44, 70, 44), (52, 78, 48)), bark=(104, 76, 60), variants=2,
        over=dict(levels=3, ratioPower=1.5, branches=(0, 34, 6, 5), length=(1.0, 0.3, 0.6, 0.45), baseSize=0.08, ratio=0.024,
                  segSplits=(0.0, 0.2, 0.3, 0.0)),
    ),
}


# --------------------------------------------------------------------------------------------
# Sapling


def load_preset(name):
    with open(os.path.join(PRESETS, name + ".py")) as f:
        src = f.read()
    return ast.literal_eval(src[src.index("{"):])


def grow(spec, seed):
    """Grows the tree; returns the curve, the armature and the number of stems at each level
    (sapling orders its splines by level and grows level by level, so a run with levels = k
    makes the same first stems: its spline count is where level k starts)."""
    p = load_preset(spec["preset"])
    p.update(spec["over"])
    p.update(seed=seed, useArm=True, armLevels=0, makeMesh=False, armAnim=False, leafAnim=False,
             showLeaves=False, bevel=True, previewArm=False)
    for k in ("limitImport", "overwrite", "presetName"):
        p.pop(k, None)
    starts = []
    for k in range(1, p["levels"] + 1):
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o)
        q = dict(p, levels=k)
        bpy.ops.curve.tree_add(**q)
        starts.append(len(bpy.data.objects["tree"].data.splines))
    curve = bpy.data.objects["tree"]
    arm = bpy.data.objects["treeArm"]
    return curve, arm, starts


class Stem:
    __slots__ = ("idx", "level", "parent", "attach_pt", "attach_s", "pts", "rad", "s", "length", "children",
                 "bones", "owner_cache")


def read_stems(curve, arm, starts):
    """The stems: points (finely evaluated), radii, arc lengths; parents from the armature."""
    stems = []
    for i, sp in enumerate(curve.data.splines):
        bp = sp.bezier_points
        st = Stem()
        st.idx = i
        st.parent = None
        st.attach_pt = 0
        st.children = []
        st.bones = []
        pts, rad = [], []
        for k in range(len(bp) - 1):
            a, b = bp[k], bp[k + 1]
            n = 4
            seg = interpolate_bezier(a.co, a.handle_right, b.handle_left, b.co, n + 1)
            for j in range(n):
                pts.append(Vector(seg[j]))
                t = j / n
                rad.append(a.radius * (1 - t) + b.radius * t)
        pts.append(Vector(bp[-1].co))
        rad.append(bp[-1].radius)
        st.pts, st.rad = pts, rad
        s = [0.0]
        for k in range(1, len(pts)):
            s.append(s[-1] + (pts[k] - pts[k - 1]).length)
        st.s = s
        st.length = s[-1]
        st.attach_s = 0.0
        stems.append(st)
    # Each stem's first sapling bone's parent names the stem and point it grows from.
    bones = arm.data.bones
    for st in stems:
        b = bones.get("bone%03d.000" % st.idx)
        if b and b.parent:
            pname = b.parent.name  # boneMMM.TTT
            m, t = int(pname[4:7]), int(pname[8:11])
            if m != st.idx:
                st.parent = m
                st.attach_pt = t + 1  # the parent bone's tail point
    for st in stems:
        if st.parent is not None:
            par = stems[st.parent]
            k = min(st.attach_pt * 4, len(par.s) - 1)
            st.attach_s = par.s[k]
            par.children.append(st.idx)
    for st in stems:
        st.level = next(k for k, c in enumerate(starts) if st.idx < c)
    return stems


def scale_tree(stems, height):
    top = max(p.z for st in stems for p in st.pts)
    f = height / top
    for st in stems:
        st.pts = [p * f for p in st.pts]
        st.rad = [r * f for r in st.rad]
        st.s = [x * f for x in st.s]
        st.length *= f
        st.attach_s *= f
    return f


def point_at(st, s):
    s = max(0.0, min(s, st.length))
    lo, hi = 0, len(st.s) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if st.s[mid] <= s:
            lo = mid
        else:
            hi = mid
    span = st.s[hi] - st.s[lo]
    t = 0.0 if span <= 0 else (s - st.s[lo]) / span
    p = st.pts[lo].lerp(st.pts[hi], t)
    r = st.rad[lo] * (1 - t) + st.rad[hi] * t
    tan = (st.pts[hi] - st.pts[lo])
    if tan.length < 1e-9:
        tan = Vector((0, 0, 1))
    return p, r, tan.normalized()


# --------------------------------------------------------------------------------------------
# The rig


class Bone:
    __slots__ = ("name", "stem", "s0", "s1", "parent", "tier", "head", "tail", "r0", "r1", "index", "wood",
                 "front", "leaf", "children")


def build_rig(stems, budget, height):
    rig = []

    def add(st, s0, s1, parent, tier, name):
        b = Bone()
        b.name, b.stem, b.s0, b.s1, b.parent, b.tier = name, st.idx, s0, s1, parent, tier
        b.head, b.r0, _ = point_at(st, s0)
        b.tail, b.r1, _ = point_at(st, s1)
        b.index = len(rig)
        b.wood = b.front = b.leaf = 0.0
        b.children = []
        if parent is not None:
            rig[parent].children.append(b.index)
        rig.append(b)
        st.bones.append(b.index)
        return b.index

    def covering(st, s):
        for bi in st.bones:
            b = rig[bi]
            if s <= b.s1 + 1e-6:
                return bi
        return st.bones[-1] if st.bones else None

    def owner(idx, s):
        st = stems[idx]
        if st.bones:
            return covering(st, s)
        return owner(st.parent, st.attach_s) if st.parent is not None else 0

    # What each stem carries (its own size and everything growing from it): the order bones are
    # given out in. A stem always carries more than any stem growing from it, so parents get
    # their bones first.
    carried = {}
    for st in reversed(stems):
        carried[st.idx] = st.length * st.rad[0] + sum(carried[c] for c in st.children)
    counts = {"trunk": 0, "limb": 0, "twig": 0}

    def give(st, n, tier, label):
        par = None if st.parent is None else owner(st.parent, st.attach_s)
        counts[label] += 1
        for k in range(n):
            nm = ("Trunk%d" % (len([b for b in rig if b.tier == 0]) + 1)) if tier == 0 else \
                ("Limb%02d%s" % (counts[label], "ab"[k])) if tier == 1 else ("Twig%02d" % counts[label])
            par = add(st, st.length * k / n, st.length * (k + 1) / n, par, tier, nm)

    # the trunk in up to 4 bones; its forks (level-0 splits) in 1-2, the larger first
    trunk_budget = max(4, budget // 6)
    for st in sorted((st for st in stems if st.level == 0), key=lambda st: -carried[st.idx]):
        n = max(1, min(4 if st.parent is None else 2, round(st.length / (0.2 * height))))
        n = min(n, trunk_budget - len(rig))
        if n > 0:
            give(st, n, 0, "trunk")
    # limbs (level 1), the larger first: 2 bones for a long one, while the budget lasts (a quarter
    # kept for the side branches)
    limb_budget = budget - max(4, budget // 4)
    for st in sorted((st for st in stems if st.level == 1), key=lambda st: -carried[st.idx]):
        if len(rig) >= limb_budget or st.length < 0.08 * height:
            continue
        n = 2 if st.length >= 0.22 * height and len(rig) + 2 <= limb_budget else 1
        give(st, n, 1, "limb")
    # side branches (level 2), the larger first, until the budget
    for st in sorted((st for st in stems if st.level == 2), key=lambda st: -carried[st.idx]):
        if len(rig) >= budget:
            break
        # (only branches of the EF scale's "large branch" size and up break as parts: 1.6 in.)
        if st.length < 0.06 * height or st.rad[0] < 0.02:
            continue
        give(st, 1, 2, "twig")
    return rig, owner, covering


# --------------------------------------------------------------------------------------------
# Meshing


class MeshOut:
    def __init__(self):
        self.co, self.nor, self.weights = [], [], []  # weights: list of {bone: w}
        self.faces, self.uvs, self.fbone, self.fmat = [], [], [], []  # uvs: per face loop list

    def vert(self, co, nor, weights):
        self.co.append(co)
        self.nor.append(nor)
        self.weights.append(weights)
        return len(self.co) - 1

    def face(self, idx, uv, bone):
        self.faces.append(idx)
        self.uvs.append(uv)
        self.fbone.append(bone)


def ring_sides(r):
    return 9 if r >= 0.22 else 6 if r >= 0.09 else 4 if r >= 0.035 else 3


def frame_for(tan, ref):
    side = tan.cross(ref)
    if side.length < 1e-6:
        side = tan.cross(Vector((1, 0, 0)))
    side.normalize()
    up = side.cross(tan).normalized()
    return side, up


def mesh_bark(mo, stems, rig, owner, covering, height):
    for st in stems:
        # the finest stems are left to the leaf cards (their wood still counts: physics())
        if st.level > 2 or st.rad[0] < (0.004, 0.008, 0.02)[st.level] * height / 15:
            continue
        sides = ring_sides(st.rad[0])
        # metres of stem per bark tile: about square texels on the trunk; stretched on thin stems
        # (fewer tile rings), one tile along a whole side branch
        tile = st.length + 1 if st.level >= 2 else max(2 * math.pi * st.rad[0], 0.12 * height)
        # the samples: every evaluated point, plus one at each tile boundary
        step = (1, 2, 4)[st.level]
        samples = [s for k, s in enumerate(st.s) if k % step == 0] + [st.length]
        n_tiles = int(st.length / tile)
        for t in range(1, n_tiles + 1):
            samples.append(t * tile)
        samples = sorted(set(round(x, 5) for x in samples if x <= st.length))
        # a limb starts just inside the stem it grows from
        start_bias = 0.0
        if st.parent is not None:
            _, pr, _ = point_at(stems[st.parent], st.attach_s)
            start_bias = -0.6 * pr
        ref = Vector((0, 0, 1)) if st.level > 0 else Vector((0, 1, 0))
        prev_rows = None
        prev_side = None
        prev_s = None
        par_owner = owner(st.parent, st.attach_s) if st.parent is not None else None
        for i, s in enumerate(samples):
            p, r, tan = point_at(st, s)
            if i == 0 and start_bias:
                p = p + tan * start_bias
            if s >= st.length - 1e-6:
                r = max(r, 0.3 * st.rad[0] * 0.2)
            side, up = frame_for(tan, ref)
            # parallel transport keeps rings from twisting
            if prev_side is not None:
                side = (prev_side - tan * prev_side.dot(tan))
                if side.length < 1e-6:
                    side, up = frame_for(tan, ref)
                else:
                    side.normalize()
                    up = side.cross(tan).normalized()
            prev_side = side
            w = weights_at(st, s, rig, covering, par_owner)
            vtile = s / tile
            frac = vtile - math.floor(vtile)
            crossing = i > 0 and abs(frac) < 1e-4 and s > 1e-6
            rows = []
            # one row of verts for the quads below this ring; at a tile boundary, a second row
            # (same place, v = 0) for the quads above
            vs = [1.0 if crossing else frac] if i > 0 else [0.0]
            if crossing:
                vs.append(0.0)
            for v in vs:
                row = []
                for j in range(sides + 1):
                    a = 2 * math.pi * j / sides
                    d = side * math.cos(a) + up * math.sin(a)
                    row.append((mo.vert(p + d * r, d, w), j / sides, v * 0.5))
                rows.append(row)
            if prev_rows is not None:
                below = prev_rows[-1]
                above = rows[0]
                fb = covering(st, 0.5 * (prev_s + s)) if st.bones else owner(st.parent, st.attach_s)
                for j in range(sides):
                    a0, a1 = below[j], below[j + 1]
                    b0, b1 = above[j], above[j + 1]
                    mo.face([a0[0], a1[0], b1[0], b0[0]],
                            [(a0[1], a0[2]), (a1[1], a1[2]), (b1[1], b1[2]), (b0[1], b0[2])], fb)
            prev_rows = rows
            prev_s = s
        # close the tip
        if prev_rows is not None:
            p, r, tan = point_at(st, st.length)
            fb = covering(st, st.length) if st.bones else owner(st.parent, st.attach_s)
            c = mo.vert(p + tan * r * 0.5, tan, weights_at(st, st.length, rig, covering, par_owner))
            row = prev_rows[-1]
            for j in range(sides):
                mo.face([row[j][0], row[j + 1][0], c], [(row[j][1], row[j][2]), (row[j + 1][1], row[j][2]), (0.5, 0.49)], fb)


def weights_at(st, s, rig, covering, par_owner):
    """A ring's weights: its bone, blended toward the neighbour across each joint, and a limb's
    first rings toward the bone it grows from."""
    if not st.bones:
        return {par_owner if par_owner is not None else 0: 1.0}
    bi = covering(st, s)
    b = rig[bi]
    L = b.s1 - b.s0
    win = max(min(2.5 * b.r0, 0.35 * L), 1e-4)
    w = {bi: 1.0}
    # toward the bone above (into the next bone on this stem)
    nxt = [c for c in b.children if rig[c].stem == st.idx]
    if nxt and s > b.s1 - win:
        t = (s - (b.s1 - win)) / win  # 0 .. 1 at the joint
        k = 0.5 * t
        w = {bi: 1 - k, nxt[0]: k}
    elif s < b.s0 + win:
        t = (s - b.s0) / win  # 0 at the joint .. 1
        below = b.parent
        if below is not None:
            k = 0.5 * (1 - t)
            w = {bi: 1 - k, below: k}
    return w


def mesh_leaves(mo, stems, rig, owner, spec, height, rnd, crown_c):
    """Alpha cards along the fine stems, spaced so the tree gets about spec['cards']."""
    hosts = [st for st in stems if st.level >= 2 or (st.level == 1 and not st.children)]
    total = sum(st.length * 0.7 for st in hosts) or 1.0
    spacing = total / spec["cards"]
    size = spec["card"] * height / sum(spec["height"]) * 2
    for st in hosts:
        n = max(1, int(st.length * 0.7 / spacing + rnd.random()))
        for k in range(n):
            s = st.length * (0.3 + 0.7 * (k + rnd.random()) / n)
            p, r, tan = point_at(st, s)
            bone = owner(st.idx, s)
            out = (p - crown_c)
            out.z *= 0.5
            if out.length < 1e-6:
                out = Vector((1, 0, 0))
            out.normalize()
            # the card faces out of the crown and up, turned at random
            nrm = (out * 0.6 + Vector((0, 0, 0.7)) + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.3, 0.3))) * 0.6).normalized()
            ax = nrm.cross(Vector((0, 0, 1)))
            if ax.length < 1e-3:
                ax = Vector((1, 0, 0))
            ax.normalize()
            ay = nrm.cross(ax).normalized()
            rot = rnd.uniform(0, 2 * math.pi)
            ax, ay = ax * math.cos(rot) + ay * math.sin(rot), ay * math.cos(rot) - ax * math.sin(rot)
            sz = size * rnd.uniform(0.75, 1.2)
            centre = p + out * sz * 0.25
            # normals: the crown's outward direction mixed with the card's own, for soft shading
            soft = ((p - crown_c).normalized() * 0.75 + nrm * 0.25).normalized()
            u0 = 0.0 if rnd.random() < 0.5 else 0.5
            corners = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
            idx, uv = [], []
            for cx, cy in corners:
                co = centre + ax * (cx * sz * 0.5) + ay * (cy * sz * 0.5)
                idx.append(mo.vert(co, soft, {bone: 1.0}))
                uv.append((u0 + (cx + 1) * 0.25 * 0.998 + 0.001, 0.5 + (cy + 1) * 0.25 * 0.998 + 0.001))
            mo.face(idx, uv, bone)
            # and its back (a MeshPart's DoubleSided cannot be set from a script)
            mo.face(list(reversed(idx)), list(reversed(uv)), bone)


# --------------------------------------------------------------------------------------------
# Physical make-up of each rig bone (from the stems, meshed or not)


def physics(stems, rig, owner, mo):
    for st in stems:
        for k in range(1, len(st.s)):
            ds = st.s[k] - st.s[k - 1]
            r = 0.5 * (st.rad[k] + st.rad[k - 1])
            bi = owner(st.idx, 0.5 * (st.s[k] + st.s[k - 1]))
            rig[bi].wood += math.pi * r * r * ds
            rig[bi].front += 2 * r * ds


def leaf_area(mo, rig, coverage):
    for fi, f in enumerate(mo.faces):
        uv = mo.uvs[fi]
        if uv[0][1] >= 0.5:  # a leaf card
            a = (Vector(mo.co[f[1]]) - Vector(mo.co[f[0]])).cross(Vector(mo.co[f[3]]) - Vector(mo.co[f[0]])).length
            rig[mo.fbone[fi]].leaf += a * coverage * 0.5  # (each card is two faces, front and back)


# --------------------------------------------------------------------------------------------
# Textures (numpy; rows bottom-up as Blender images)


def periodic_noise(W, H, rng, terms, fmax_x, fmax_y):
    x = np.arange(W)[None, :] / W
    y = np.arange(H)[:, None] / H
    out = np.zeros((H, W), np.float32)
    for _ in range(terms):
        fx = rng.integers(0, fmax_x + 1)
        fy = rng.integers(1, fmax_y + 1)
        ph = rng.uniform(0, 2 * np.pi)
        a = 1.0 / math.sqrt(1 + fx * fx + fy * fy)
        out += a * np.sin(2 * np.pi * (fx * x + fy * y) + ph)
    out -= out.min()
    out /= max(out.max(), 1e-6)
    return out


def bark_texture(W, H, color, rng, furrows):
    warp = periodic_noise(W, H, rng, 18, 3, 6)
    fine = periodic_noise(W, H, rng, 60, 24, 40)
    x = np.arange(W)[None, :] / W
    ridge = np.abs(np.sin(np.pi * (furrows * x + 1.2 * (warp - 0.5)))) ** 0.3  # broad plates, narrow dark furrows
    shade = 0.45 + 0.4 * ridge + 0.25 * (fine - 0.5)
    rgb = np.stack([np.clip(shade * c / 255.0 * 1.15, 0, 1) for c in color], -1)
    return np.concatenate([rgb, np.ones((H, W, 1), np.float32)], -1)


def stamp(img, cx, cy, half_l, half_w, ang, rgb, soft=1.2):
    H, W = img.shape[:2]
    R = int(half_l + 2)
    x0, x1 = max(0, int(cx - R)), min(W, int(cx + R + 1))
    y0, y1 = max(0, int(cy - R)), min(H, int(cy + R + 1))
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    dx, dy = xs - cx, ys - cy
    c, s = math.cos(ang), math.sin(ang)
    u = (dx * c + dy * s) / half_l
    v = (-dx * s + dy * c) / half_w
    # a leaf: an ellipse pinched at both ends
    d = u * u + (v / np.maximum(1 - 0.35 * u * u, 0.2)) ** 2
    a = np.clip((1 - d) * half_w / soft, 0, 1)
    vein = 1 - 0.18 * np.exp(-(v * half_w) ** 2 / 1.5)
    tone = (0.85 + 0.25 * v.clip(-1, 1) * -1 * 0.5) * vein
    sub = img[y0:y1, x0:x1]
    col = np.stack([np.clip(rgb[i] * tone, 0, 1) for i in range(3)], -1)
    sub[..., :3] = sub[..., :3] * (1 - a[..., None]) + col * a[..., None]
    sub[..., 3] = np.maximum(sub[..., 3], a)


def leaf_card(S, colors, rng, style):
    img = np.zeros((S, S, 4), np.float32)
    base = np.array(colors[0], np.float32) / 255
    alt = np.array(colors[1], np.float32) / 255
    c = S / 2
    if style == "broad":
        n = 230
        pts = []
        for _ in range(n):
            r = (rng.uniform() ** 0.6) * S * 0.38
            a = rng.uniform(0, 2 * np.pi)
            pts.append((c + r * math.cos(a), c + r * math.sin(a) * 0.85))
        pts.sort(key=lambda p: p[1])  # the lower leaves first (drawn under)
        # twigs
        for _ in range(7):
            a = rng.uniform(0, 2 * np.pi)
            L = rng.uniform(0.2, 0.4) * S
            for t in np.linspace(0, 1, 40):
                stamp(img, c + math.cos(a) * L * t, c + math.sin(a) * L * t, 3, 1.4, a, (0.28, 0.22, 0.16))
        for (x, y) in pts:
            mix = rng.uniform()
            rgb = base * (1 - mix) + alt * mix
            light = 0.75 + 0.45 * (y / S) + rng.uniform(-0.1, 0.1)  # brighter toward the top
            hl = S * rng.uniform(0.035, 0.05)
            stamp(img, x, y, hl, hl * 0.48, rng.uniform(0, 2 * np.pi), rgb * light)
    else:  # spray: forking fronds of small scale leaves
        for _ in range(18):
            a0 = rng.uniform(0, 2 * np.pi)
            L = rng.uniform(0.25, 0.45) * S
            for t in np.linspace(0, 1, 70):
                x, y = c + math.cos(a0) * L * t, c + math.sin(a0) * L * t
                for side in (-1, 1):
                    if rng.uniform() < 0.85:
                        a = a0 + side * 0.8
                        mix = rng.uniform()
                        rgb = (base * (1 - mix) + alt * mix) * (0.75 + 0.4 * (y / S))
                        stamp(img, x + math.cos(a) * 9, y + math.sin(a) * 9, S * 0.032, S * 0.012, a, rgb)
                stamp(img, x, y, S * 0.012, S * 0.006, a0, base * 0.9)
    return img


def atlas_image(name, spec, rng, path):
    W = ATLAS
    bark = bark_texture(W, W // 2, spec["bark"], rng, 7 if spec["leaf"] == "spray" else 10)
    a = leaf_card(W // 2, spec["leafColors"], rng, spec["leaf"])
    b = leaf_card(W // 2, spec["leafColors"], rng, spec["leaf"])
    top = np.concatenate([a, b], 1)
    # leaf texels with no alpha take the leaf colour (so mip filtering does not darken the edges)
    for img in (top,):
        mask = img[..., 3] < 0.05
        mean = np.array(spec["leafColors"][0], np.float32) / 255
        img[mask, :3] = mean
    full = np.concatenate([bark, top], 0)  # rows bottom-up: bark at the bottom
    coverage = float(top[..., 3].mean())
    im = bpy.data.images.new(name, W, W, alpha=True)
    im.pixels.foreach_set(full.astype(np.float32).ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    return im, coverage


# --------------------------------------------------------------------------------------------
# Blender objects and export


def make_material(im):
    m = bpy.data.materials.new("FoliageAtlas")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = im
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.9
    try:
        m.surface_render_method = "DITHERED"
    except Exception:
        pass
    return m


def build_mesh_object(name, mo, face_ids, mat, with_weights, rig):
    used = sorted({v for fi in face_ids for v in mo.faces[fi]})
    remap = {v: i for i, v in enumerate(used)}
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(mo.co[v]) for v in used], [], [[remap[v] for v in mo.faces[fi]] for fi in face_ids])
    uvl = me.uv_layers.new(name="UVMap")
    li = 0
    for fi in face_ids:
        for uv in mo.uvs[fi]:
            uvl.data[li].uv = uv
            li += 1
    me.materials.append(mat)
    me.update()
    me.normals_split_custom_set_from_vertices([tuple(mo.nor[v]) for v in used])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if with_weights:
        groups = {}
        for b in rig:
            groups[b.index] = ob.vertex_groups.new(name=b.name)
        for v in used:
            for bi, w in mo.weights[v].items():
                groups[bi].add([remap[v]], w, "REPLACE")
    return ob


def build_armature(rig):
    ad = bpy.data.armatures.new("Rig")
    ob = bpy.data.objects.new("Rig", ad)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    eb = {}
    for b in rig:
        e = ad.edit_bones.new(b.name)
        e.head = b.head
        tail = b.tail if (b.tail - b.head).length > 1e-3 else b.head + Vector((0, 0, 0.05))
        e.tail = tail
        e.use_deform = True
        if b.parent is not None:
            e.parent = eb[b.parent]
            e.use_connect = False
        eb[b.index] = e
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def render_impostors(out_dir, tree_ob, height):
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            sc.render.engine = eng
            break
        except Exception:
            continue
    sc.render.film_transparent = True
    xs = [v.co for v in tree_ob.data.vertices]
    rh = max(math.hypot(v.x, v.y) for v in xs) * 1.04
    zmin = min(v.z for v in xs)
    zmax = max(v.z for v in xs) * 1.02
    w, h = 2 * rh, zmax - zmin
    res_x = 256
    res_y = int(min(512, max(128, round(res_x * h / w / 8) * 8)))
    sc.render.resolution_x, sc.render.resolution_y = res_x, res_y
    sc.render.resolution_percentage = 100
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = max(w, h * res_x / res_y)
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = 3.5
    sun = bpy.data.objects.new("sun", sun_d)
    sc.collection.objects.link(sun)
    world = sc.world or bpy.data.worlds.new("w")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs[1].default_value = 0.9
    zc = zmin + h / 2
    for k in range(IMPOSTOR_VIEWS):
        a = 2 * math.pi * k / IMPOSTOR_VIEWS
        d = Vector((math.sin(a), -math.cos(a), 0))  # view k looks from this side (k = 0 from -y; in Roblox, from (-sin a, 0, -cos a))
        cam.location = Vector((0, 0, zc)) + d * (rh * 4 + 10)
        cam.rotation_euler = (math.pi / 2, 0, a)
        sun.rotation_euler = (math.radians(50), 0, a + math.radians(35))
        sc.render.filepath = os.path.join(out_dir, "impostor_%d.png" % k)
        bpy.ops.render.render(write_still=True)
    return dict(widthM=w, heightM=h, baseM=-zmin, pxW=res_x, pxH=res_y)


def export_fbx(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.fbx(
        filepath=path, use_selection=True, object_types={"ARMATURE", "MESH"}, global_scale=STUDS_PER_M,
        apply_unit_scale=True, apply_scale_options="FBX_SCALE_ALL", axis_forward="-Z", axis_up="Y",
        use_armature_deform_only=True, add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X",
        mesh_smooth_type="OFF", use_mesh_modifiers=False, path_mode="COPY", embed_textures=True, bake_anim=False,
    )


# --------------------------------------------------------------------------------------------
# Rig data module


def lua_num(x):
    return ("%.4f" % x).rstrip("0").rstrip(".") if x != int(x) else str(int(x))


def write_data(path, kind, variant, height, rig, imp, stats, coverage):
    L = ["--!nocheck"]
    L.append("-- Generated by tools/blender/foliage_trees.py (--kind %s --variant %d). Do not hand-edit:" % (kind, variant))
    L.append("-- regenerate. The rig bones of one skinned tree, parents first, in metres and m2/m3:")
    L.append("-- head and tail (Roblox axes: -x, up, y of Blender's; from the tree's foot), length, base and tip")
    L.append("-- radius, wood volume and frontal area, and the leaf area it holds itself.")
    L.append("return {")
    L.append('\tkind = "%s",' % kind)
    L.append("\tvariant = %d," % variant)
    L.append("\theightM = %s," % lua_num(height))
    L.append("\tleafCoverage = %s," % lua_num(coverage))
    L.append("\ttriangles = %d," % stats["tris"])
    L.append("\tbones = {")
    for b in rig:
        # (Roblox's importer puts Blender's (x, y, z) at (-x, z, y): checked in Studio 2026-11-11)
        hd = "{ %s, %s, %s }" % (lua_num(-b.head.x), lua_num(b.head.z), lua_num(b.head.y))
        tl = "{ %s, %s, %s }" % (lua_num(-b.tail.x), lua_num(b.tail.z), lua_num(b.tail.y))
        L.append('\t\t{ name = "%s", parent = %s, tier = %d, head = %s, tail = %s, lengthM = %s, r0 = %s, r1 = %s, woodM3 = %s, frontM2 = %s, leafM2 = %s },' % (
            b.name, ('"%s"' % rig[b.parent].name) if b.parent is not None else "nil", b.tier, hd, tl,
            lua_num((b.tail - b.head).length), lua_num(b.r0), lua_num(b.r1), lua_num(b.wood), lua_num(b.front), lua_num(b.leaf)))
    L.append("\t},")
    if imp:
        L.append("\timpostor = { views = %d, widthM = %s, heightM = %s, baseM = %s, pxW = %d, pxH = %d }," % (
            IMPOSTOR_VIEWS, lua_num(imp["widthM"]), lua_num(imp["heightM"]), lua_num(imp["baseM"]), imp["pxW"], imp["pxH"]))
    L.append("}")
    with open(path, "w", newline="\n") as f:
        f.write("\n".join(L) + "\n")


# --------------------------------------------------------------------------------------------


def make(kind, variant, render=True):
    spec = KINDS[kind]
    seed = 1000 * (list(KINDS).index(kind) + 1) + variant
    rnd = random.Random(seed)
    rng = np.random.default_rng(seed)
    name = "%s_%d" % (kind, variant)
    out_dir = os.path.join(OUT_ASSETS, name)
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(OUT_DATA, exist_ok=True)

    curve, arm, starts = grow(spec, seed)
    stems = read_stems(curve, arm, starts)
    bpy.data.objects.remove(curve)
    bpy.data.objects.remove(arm)
    height = rnd.uniform(*spec["height"])
    scale_tree(stems, height)
    levels = {}
    for st in stems:
        levels[st.level] = levels.get(st.level, 0) + 1
    rig, owner, covering = build_rig(stems, spec["budget"], height)

    mo = MeshOut()
    mesh_bark(mo, stems, rig, owner, covering, height)
    leaf_pts = [p for st in stems if st.level >= 2 for p in st.pts]
    crown_c = sum(leaf_pts, Vector()) / max(1, len(leaf_pts)) if leaf_pts else Vector((0, 0, height * 0.65))
    bark_tris = sum(len(f) - 2 for f in mo.faces)
    mesh_leaves(mo, stems, rig, owner, spec, height, rnd, crown_c)

    im, coverage = atlas_image(name + "_atlas", spec, rng, os.path.join(out_dir, "atlas.png"))
    physics(stems, rig, owner, mo)
    leaf_area(mo, rig, coverage)
    mat = make_material(im)

    all_faces = list(range(len(mo.faces)))
    tris = sum(len(f) - 2 for f in mo.faces)
    tree = build_mesh_object("Tree", mo, all_faces, mat, True, rig)
    rig_ob = build_armature(rig)
    tree.parent = rig_ob
    mod = tree.modifiers.new("Armature", "ARMATURE")
    mod.object = rig_ob
    pieces = []
    by_bone = {}
    for fi, bi in enumerate(mo.fbone):
        by_bone.setdefault(bi, []).append(fi)
    for bi, faces in sorted(by_bone.items()):
        pieces.append(build_mesh_object("Piece_" + rig[bi].name, mo, faces, mat, False, rig))

    imp = None
    if render:
        rig_ob.hide_render = True
        for p in pieces:
            p.hide_render = True
        imp = render_impostors(out_dir, tree, height)
        for p in pieces:
            p.hide_render = False
    export_fbx(os.path.join(out_dir, "tree.fbx"), [rig_ob, tree] + pieces)
    stats = dict(tris=tris)
    write_data(os.path.join(OUT_DATA, name + ".luau"), kind, variant, height, rig, imp, stats, coverage)
    print("[foliage] %s: height %.1f m, stems %s, rig %d bones (%s), %d verts, %d tris, %d pieces, leaf cover %.2f" % (
        name, height, levels, len(rig), ",".join("%d" % sum(1 for b in rig if b.tier == t) for t in range(3)),
        len(mo.co), tris, len(pieces), coverage) + " (bark %d)" % bark_tris)
    return tris


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", default="hardwood")
    ap.add_argument("--variant", type=int, default=0)
    ap.add_argument("--no-render", action="store_true")
    a = ap.parse_args(argv)
    addon_utils.enable(SAPLING, default_set=True)
    jobs = []
    kinds = list(KINDS) if a.kind == "all" else [a.kind]
    for k in kinds:
        vs = range(1, KINDS[k]["variants"] + 1) if a.variant == 0 else [a.variant]
        for v in vs:
            jobs.append((k, v))
    for k, v in jobs:
        bpy.ops.wm.read_homefile(use_empty=True)
        addon_utils.enable(SAPLING, default_set=True)
        make(k, v, render=not a.no_render)
    write_index()
    write_manifest()


def write_manifest():
    """roblox/assets/foliage/manifest.json: every output file's size and sha256 (the files stay
    out of git; this is committed instead)."""
    import hashlib
    import json
    out = {}
    for d, _, files in os.walk(OUT_ASSETS):
        for f in sorted(files):
            if f == "manifest.json":
                continue
            path = os.path.join(d, f)
            rel = os.path.relpath(path, OUT_ASSETS).replace(os.sep, "/")
            with open(path, "rb") as fh:
                data = fh.read()
            out[rel] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    with open(os.path.join(OUT_ASSETS, "manifest.json"), "w", newline=chr(10)) as f:
        json.dump(dict(sorted(out.items())), f, indent=1)


def write_index():
    """Kinds/init.luau: every generated tree by name (kind_variant), and each kind's variants."""
    names = sorted(f[:-5] for f in os.listdir(OUT_DATA) if f.endswith(".luau") and f != "init.luau")
    L = ["-- Generated by tools/blender/foliage_trees.py: every generated tree's rig data, by name.",
         "local function dep(name: string): any",
         "	if script then",
         "		return require((script :: any):FindFirstChild(name))",
         "	end",
         "	return (require :: any)(\"@self/\" .. name)",
         "end",
         "",
         "local Kinds = { byName = {}, variants = {} }"]
    for n in names:
        kind = n.rsplit("_", 1)[0]
        L.append('Kinds.byName["%s"] = dep("%s")' % (n, n))
    for kind in sorted({n.rsplit("_", 1)[0] for n in names}):
        L.append('Kinds.variants["%s"] = { %s }' % (kind, ", ".join('"%s"' % n for n in names if n.rsplit("_", 1)[0] == kind)))
    L.append("return Kinds")
    with open(os.path.join(OUT_DATA, "init.luau"), "w", newline="\n") as f:
        f.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
