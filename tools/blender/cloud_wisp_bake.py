# Bakes the storm's ragged bits into camera-facing sprites: "scud" (single torn fractus fragments)
# and "fringe" (the ragged lower edge of a cloud base seen side-on, tileable left/right). Run headless:
#
#   blender --background --factory-startup --python tools/blender/cloud_wisp_bake.py -- \
#       [--pieces scud_1,fringe_2] [--scale 1.0] [--samples 256] [--out roblox/assets/cloudkit/wisp]
#       [--sheet-only 1] [--proj 1  (debug: also write <piece>_proj.png, view-axis optical depth)]
#
# Unlike cloud_vapor_bake.py (a mesh turned into a volume), these have no mesh: each piece's density
# is built in numpy and handed to Cycles as an OpenVDB grid.
#   - Noise is a Gaussian random field made with an FFT (amplitude ~ k^-beta), so it is periodic over
#     its grid: the fringe's grid spans exactly one image width in x and so tiles left/right.
#     Anisotropic spectra (smoother along one axis) give fibres/striations, not round puffs.
#   - Scud: distance to a hand-drawn centreline (a few polylines with radii), evaluated at strongly
#     domain-warped positions so it curls and tears, then eroded by fibrous noise: a few denser cores,
#     stringy translucent edges, detached shreds.
#   - Fringe: an opaque slab across the top whose underside height wanders, hanging shreds below it
#     (length per column from 2D noise, vertical fibres, sideways drift growing downward) and a few
#     small detached scud bits lower down.
# Rendered with Cycles (Principled Volume, white, no absorption, anisotropy 0.5) under two lights:
#   diffuse  uniform white sky only (no sun): the overcast light under a storm; the main look
#   back     sun behind the piece, 20 deg up, 15 deg to the camera's left, plus a dim white sky
# Camera: orthographic, horizontal, from Blender -Y toward +Y (image right = +X, image up = +Z).
#
# Writes <out>/<piece>.png (two cells stacked: diffuse on top, back below; RGBA, straight alpha;
# scud 256 x 512, fringe 512 x 512), <piece>_preview.png (over dark slate #3a4450), fringe_<n>_row.png
# (the diffuse cell three times side by side: a seam check) and sheet.png.
import bpy
import math
import os
import sys
import time

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SCUDS = ["scud_1", "scud_2", "scud_3", "scud_4", "scud_5", "scud_6"]
FRINGES = ["fringe_1", "fringe_2", "fringe_3"]
CELLS = ["diffuse", "back"]                       # top, bottom
ANISOTROPY = 0.5
SKY_DIFFUSE = 1.0                                 # white world strength, diffuse cell
SKY_BACK = 0.15                                   # white world strength, back cell
SUN_ENERGY = 3.0
SUN_DIR = (15.0, 20.0)                            # (deg round from "behind the piece" to the camera's left, elevation)
PREVIEW_BG = (0x3a / 255, 0x44 / 255, 0x50 / 255)

# ---------------------------------------------------------------------------------------------
# Piece definitions. Scud frame: x, z in -1..1 (the 256 px cell); the fragment stays inside ~0.8.
# Each stroke is a polyline of (x, z, radius); y wanders a little. "stretch" = axis the fibres run
# along (spectrum smoothed by that factor), "warp" = amplitude of the domain warp (curl / tearing).

