# Achtergrondvideo voor het klokscherm van de Flex Window (cover-scherm Galaxy Z Flip 5, 748 x 720 px):
# 3 s het Nex AI-logo met een korte glitch, daarna de draaiende Pi-behuizing. 15 s, zodat Samsung hem aanvaardt.
# De klok, datum, meldingen en de camera-knop tekent Samsung erover: het midden blijft vrij voor logo en behuizing.
#
# Gebruik:
#   python3 render_frames.py 420 120 /tmp/pi           (120 beelden van de behuizing, 3 graden per stap)
#   python3 make_cover_video.py <logo.png> /tmp/pi <fonts-dir> <uit.mp4>
import math, subprocess, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

LOGO, PIDIR, FONTS, OUT = sys.argv[1:5]
W, H, FPS, SECONDS = 748, 720, 30, 15
CX, CY = W // 2, 330            # iets boven het midden: onderaan staan Samsungs meldingen en camera-knop
LOGO_PX = 360
PI_PX = 420
FRAMES = 120
TURN_S = 4.0                    # één volledige draai
MAGENTA, CYAN, MINT, MUTED = (244, 114, 182), (34, 211, 238), (52, 245, 197), (138, 138, 148)

def ease_out(t): return 1 - (1 - t) ** 3
def clamp(v, a=0.0, b=1.0): return max(a, min(b, v))
def ramp(t, a, b): return clamp((t - a) / (b - a)) if b > a else float(t >= b)

# achtergrond: Odyssey Deep Space, met een zachte paarse gloed achter het midden
bg = Image.new('RGB', (W, H))
d = ImageDraw.Draw(bg)
for y in range(H):
    k = y / (H - 1)
    d.line([(0, y), (W, y)], fill=(round(5 + 6 * k), round(5 + 6 * k), round(8 + 10 * k)))
glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((CX - 230, CY - 200, CX + 230, CY + 200), fill=(139, 92, 246, 46))
bg = Image.alpha_composite(bg.convert('RGBA'), glow.filter(ImageFilter.GaussianBlur(70)))

logo = Image.open(LOGO).convert('RGBA').resize((LOGO_PX, LOGO_PX), Image.LANCZOS)
def tinted(col):
    t = Image.new('RGBA', logo.size, col + (255,))
    t.putalpha(logo.getchannel('A'))
    return t
ghost_m, ghost_c = tinted(MAGENTA), tinted(CYAN)
pis = [Image.open(f'{PIDIR}/nex_cover_pi_{i:02d}.webp').convert('RGBA').resize((PI_PX, PI_PX), Image.LANCZOS) for i in range(FRAMES)]
shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(shadow).ellipse((CX - 150, CY + 120, CX + 150, CY + 160), fill=(0, 0, 0, 150))
shadow = shadow.filter(ImageFilter.GaussianBlur(14))
font = ImageFont.truetype(f'{FONTS}/JetBrainsMono_300Light.ttf', 20)
caption = 'N E X   P I   C O N T R O L'

def jolt(t, start):
    seq = [(0.04, -6), (0.04, 5), (0.04, -3), (0.06, 0)]
    if t < start: return 0.0, 0.0
    acc = start
    for i, (dur, val) in enumerate(seq):
        if t < acc + dur:
            ghost = [0.55, 0.25, 0.1, 0.0][i]
            return float(val), ghost
        acc += dur
    return 0.0, 0.0

def paste_center(dst, img, cx, cy, scale=1.0, alpha=1.0, dx=0.0):
    if alpha <= 0: return
    if scale != 1.0:
        s = max(1, round(img.width * scale))
        img = img.resize((s, s), Image.LANCZOS)
    if alpha < 1:
        img = img.copy(); img.putalpha(img.getchannel('A').point(lambda a: round(a * alpha)))
    dst.alpha_composite(img, (round(cx - img.width / 2 + dx), round(cy - img.height / 2)))

ff = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                       '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', OUT], stdin=subprocess.PIPE)
for n in range(FPS * SECONDS):
    t = n / FPS
    f = bg.copy()
    # 1. het logo (0 tot 2,9 s)
    if t < 2.9:
        op = ease_out(ramp(t, 0, 0.38)) * (1 - ramp(t, 2.58, 2.88))
        sc = 0.94 + 0.06 * ease_out(ramp(t, 0, 0.52)) + 0.03 * ramp(t, 2.57, 2.87)
        j1, g1 = jolt(t, 0.95)
        j2, g2 = jolt(t, 1.85)
        dx, gh = j1 + j2, max(g1, g2)
        if gh > 0:
            paste_center(f, ghost_m, CX, CY, sc, gh * op, dx - 5)
            paste_center(f, ghost_c, CX, CY, sc, gh * op, dx + 5)
        paste_center(f, logo, CX, CY, sc, op, dx)
        p = ramp(t, 0.42, 1.72)
        if 0 < p < 1:
            y = CY - LOGO_PX / 2 + p * LOGO_PX
            line = Image.new('RGBA', (W, H), (0, 0, 0, 0))
            ImageDraw.Draw(line).line([(CX - LOGO_PX * 0.56, y), (CX + LOGO_PX * 0.56, y)], fill=MINT + (round(140 * op),), width=2)
            f.alpha_composite(line)
    # 2. de draaiende behuizing (vanaf 2,9 s)
    if t >= 2.9:
        op = ease_out(ramp(t, 2.9, 3.3))
        sc = 0.96 + 0.04 * ease_out(ramp(t, 2.9, 3.4))
        idx = int(((t - 2.9) / TURN_S) * FRAMES) % FRAMES
        sh = shadow.copy(); sh.putalpha(sh.getchannel('A').point(lambda a: round(a * op)))
        f.alpha_composite(sh)
        paste_center(f, pis[idx], CX, CY, sc, op)
        cap = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        cd = ImageDraw.Draw(cap)
        tw = cd.textlength(caption, font=font)
        cd.text((CX - tw / 2, CY + PI_PX / 2 + 4), caption, font=font, fill=MUTED + (round(255 * op),))
        f.alpha_composite(cap)
    ff.stdin.write(f.convert('RGB').tobytes())
    if n == 45: f.convert('RGB').save(OUT.replace('.mp4', '-logo.png'))
    if n == 6 * FPS: f.convert('RGB').save(OUT.replace('.mp4', '-still.png'))
ff.stdin.close()
ff.wait()
print(OUT)
