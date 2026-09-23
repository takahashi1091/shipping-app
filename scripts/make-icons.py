# -*- coding: utf-8 -*-
"""シンプルな PNG アイコンを生成する（追加ライブラリ不要）。"""
import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")
os.makedirs(OUT, exist_ok=True)

BLUE = (13, 110, 253)
WHITE = (255, 255, 255)


def png_chunk(tag, data):
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def write_png(path, pixels, size):
    raw = b""
    for y in range(size):
        raw += b"\x00"
        for x in range(size):
            raw += bytes(pixels[y][x])
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    data = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(raw, 9)) + png_chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(data)


def make_icon(size):
    pixels = [[BLUE for _ in range(size)] for _ in range(size)]
    # 角を少し丸める
    r = max(8, size // 8)
    for y in range(size):
        for x in range(size):
            dx = min(x, size - 1 - x)
            dy = min(y, size - 1 - y)
            if dx < r and dy < r:
                if (r - dx) ** 2 + (r - dy) ** 2 > r * r:
                    pixels[y][x] = (33, 37, 41)

    # 荷物の箱
    m = size // 5
    x0, x1 = m, size - m
    y0, y1 = int(size * 0.32), int(size * 0.78)
    for y in range(y0, y1):
        for x in range(x0, x1):
            edge = x in (x0, x1 - 1) or y in (y0, y1 - 1)
            pixels[y][x] = WHITE if edge else (232, 240, 254)
    # フタの線
    mid = (y0 + y1) // 2
    for x in range(x0, x1):
        pixels[mid][x] = WHITE
    for y in range(y0, y1):
        pixels[y][(x0 + x1) // 2] = WHITE
    return pixels


for n, name in ((192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")):
    write_png(os.path.join(OUT, name), make_icon(n), n)
    print("wrote", name)