SCUD = {
    # rising, curling wisp like 05_scud_fractus_c: broad soft bottom, thinning up into a hook
    "scud_1": dict(seed=11, stretch=(1.0, 1.0, 2.6), warp=0.10, dens=10.0, strokes=[
        [(0.10, -0.62, 0.17), (0.02, -0.35, 0.17), (-0.02, -0.05, 0.13), (0.05, 0.22, 0.10),
         (-0.08, 0.45, 0.08), (-0.30, 0.60, 0.065), (-0.48, 0.55, 0.045)],
        [(0.20, 0.40, 0.04), (0.35, 0.62, 0.03)]]),
    # horizontal tattered strip
    "scud_2": dict(seed=22, stretch=(3.0, 1.0, 1.0), warp=0.08, dens=10.0, strokes=[
        [(-0.78, 0.02, 0.04), (-0.45, 0.08, 0.10), (-0.05, -0.02, 0.13), (0.35, 0.06, 0.10),
         (0.70, -0.04, 0.05)],
        [(-0.30, -0.05, 0.05), (-0.20, -0.30, 0.035)], [(0.25, -0.05, 0.05), (0.38, -0.25, 0.03)]]),
    # thin leaning column breaking up at the top
    "scud_3": dict(seed=33, stretch=(1.0, 1.0, 3.0), warp=0.09, dens=10.0, strokes=[
        [(0.30, -0.72, 0.035), (0.16, -0.35, 0.10), (0.02, 0.05, 0.12), (-0.12, 0.42, 0.09),
         (-0.20, 0.70, 0.05)],
        [(-0.30, 0.55, 0.035), (-0.45, 0.72, 0.03)]]),
    # horizontal strip with ragged pieces drooping below it
    "scud_4": dict(seed=44, stretch=(1.6, 1.0, 2.0), warp=0.09, dens=10.0, strokes=[
        [(-0.75, 0.40, 0.06), (-0.35, 0.36, 0.12), (0.10, 0.42, 0.13), (0.50, 0.34, 0.10),
         (0.78, 0.40, 0.05)],
        [(-0.25, 0.30, 0.08), (-0.33, -0.10, 0.06), (-0.26, -0.48, 0.035)],
        [(0.35, 0.28, 0.07), (0.42, -0.05, 0.045), (0.36, -0.25, 0.025)]]),
    # a little cluster of shreds on a diagonal
    "scud_5": dict(seed=55, stretch=(1.8, 1.0, 1.4), warp=0.10, dens=10.0, strokes=[
        [(-0.70, -0.55, 0.06), (-0.40, -0.40, 0.10), (-0.30, -0.30, 0.06)],
        [(-0.20, -0.08, 0.10), (0.05, 0.05, 0.14), (0.25, 0.12, 0.08)],
        [(0.35, 0.40, 0.06), (0.55, 0.55, 0.08), (0.72, 0.62, 0.04)]]),
    # comma / hook curling up into the base
    "scud_6": dict(seed=66, stretch=(1.4, 1.0, 1.8), warp=0.10, dens=10.0, strokes=[
        [(0.55, -0.65, 0.04), (0.38, -0.35, 0.09), (0.12, -0.08, 0.14), (-0.20, 0.08, 0.15),
         (-0.42, 0.32, 0.11), (-0.32, 0.58, 0.08), (-0.05, 0.70, 0.05), (0.15, 0.62, 0.03)]]),
}

# Fringe frame: x in 0..2 (one period, the 512 px cell width), z in 0..1 (256 px). The slab's underside
# sits at `base` (+- rough); below it hang `count` shreds (random curving strokes, longest `length`,
# leaning by `drift` per unit drop), `short` stubby ragged bits along the underside and `bits` small
# detached scud fragments lower down. All placed periodically in x, so the strip tiles.
FRINGE = {
    "fringe_1": dict(seed=101, base=0.66, rough=0.03, count=11, length=0.50, short=22, bits=4, drift=0.25),
    "fringe_2": dict(seed=202, base=0.68, rough=0.04, count=16, length=0.36, short=28, bits=2, drift=0.45),
    "fringe_3": dict(seed=303, base=0.64, rough=0.03, count=8, length=0.58, short=18, bits=6, drift=0.1),
}
FRINGE_DENS = 40.0
SCUD_ZOOM = 1.12       # strokes were drawn a little small: grow them to fill ~80% of the cell
SHRED_DENS = 1.6       # shreds relative to the slab: thinner, partly see-through


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = {"pieces": ",".join(SCUDS + FRINGES), "scale": 1.0, "samples": 256, "bounces": 16,
           "out": os.path.join(ROOT, "roblox", "assets", "cloudkit", "wisp"), "sheet-only": 0, "tag": "", "proj": 0}
    for i in range(0, len(argv) - 1, 2):
        k = argv[i].lstrip("-")
        out[k] = type(out[k])(argv[i + 1]) if k in out else argv[i + 1]
    return out


def raise_priority():
    if os.name == "nt":
        try:
            import ctypes
            k = ctypes.windll.kernel32
            k.SetPriorityClass(k.GetCurrentProcess(), 0x8000)  # above normal
        except Exception:
            pass


