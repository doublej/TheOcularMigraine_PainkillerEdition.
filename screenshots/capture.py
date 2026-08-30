from playwright.sync_api import sync_playwright

PORT = 5175
W, H = 480, 860

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": W, "height": H}, device_scale_factor=2)
    page = ctx.new_page()
    page.goto(f"http://localhost:{PORT}", wait_until="networkidle")
    page.wait_for_timeout(500)

    page.screenshot(path="raw/tune.png")
    print("✓ tune.png")

    page.get_by_role("button", name="Record").click()
    page.wait_for_timeout(300)
    page.screenshot(path="raw/recording.png")
    print("✓ recording.png")

    page.get_by_role("button", name="System").click()
    page.wait_for_timeout(300)
    page.screenshot(path="raw/system.png")
    print("✓ system.png")

    browser.close()
    print("Done")
