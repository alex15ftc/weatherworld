"""Builds the close-up tornado funnel: a skinned tube that the game shapes with its bones from the
storm the server relays (roblox/Client/Modules/Weather/TornadoMesh.luau), exported as FBX for
upload to Roblox.

    blender -b --factory-startup --python scripts/blender/build_funnel_rig.py -- --out <file.fbx>

Roblox bones cannot scale, so a ring cannot widen by scaling one bone. Each of the RINGS rings
(the heights of the engine's funnelRadiusM, ground to cloud base) has SPOKES bones spaced round
it at the bind radius; the game moves them out or in for the funnel's radius there, moves them
together for its lean and snaking, and turns them round the ring for its spin. A vertex follows
the two spokes either side of it on the two rings either side of it (4 influences, Roblox's
most).

Bind pose, in the file's units (1 = 1 stud): HEIGHT tall from the ground (y = 0), RADIUS round.
UVs: u round the funnel (one turn), v up it, for the edge-boil frames painted on it. The tube is
open at both ends; the game shows it from inside too (DoubleSided).

Bone names: Root, then R<ring>_S<spoke> (R0 at the ground, S0 at +x, counting
counter-clockwise seen from above).
"""

import math
import sys

import bpy
from mathutils import Vector

RINGS = 9
SPOKES = 8
ROWS_PER_RING = 4  # vertex rows from one ring to the next
AROUND = 48  # vertex columns round the funnel
HEIGHT = 100.0
RADIUS = 10.0


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if "--out" not in argv:
        raise SystemExit("--out <file.fbx> is required")
    return argv[argv.index("--out") + 1]


def ring_height(ring):
    return HEIGHT * ring / (RINGS - 1)


def spoke_angle(spoke):
    return 2 * math.pi * spoke / SPOKES


def main():
    out = args()
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)

    # Blender is z-up; the FBX export turns it y-up for Roblox. Built z-up here.
    arm_data = bpy.data.armatures.new("FunnelRig")
    rig = bpy.data.objects.new("FunnelRig", arm_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    root = arm_data.edit_bones.new("Root")
    root.head, root.tail = Vector((0, 0, 0)), Vector((0, 0, -2))
    for r in range(RINGS):
        for s in range(SPOKES):
            a = spoke_angle(s)
            b = arm_data.edit_bones.new(f"R{r}_S{s}")
            b.head = Vector((math.cos(a) * RADIUS, math.sin(a) * RADIUS, ring_height(r)))
            b.tail = b.head + Vector((math.cos(a), math.sin(a), 0)) * 2
            b.parent = root
    bpy.ops.object.mode_set(mode="OBJECT")

    # The tube: rows up, columns round (the last column repeats the first, for the UV seam).
    rows = (RINGS - 1) * ROWS_PER_RING + 1
    verts, uvs_at, faces = [], [], []
    for j in range(rows):
        z = HEIGHT * j / (rows - 1)
        for i in range(AROUND + 1):
            a = 2 * math.pi * i / AROUND
            verts.append((math.cos(a) * RADIUS, math.sin(a) * RADIUS, z))
            uvs_at.append((i / AROUND, j / (rows - 1)))
    for j in range(rows - 1):
        for i in range(AROUND):
            v0 = j * (AROUND + 1) + i
            faces.append((v0, v0 + 1, v0 + AROUND + 2, v0 + AROUND + 1))
    mesh = bpy.data.meshes.new("Funnel")
    mesh.from_pydata(verts, [], faces)
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = uvs_at[mesh.loops[li].vertex_index]
    mesh.update()
    funnel = bpy.data.objects.new("Funnel", mesh)
    bpy.context.scene.collection.objects.link(funnel)

    # Weights: bilinear between the rings above and below and the spokes either side.
    groups = {}
    for r in range(RINGS):
        for s in range(SPOKES):
            groups[(r, s)] = funnel.vertex_groups.new(name=f"R{r}_S{s}")
    for j in range(rows):
        ring_f = j / ROWS_PER_RING
        r0 = min(int(ring_f), RINGS - 2)
        tr = ring_f - r0
        for i in range(AROUND + 1):
            spoke_f = (i % AROUND) / AROUND * SPOKES
            s0 = int(spoke_f) % SPOKES
            ts = spoke_f - int(spoke_f)
            s1 = (s0 + 1) % SPOKES
            index = j * (AROUND + 1) + i
            for (r, s), w in (((r0, s0), (1 - tr) * (1 - ts)), ((r0, s1), (1 - tr) * ts),
                              ((r0 + 1, s0), tr * (1 - ts)), ((r0 + 1, s1), tr * ts)):
                if w > 1e-4:
                    groups[(r, s)].add([index], w, "REPLACE")
    funnel.parent = rig
    modifier = funnel.modifiers.new("Rig", "ARMATURE")
    modifier.object = rig

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.fbx(
        filepath=out,
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        add_leaf_bones=False,
        bake_anim=False,
        axis_forward="-Z",
        axis_up="Y",
        apply_unit_scale=True,
        apply_scale_options="FBX_SCALE_UNITS",
        mesh_smooth_type="FACE",
        primary_bone_axis="Y",
        secondary_bone_axis="X",
    )
    print(f"[rig] {len(verts)} vertices, {RINGS * SPOKES + 1} bones -> {out}", flush=True)


main()