# ---------------------------------------------------------------------------------------------
# Noise

def grf(shape, size, beta, seed, stretch=(1.0, 1.0, 1.0), kmin=0.0):
    """Periodic Gaussian random field over a box of `size`, std 1. Amplitude ~ k^-beta, where k is
    measured with each axis multiplied by its stretch (stretch > 1: smoother, longer along that axis).
    kmin (cycles per unit) removes the largest scales."""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal(shape).astype(np.float32)
    F = np.fft.rfftn(w)
    ks = []
    for ax, (n, L) in enumerate(zip(shape, size)):
        f = np.fft.rfftfreq(n, d=L / n) if ax == len(shape) - 1 else np.fft.fftfreq(n, d=L / n)
        sh = [1] * len(shape)
        sh[ax] = -1
        ks.append((f * stretch[ax]).reshape(sh) ** 2)
    k = np.sqrt(sum(ks))
    amp = np.where(k > 0, (k + 1e-6) ** -beta, 0.0)
    if kmin > 0:
        amp *= 1.0 - np.exp(-(k / kmin) ** 2)
    f = np.fft.irfftn(F * amp, s=shape, axes=tuple(range(len(shape)))).astype(np.float32)
    f -= f.mean()
    return f / (f.std() + 1e-9)


def sample(field, idx):
    """Trilinear sample of a periodic field at float voxel indices idx = (i, j, k) arrays."""
    out = 0.0
    n = field.shape
    i0 = [np.floor(c).astype(np.int64) for c in idx]
    fr = [(c - f).astype(np.float32) for c, f in zip(idx, i0)]
    for dx in (0, 1):
        wx = fr[0] if dx else 1 - fr[0]
        ix = (i0[0] + dx) % n[0]
        for dy in (0, 1):
            wy = fr[1] if dy else 1 - fr[1]
            iy = (i0[1] + dy) % n[1]
            for dz in (0, 1):
                wz = fr[2] if dz else 1 - fr[2]
                iz = (i0[2] + dz) % n[2]
                out = out + field[ix, iy, iz] * (wx * wy * wz)
    return out


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------------------------
# Densities. Each returns (density array (x, y, z), voxel size, origin in world units).

def stroke_shape(W, lo, vox, strokes, margin, period=0.0, rscale=2.0):
    """Max over strokes (polylines of (x, y, z, r)) of 1 - d / (rscale r), d = distance from the
    warped position W to the segment, r interpolated along it. Only the voxels near each segment are
    touched. With a period, each segment is also placed one period left and right."""
    shape = W[0].shape
    s = np.zeros(shape, np.float32)
    for stroke in strokes:
        for p0, p1 in zip(stroke[:-1], stroke[1:]):
            for off in ((-period, 0.0, period) if period else (0.0,)):
                a = np.array(p0[:3], float) + (off, 0, 0)
                b = np.array(p1[:3], float) + (off, 0, 0)
                R = rscale * max(p0[3], p1[3]) + margin
                i0 = np.maximum(np.floor((np.minimum(a, b) - R - lo) / vox).astype(int), 0)
                i1 = np.minimum(np.ceil((np.maximum(a, b) + R - lo) / vox).astype(int) + 1, shape)
                if np.any(i1 <= i0):
                    continue
                sl = tuple(slice(i0[k], i1[k]) for k in range(3))
                w = [W[k][sl] for k in range(3)]
                ab = b - a
                t = np.clip(((w[0] - a[0]) * ab[0] + (w[1] - a[1]) * ab[1] + (w[2] - a[2]) * ab[2]) / max(ab @ ab, 1e-9), 0, 1)
                d = np.sqrt((w[0] - a[0] - t * ab[0]) ** 2 + (w[1] - a[1] - t * ab[1]) ** 2 + (w[2] - a[2] - t * ab[2]) ** 2)
                r = p0[3] + (p1[3] - p0[3]) * t
                s[sl] = np.maximum(s[sl], 1.0 - d / (rscale * r))
    return s


