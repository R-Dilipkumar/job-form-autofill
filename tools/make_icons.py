"""Draws the extension icons (a form card with a tick) at 16, 32, 48 and 128 px.

Run: python -I tools/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "icons"
GREEN = (22, 101, 52, 255)
PAPER = (255, 255, 255, 255)
LINE = (187, 205, 193, 255)
TICK = (34, 197, 94, 255)


def draw(size: int) -> Image.Image:
    scale = 8  # draw big, shrink for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=GREEN)

    # paper card
    pad = s * 0.2
    d.rounded_rectangle([pad, pad * 0.9, s - pad, s - pad * 0.9], radius=int(s * 0.06), fill=PAPER)

    # form lines (skip on the tiny icon, they turn to mush)
    if size >= 32:
        for i, y in enumerate((0.36, 0.5)):
            x2 = s * (0.72 if i == 0 else 0.62)
            d.rounded_rectangle([s * 0.3, s * y, x2, s * y + s * 0.055], radius=int(s * 0.02), fill=LINE)

    # tick in the lower right
    w = int(s * (0.09 if size >= 32 else 0.12))
    pts = [(s * 0.42, s * 0.67), (s * 0.52, s * 0.77), (s * 0.72, s * 0.56)]
    d.line(pts, fill=TICK, width=w, joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=TICK)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        path = OUT / f"icon{size}.png"
        draw(size).save(path)
        print(path, Image.open(path).size)


if __name__ == "__main__":
    main()
