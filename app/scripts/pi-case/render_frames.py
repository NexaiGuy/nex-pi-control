# Losse beelden van de draaiende Pi-behuizing voor het laadscherm van de Flex Window-widget (cover-scherm Flip).
# Zelfde model en camera als render.py (de sprite van PiCaseSpin), maar als aparte drawables: een widget kan geen
# sprite verschuiven, wel een AnimationDrawable afspelen (ProgressBar in RemoteViews).
#
# Gebruik (in scripts/pi-case, met three.min.js en logo-inlay.png ernaast):
#   python3 render_frames.py <maat in px> <aantal beelden> <doelmap>
#   python3 render_frames.py 216 24 ../../modules/widget-live/android/src/main/res/drawable-nodpi
import base64, io, math, os, sys
from playwright.sync_api import sync_playwright
from PIL import Image

S, N, OUT = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(OUT, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": S, "height": S})
    pg.goto(f"file://{HERE}/render.html?s={S * 2}")  # 2x supersampling, daarna verkleinen
    pg.wait_for_function("window.ready === true")
    logo = os.path.join(HERE, "logo-inlay.png")
    if os.path.exists(logo):
        url = "data:image/png;base64," + base64.b64encode(open(logo, "rb").read()).decode()
        pg.evaluate("(u) => window.setLogo(u)", url)
    for i in range(N):
        data = pg.evaluate(f"window.frame({-2 * math.pi * i / N})")
        img = Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1]))).convert("RGBA").resize((S, S), Image.LANCZOS)
        img.save(os.path.join(OUT, f"nex_cover_pi_{i:02d}.webp"), "WEBP", quality=86, method=6)
    b.close()
print(f"{N} beelden van {S} px in {OUT}")