def torn(s, nf, nb, nfi, w=(0.55, 0.25, 0.12), cores=(0.4, 0.9), soft=0.45):
    """Erode a soft shape with fibrous noise (nf), big holes (nb) and fine wisps (nfi), weighted
    by w; then denser cores in places (density x (cores[0] + cores[1] * lumpiness))."""
    ero = (w[0] * (0.5 - 0.5 * np.tanh(0.8 * nf)) + w[1] * (0.5 - 0.5 * np.tanh(nb))
           + w[2] * (0.5 - 0.5 * np.tanh(nfi)))
    dens = smooth(s - ero, 0.0, soft) ** 1.2
    return dens * (cores[0] + cores[1] * smooth(nb, -0.6, 1.2))


def scud_density(name, scale):
    S = SCUD[name]
    vox = 0.0125 / scale
    lo = np.array([-1.0, -0.6, -1.0])
    size = np.array([2.0, 1.2, 2.0])
    shape = tuple(int(round(s / vox)) for s in size)
    sd = S["seed"]
    # warp: two scales (big curl, mid tearing)
    wbig = [grf(shape, size, 3.0, sd + i, kmin=0.4) for i in range(3)]
    wmid = [grf(shape, size, 2.2, sd + 10 + i, stretch=S["stretch"], kmin=1.5) for i in range(3)]
    big = grf(shape, size, 2.0, sd + 20, kmin=1.0)                      # cores and holes
    fib = grf(shape, size, 1.65, sd + 21, stretch=tuple(s * 1.5 for s in S["stretch"]), kmin=2.5)  # fibres
    fine = grf(shape, size, 1.5, sd + 22, stretch=S["stretch"], kmin=6.0)  # fine wisps

    gi = np.indices(shape, dtype=np.float32)
    P = [lo[a] + (gi[a] + 0.5) * vox for a in range(3)]
    W = [P[a] + S["warp"] * wbig[a] + 0.35 * S["warp"] * wmid[a] for a in range(3)]
    Wi = [(W[a] - lo[a]) / vox - 0.5 for a in range(3)]

    del wbig, wmid
    rng = np.random.default_rng(sd)
    strokes = []
    for stroke in S["strokes"]:
        ys = rng.uniform(-0.06, 0.06, len(stroke))
        strokes.append([(SCUD_ZOOM * x, y, SCUD_ZOOM * z, SCUD_ZOOM * r) for (x, z, r), y in zip(stroke, ys)])
    s = stroke_shape(W, lo, vox, strokes, margin=3 * S["warp"])
    dens = torn(s, sample(fib, Wi), sample(big, Wi), sample(fine, Wi))
    for a in (0, 2):
        dens *= smooth(np.abs(P[a]), 0.95, 0.85)    # fade well before the cell edges
    return dens.astype(np.float32) * S["dens"], vox, lo


def fringe_strokes(F):
    rng = np.random.default_rng(F["seed"])
    top = F["base"] + 0.03                     # shreds start inside the slab
    strokes = []

    def hanging(n, lmin, lmax, rmin, rmax, yspread):
        for _ in range(n):
            x, y = rng.uniform(0, 2), rng.uniform(-yspread, yspread)
            L = lmin + (lmax - lmin) * rng.beta(1.6, 1.6)
            r0 = rng.uniform(rmin, rmax) * (0.7 + 0.6 * (L - lmin) / max(lmax - lmin, 1e-6))
            lean = F["drift"] + rng.normal(0, 0.3)
            curl = rng.normal(0, 0.8)
            pts = []
            for j in range(6):
                f = j / 5
                dz = f * L
                pts.append((x + lean * dz + curl * dz * dz, y + rng.normal(0, 0.015), top - dz,
                            r0 * (1 - 0.4 * f)))
            strokes.append(pts)

    hanging(2 * F["count"], 0.10, F["length"], 0.05, 0.09, 0.15)     # long shreds
    hanging(F["short"], 0.03, 0.10, 0.04, 0.07, 0.25)          # stubby ragged edge
    for _ in range(F["bits"]):                                    # detached scud
        x, y = rng.uniform(0, 2), rng.uniform(-0.1, 0.1)
        z = rng.uniform(0.2, F["base"] - 0.22)
        ang = rng.normal(0, 0.6)
        L = rng.uniform(0.08, 0.2)
        r = rng.uniform(0.045, 0.07)
        pts = []
        for j in range(4):
            f = j / 3 - 0.5
            pts.append((x + f * L * math.cos(ang), y, z + f * L * math.sin(ang), r * (1 - 0.35 * abs(f) * 2)))
        strokes.append(pts)
    return strokes


