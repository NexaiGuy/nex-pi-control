#!/usr/bin/env python3
"""Maakt alle app-iconen van Nex Pi Control uit het chiplogo (HAL-9000-logo, VOD DEV-kleuren: cyaan en magenta), op wit.

Bron: HAL-9000-logo/svg/hal9000-icon-vod.svg. De vormen staan hieronder als SVG, zodat dit script op zichzelf werkt.

Gebruik:  python3 scripts/make_icon.py        (vanuit app/, vereist cairosvg en Pillow)
Uitvoer:  assets/icon.png, assets/android-icon-{foreground,background,monochrome}.png, assets/splash-icon.png, assets/favicon.png
"""
import io
from pathlib import Path

import cairosvg
from PIL import Image

ASSETS = Path(__file__).resolve().parent.parent / "assets"

# Witte achtergrond. Omdat de H in het origineel wit is, wordt die hier donker; cyaan en magenta een tikje dieper
# zodat ze scherp blijven op wit.
BG = "#FFFFFF"
CYAN = "#06B6D4"
MAGENTA = "#EC4899"
WHITE = "#0B0B12"  # kleur van de H
SPLASH_COLORS = ("#22D3EE", "#F2F1F8", "#F472B6")  # origineel, op de donkere splash


def chip(stroke: str, h: str, core: str) -> str:
    """De chip in een 64x64-ruimte: behuizing, 12 pinnen, de H en de kern."""
    pins = []
    for p in (20.25, 30.25, 40.25):
        pins += [
            f'<rect x="{p}" y="3" width="3.5" height="7" rx="1.75" fill="{stroke}"/>',
            f'<rect x="{p}" y="54" width="3.5" height="7" rx="1.75" fill="{stroke}"/>',
            f'<rect x="3" y="{p}" width="7" height="3.5" rx="1.75" fill="{stroke}"/>',
            f'<rect x="54" y="{p}" width="7" height="3.5" rx="1.75" fill="{stroke}"/>',
        ]
    return (
        f'<rect x="12" y="12" width="40" height="40" rx="10" fill="none" stroke="{stroke}" stroke-width="4"/>'
        + "".join(pins)
        + f'<rect x="21" y="21" width="5.5" height="22" rx="2.75" fill="{h}"/>'
        + f'<rect x="37.5" y="21" width="5.5" height="22" rx="2.75" fill="{h}"/>'
        + f'<rect x="26" y="30.5" width="12" height="3" fill="{h}"/>'
        + f'<circle cx="32" cy="32" r="4.6" fill="{core}"/>'
    )


def svg(content_fraction: float, *, bg: str | None, radius: float = 0, colors=(CYAN, WHITE, MAGENTA)) -> str:
    """Canvas van 128 eenheden. De chip (pinnen van 3 tot 61) beslaat `content_fraction` van de breedte, gecentreerd."""
    scale = 128 * content_fraction / 58
    tx = 64 - 32 * scale
    back = f'<rect width="128" height="128" rx="{radius}" fill="{bg}"/>' if bg else ""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">'
        + back
        + f'<g transform="translate({tx} {tx}) scale({scale})">{chip(*colors)}</g></svg>'
    )


def render(svg_text: str, size: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg_text.encode(), output_width=size, output_height=size)
    return Image.open(io.BytesIO(png)).convert("RGBA")


def main() -> None:
    # Verhouding van het origineel: pinnen van 20,5 tot 107,5 op 128 = 68 procent.
    full = 87 / 128

    # 1. Hoofdicoon: vierkant zonder afgeronde hoeken (Android, iOS en Play ronden zelf af).
    render(svg(full, bg=BG), 1024).convert("RGB").save(ASSETS / "icon.png", optimize=True)

    # 2. Android adaptive icon: chip binnen de veilige zone, donkere achtergrond, monochroom voor themed icons.
    render(svg(0.56, bg=None), 1024).save(ASSETS / "android-icon-foreground.png", optimize=True)
    Image.new("RGBA", (1024, 1024), BG).save(ASSETS / "android-icon-background.png", optimize=True)
    mono = render(svg(0.56, bg=None, colors=("#FFFFFF", "#FFFFFF", "#000000")), 1024)
    # Kern weglaten in de monochrome versie: zwart wordt transparant.
    px = mono.load()
    for y in range(mono.height):
        for x in range(mono.width):
            r, g, b, a = px[x, y]
            if a and r < 128:
                px[x, y] = (255, 255, 255, 0)
    mono.save(ASSETS / "android-icon-monochrome.png", optimize=True)

    # 3. Splash: chip op transparant (de splash-achtergrond is al donker).
    render(svg(full, bg=None, colors=SPLASH_COLORS), 512).save(ASSETS / "splash-icon.png", optimize=True)

    # 4. Favicon: met de afgeronde donkere tegel van het origineel.
    render(svg(full, bg=BG, radius=28), 64).save(ASSETS / "favicon.png", optimize=True)
    print("Iconen bijgewerkt in", ASSETS)


if __name__ == "__main__":
    main()
