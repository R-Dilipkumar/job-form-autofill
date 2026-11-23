"""Builds the Chrome Web Store images from the end-to-end test screenshots.

1. node tests/e2e.js with SHOTS_DIR=<repo>/tests/shots   (makes popup.png, options.png, filled-form.png)
2. python -I tools/make_store_images.py                  (writes store/*.png)
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "tests" / "shots"
OUT = ROOT / "store"
GREEN = (22, 101, 52)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "segoeuib.ttf" if bold else "segoeui.ttf"
    try:
        return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)
    except OSError as err:
        raise SystemExit(f"Font {name} not found ({err}); install Segoe UI or change the font name.")


def with_shadow(canvas: Image.Image, img: Image.Image, xy: tuple[int, int]) -> None:
    shadow = Image.new("RGBA", (img.width + 40, img.height + 40), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([20, 24, img.width + 20, img.height + 24], radius=12, fill=(0, 0, 0, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    canvas.alpha_composite(shadow, (xy[0] - 20, xy[1] - 20))
    canvas.alpha_composite(img.convert("RGBA"), xy)


def screenshot_fill() -> Image.Image:
    form = Image.open(SHOTS / "filled-form.png").convert("RGBA")
    popup = Image.open(SHOTS / "popup.png").convert("RGBA").crop((0, 0, 380, 340))
    canvas = form.copy()
    with_shadow(canvas, popup, (canvas.width - popup.width - 40, 24))
    return canvas


def screenshot_options() -> Image.Image:
    return Image.open(SHOTS / "options.png").convert("RGBA")


def promo_tile() -> Image.Image:
    tile = Image.new("RGBA", (440, 280), GREEN + (255,))
    icon = Image.open(ROOT / "icons" / "icon128.png").convert("RGBA").resize((96, 96), Image.LANCZOS)
    tile.alpha_composite(icon, (32, 40))
    d = ImageDraw.Draw(tile)
    d.text((32, 156), "Job Form Autofill", font=font(34, bold=True), fill="white")
    d.text((32, 204), "Fill once. Reuse on every application.", font=font(18), fill=(220, 252, 231))
    d.text((32, 230), "Saved only on your computer.", font=font(18), fill=(220, 252, 231))
    return tile


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for name, img in (
        ("screenshot-1-fill.png", screenshot_fill()),
        ("screenshot-2-answers.png", screenshot_options()),
        ("promo-small-440x280.png", promo_tile()),
    ):
        path = OUT / name
        img.convert("RGB").save(path)
        print(path, Image.open(path).size)


if __name__ == "__main__":
    main()