def fringe_density(name, scale):
    F = FRINGE[name]
    vox = 0.00625 / scale
    lo = np.array([0.0, -0.35, -0.05])
    size = np.array([2.0, 0.7, 1.25])        # x is exactly one period
    shape = tuple(int(round(s / vox)) for s in size)
    sd = F["seed"]
    gi = np.indices(shape, dtype=np.float32)
    P = [lo[a] + (gi[a] + 0.5) * vox for a in range(3)]

    hb = grf(shape[:2], size[:2], 2.6, sd, kmin=0.8)[..., None]     # underside height over (x, y)
    zb = F["base"] + F["rough"] * np.clip(hb, -2, 2)
    # warp: tearing, growing below the base
    below = np.clip(zb - P[2], 0.0, None)
    amp = 0.015 + 0.05 * below / 0.3
    W = [P[0] + amp * grf(shape, size, 3.0, sd + 2, stretch=(1.0, 1.0, 1.5), kmin=2.0),
         P[1] + amp * grf(shape, size, 3.0, sd + 3, kmin=2.0),
         P[2] + 0.6 * amp * grf(shape, size, 3.0, sd + 4, kmin=2.0)]
    Wi = [(W[a] - lo[a]) / vox - 0.5 for a in range(3)]
    del amp

    def field(beta, seed, stretch, kmin):
        return sample(grf(shape, size, beta, seed, stretch=stretch, kmin=kmin), Wi)

    nl = field(2.0, sd + 5, (1.4, 1.0, 1.0), 2.0)      # lumps / cores
    nf = field(1.65, sd + 6, (1.0, 1.0, 2.5), 5.0)     # vertical-ish fibres
    nfi = field(1.5, sd + 7, (1.0, 1.0, 1.5), 12.0)    # fine wisps

    zbw = zb + 0.025 * nl                               # lumpy underside
    slab = smooth(W[2], zbw - 0.03, zbw + 0.06)
    s = stroke_shape(W, lo, vox, fringe_strokes(F), margin=0.06, period=2.0)
    # shreds: torn mostly along the fibres (stringy), little lumpiness (no popcorn)
    # the lower a shred hangs the more it is eaten: it dissolves into wisps rather than a point
    s = s - 0.12 * smooth(below, 0.1, 0.4)
    shred = SHRED_DENS * torn(s, nf, nl, nfi, soft=0.65)
    # the underside frays into the same fibres
    edge = 1.0 - smooth(slab, 0.5, 0.95)
    dens = np.maximum(slab * (1.0 - edge * 0.45 * smooth(-nf - 0.3 * nfi, -0.4, 0.9)), shred)
    # front/back faces of the slab soft, bottom of the frame clear
    dens *= smooth(np.abs(P[1]), 0.34, 0.24) * smooth(P[2], 0.0, 0.06)
    return dens.astype(np.float32) * FRINGE_DENS, vox, lo


def write_vdb(dens, vox, lo, path, pad_x=0):
    import openvdb as vdb
    if pad_x:
        dens = np.concatenate([dens[-pad_x:], dens, dens[:pad_x]], axis=0)
        lo = lo.copy(); lo[0] -= pad_x * vox
    g = vdb.FloatGrid(0.0)
    # voxel centres at (ijk + 0.5) * vox from lo: shift the transform by half a voxel
    xf = vdb.createLinearTransform(vox)
    xf.postTranslate((0.5 * vox, 0.5 * vox, 0.5 * vox))
    g.transform = xf
    ijk = tuple(int(round(v / vox)) for v in lo)
    g.copyFromArray(np.ascontiguousarray(dens), ijk=ijk, tolerance=1e-4)
    g.name = "density"
    vdb.write(path, grids=[g])


# ---------------------------------------------------------------------------------------------
# Scene

