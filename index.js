const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const path = require('path');
const fileUpload = require('express-fileupload');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
// Middleware for multipart/form-data (Attachments)
app.use(fileUpload({
    limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB limit
    abortOnLimit: true
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── Configuraciones Globales (Extraídas del Android App) ──────────
const EMAIL_DOMAIN = "eficell.cl";
const IMAP_HOST = "mail.spacemail.com";
const IMAP_PORT = 993;
const SMTP_HOST = "mail.spacemail.com";
const SMTP_PORT = 465;
const MAX_MESSAGES_PER_FETCH = 50;

const FOLDER_NAMES = {
    "INBOX": "Bandeja de entrada",
    "Sent": "Enviados",
    "Drafts": "Borradores",
    "Trash": "Papelera",
    "Spam": "Spam",
    "Archive": "Archivados"
};

// Configuración de Servidor
const getEmailConfig = (user, pass) => ({
    imap: {
        user: user || process.env.EMAIL_USER,
        password: pass || process.env.EMAIL_PASSWORD,
        host: IMAP_HOST,
        port: IMAP_PORT,
        tls: true,
        authTimeout: 10000, // Timeout como en Android
        tlsOptions: { rejectUnauthorized: false }
    },
    smtp: {
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: true,
        auth: {
            user: user || process.env.EMAIL_USER,
            pass: pass || process.env.EMAIL_PASSWORD
        }
    }
});

// Middleware de Auth básica (usando headers)
const authMiddleware = (req, res, next) => {
    const user = req.headers['x-email-user'];
    const pass = req.headers['x-email-pass'];

    if (!user || !pass) {
        return res.status(401).json({ error: "Credenciales de email requeridas." });
    }

    req.emailConfig = getEmailConfig(user, pass);
    next();
};

// ── RUTAS DE LA API (Clon de EmailRepositoryImpl) ──────────

// 1. Obtener Carpetas (getFolders)
app.get('/api/folders', authMiddleware, async (req, res) => {
    try {
        const connection = await imaps.connect(req.emailConfig);
        const boxes = await connection.getBoxes();
        connection.end();

        const folders = Object.keys(boxes).map(key => ({
            id: key,
            name: FOLDER_NAMES[key] || key,
            path: key
        }));

        res.json({ success: true, folders });
    } catch (error) {
        console.error('Error fetching folders:', error);
        res.status(500).json({ error: 'Error cargando carpetas', details: error.message });
    }
});

// 2. Obtener Mensajes por Carpeta (getMessages)
app.get('/api/folders/:folder/messages', authMiddleware, async (req, res) => {
    const folder = req.params.folder;
    const limit = parseInt(req.query.limit) || MAX_MESSAGES_PER_FETCH;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const connection = await imaps.connect(req.emailConfig);
        await connection.openBox(folder);

        // Get total messages to calculate seq range for pagination
        const box = await connection.openBox(folder);
        const totalMessages = box.messages.total;

        let results = [];
        if (totalMessages > 0) {
            // IMAP sequence numbers are 1-based. Calculate the range for the latest messages.
            let start = totalMessages - offset - limit + 1;
            let end = totalMessages - offset;

            // Adjust bounds if offset is too large
            if (start < 1) start = 1;
            if (end < 1) end = 0;

            if (end >= start) {
                const searchCriteria = [`${start}:${end}`]; // Using sequence numbers directly instead of ALL
                const fetchOptions = {
                    bodies: ['HEADER'], // Fetch headers only, not full text body for listing
                    markSeen: false,
                    struct: true
                };

                results = await connection.search(searchCriteria, fetchOptions);
            }
        }
        connection.end();

        // Reverse to show latest first
        results = results.reverse();

        const emails = await Promise.all(results.map(async (res) => {
            let rawEmail = "";
            // We only requested 'HEADER' this time
            res.parts.forEach(part => rawEmail += part.body);

            try {
                const parsed = await simpleParser(rawEmail);
                const isRead = res.attributes.flags.includes('\\Seen');
                const isStarred = res.attributes.flags.includes('\\Flagged');

                return {
                    id: res.attributes.uid,
                    subject: parsed.subject || '(Sin asunto)',
                    from: parsed.from?.text || 'Desconocido',
                    to: parsed.to?.text || '',
                    date: parsed.date,
                    textSnippet: parsed.text ? parsed.text.substring(0, 100) : '', // Preview
                    isRead,
                    isStarred,
                    hasAttachments: parsed.attachments.length > 0,
                    folder: folder
                };
            } catch(e) {
                return { id: res.attributes.uid, subject: 'Error parsing email' };
            }
        }));

        res.json({ success: true, emails });
    } catch (error) {
        console.error(`Error cargando mensajes de ${folder}:`, error);
        res.status(500).json({ error: `Error cargando mensajes de ${folder}`, details: error.message });
    }
});

// 3. Obtener Mensaje Completo (getMessage)
app.get('/api/folders/:folder/messages/:uid', authMiddleware, async (req, res) => {
    const { folder, uid } = req.params;

    try {
        const connection = await imaps.connect(req.emailConfig);
        await connection.openBox(folder);

        const searchCriteria = [['UID', uid]];
        const fetchOptions = { bodies: [''], markSeen: true }; // markSeen: true al abrir

        const results = await connection.search(searchCriteria, fetchOptions);
        connection.end();

        if (results.length === 0) return res.status(404).json({ error: "Mensaje no encontrado" });

        const rawEmail = results[0].parts[0].body;
        const parsed = await simpleParser(rawEmail);

        res.json({
            success: true,
            email: {
                id: uid,
                subject: parsed.subject || '(Sin asunto)',
                from: parsed.from?.text || 'Desconocido',
                to: parsed.to?.text || '',
                cc: parsed.cc?.text || '',
                bcc: parsed.bcc?.text || '',
                replyTo: parsed.replyTo?.text || '',
                date: parsed.date,
                html: parsed.html || parsed.textAsHtml || parsed.text || '(Sin contenido)',
                attachments: parsed.attachments.map((a, i) => ({
                    index: i,
                    filename: a.filename,
                    size: a.size,
                    contentType: a.contentType
                }))
            }
        });
    } catch (error) {
        console.error(`Error cargando mensaje ${uid}:`, error);
        res.status(500).json({ error: `Error cargando mensaje ${uid}`, details: error.message });
    }
});

// 3.5 Descargar un Archivo Adjunto Específico
app.get('/api/folders/:folder/messages/:uid/attachments/:index', authMiddleware, async (req, res) => {
    const { folder, uid, index } = req.params;

    try {
        const connection = await imaps.connect(req.emailConfig);
        await connection.openBox(folder);

        const searchCriteria = [['UID', uid]];
        const fetchOptions = { bodies: [''] };

        const results = await connection.search(searchCriteria, fetchOptions);
        connection.end();

        if (results.length === 0) return res.status(404).json({ error: "Mensaje no encontrado" });

        const rawEmail = results[0].parts[0].body;
        const parsed = await simpleParser(rawEmail);

        if (!parsed.attachments || !parsed.attachments[index]) {
            return res.status(404).json({ error: "Archivo adjunto no encontrado" });
        }

        const attachment = parsed.attachments[index];

        res.setHeader('Content-Type', attachment.contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(attachment.filename)}"`);
        res.send(attachment.content);

    } catch (error) {
        console.error('Error downloading attachment:', error);
        res.status(500).json({ error: 'Error descargando archivo adjunto', details: error.message });
    }
});


// 4. Buscar Mensajes (searchMessages)
app.get('/api/search', authMiddleware, async (req, res) => {
    const query = req.query.q;
    const folder = req.query.folder || 'INBOX';

    if (!query) return res.status(400).json({ error: "Falta parámetro 'q' de búsqueda" });

    try {
        const connection = await imaps.connect(req.emailConfig);
        await connection.openBox(folder);

        // Equivalente a OrTerm(SubjectTerm, FromStringTerm, BodyTerm) en IMAP
        const searchCriteria = [['OR', ['SUBJECT', query], ['FROM', query]]];
        // Nota: IMAP OR complex search puede variar, usar FROM y SUBJECT es estándar

        const fetchOptions = { bodies: ['HEADER'], markSeen: false };

        const results = await connection.search(searchCriteria, fetchOptions);
        connection.end();

        const emails = await Promise.all(results.reverse().slice(0, MAX_MESSAGES_PER_FETCH).map(async (res) => {
            let rawEmail = "";
            res.parts.forEach(part => rawEmail += part.body);
            const parsed = await simpleParser(rawEmail);
            return {
                id: res.attributes.uid,
                subject: parsed.subject || '(Sin asunto)',
                from: parsed.from?.text || 'Desconocido',
                date: parsed.date,
                isRead: res.attributes.flags.includes('\\Seen'),
                isStarred: res.attributes.flags.includes('\\Flagged')
            };
        }));

        res.json({ success: true, emails });
    } catch (error) {
        console.error(`Error buscando '${query}':`, error);
        res.status(500).json({ error: `Error buscando '${query}'`, details: error.message });
    }
});

// 5. Enviar Email (sendMessage - Cloud Function clone via SMTP)
app.post('/api/emails/send', authMiddleware, async (req, res) => {
    const { to, cc, bcc, subject, body, senderName } = req.body;

    if (!to || !body) {
        return res.status(400).json({ error: 'Destinatario "to" y "body" son requeridos.' });
    }

    try {
        const transporter = nodemailer.createTransport(req.emailConfig.smtp);
        const fromAddress = senderName
            ? `"${senderName}" <${req.emailConfig.smtp.auth.user}>`
            : req.emailConfig.smtp.auth.user;

        // Procesar archivos adjuntos si existen
        const attachments = [];
        if (req.files && req.files.attachments) {
            let files = req.files.attachments;
            if (!Array.isArray(files)) files = [files];

            files.forEach(file => {
                attachments.push({
                    filename: file.name,
                    content: file.data
                });
            });
        }

        const info = await transporter.sendMail({
            from: fromAddress,
            to: Array.isArray(to) ? to.join(', ') : to,
            cc: Array.isArray(cc) ? cc.join(', ') : cc,
            bcc: Array.isArray(bcc) ? bcc.join(', ') : bcc,
            subject: subject || '(Sin asunto)',
            html: body,
            attachments: attachments
        });

        // Opcional: También guardar en carpeta 'Sent' (Enviados) vía IMAP
        try {
            const connection = await imaps.connect(req.emailConfig);
            await connection.append('Sent', info.message.toString(), { flags: ['\\Seen'] });
            connection.end();
        } catch(e) { console.error("No se pudo guardar en Enviados:", e.message) }

        res.json({ success: true, messageId: info.messageId });
    } catch (error) {
        console.error('Error enviando email:', error);
        res.status(500).json({ error: 'Error enviando email via SMTP', details: error.message });
    }
});

// 6. Guardar Borrador (saveDraft)
app.post('/api/emails/draft', authMiddleware, async (req, res) => {
    const { to, cc, bcc, subject, body, senderName } = req.body;

    try {
        // En Android lo armas con MimeMessage. Aquí usamos nodemailer para construir el crudo
        const transporter = nodemailer.createTransport(req.emailConfig.smtp);
        const fromAddress = senderName
            ? `"${senderName}" <${req.emailConfig.smtp.auth.user}>`
            : req.emailConfig.smtp.auth.user;

        const mailOptions = {
            from: fromAddress,
            to: Array.isArray(to) ? to.join(', ') : to,
            cc: Array.isArray(cc) ? cc.join(', ') : cc,
            bcc: Array.isArray(bcc) ? bcc.join(', ') : bcc,
            subject: subject || '(Sin asunto)',
            html: body
        };

        let messageBuffer = '';
        transporter.compile(mailOptions).build((err, message) => {
            if(err) throw err;
            messageBuffer = message.toString();
        });

        const connection = await imaps.connect(req.emailConfig);
        await connection.append('Drafts', messageBuffer, { flags: ['\\Draft'] });
        connection.end();

        res.json({ success: true, message: "Borrador guardado" });
    } catch (error) {
        console.error('Error guardando borrador:', error);
        res.status(500).json({ error: 'Error guardando borrador', details: error.message });
    }
});

// 7. Modificar Flags (markAsRead / markAsStarred)
app.patch('/api/folders/:folder/messages/:uid/flags', authMiddleware, async (req, res) => {
    const { folder, uid } = req.params;
    const { read, starred } = req.body;

    try {
        const connection = await imaps.connect(req.emailConfig);
        await connection.openBox(folder);

        if (read !== undefined) {
            if (read) await connection.addFlags(uid, ['\\Seen']);
            else await connection.delFlags(uid, ['\\Seen']);
        }

        if (starred !== undefined) {
            if (starred) await connection.addFlags(uid, ['\\Flagged']);
            else await connection.delFlags(uid, ['\\Flagged']);
        }

        connection.end();
        res.json({ success: true });
    } catch (error) {
        console.error(`Error modificando flags del mensaje ${uid}:`, error);
        res.status(500).json({ error: 'Error modificando flags', details: error.message });
    }
});

// 8. Mover / Eliminar (moveMessage / deleteMessage)
app.post('/api/folders/:folder/messages/:uid/move', authMiddleware, async (req, res) => {
    const { folder, uid } = req.params;
    const { destination, permanent } = req.body; // destination="Trash" = Delete

    try {
        const connection = await imaps.connect(req.emailConfig);
        await connection.openBox(folder);

        if (permanent) {
            await connection.addFlags(uid, ['\\Deleted']);
            // connection.expunge() doesn't exist explicitly in imap-simple, auto-expunge on close usually
        } else if (destination) {
            await connection.moveMessage(uid, destination);
        }

        connection.end();
        res.json({ success: true });
    } catch (error) {
        console.error(`Error moviendo/eliminando mensaje ${uid}:`, error);
        res.status(500).json({ error: 'Error moviendo/eliminando mensaje', details: error.message });
    }
});

// 9. Test Conexión (testConnection)
app.post('/api/test-connection', authMiddleware, async (req, res) => {
    try {
        const connection = await imaps.connect(req.emailConfig);
        const connected = !!connection;
        connection.end();
        res.json({ success: true, connected });
    } catch (error) {
        res.status(401).json({ success: false, connected: false, error: 'Credenciales inválidas o servidor no alcanzable' });
    }
});

app.listen(PORT, () => {
    console.log(`Eficell Mailbox Web Server running on port ${PORT}`);
});