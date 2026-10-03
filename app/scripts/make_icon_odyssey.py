#!/usr/bin/env python3
"""Maakt de app-iconen van Nex Pi Control in de Odyssey-stijl (cyberpunk, Kubrick).

Zelfde chip als het klassieke logo (scripts/make_icon.py), maar:
- diepe ruimte als achtergrond met een zwakke perspectiefgang naar het midden en scanlijnen;
- de behuizing en pinnen in een spectrale gradiënt (paars, magenta, cyaan, mint) met neongloed;
- chromatische aberratie: een rood en cyaan randje, licht verschoven;
- een paar subtiele glitch-sneden door de chip;
- de kern is het rode oog, de H klinisch wit.

Gebruik:  python3 scripts/make_icon_odyssey.py   (vanuit app/, vereist cairosvg, Pillow en numpy)
Uitvoer:  assets/icon.png, assets/android-icon-{foreground,background,monochrome}.png, assets/splash-icon.png, assets/favicon.png
Terug naar het klassieke logo:  python3 scripts/make_icon.py
"""
import io
from pathlib import Path

import cairosvg
import numpy as np
from PIL import Image, ImageChops, ImageFilter

ASSETS = Path(__file__).resolve().parent.parent / "assets"

SPACE_0 = "#050508"
SPACE_1 = "#12121C"
INK = "#F2F2F0"
SPECTRAL = ("#8B5CF6", "#F472B6", "#22D3EE", "#34F5C5")
AB_RED = (255, 42, 31)
AB_CYAN = (34, 211, 238)
EYE = "#FF2A1F"
EYE_HOT = "#FFD9D2"


# ---------- SVG ----------------------------------------------------------------------------------

def defs() -> str:
    s = SPECTRAL
    return (
        "<defs>"
        '<linearGradient id="sp" gradientUnits="userSpaceOnUse" x1="6" y1="4" x2="58" y2="60">'
        f'<stop offset="0" stop-color="{s[0]}"/><stop offset="0.38" stop-color="{s[1]}"/>'
        f'<stop offset="0.7" stop-color="{s[2]}"/><stop offset="1" stop-color="{s[3]}"/>'
        "</linearGradient>"
        '<radialGradient id="eye" cx="32" cy="32" r="5.6" gradientUnits="userSpaceOnUse">'
        f'<stop offset="0" stop-color="{EYE_HOT}"/><stop offset="0.35" stop-color="{EYE}"/>'
        f'<stop offset="0.8" stop-color="{EYE}" stop-opacity="0.85"/><stop offset="1" stop-color="{EYE}" stop-opacity="0"/>'
        "</radialGradient>"
        "</defs>"
    )


def chip(stroke: str, h: str | None, core: str | None, width: float = 3.4) -> str:
    """De chip in een 64x64-ruimte: behuizing, 12 pinnen, de H en de kern. `None` laat een deel weg."""
    pins = []
    for p in (20.25, 30.25, 40.25):
        pins += [
            f'<rect x="{p}" y="3" width="3.5" height="7" rx="1.75" fill="{stroke}"/>',
            f'<rect x="{p}" y="54" width="3.5" height="7" rx="1.75" fill="{stroke}"/>',
            f'<rect x="3" y="{p}" width="7" height="3.5" rx="1.75" fill="{stroke}"/>',
            f'<rect x="54" y="{p}" width="7" height="3.5" rx="1.75" fill="{stroke}"/>',
        ]
    out = f'<rect x="12" y="12" width="40" height="40" rx="10" fill="none" stroke="{stroke}" stroke-width="{width}"/>' + "".join(pins)
    if h:
        out += (
            f'<rect x="21.5" y="21" width="4.5" height="22" rx="2.25" fill="{h}"/>'
            f'<rect x="38" y="21" width="4.5" height="22" rx="2.25" fill="{h}"/>'
            f'<rect x="26" y="31" width="12" height="2" fill="{h}"/>'
        )
    if core:
        out += f'<circle cx="32" cy="32" r="5.6" fill="{core}"/>'
    return out


def svg(content: str, fraction: float) -> str:
    """Canvas van 128 eenheden; de chip (pinnen 3 tot 61) beslaat `fraction` van de breedte, gecentreerd."""
    scale = 128 * fraction / 58
    tx = 64 - 32 * scale
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
        + defs()
        + f'<g transform="translate({tx} {tx}) scale({scale})">{content}</g></svg>'
    )


