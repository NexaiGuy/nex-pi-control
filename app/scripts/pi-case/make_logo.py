# Inleg voor op het deksel: zwart afgeronde plaat met het bestaande Odyssey-logo (neon chip + rood oog).
import sys
sys.path.insert(0, "/home/claude/w/app/scripts")
from PIL import Image, ImageDraw, ImageFilter
import make_icon_odyssey as m

S = 1024
plate = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(plate)
pad, r = 40, 190
d.rounded_rectangle((pad, pad, S - pad, S - pad), radius=r, fill=(7, 7, 12, 255))
# dunne spectrale rand: paars naar mint
edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(edge).rounded_rectangle((pad, pad, S - pad, S - pad), radius=r, outline=(139, 92, 246, 200), width=10)
plate.alpha_composite(edge)
chip = m.neon_chip(S, 0.66, with_glitch=False)
plate.alpha_composite(chip)
# alles buiten de plaat weer transparant (gloed mag niet over het witte deksel lopen)
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((pad, pad, S - pad, S - pad), radius=r, fill=255)
plate.putalpha(Image.fromarray(__import__("numpy").minimum(__import__("numpy").asarray(plate.getchannel("A")), __import__("numpy").asarray(mask))))
plate.save("logo-inlay.png")
print("ok")