def setup_scene(a):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = a["samples"]
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = max(16, a["bounces"])
    sc.cycles.volume_bounces = a["bounces"]
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.diffuse_bounces = sc.cycles.glossy_bounces = sc.cycles.transmission_bounces = 0
    sc.cycles.use_volume_guiding = True
    sc.cycles.sample_clamp_indirect = 0.0
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.image_settings.color_depth = "8"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA"):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                gpus = [d for d in prefs.devices if d.type == kind]
                if gpus:
                    for d in prefs.devices:
                        d.use = d.type == kind
                    sc.cycles.device = "GPU"
                    print("Cycles on", kind, [d.name for d in gpus])
                    break
            except Exception:
                continue
    except Exception as e:
        print("GPU not used:", e)

    world = bpy.data.worlds.new("sky")
    world.use_nodes = True
    sc.world = world
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = SUN_ENERGY
    sun_data.angle = math.radians(1.0)
    sun_data.color = (1.0, 0.98, 0.95)
    sun = bpy.data.objects.new("sun", sun_data)
    sc.collection.objects.link(sun)
    from mathutils import Vector
    az, el = (math.radians(v) for v in SUN_DIR)
    d = Vector((-math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))  # behind = +Y
    sun.rotation_euler = d.to_track_quat("Z", "Y").to_euler()

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start, cam_data.clip_end = 0.1, 100.0
    cam = bpy.data.objects.new("cam", cam_data)
    cam.rotation_euler = (math.radians(90), 0, 0)   # looks along +Y, up = +Z
    sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, sun, cam


def set_light(sc, sun, cell):
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs["Strength"].default_value = SKY_DIFFUSE if cell == "diffuse" else SKY_BACK
    sun.hide_render = cell == "diffuse"


