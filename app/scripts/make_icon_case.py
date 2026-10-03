#!/usr/bin/env python3
"""App-icoon: de Raspberry Pi-behuizing (3D, met het Odyssey-logo op het deksel) op de Odyssey-ruimteachtergrond.

Invoer:  scripts/pi-case/case-icon.png (1024 px, transparant, gemaakt met scripts/pi-case/render_icon.py)
Uitvoer: assets/icon.png, assets/android-icon-{foreground,background,monochrome}.png, assets/favicon.png
Het splash-scherm houdt de neon-chip (scripts/make_icon_odyssey.py).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

import make_icon_odyssey as ody

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets"
CASE = Image.open(HERE / "pi-case" / "case-icon.png").convert("RGBA")


def fit(img: Image.Image, size: int, fraction: float) -> Image.Image:
    """Behuizing bijgesneden en gecentreerd op `fraction` van de breedte (optisch iets hoger)."""
    box = img.getbbox()
    crop = img.crop(box)
    w = int(size * fraction)
    h = int(crop.height * w / crop.width)
    crop = crop.resize((w, h), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(crop, ((size - w) // 2, (size - h) // 2 - int(size * 0.01)))
    return out


def glow(layer: Image.Image, size: int) -> Image.Image:
    """Zachte spectrale gloed onder de behuizing: paars links, cyaan rechts."""
    a = np.asarray(layer.getchannel("A"), dtype=np.float32) / 255
    xs = np.linspace(0, 1, size)[None, :, None]
    purple, cyan = np.array([139, 92, 246]), np.array([34, 211, 238])
    rgb = purple * (1 - xs) + cyan * xs
    out = np.zeros((size, size, 4), dtype=np.float32)
    out[..., :3] = rgb
    out[..., 3] = a * 255 * 0.55
    g = Image.fromarray(out.astype(np.uint8), "RGBA").filter(ImageFilter.GaussianBlur(size * 0.045))
    return ody.shift(g, 0, int(size * 0.025))


def compose(size: int, fraction: float, with_bg: bool) -> Image.Image:
    case = fit(CASE, size, fraction)
    img = ody.background(size) if with_bg else Image.new("RGBA", (size, size), (0, 0, 0, 0))
    img.alpha_composite(glow(case, size))
    img.alpha_composite(case)
    return img


def monochrome(size: int, fraction: float) -> Image.Image:
    """Witte silhouet voor Android-themaiconen; donkere delen (inlegplaat, sleuven) uitgespaard, de chip blijft."""
    case = np.asarray(fit(CASE, size, fraction), dtype=np.float32)
    lum = (0.2126 * case[..., 0] + 0.7152 * case[..., 1] + 0.0722 * case[..., 2]) / 255
    alpha = case[..., 3] * np.clip((lum - 0.18) / 0.12, 0, 1)
    out = np.zeros_like(case)
    out[..., :3] = 255
    out[..., 3] = alpha
    return Image.fromarray(out.astype(np.uint8), "RGBA")


def main() -> None:
    compose(1024, 0.84, True).convert("RGB").save(ASSETS / "icon.png", optimize=True)
    compose(1024, 0.62, False).save(ASSETS / "android-icon-foreground.png", optimize=True)
    ody.background(1024).convert("RGB").save(ASSETS / "android-icon-background.png", optimize=True)
    monochrome(1024, 0.62).save(ASSETS / "android-icon-monochrome.png", optimize=True)
    compose(256, 0.86, True).resize((64, 64), Image.LANCZOS).convert("RGB").save(ASSETS / "favicon.png", optimize=True)
    print("Iconen met de Pi-behuizing bijgewerkt in", ASSETS)


if __name__ == "__main__":
    main()
