#!/usr/bin/env python3
"""Generate minimal PNG icons for the ChatFree extension."""
import struct
import zlib
import os

def create_png(width, height, r, g, b):
    """Create a minimal solid-color PNG and return bytes."""

    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        return struct.pack('>I', len(data)) + c + crc

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr_chunk = chunk(b'IHDR', ihdr)

    # IDAT - raw image data: filter byte (0) + RGB triple per row
    raw = b''
    for y in range(height):
        raw += b'\x00'  # filter: none
        for x in range(width):
            # Draw "CF" letter shapes roughly centered
            px, py = x / width, y / height
            if _in_cf(px, py):
                raw += bytes([255, 255, 255])  # white letters
            else:
                raw += bytes([r, g, b])  # background

    compressed = zlib.compress(raw)
    idat_chunk = chunk(b'IDAT', compressed)

    # IEND
    iend_chunk = chunk(b'IEND', b'')

    return sig + ihdr_chunk + idat_chunk + iend_chunk


def _in_cf(px, py):
    """Crude 'CF' shape mask. Returns True if pixel is part of the letters."""
    # C letter
    cx, cy, cw, ch = 0.12, 0.22, 0.34, 0.56
    if cx <= px <= cx + cw and cy <= py <= cy + ch:
        # C shape: left bar, top bar, bottom bar
        on_left = px <= cx + cw * 0.35
        on_top = py <= cy + ch * 0.18
        on_bottom = py >= cy + ch * 0.82
        if on_left or on_top or on_bottom:
            return True
        return False

    # F letter
    fx, fy, fw, fh = 0.54, 0.22, 0.34, 0.56
    if fx <= px <= fx + fw and fy <= py <= fy + fh:
        on_left = px <= fx + fw * 0.35
        on_top = py <= fy + fh * 0.18
        on_mid = abs(py - (fy + fh * 0.45)) <= fh * 0.10
        if on_left or on_top or on_mid:
            return True
        return False

    return False


def main():
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'icons')
    os.makedirs(out_dir, exist_ok=True)

    sizes = [(16, 16), (48, 48), (128, 128)]
    # Neutral dark teal-green background
    bg = (42, 90, 61)  # #2a5a3d

    for w, h in sizes:
        data = create_png(w, h, *bg)
        path = os.path.join(out_dir, f'icon{w}.png')
        with open(path, 'wb') as f:
            f.write(data)
        print(f'Created {path} ({len(data)} bytes)')

if __name__ == '__main__':
    main()
