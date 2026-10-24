"""Packs every cloud kit piece (roblox/src/shared/Weather/CloudKit/Pieces/*.luau) into one .glb
for upload to Roblox as a Model asset: one mesh node per piece, named after it, with its normals
and its ambient occlusion as vertex colour. Uploaded meshes don't use the EditableMesh memory
budget the runtime-built pieces need.

    py tools/blender/cloud_kit_glb.py            -> roblox/assets/cloudkit/cloud_kit.glb
"""
import json, os, re, struct, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
PIECES = os.path.join(ROOT, 'roblox', 'src', 'shared', 'Weather', 'CloudKit', 'Pieces')
OUT = os.path.join(ROOT, 'roblox', 'assets', 'cloudkit', 'cloud_kit.glb')
MASK = os.path.join(ROOT, 'roblox', 'assets', 'cloudkit', 'white_mask.png')
# --emissive: each piece gets a material with a white emissive texture, so the import gives it a
# SurfaceAppearance with an emissive mask (scripts can't set one; the game drives the glow's
# strength and tint for distance haze)
EMISSIVE = '--emissive' in sys.argv
UNIT = 100.0  # studs a unit (as CloudKit builds them)


def numbers(src, key):
    m = re.search(r'\n\t' + key + r' = \{(.*?)\n\t\}', src, re.S)
    return [float(x) for x in m.group(1).replace('\n', ' ').replace('\t', ' ').split(',') if x.strip()]


def main():
    names = sorted(f[:-5] for f in os.listdir(PIECES) if f.endswith('.luau'))
    blob = bytearray()
    views, accessors, meshes, nodes = [], [], [], []

    def view(data, target):
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        return len(views) - 1

    for name in names:
        src = open(os.path.join(PIECES, name + '.luau'), encoding='utf-8').read()
        if '-- Cloud kit piece' not in src:
            continue
        p, n, ao, t = numbers(src, 'p'), numbers(src, 'n'), numbers(src, 'ao'), [int(x) - 1 for x in numbers(src, 't')]
        nv = len(ao)
        # centred on the piece's box middle (the box is x, z -0.5..0.5, y 0..1)
        pos = []
        for i in range(nv):
            pos += [p[3 * i] * UNIT, (p[3 * i + 1] - 0.5) * UNIT, p[3 * i + 2] * UNIT]
        lo = [min(pos[k::3]) for k in range(3)]
        hi = [max(pos[k::3]) for k in range(3)]
        col = []
        for a in ao:
            col += [a, a, a, 1.0]
        a_pos = len(accessors)
        accessors.append({'bufferView': view(struct.pack('<%df' % len(pos), *pos), 34962), 'componentType': 5126,
                          'count': nv, 'type': 'VEC3', 'min': lo, 'max': hi})
        accessors.append({'bufferView': view(struct.pack('<%df' % len(n), *n), 34962), 'componentType': 5126,
                          'count': nv, 'type': 'VEC3'})
        accessors.append({'bufferView': view(struct.pack('<%df' % len(col), *col), 34962), 'componentType': 5126,
                          'count': nv, 'type': 'VEC4'})
        accessors.append({'bufferView': view(struct.pack('<%dI' % len(t), *t), 34963), 'componentType': 5125,
                          'count': len(t), 'type': 'SCALAR'})
        attrs = {'POSITION': a_pos, 'NORMAL': a_pos + 1, 'COLOR_0': a_pos + 2}
        prim = {'attributes': attrs, 'indices': a_pos + 3, 'mode': 4}
        if EMISSIVE:
            uv = [0.5] * (2 * nv)
            attrs['TEXCOORD_0'] = len(accessors)
            accessors.append({'bufferView': view(struct.pack('<%df' % len(uv), *uv), 34962), 'componentType': 5126,
                              'count': nv, 'type': 'VEC2'})
            prim['material'] = 0
        meshes.append({'name': name, 'primitives': [prim]})
        # laid out side by side so they don't overlap in the import
        nodes.append({'name': name, 'mesh': len(meshes) - 1, 'translation': [len(nodes) * 150.0, 0, 0]})
        print(name, nv, 'vertices')
    extra = {}
    if EMISSIVE:
        png = open(MASK, 'rb').read()
        img_view = view(png, None)
        views[img_view].pop('target')
        extra = {'images': [{'bufferView': img_view, 'mimeType': 'image/png', 'name': 'white_mask'}],
                 'samplers': [{}], 'textures': [{'source': 0, 'sampler': 0}],
                 'materials': [{'name': 'CloudKit', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}, 'metallicFactor': 0.0, 'roughnessFactor': 1.0},
                                'emissiveTexture': {'index': 0}, 'emissiveFactor': [1.0, 1.0, 1.0]}]}
    gltf = {'asset': {'version': '2.0', 'generator': 'weatherworld cloud_kit_glb.py'},
            'scene': 0, 'scenes': [{'name': 'CloudKit', 'nodes': list(range(len(nodes)))}],
            'nodes': nodes, 'meshes': meshes, 'accessors': accessors, 'bufferViews': views,
            'buffers': [{'byteLength': len(blob)}], **extra}
    js = json.dumps(gltf, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(blob) % 4:
        blob.append(0)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(blob))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js
    out += struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    if EMISSIVE:
        globals()['OUT'] = OUT.replace('.glb', '_emissive.glb')
    open(OUT, 'wb').write(out)
    print('wrote', OUT, len(out) // 1024, 'KB')


if __name__ == '__main__':
    main()
