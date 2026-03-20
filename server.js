const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const path = require('path');
const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
require('dotenv').config();

const app = express();
app.use(cors());

// Almacén en memoria para las credenciales de sesión por usuario
const sessions = {}; // { 'email': { headers: {...} } }

// Middleware para extraer el email de autenticación desde headers (usando headers locales custom)
const getSessionEmail = (req) => {
    return req.headers['x-email-user'] || process.env.EMAIL_USER;
};

// 1. Endpoint de Login Automático: Usa Playwright para loguearse y robar cookies vivas
app.use(express.json());
app.post('/api/auth/login', async (req, res) => {
    const email = req.body.email || getSessionEmail(req);
    const password = req.body.password || process.env.EMAIL_PASSWORD;

    if (!email || !password) {
        return res.status(400).json({ error: 'Credenciales requeridas' });
    }

    try {
        console.log(`Iniciando sesión en Spacemail para ${email} (Apertura de navegador visible para resolver captchas/2FA)...`);
        const browser = await chromium.launch({ headless: false }); // <-- CAMBIO A FALSE PARA DEPURACIÓN
        const context = await browser.newContext();
        const page = await context.newPage();

        let authFound = false;

        page.on('request', request => {
            if ((request.url().includes('/gateway/') || request.url().includes('loginStatus')) && request.method() !== 'OPTIONS') {
                const reqHeaders = request.headers();
                if (reqHeaders.cookie && reqHeaders.cookie.includes('spacemail_jwt') && !authFound) {
                    sessions[email] = { headers: {} };
                    for (const key in reqHeaders) {
                        if (!key.startsWith(':') && key.toLowerCase() !== 'content-length' && key.toLowerCase() !== 'origin' && key.toLowerCase() !== 'referer') {
                            sessions[email].headers[key] = reqHeaders[key];
                        }
                    }
                    // Forzamos headers para engañar al backend y validar que es una peticion real
                    sessions[email].headers['origin'] = 'https://www.spacemail.com';
                    sessions[email].headers['referer'] = 'https://www.spacemail.com/es-ES/mail/';
                    authFound = true;
                    console.log(`[AUTH] ¡Cookies y Sesión capturadas exitosamente!`);
                }
            }
        });

        await page.goto('https://www.spacemail.com/login', { waitUntil: 'networkidle', timeout: 30000 });

        const usernameSelector = 'input[type="text"], input[name="username"], input[name="email"]';
        await page.waitForSelector(usernameSelector, { timeout: 10000 });
        const passwordSelector = 'input[type="password"]';

        await page.fill(usernameSelector, email);
        await page.fill(passwordSelector, password);

        const btnSelector = 'button[type="submit"], button:has-text("Log in"), button:has-text("Login")';
        await page.click(btnSelector);

        // Esperamos hasta 60 segundos por si hay un Captcha o 2FA manual que completar en la ventana
        for(let i=0; i<60; i++) {
            if (authFound) break;
            await page.waitForTimeout(1000);

            // Re-evaluar cookies para ver si las encontramos sin el on(request)
            const tmpCookies = await context.cookies();
            if (tmpCookies.some(c => c.name === 'spacemail_jwt')) {
                authFound = true;
                // Si la pillamos por cookies, mockear session headers manuales para el backend
                sessions[email] = { headers: {} };
                sessions[email].headers['cookie'] = tmpCookies.map(c => `${c.name}=${c.value}`).join('; ');
                sessions[email].headers['origin'] = 'https://www.spacemail.com';
                sessions[email].headers['referer'] = 'https://www.spacemail.com/es-ES/mail/';
                console.log(`[AUTH] Cookies detectadas via polling!`);
            }
        }

        // Extraer cookies reales del navegador para enviarlas al cliente local
        const cookies = await context.cookies();

        await browser.close();

        if (authFound) {
            // Reenviar las cookies al navegador local para engañar al frontend SPA
            cookies.forEach(cookie => {
                let options = {
                    httpOnly: cookie.httpOnly,
                    secure: false, // En localhost no siempre es HTTPS
                    path: cookie.path || '/'
                };
                // Ignorar el domain para forzar que sirvan en localhost
                res.cookie(cookie.name, cookie.value, options);
            });

            res.json({ success: true, message: 'Sesión activa en el Proxy.' });
        } else {
            throw new Error("No se capturó la sesión. Revisa credenciales.");
        }

    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

// Servimos archivos estáticos (solo está index.html)
app.use(express.static('public'));

// Fallback para las rutas SPA de Vue
app.use((req, res, next) => {
    if (req.method === 'GET') {
        const isExcluded = req.url.startsWith('/gateway') || req.url.startsWith('/api') || req.url.startsWith('/webmail-ui') || req.url.startsWith('/static') || req.url.startsWith('/sharedstaticresources') || req.url.startsWith('/l10n');
        if (!isExcluded) {
            return res.sendFile(path.join(__dirname, 'public', 'index.html'));
        }
    }
    next();
});

// 2. Archivos estáticos de Spacemail que hemos clonado desde el CDN (ya no usamos Proxy para evitar bloqueos 403 de Cloudflare)
const fs = require('fs');
const publicDir = path.join(__dirname, 'public');
// Montamos todas las subcarpetas dentro de 'public' dinámicamente como rutas raíz
if (fs.existsSync(publicDir)) {
    const folders = fs.readdirSync(publicDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

    folders.forEach(folder => {
        app.use(`/${folder}`, express.static(path.join(__dirname, `public/${folder}`)));
    });
}
// Especial para static
app.use('/static', express.static(path.join(__dirname, 'public/static')));
app.use('/l10n', express.static(path.join(__dirname, 'public/l10n')));

// 3. Proxy para la API de Spacemail (Inyección de Autenticación)
app.use('/gateway', createProxyMiddleware({
    target: 'https://www.spacemail.com',
    changeOrigin: true,
    onProxyReq: (proxyReq, req, res) => {
        const sessionEmail = getSessionEmail(req);
        proxyReq.setHeader('origin', 'https://www.spacemail.com');
        proxyReq.setHeader('referer', 'https://www.spacemail.com/es-ES/mail/');
        if (sessionEmail && sessions[sessionEmail]) {
            const authHeaders = sessions[sessionEmail].headers;
            for (const [key, value] of Object.entries(authHeaders)) {
                proxyReq.setHeader(key, value);
            }
        }
    }
}));

// 4. Fallback routing para la Single Page Application (SPA)
app.use(function (req, res, next) {
    if (req.method === 'GET' && !req.url.startsWith('/gateway') && !req.url.startsWith('/api') && req.accepts('html')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        next();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`========================================================`);
    console.log(`PROXY REPLICADOR DE SPACEMAIL INICIADO`);
    console.log(`URL Local: http://localhost:${PORT}`);
    console.log(`========================================================`);

    // Auto-login al arrancar usando las credenciales del .env
    const email = process.env.EMAIL_USER;
    const password = process.env.EMAIL_PASSWORD;
    if (email && password && password !== '[TU_CONTRASEÑA]') {
        console.log(`Ejecutando auto-login para ${email} en segundo plano...`);
        try {
            const fetch = require('node-fetch');
            const response = await fetch(`http://localhost:${PORT}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (response.ok) {
                console.log(`✅ Auto-login exitoso. Ya puedes abrir http://localhost:${PORT}/es-ES/mail/ en tu navegador.`);
            } else {
                console.log(`❌ Falló el auto-login: ${response.statusText}`);
            }
        } catch(e) {
            console.log(`⚠️ Error al intentar auto-login:`, e.message);
        }
    } else {
        console.log(`⚠️ Faltan credenciales en el archivo .env. Por favor, configúralas para habilitar el login automático.`);
        console.log(`Alternativamente puedes hacer POST a http://localhost:${PORT}/api/auth/login para iniciar sesión manualmente.`);
    }
});
