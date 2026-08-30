from playwright.sync_api import sync_playwright
from pathlib import Path

SCREENS = ["tune", "recording", "system"]
OUT_W, OUT_H = 560, 960
SCRIPT_DIR = Path(__file__).parent

TEMPLATE = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{
    width: {w}px;
    height: {h}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0a0a0a;
    overflow: hidden;
  }}
  .device-frame {{
    border-radius: 20px;
    overflow: hidden;
    box-shadow:
      0 40px 80px -20px rgba(0,0,0,0.5),
      0 16px 32px -8px rgba(0,0,0,0.3),
      0 4px 8px rgba(0,0,0,0.15);
  }}
  .device-frame img {{
    display: block;
    height: {img_h}px;
    width: auto;
  }}
</style>
</head>
<body>
  <div class="device-frame">
    <img src="{img}" alt="">
  </div>
</body>
</html>"""

for name in SCREENS:
    html_path = SCRIPT_DIR / f"compose-{name}.html"
    html_path.write_text(TEMPLATE.format(
        w=OUT_W, h=OUT_H,
        img_h=int(OUT_H * 0.9),
        img=f"raw/{name}.png",
    ))

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": OUT_W, "height": OUT_H}, device_scale_factor=2)
    page = ctx.new_page()

    for name in SCREENS:
        html_file = SCRIPT_DIR / f"compose-{name}.html"
        page.goto(f"file://{html_file}", wait_until="networkidle")
        page.wait_for_timeout(200)
        page.screenshot(path=str(SCRIPT_DIR / f"{name}.png"))
        print(f"✓ {name}.png")

    browser.close()
    print("Done")
