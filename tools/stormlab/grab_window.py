"""Grab a window's client area to PNG files: one frame, or a timed burst for tools/stormlab/motion_probe.py.

    py tools/stormlab/grab_window.py "plains - Roblox" out_prefix [--n 1] [--dt 0.5] [--crop x,y,w,h]

Files land as out_prefix.png (n = 1) or out_prefix_00.png .. (a burst), cropped to the region given in
the client area's own pixels (studio_capture_window's coordinates). It asks the window to draw itself
(PrintWindow, full content - as studio_capture_window), so other windows in front don't matter; it
must not be minimised.
"""
import argparse
import ctypes
import time
from ctypes import wintypes

from PIL import Image

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # (real pixels, as the capture tool's)
except Exception:
    pass


def find(title_part):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        n = user32.GetWindowTextLengthW(hwnd)
        if n and user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(n + 1)
            user32.GetWindowTextW(hwnd, buf, n + 1)
            if title_part.lower() in buf.value.lower():
                found.append(hwnd)
        return True

    user32.EnumWindows(cb, 0)
    if not found:
        raise SystemExit(f"no window with '{title_part}' in its title")
    return found[0]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG), ("biYPelsPerMeter", wintypes.LONG),
                ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]


def grab_client(hwnd):
    """The window's client area, drawn by the window itself (PW_CLIENTONLY | PW_RENDERFULLCONTENT)."""
    r = wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(r))
    w, h = r.right, r.bottom
    hdc = user32.GetDC(hwnd)
    mdc = gdi32.CreateCompatibleDC(hdc)
    bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
    gdi32.SelectObject(mdc, bmp)
    user32.PrintWindow(hwnd, mdc, 1 | 2)
    bi = BITMAPINFOHEADER(ctypes.sizeof(BITMAPINFOHEADER), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)
    buf = ctypes.create_string_buffer(w * h * 4)
    gdi32.GetDIBits(mdc, bmp, 0, h, buf, ctypes.byref(bi), 0)
    gdi32.DeleteObject(bmp)
    gdi32.DeleteDC(mdc)
    user32.ReleaseDC(hwnd, hdc)
    return Image.frombuffer("RGB", (w, h), buf, "raw", "BGRX", 0, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("title")
    ap.add_argument("out")
    ap.add_argument("--n", type=int, default=1)
    ap.add_argument("--dt", type=float, default=0.5)
    ap.add_argument("--crop")
    a = ap.parse_args()
    hwnd = find(a.title)
    box = None
    if a.crop:
        cx, cy, cw, ch = (int(v) for v in a.crop.split(","))
        box = (cx, cy, cx + cw, cy + ch)
    t0 = time.perf_counter()
    for i in range(a.n):
        while time.perf_counter() < t0 + i * a.dt:
            time.sleep(0.002)
        img = grab_client(hwnd)
        if box:
            img = img.crop(box)
        img.save(f"{a.out}.png" if a.n == 1 else f"{a.out}_{i:02d}.png")
    print(f"{a.n} frame(s) {img.size[0]}x{img.size[1]} in {time.perf_counter() - t0:.2f} s -> {a.out}")


if __name__ == "__main__":
    main()
