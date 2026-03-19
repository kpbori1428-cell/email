const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { chromium } = require('playwright');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Almacén en memoria para las credenciales de sesión por usuario
const sessions = {}; // { 'email': { headers: {...} } }

// Helper para obtener las cabeceras vivas usando Playwright
async function getLiveHeaders(email, password) {
    console.log(`Iniciando sesión en Spacemail para ${email}...`);
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    let capturedHeaders = null;
    let authFound = false;

    // Interceptar la respuesta para robar las cookies y el token de la sesión recién iniciada
    page.on('request', request => {
        if (request.url().includes('/gateway/api/v1/mailcore/getMailboxInfo') || request.url().includes('/accountpreferencesbff/SetPreferences')) {
            const reqHeaders = request.headers();
            // Si tiene Cookie o el Authorization (aunque Spacemail usa cookies mayormente), las guardamos
            if (reqHeaders.cookie && !authFound) {
                capturedHeaders = reqHeaders;
                authFound = true;
                console.log(`[AUTH] Cabeceras de ${email} capturadas exitosamente!`);
            }
        }
    });

    try {
        await page.goto('https://www.spacemail.com/login', { waitUntil: 'networkidle', timeout: 30000 });

        const usernameSelector = 'input[type="text"], input[name="username"], input[name="email"]';
        await page.waitForSelector(usernameSelector, { timeout: 10000 });
        const passwordSelector = 'input[type="password"]';

        await page.fill(usernameSelector, email);
        await page.fill(passwordSelector, password);

        const btnSelector = 'button[type="submit"], button:has-text("Log in"), button:has-text("Login")';
        await page.click(btnSelector);

        console.log("Esperando inicio de sesión...");

        // Esperamos a que inicie sesion (sabremos si interceptamos la API getMailboxInfo)
        for(let i=0; i<15; i++) {
            if (authFound) break;
            await page.waitForTimeout(1000);
        }

        await browser.close();

        if (authFound) {
            // Filtrar las cabeceras para que sean seguras para axios/fetch (quitar :authority, etc)
            const cleanHeaders = {};
            for (const key in capturedHeaders) {
                if (!key.startsWith(':') && key.toLowerCase() !== 'content-length' && key.toLowerCase() !== 'origin' && key.toLowerCase() !== 'referer') {
                    cleanHeaders[key] = capturedHeaders[key];
                }
            }
            // Forzar origen correcto para el CORS de Spacemail
            cleanHeaders['content-type'] = 'application/json';
            cleanHeaders['origin'] = 'https://www.spacemail.com';
            cleanHeaders['referer'] = 'https://www.spacemail.com/es-ES/mail/';

            return cleanHeaders;
        } else {
            throw new Error("Login falló o no se pudieron capturar las cabeceras (Credenciales inválidas?)");
        }

    } catch (error) {
        await browser.close();
        throw error;
    }
}

// Endpoint de Login: Obtiene y guarda los headers vivos
app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    try {
        const headers = await getLiveHeaders(email, password);
        sessions[email] = { headers };
        res.json({ success: true, message: 'Autenticado correctamente. Sesión guardada.' });
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
});

// Proxy dinámico a cualquier endpoint de Spacemail
app.post('/api/spacemail/:endpoint', async (req, res) => {
    const { endpoint } = req.params;
    const email = req.headers['x-email-user']; // Lo envía el frontend localStorage

    if (!email || !sessions[email]) {
        return res.status(401).json({ error: 'No autorizado. Inicie sesión primero.' });
    }

    const spacemailUrl = `https://www.spacemail.com/gateway/api/v1/mailcore/${endpoint}`;

    console.log(`[PROXY] Reenviando petición POST a ${spacemailUrl}`);

    try {
        const fetch = (await import('node-fetch')).default; // Usar fetch nativo (Node 18+) o node-fetch

        const proxyResponse = await fetch(spacemailUrl, {
            method: 'POST',
            headers: sessions[email].headers,
            body: JSON.stringify(req.body) // El payload (ej: {displayName: "..."})
        });

        const data = await proxyResponse.json().catch(() => ({}));

        if (proxyResponse.ok) {
            res.json({ success: true, data });
        } else {
            console.error(`Spacemail respondió con error ${proxyResponse.status}:`, data);
            res.status(proxyResponse.status).json({ error: 'Spacemail API Error', details: data });
        }
    } catch (err) {
        console.error("Error en proxy:", err);
        res.status(500).json({ error: 'Fallo al comunicarse con Spacemail.' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor y Proxy de Spacemail corriendo en http://localhost:${PORT}`);
});
