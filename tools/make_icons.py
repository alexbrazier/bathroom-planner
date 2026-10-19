#!/usr/bin/env python3
"""Generate favicons, app icons and the header logo from design/icon-source.png.

The source artwork is a rounded square on a white background. This cuts the rounded square out
(transparent corners) for favicons / the logo, and fills the corners with the background teal for the
Apple touch icon (iOS applies its own rounding).

Usage: python3 tools/make_icons.py [source.png] [out_dir]
"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
src = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'design' / 'icon-source.png'
out = Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'assets'
out.mkdir(parents=True, exist_ok=True)

img = Image.open(src).convert('RGB')
W, H = img.size
px = img.load()
is_bg = lambda p: min(p) > 235  # near-white background

# bounding box of the artwork
xs = [x for x in range(W) if any(not is_bg(px[x, y]) for y in range(0, H, 4))]
ys = [y for y in range(H) if any(not is_bg(px[x, y]) for x in range(0, W, 4))]
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
side = max(x1 - x0, y1 - y0) + 1
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
box = (cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)
art = img.crop(box)
S = art.size[0]
apx = art.load()

# corner radius: walk the diagonal from the top-left corner until we hit the artwork
d = next(i for i in range(S // 2) if not is_bg(apx[i, i]))
radius = int(round(d / (1 - 2 ** -0.5)))
radius = max(8, min(radius, S // 2))

# background teal, sampled just inside the left edge
teal = apx[int(S * 0.04), S // 2]

# anti-aliased rounded-rect mask (4× supersampled), inset 1px to drop the white fringe
k = 4
mask = Image.new('L', (S * k, S * k), 0)
ImageDraw.Draw(mask).rounded_rectangle((k, k, S * k - k, S * k - k), radius=radius * k, fill=255)
mask = mask.resize((S, S), Image.LANCZOS)
cut = art.convert('RGBA')
cut.putalpha(mask)

def save(im, name, size):
    im.resize((size, size), Image.LANCZOS).save(out / name, optimize=True)

# transparent-corner versions
for name, size in [('favicon-32.png', 32), ('favicon-48.png', 48), ('icon-192.png', 192), ('icon-512.png', 512), ('logo-64.png', 64)]:
    save(cut, name, size)
cut.resize((48, 48), Image.LANCZOS).save(out / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])

# full-bleed Apple touch icon: corners filled with the background colour
full = Image.new('RGB', (S, S), teal)
full.paste(art, (0, 0), mask)
save(full, 'apple-touch-icon.png', 180)

print(f'artwork {S}px, corner radius {radius}px, teal #{teal[0]:02x}{teal[1]:02x}{teal[2]:02x} → {out}')
