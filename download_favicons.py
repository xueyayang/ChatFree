#!/usr/bin/env python3
"""Download favicons for each site and save them locally in icons/."""

import os
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ICONS_DIR = os.path.join(SCRIPT_DIR, "icons")

SITES = [
    ("deepseek", "chat.deepseek.com", "deepseek.png"),
    ("doubao", "www.doubao.com", "doubao.png"),
    ("qianwen", "tongyi.aliyun.com", "qianwen.png"),
    ("gemini", "gemini.google.com", "gemini.png"),
]


def download_via_google(domain, size=32):
    """Use Google's favicon service (returns PNG)."""
    url = f"https://www.google.com/s2/favicons?domain={domain}&sz={size}"
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return r.content


def try_direct_favicon(domain, size=32):
    """Try fetching favicon directly from the site.

    Returns (png_bytes_or_None, actual_size_hint).  Most direct favicons
    are .ico files; we accept anything that looks like an image.
    """
    candidates = [
        f"https://{domain}/favicon.ico",
        f"https://{domain}/favicon.png",
    ]
    for url in candidates:
        try:
            r = requests.get(url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            if r.status_code == 200 and len(r.content) > 100:
                ct = r.headers.get("content-type", "")
                if any(t in ct for t in ("image", "octet-stream", "ico", "png", "svg", "icon")):
                    return r.content
        except Exception:
            continue
    return None


def main():
    os.makedirs(ICONS_DIR, exist_ok=True)

    for name, domain, filename in SITES:
        out_path = os.path.join(ICONS_DIR, filename)
        data = None

        # Try direct first, fall back to Google
        print(f"[{name}] Trying direct favicon from {domain}...")
        data = try_direct_favicon(domain)
        if data:
            print(f"  -> got {len(data)} bytes direct")
        else:
            print(f"[{name}] Falling back to Google favicon service...")
            data = download_via_google(domain)
            print(f"  -> got {len(data)} bytes via Google")

        with open(out_path, "wb") as f:
            f.write(data)
        print(f"  -> saved {out_path}")


if __name__ == "__main__":
    main()
