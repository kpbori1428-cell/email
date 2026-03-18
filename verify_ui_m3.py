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
            time.sleep(1)

            # Fill login
            page.fill("input#login-email", "test@test.com")
            page.fill("input#login-password", "password")
            page.click("#btn-login-submit")
            time.sleep(3)

            # Wait to ensure emails have finished loading
            page.screenshot(path="email_list_m3.png")
            print("Screenshot saved to email_list_m3.png")

        except Exception as e:
            print(f"Error occurred: {e}")
        finally:
            server.terminate()
            browser.close()

verify()
