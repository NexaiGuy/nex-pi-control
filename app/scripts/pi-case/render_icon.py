# Eén stilstaand beeld van de behuizing met logo, groot, voor het app-icoon.
import base64, io, sys
from playwright.sync_api import sync_playwright
from PIL import Image
OUT, S, ANGLE, ELEV, DIST = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4]), float(sys.argv[5])
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 400, "height": 400})
    pg.goto(f"file://{sys.path[0]}/render.html?s={S*2}")
    pg.wait_for_function("window.ready === true")
    pg.evaluate("(u) => window.setLogo(u)", "data:image/png;base64," + base64.b64encode(open("logo-inlay.png", "rb").read()).decode())
    pg.evaluate(f"window.setView({ELEV}, {DIST})")
    url = pg.evaluate(f"window.frame({ANGLE})")
    Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGBA").resize((S, S), Image.LANCZOS).save(OUT)
    b.close()
print(OUT)
