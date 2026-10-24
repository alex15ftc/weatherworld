"""Packs a relight grid (roblox/src/shared/Weather/CloudKit/Relight/<piece>.luau, 19 channels at
256x256) into one 1024x512 RGB PNG for upload as an image asset: 8 tiles of 256 (4 across, 2 down),
tile t holding channels 3t, 3t+1, 3t+2 in R, G, B (tile 6: 18 = alpha, then padding). RGB only and
fully opaque, so nothing in the upload touches the colours under a zero alpha. The game reads the
pixels back (client/VaporRelight) instead of shipping ~1.7 MB of Luau a piece.

    py tools/blender/relight_pack.py [piece ...]    -> roblox/assets/cloudkit/relight/<piece>_pack.png
"""
import base64
import os
import re
import struct
import sys
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
# (the grids' Luau, moved out of the place once packed: the game reads the uploaded packs; new
# bakes land in src/.../CloudKit/Relight and are packed from there too)
SRC = os.path.join(ROOT, 'roblox', 'assets', 'cloudkit', 'relight', 'luau')
NEW = os.path.join(ROOT, 'roblox', 'src', 'shared', 'Weather', 'CloudKit', 'Relight')
OUT = os.path.join(ROOT, 'roblox', 'assets', 'cloudkit', 'relight')


def png(w, h, rows):
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    raw = b''.join(b'\x00' + r for r in rows)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def pack(piece):
    path = os.path.join(NEW, piece + '.luau')
    if not os.path.exists(path):
        path = os.path.join(SRC, piece + '.luau')
    src = open(path, encoding='utf-8').read()
    size = int(re.search(r'size = (\d+)', src).group(1))
    ch = int(re.search(r'channels = (\d+)', src).group(1))
    data = base64.b64decode(re.search(r'data = "([^"]+)"', src).group(1))
    assert len(data) == size * size * ch, (piece, len(data))
    W, H = size * 4, size * 2
    img = bytearray(W * H * 3)
    for t in range(8):
        tx, ty = (t % 4) * size, (t // 4) * size
        for c in range(3):
            k = t * 3 + c
            if k >= ch:
                continue
            for y in range(size):
                src_row = y * size * ch
                dst_row = ((ty + y) * W + tx) * 3 + c
                img[dst_row:dst_row + size * 3:3] = data[src_row + k:src_row + size * ch:ch]
    rows = [bytes(img[y * W * 3:(y + 1) * W * 3]) for y in range(H)]
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, piece + '_pack.png')
    open(out, 'wb').write(png(W, H, rows))
    print(piece, out, os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    names = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(SRC) if f.endswith('.luau'))
    for n in names:
        pack(n)
