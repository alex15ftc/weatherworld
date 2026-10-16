"""Adds the close-up funnel's edge-boil frames (scripts/blender/bake_funnel_boil.py) to the build
for upload (roblox/tools/upload-images.mjs) and the funnel model (roblox/tools/funnel-model.luau).

    python -I scripts/pack-funnel-boil.py <boil dir> <build dir>

Copies <boil dir>/<shell>/fNNN.png to <build dir>/boil/<shell>/ and records them in
manifest.json as `boil`: { frames, seconds (of the funnel's clock one loop covers), shells:
{ <shell>: [files] } }.
"""

import json
import os
import shutil
import sys


def long_path(path):
    """Windows: a path past 260 characters needs the extended-length (\\\\?\\) form."""
    path = os.path.abspath(path)
    prefix = "\\\\?\\"
    if os.name == "nt" and not path.startswith(prefix):
        return prefix + path
    return path


def main():
    source, build = long_path(sys.argv[1]), long_path(sys.argv[2])
    info = json.load(open(os.path.join(source, "boil.json")))
    shells = {}
    for shell in info["shells"]:
        os.makedirs(os.path.join(build, "boil", shell), exist_ok=True)
        files = []
        for k in range(info["frames"]):
            name = f"f{k:03d}.png"
            shutil.copyfile(os.path.join(source, shell, name), os.path.join(build, "boil", shell, name))
            files.append(f"boil/{shell}/{name}")
        shells[shell] = files
    manifest_file = os.path.join(build, "manifest.json")
    manifest = json.load(open(manifest_file)) if os.path.exists(manifest_file) else {}
    manifest["boil"] = {"frames": info["frames"], "seconds": info["seconds"], "shells": shells}
    json.dump(manifest, open(manifest_file, "w"), indent=2)
    print(f"boil: {info['frames']} frames x {len(shells)} shells")


if __name__ == "__main__":
    main()
