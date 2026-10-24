# Checks the cloud kit's piece modules (roblox/src/shared/Weather/CloudKit/Pieces/*.luau) and
# Index.luau without Blender or Roblox. Plain Python:
#
#   py tools/blender/check_cloud_kit.py [piece.luau ...]
#
# For each piece: braces balance; the lists have the right lengths (p and n 3 per vertex, ao 1 per
# vertex, t a multiple of 3, every index in 1..vertices); positions fill the unit box; normals are
# unit length; no degenerate triangles; closed (every edge in exactly two triangles), wound the
# same way everywhere (each edge used once in each direction) and outward (positive volume); and
# how many triangles agree with their corners' normals. Every piece in Index.luau must exist.
# Stand-in pieces (not made by cloud_kit.py) are skipped.
import glob
import math
import os
import re
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
KIT = os.path.join(ROOT, "roblox", "src", "shared", "Weather", "CloudKit")


def numbers(text, key):
    m = re.search(r"\n\t" + key + r" = \{(.*?)\n\t\},", text, re.S)
    if not m:
        raise ValueError(f"no list {key}")
    return [float(x) for x in m.group(1).replace("\n", " ").split(",") if x.strip()]


def check(path):
    text = open(path, encoding="utf-8").read()
    errors = []
    if text.count("{") != text.count("}"):
        errors.append("braces do not balance")
    name = re.search(r'name = "([^"]+)"', text).group(1)
    kind = re.search(r'kind = "([^"]+)"', text).group(1)
    nv = int(re.search(r"vertices = (\d+),", text).group(1))
    p, n, ao, t = (numbers(text, k) for k in ("p", "n", "ao", "t"))
    if os.path.basename(path)[:-5] != name:
        errors.append("name does not match the file name")
    if len(p) != 3 * nv or len(n) != 3 * nv or len(ao) != nv:
        errors.append(f"list lengths p {len(p)} n {len(n)} ao {len(ao)} for {nv} vertices")
    if len(t) % 3:
        errors.append("t is not a multiple of 3")
    tris = [(int(t[i]), int(t[i + 1]), int(t[i + 2])) for i in range(0, len(t) - 2, 3)]
    if any(not 1 <= i <= nv for tri in tris for i in tri):
        errors.append("a triangle index is outside 1..vertices")
        return name, kind, nv, len(tris), errors, 0
    if not 1500 <= nv <= 4000:
        errors.append(f"{nv} vertices is outside the 1500..4000 budget")
    P = [(p[3 * i], p[3 * i + 1], p[3 * i + 2]) for i in range(nv)]
    N = [(n[3 * i], n[3 * i + 1], n[3 * i + 2]) for i in range(nv)]
    lo = [min(v[k] for v in P) for k in range(3)]
    hi = [max(v[k] for v in P) for k in range(3)]
    want = ((-0.5, 0.5), (0.0, 1.0), (-0.5, 0.5))
    for k in range(3):
        if abs(lo[k] - want[k][0]) > 1e-3 or abs(hi[k] - want[k][1]) > 1e-3:
            errors.append(f"axis {'xyz'[k]} spans {lo[k]:.4f}..{hi[k]:.4f}, not {want[k]}")
    if any(abs(math.sqrt(a * a + b * b + c * c) - 1) > 2e-3 for a, b, c in N):
        errors.append("a normal is not unit length")
    if any(not 0 <= a <= 1 for a in ao):
        errors.append("ao outside 0..1")
    directed, volume, degenerate, agree = set(), 0.0, 0, 0
    for a, b, c in tris:
        for e in ((a, b), (b, c), (c, a)):
            if e in directed:
                errors.append(f"edge {e} used twice in the same direction")
                break
            directed.add(e)
        A, B, C = P[a - 1], P[b - 1], P[c - 1]
        u = [B[k] - A[k] for k in range(3)]
        w = [C[k] - A[k] for k in range(3)]
        x = (u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0])
        if math.sqrt(sum(q * q for q in x)) < 1e-9:
            degenerate += 1
        s = [N[a - 1][k] + N[b - 1][k] + N[c - 1][k] for k in range(3)]
        agree += sum(x[k] * s[k] for k in range(3)) > 0
        volume += (A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0])
                   + A[2] * (B[0] * C[1] - B[1] * C[0])) / 6.0
    open_edges = sum(1 for a, b in directed if (b, a) not in directed)
    if open_edges:
        errors.append(f"{open_edges} edges without a partner (not closed, or wound inconsistently)")
    if degenerate:
        errors.append(f"{degenerate} degenerate triangles")
    if volume <= 0:
        errors.append(f"volume {volume:.3f}: triangles wound inward")
    if max(len(line) for line in text.splitlines()) > 220:
        errors.append("a line is longer than 220 characters")
    return name, kind, nv, len(tris), errors, agree / max(len(tris), 1), volume


def main():
    files = sys.argv[1:] or sorted(glob.glob(os.path.join(KIT, "Pieces", "*.luau")))
    bad = 0
    names = set()
    for f in files:
        head = open(f, encoding="utf-8").read(400)
        if "-- Cloud kit piece " not in head:
            print(f"skip {os.path.basename(f)} (not made by cloud_kit.py)")
            continue
        name, kind, nv, nt, errors, agree, *vol = check(f)
        names.add(name)
        status = "ok" if not errors else "FAIL"
        bad += bool(errors)
        print(f"{status:4} {name:14} {kind:11} {nv:5} vertices {nt:5} triangles  volume {vol[0] if vol else 0:.3f}"
              f"  normals agree {100 * agree:.1f}%")
        for e in errors:
            print("     -", e)
    index = os.path.join(KIT, "Index.luau")
    if os.path.exists(index) and not sys.argv[1:]:
        listed = re.findall(r'"([^"]+)"', open(index, encoding="utf-8").read())
        missing = [x for x in listed if not os.path.exists(os.path.join(KIT, "Pieces", x + ".luau"))]
        print(f"Index.luau lists {len(listed)} pieces" + (f"; missing: {missing}" if missing else ", all present"))
        bad += bool(missing)
    sys.exit(1 if bad else 0)


main()
