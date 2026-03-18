from playwright.sync_api import sync_playwright
import time
import subprocess

def verify():
    # Start server in the background
    server = subprocess.Popen(["node", "index.js"])
    time.sleep(2)  # Wait for server to start

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        try:
            page.goto("http://localhost:3000")
            time.sleep(2)

            # Screenshot of the new login screen
            page.screenshot(path="login_new_ui.png")
            print("Screenshot saved to login_new_ui.png")

            # Fill login
            page.fill("input#login-email", "test@test.com")
            page.fill("input#login-password", "password")
            page.click("#btn-login-submit")
            time.sleep(3)

            # Hover over compose button to see the new shadow effect
            page.locator("#btn-compose-nav").hover()
            time.sleep(1)

            # Screenshot of the main UI
            page.screenshot(path="main_new_ui.png")
            print("Screenshot saved to main_new_ui.png")

        finally:
            server.terminate()
            browser.close()

verify()
