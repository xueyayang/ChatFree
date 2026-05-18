#!/usr/bin/env python3
"""Generate 32x32 site icons as bold geometric shapes on transparent background.

Each icon uses the same SDF-based anti-aliased PNG pipeline as
generate_chatgpt_icon.py, so no external dependencies are needed.
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


def lerp(a, b, t):
    return tuple(int(va + (vb - va) * t) for va, vb in zip(a, b))


def render_sdf(W, H, cx, cy, sdf_fn, color_primary, color_highlight):
    """Return a pixel_fn that renders a shape via signed distance.

    Edge band:   d in (-1.5, 0]   -> blend to transparent
    Core fill:   d <= -1.5         -> color_primary with optional highlight
    """
    def pixel_fn(x, y):
        d = sdf_fn(x + 0.5, y + 0.5)

        if d > 1.5:
            return (0, 0, 0, 0)

        if d > 0:
            alpha = int(max(0, 255 * (1.0 - d / 1.5)))
            return (*color_primary, alpha)

        # Inside shape — subtle highlight from top-left
        dist_in = -d
        angle = math.atan2(cy - y, cx - x)
        light_angle = -math.pi * 0.75  # top-left
        angle_factor = max(0, math.cos(angle - light_angle)) * 0.45 + 0.55
        inner_factor = min(1.0, dist_in / 8.0)
        t = angle_factor * inner_factor * 0.4
        return (*lerp(color_primary, color_highlight, t), 255)

    return pixel_fn


# ---------------------------------------------------------------------------
# Shape SDFs
# ---------------------------------------------------------------------------

def sdf_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


def sdf_diamond(px, py, cx, cy, r):
    """45-degree rotated square (diamond)."""
    dx = abs(px - cx)
    dy = abs(py - cy)
    return (dx + dy) / math.sqrt(2) - r


def sdf_rounded_rect(px, py, cx, cy, hw, hh, radius):
    """Rounded rectangle SDF."""
    dx = max(0, abs(px - cx) - (hw - radius))
    dy = max(0, abs(py - cy) - (hh - radius))
    return math.hypot(dx, dy) - radius


def sdf_star4(px, py, cx, cy, outer_r, inner_r):
    """4-pointed star (like Gemini sparkle)."""
    dx = abs(px - cx)
    dy = abs(py - cy)
    # Rotate 45 degrees: the star points are along the diagonals
    u = (dx + dy) / math.sqrt(2)
    v = abs(dx - dy) / math.sqrt(2)
    # Distance to the star boundary in first quadrant
    # Star: outer_r along diagonals, inner_r along axes
    if u + v < 0.001:
        return -inner_r
    # Normalized direction
    t = v / (u + v) if (u + v) > 0.001 else 0
    r = inner_r + (outer_r - inner_r) * t
    return math.hypot(u, v) - r


def sdf_rounded_triangle(px, py, cx, cy, r):
    """Upward-pointing rounded triangle (approximation via hexagram half)."""
    dx = px - cx
    dy = py - cy
    # Shift: tip at top, base at bottom
    tip_y = -r * 0.85
    base_y = r * 0.75
    half_w = r * 0.85

    if dy < tip_y or dy > base_y:
        return 10.0  # far outside vertically

    # Left and right edge normals
    # Left edge: from (cx, tip_y) to (cx - half_w, base_y)
    lx0, ly0 = -half_w, base_y
    l_dir_y = base_y - tip_y
    # Normal points inward
    nx = l_dir_y
    ny = half_w
    nl = math.hypot(nx, ny)
    nx, ny = nx / nl, ny / nl  # inward normal for left edge

    # Which side are we on?
    # For the left edge, inward is to the positive-x side
    dist_left = (dx - lx0) * nx + (dy - ly0) * ny

    # Right edge: from (cx, tip_y) to (cx + half_w, base_y)
    rx0, ry0 = half_w, base_y
    dist_right = (dx - rx0) * (-nx) + (dy - ry0) * ny

    # Bottom edge
    bot = dy - base_y

    return max(dist_left, dist_right, bot)


def sdf_wave(px, py, cx, cy, r):
    """Simple wave-like shape (DeepSeek whale tail suggestion)."""
    dx = px - cx
    dy = py - cy
    dist = math.hypot(dx, dy)
    # Add a small sinusoidal modulation to create a wave/ripple effect
    angle = math.atan2(dy, dx)
    wave = math.sin(angle * 4) * r * 0.18
    return dist - (r + wave)


# ---------------------------------------------------------------------------
# Icon definitions
# ---------------------------------------------------------------------------

ICONS = [
    {
        "name": "deepseek",
        "fn": lambda: render_sdf(
            32, 32, 16, 16,
            lambda px, py: sdf_circle(px, py, 16, 16, 11),
            (37, 99, 235),   # blue-600
            (96, 165, 250),  # blue-400
        ),
    },
    {
        "name": "doubao",
        "fn": lambda: render_sdf(
            32, 32, 16, 16,
            lambda px, py: sdf_rounded_rect(px, py, 16, 16, 10, 10, 4),
            (22, 163, 74),   # green-600
            (74, 222, 128),  # green-400
        ),
    },
    {
        "name": "qianwen",
        "fn": lambda: render_sdf(
            32, 32, 16, 16,
            lambda px, py: sdf_diamond(px, py, 16, 16, 10),
            (124, 58, 237),  # violet-600
            (167, 139, 250), # violet-400
        ),
    },
    {
        "name": "gemini",
        "fn": lambda: render_sdf(
            32, 32, 16, 16,
            lambda px, py: sdf_star4(px, py, 16, 16, 12, 5),
            (217, 119, 6),   # amber-600
            (252, 211, 77),  # amber-300
        ),
    },
]


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
    os.makedirs(out_dir, exist_ok=True)

    for icon in ICONS:
        data = create_rgba_png(32, 32, icon["fn"]())
        path = os.path.join(out_dir, f'{icon["name"]}.png')
        with open(path, 'wb') as f:
            f.write(data)
        print(f'Created {path} ({len(data)} bytes)')


if __name__ == '__main__':
    main()