def material():
    mat = bpy.data.materials.new("wisp")
    nt = mat.node_tree
    nt.nodes.clear()
    attr = nt.nodes.new("ShaderNodeAttribute")
    attr.attribute_type = "GEOMETRY"
    attr.attribute_name = "density"
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    vol.inputs["Absorption Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    vol.inputs["Anisotropy"].default_value = ANISOTROPY
    vol.inputs["Density Attribute"].default_value = ""
    nt.links.new(attr.outputs["Fac"], vol.inputs["Density"])
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.target = "ALL"
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    return mat


def render_cell(sc, path):
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return px


def save(pixels, path):
    img = bpy.data.images.new(os.path.basename(path), pixels.shape[1], pixels.shape[0], alpha=True)
    img.alpha_mode = "STRAIGHT"
    img.pixels[:] = np.ascontiguousarray(pixels).ravel()
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def over_bg(sheet):
    prev = sheet.copy()
    a = sheet[..., 3:4]
    prev[..., :3] = sheet[..., :3] * a + np.array(PREVIEW_BG, dtype=np.float32) * (1 - a)
    prev[..., 3] = 1
    return prev


def bake_piece(sc, sun, cam, name, a, work, mat):
    t0 = time.time()
    is_fringe = name.startswith("fringe")
    if is_fringe:
        dens, vox, lo = fringe_density(name, a["scale"])
        pad = int(round(0.5 / vox))          # a quarter period each side, so the ends are lit like the middle
    else:
        dens, vox, lo = scud_density(name, a["scale"])
        pad = 0
    path = os.path.join(work, name + ".vdb")
    write_vdb(dens, vox, lo, path, pad)
    if a.get("proj"):
        # debug: optical depth along the view (y), as alpha = 1 - exp(-tau), over the slate
        al = 1.0 - np.exp(-dens.sum(axis=1) * vox)            # (x, z)
        img = np.zeros((al.shape[1], al.shape[0], 4), np.float32)
        img[..., :3] = al.T[..., None]; img[..., 3] = 1
        save(img, os.path.join(a["out"], f"{name}_proj.png"))
    tbuild = time.time() - t0
    print(f"{name}: grid {dens.shape}, max {dens.max():.1f}, build {tbuild:.1f} s")

    for ob in list(bpy.data.objects):
        if ob.type == "VOLUME":
            bpy.data.objects.remove(ob)
    vdata = bpy.data.volumes.new(name)
    vdata.filepath = path
    vob = bpy.data.objects.new(name, vdata)
    sc.collection.objects.link(vob)
    vdata.materials.append(mat)

    W, H = (512, 256) if is_fringe else (256, 256)
    W, H = int(W * a["scale"]), int(H * a["scale"])
    sc.render.resolution_x, sc.render.resolution_y = W, H
    sc.render.pixel_aspect_x = sc.render.pixel_aspect_y = 1.0
    cam.data.sensor_fit = "HORIZONTAL"
    if is_fringe:
        cam.data.ortho_scale = 2.0
        cam.location = (1.0, -10.0, 0.5)
    else:
        cam.data.ortho_scale = 2.0
        cam.location = (0.0, -10.0, 0.0)

    sheet = np.zeros((2 * H, W, 4), dtype=np.float32)
    times = {}
    for k, cell in enumerate(CELLS):
        set_light(sc, sun, cell)
        t1 = time.time()
        px = render_cell(sc, os.path.join(work, f"{name}_{cell}.png"))
        times[cell] = time.time() - t1
        y0 = (1 - k) * H            # Blender rows run bottom-up: cell 0 on top
        sheet[y0:y0 + H] = px
        al = px[..., 3]
        edge_l, edge_r = al[:, 0], al[:, -1]
        rgb = px[..., :3][al > 0.5]
        print(f"RENDER {name} {cell}: {times[cell]:.1f} s, cover {float((al > 0.5).mean()):.2f}, "
              f"alpha top {al[-1].mean():.2f} min top quarter {al[-(H // 4):].min():.2f} bottom {al[0].max():.2f} left {edge_l.max():.2f} right {edge_r.max():.2f}, "
              f"L/R mismatch {float(np.abs(px[:, 0] - px[:, -1]).mean()):.3f}, "
              f"rgb p50 {np.percentile(rgb, 50) if rgb.size else 0:.2f} p95 {np.percentile(rgb, 95) if rgb.size else 0:.2f}")
    tag = a["tag"]
    os.makedirs(a["out"], exist_ok=True)
    save(sheet, os.path.join(a["out"], f"{name}{tag}.png"))
    save(over_bg(sheet), os.path.join(a["out"], f"{name}{tag}_preview.png"))
    if is_fringe:
        # tiling check: the diffuse cell three times side by side, over slate
        row = np.concatenate([sheet[H:]] * 3, axis=1)
        save(over_bg(row), os.path.join(a["out"], f"{name}{tag}_row.png"))
    return tbuild, times


def contact_sheet(a):
    """Scud previews in a row on top, fringe previews in a row below (1536 x 1024 at full scale)."""
    rows = []
    for names in (SCUDS, FRINGES):
        ims = []
        for name in names:
            p = os.path.join(a["out"], f"{name}{a['tag']}_preview.png")
            if os.path.exists(p):
                img = bpy.data.images.load(p)
                w, h = img.size
                ims.append(np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4))
                bpy.data.images.remove(img)
        if ims:
            hmax = max(i.shape[0] for i in ims)
            ims = [i if i.shape[0] == hmax else np.pad(i, ((hmax - i.shape[0], 0), (0, 0), (0, 0))) for i in ims]
            rows.append(np.concatenate(ims, axis=1))
    if not rows:
        return
    wmax = max(r.shape[1] for r in rows)
    rows = [np.pad(r, ((0, 0), (0, wmax - r.shape[1]), (0, 0)), constant_values=0.1) for r in rows]
    sheet = np.concatenate(rows[::-1], axis=0)    # bottom-up: first row on top
    sheet[..., 3] = 1
    save(sheet, os.path.join(a["out"], f"sheet{a['tag']}.png"))


def main():
    raise_priority()
    a = args()
    a["out"] = os.path.abspath(a["out"])
    work = os.path.join(os.environ.get("CLAUDE_JOB_DIR", os.path.join(ROOT, "tmp")), "tmp", "wisp_bake")
    os.makedirs(work, exist_ok=True)
    if not a["sheet-only"]:
        sc, sun, cam = setup_scene(a)
        mat = material()
        total = time.time()
        for name in a["pieces"].split(","):
            tb, t = bake_piece(sc, sun, cam, name, a, work, mat)
            print(f"PIECE {name}: build {tb:.1f} s, render {sum(t.values()):.1f} s")
        print(f"TOTAL {time.time() - total:.1f} s, {a['samples']} samples, scale {a['scale']}")
    contact_sheet(a)


main()
