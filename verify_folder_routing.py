from playwright.sync_api import sync_playwright
import time
import subprocess

def verify():
    server = subprocess.Popen(["node", "index.js"])
    time.sleep(2)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 800})
        page = context.new_page()

        try:
            page.goto("http://localhost:3000")
            time.sleep(2)

            print("Filling login form...")
            page.fill("#login-email", "test@test.com")
            page.fill("#login-password", "password")
            page.click("#btn-login-submit")
            time.sleep(3)

            print("Trying to click a folder...")
            # Use specific locator for the "folder-item" that contains "Enviados"
            page.locator(".folder-item", has_text="Enviados").click()
            time.sleep(3)

            errors = page.locator(".status-message.error").all_inner_texts()
            print("Errors found:", errors)

            page.screenshot(path="folder_test_fixed.png")
            print("Screenshot saved to folder_test_fixed.png")

        except Exception as e:
            print(f"Error occurred: {e}")
            page.screenshot(path="error.png")
        finally:
            server.terminate()
            browser.close()

verify()