def render(svg_text: str, size: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg_text.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


# ---------- Compositing --------------------------------------------------------------------------

def tint(img: Image.Image, rgb: tuple[int, int, int], alpha: float) -> Image.Image:
    """Zelfde vorm, één kleur, met een gegeven dekking."""
    a = np.asarray(img.getchannel("A"), dtype=np.float32) * alpha
    out = np.zeros((img.height, img.width, 4), dtype=np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = rgb
    out[..., 3] = np.clip(a, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def fade(img: Image.Image, alpha: float) -> Image.Image:
    arr = np.asarray(img, dtype=np.float32).copy()
    arr[..., 3] *= alpha
    return Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGBA")


def shift(img: Image.Image, dx: int, dy: int = 0) -> Image.Image:
    return ImageChops.offset(img, dx, dy)


def glitch(img: Image.Image, size: int) -> Image.Image:
    """Twee dunne horizontale sneden die een paar pixels verschuiven. Subtiel, geen ruis."""
    out = img.copy()
    for y0, h, dx in ((0.395, 0.022, 0.014), (0.6, 0.014, -0.01)):
        top, bot, d = int(size * y0), int(size * (y0 + h)), int(size * dx)
        band = img.crop((0, top, size, bot))
        out.paste((0, 0, 0, 0), (0, top, size, bot))
        out.alpha_composite(shift(band, d), (0, top))
    return out


def background(size: int) -> Image.Image:
    """Diepe ruimte: radiale fade, perspectiefgang naar het midden en scanlijnen."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    r = np.sqrt((xx - size / 2) ** 2 + (yy - size / 2) ** 2) / (size * 0.72)
    c0 = np.array([int(SPACE_1[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)
    c1 = np.array([int(SPACE_0[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)
    t = np.clip(r, 0, 1)[..., None]
    rgb = c0 * (1 - t) + c1 * t
    # Scanlijnen: elke 4 px een iets lichtere lijn.
    rgb[(yy.astype(int) % max(2, size // 256)) == 0] += 2.2
    img = Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    lines = []
    for x, y in ((0, 0), (128, 0), (0, 128), (128, 128), (28, 128), (100, 128), (28, 0), (100, 0), (0, 40), (128, 40), (0, 88), (128, 88)):
        lines.append(f'<line x1="{x}" y1="{y}" x2="64" y2="64" stroke="{INK}" stroke-opacity="0.07" stroke-width="0.35"/>')
    corridor = render('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' + "".join(lines) + "</svg>", size)
    img.alpha_composite(corridor)
    return img


def neon_chip(size: int, fraction: float, *, with_glitch: bool = True) -> Image.Image:
    """De chip met gloed, aberratie, glitch en het rode oog, op transparant."""
    body = render(svg(chip("url(#sp)", None, None), fraction), size)
    full = render(svg(chip("url(#sp)", INK, "url(#eye)"), fraction), size)
    eye = render(svg(f'<circle cx="32" cy="32" r="6" fill="{EYE}"/>', fraction), size)

    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Neongloed: twee vervaagde kopieën van de behuizing.
    for radius, alpha in ((size * 0.045, 0.55), (size * 0.016, 0.8)):
        layer.alpha_composite(fade(body.filter(ImageFilter.GaussianBlur(radius)), alpha))
    # Gloed van het oog.
    layer.alpha_composite(fade(eye.filter(ImageFilter.GaussianBlur(size * 0.03)), 0.9))
    # Chromatische aberratie: rood naar links, cyaan naar rechts, achter de chip.
    off = max(1, round(size * 0.0055))
    layer.alpha_composite(shift(tint(full, AB_RED, 0.55), -off, 0))
    layer.alpha_composite(shift(tint(full, AB_CYAN, 0.55), off, 0))
    layer.alpha_composite(full)
    return glitch(layer, size) if with_glitch else layer


# ---------- Uitvoer ------------------------------------------------------------------------------

def main() -> None:
    full = 87 / 128  # zelfde verhouding als het klassieke icoon

    # 1. Hoofdicoon: vierkant, volledig gevuld (Android, iOS en Play ronden zelf af).
    icon = background(1024)
    icon.alpha_composite(neon_chip(1024, full))
    icon.convert("RGB").save(ASSETS / "icon.png", optimize=True)

    # 2. Android adaptive icon: chip binnen de veilige zone, ruimte als achtergrond, monochroom voor themed icons.
    neon_chip(1024, 0.56).save(ASSETS / "android-icon-foreground.png", optimize=True)
    background(1024).convert("RGB").save(ASSETS / "android-icon-background.png", optimize=True)
    mono = render(svg(chip("#FFFFFF", "#FFFFFF", None), 0.56), 1024)
    mono.save(ASSETS / "android-icon-monochrome.png", optimize=True)

    # 3. Splash: chip op transparant (de splash-achtergrond is de ruimte zelf).
    neon_chip(512, full).save(ASSETS / "splash-icon.png", optimize=True)

    # 4. Favicon: klein, dus zonder glitch.
    fav = background(256)
    fav.alpha_composite(neon_chip(256, full, with_glitch=False))
    fav.resize((64, 64), Image.LANCZOS).convert("RGB").save(ASSETS / "favicon.png", optimize=True)
    print("Odyssey-iconen bijgewerkt in", ASSETS)


if __name__ == "__main__":
    main()
