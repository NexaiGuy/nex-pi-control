import base64, io, math, sys
from playwright.sync_api import sync_playwright
from PIL import Image
S, N = int(sys.argv[1]), int(sys.argv[2])
frames = []
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": S, "height": S})
    pg.goto(f"file://{sys.path[0]}/render.html?s={S*2}")  # 2x supersampling, daarna verkleinen
    pg.wait_for_function("window.ready === true")
    import os
    if os.path.exists("logo-inlay.png"):
        logo = "data:image/png;base64," + base64.b64encode(open("logo-inlay.png", "rb").read()).decode()
        pg.evaluate("(u) => window.setLogo(u)", logo)
    for i in range(N):
        url = pg.evaluate(f"window.frame({-2 * math.pi * i / N})")
        img = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGBA").resize((S, S), Image.LANCZOS)
        frames.append(img)
    b.close()
cols = 12
rows = math.ceil(N / cols)
sheet = Image.new("RGBA", (cols * S, rows * S), (0, 0, 0, 0))
for i, f in enumerate(frames):
    sheet.paste(f, ((i % cols) * S, (i // cols) * S))
sheet.save("pi-case-spin.webp", "WEBP", quality=82, method=6)
frames[0].save("frame0.png"); frames[N // 8].save("frame1.png")
print(sheet.size)
