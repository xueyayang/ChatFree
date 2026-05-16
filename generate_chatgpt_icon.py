#!/usr/bin/env python3
"""Generate a ChatGPT site icon — hexagon shape in dark tech-red.

Design: a bold hexagon with a subtle top-left highlight on transparent
background.  Hexagons are the core motif of ChatGPT's brand identity.
At 32x32 the shape is large enough to be clearly visible at 0.45 opacity.
"""
import struct
import zlib
import os
import math


def create_rgba_png(width, height, pixel_fn):
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            raw += bytes(pixel_fn(x, y))

    compressed = zlib.compress(raw)
    return (sig +
            chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', compressed) +
            chunk(b'IEND', b''))


def hexagon_icon():
    """Bold hexagon with inner highlight on transparent background."""
    W = H = 32
    cx, cy = 16, 16
    R = 12.5  # circumradius — fills most of the 32x32 canvas

    # Dark tech-red palette
    EDGE = (153, 27, 27)     # #991b1b outermost ring
    BASE = (196, 30, 58)     # #c41e3a main fill
    MID = (220, 44, 64)      # #dc2c40 inner
    GLOW = (248, 76, 82)     # #f84c52 highlight core

    def pointy_hex_sdf(px, py, r):
        """Signed distance to a pointy-top regular hexagon centered at (cx, cy).

        Pointy-top hexagon vertices at angles 0, 60, 120, ... degrees.
        Uses the exact hexagon SDF from iq's method."""
        dx = abs(px - cx)
        dy = abs(py - cy)

        # Hexagon half-widths
        hw = r * math.sqrt(3) / 2  # horizontal radius (from center to flat side midpoint)
        hr = r                       # vertical radius (from center to vertex)

        # Transform to the first sextant
        # Rotate point so hexagon edge is axis-aligned
        # For pointy-top, vertices are at (0, ±r), (±hw, ±r/2), etc.
        # SDF: max of dot products with edge normals
        k = math.sqrt(3)
        # Pointy-top hexagon SDF
        px2 = abs(dx) / r
        py2 = abs(dy) / r
        return max(px2 * k + py2, max(px2, py2)) - k

    def pixel_fn(x, y):
        px, py = x + 0.5, y + 0.5
        d = pointy_hex_sdf(px, py, R)

        if d > 1.0:
            return (0, 0, 0, 0)  # fully outside, transparent

        if d > 0:
            # Anti-alias edge: blend with transparent
            alpha = int(max(0, 255 * (1.0 - d)))
            if d > 0.6:
                r, g, b = EDGE
            else:
                r, g, b = BASE
            return (r, g, b, alpha)

        # Inside the hexagon
        dist_to_edge = -d
        edge_zone = 1.5

        if dist_to_edge < edge_zone:
            # Edge ring: blend EDGE → BASE
            t = min(1, dist_to_edge / edge_zone)
            r = int(EDGE[0] + (BASE[0] - EDGE[0]) * t)
            g = int(EDGE[1] + (BASE[1] - EDGE[1]) * t)
            b = int(EDGE[2] + (BASE[2] - EDGE[2]) * t)
            return (r, g, b, 255)

        # Inner area: add tech-glow highlight from top-left
        # Angle from center to top-left (-135 degrees)
        angle = math.atan2(cy - py, cx - px)  # -pi to pi
        light_angle = -math.pi * 0.75  # top-left
        angle_factor = max(0, math.cos(angle - light_angle)) * 0.5 + 0.5

        # Distance from center (normalized)
        dist_norm = min(1, dist_to_edge / R)
        inner_factor = 1 - dist_norm  # brighter near center

        glow = angle_factor * inner_factor * 0.55

        r = int(BASE[0] + (GLOW[0] - BASE[0]) * glow)
        g = int(BASE[1] + (GLOW[1] - BASE[1]) * glow)
        b = int(BASE[2] + (GLOW[2] - BASE[2]) * glow)

        return (min(255, r), min(255, g), min(255, b), 255)

    return create_rgba_png(W, H, pixel_fn)


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
    os.makedirs(out_dir, exist_ok=True)
    data = hexagon_icon()
    path = os.path.join(out_dir, 'chatgpt.png')
    with open(path, 'wb') as f:
        f.write(data)
    print(f'Created {path} ({len(data)} bytes)')


if __name__ == '__main__':
    main()
