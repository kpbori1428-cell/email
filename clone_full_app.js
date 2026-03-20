const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  const publicDir = path.join(__dirname, 'public');

  // Interceptar TODAS las respuestas de red
  // Guardaremos en disco cualquier cosa que venga de spaceship-cdn.com
  page.on('response', async response => {
      try {
          const url = response.url();
          if (url.includes('spaceship-cdn.com') && response.request().resourceType() !== 'fetch' && response.request().resourceType() !== 'xhr' && response.status() === 200) {
              const parsedUrl = new URL(url);
              // Ruta local en la carpeta public, por ejemplo: /webmail-ui/1.53.0/css/app.css
              const localFilePath = path.join(publicDir, parsedUrl.pathname);

              // Asegurarse de que el directorio existe
              fs.mkdirSync(path.dirname(localFilePath), { recursive: true });

              // Guardar el buffer (binario o texto)
              const buffer = await response.body();
              fs.writeFileSync(localFilePath, buffer);
              console.log(`[CDN Cloned] ${parsedUrl.pathname}`);
          }
      } catch (err) {
          // Ignorar errores esporádicos en respuestas como CORS o body no disponible
      }
  });

  console.log("Navegando a la página de login...");
  await page.goto('https://www.spacemail.com/login', { waitUntil: 'networkidle' });

  try {
    const email = process.env.EMAIL_USER;
    const password = process.env.EMAIL_PASSWORD;

    if (!email || !password) {
        throw new Error("No se encontraron credenciales en process.env.EMAIL_USER o process.env.EMAIL_PASSWORD");
    }

    const usernameSelector = 'input[type="text"], input[name="username"], input[name="email"]';
    await page.waitForSelector(usernameSelector, { timeout: 10000 });
    const passwordSelector = 'input[type="password"]';

    await page.fill(usernameSelector, email);
    await page.fill(passwordSelector, password);

    const btnSelector = 'button[type="submit"], button:has-text("Log in"), button:has-text("Login")';
    await page.click(btnSelector);

    console.log("Esperando renderizado completo de la aplicación (Bandeja de Entrada)...");
    await page.waitForTimeout(10000);

    console.log("Cerrando posibles modales...");
    await page.keyboard.press('Escape');
    const rejectBtn = await page.$('button:has-text("Reject all")');
    if (rejectBtn) await rejectBtn.click();
    await page.mouse.click(1350, 40);
    await page.waitForTimeout(2000);

    console.log("Navegando a la vista de Bandeja de Entrada para capturar la aplicación base...");
    await page.goto('https://www.spacemail.com/es-ES/mail/', { waitUntil: 'networkidle' });

    // Forzar scroll o clics para asegurar que los componentes lazy-loaded se descarguen
    await page.waitForTimeout(8000);

    console.log("Extrayendo el SPA Shell HTML de Spacemail...");

    let htmlContent = await page.evaluate(() => {
        // Remover <base> tag y cualquier script analítico innecesario que pueda interferir localmente
        const existingBase = document.querySelector('base');
        if (existingBase) existingBase.remove();

        // Quitar también código de analytics
        document.querySelectorAll('script[src*="google-analytics"], script[src*="googletagmanager"]').forEach(s => s.remove());

        return document.documentElement.outerHTML;
    });

    // Evitar que el frontend haga prefetch directo a assets de spaceship-cdn
    let modifiedHtmlContent = htmlContent.replace(/https:\/\/spaceship-cdn\.com/g, '');

    // Reemplazar URLs absolutas de la API para que pasen por nuestro proxy local
    modifiedHtmlContent = modifiedHtmlContent.replace(/https:\/\/www\.spacemail\.com/g, '');
    modifiedHtmlContent = modifiedHtmlContent.replace(/https:\/\/www\.spaceship\.com/g, '');

    // Inyectar custom CSS (Material Design 3) antes del cierre del head
    modifiedHtmlContent = modifiedHtmlContent.replace('</head>', '    <link rel="stylesheet" href="/custom-m3.css">\n</head>');

    fs.writeFileSync(path.join(publicDir, 'index.html'), '<!DOCTYPE html>\n<html lang="es-ES">' + modifiedHtmlContent + '</html>');

    console.log("✅ Código fuente SPA completo guardado en public/index.html");

  } catch (e) {
    console.log("Error general:", e.message);
  }

  await browser.close();
})();
