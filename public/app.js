// State
let currentFolder = 'INBOX';
let emails = [];
let currentMessageId = null;
let currentEmailDetail = null;

// DOM Elements
const formLogin = document.getElementById('login-form');
const loginOverlay = document.getElementById('login-modal');
const appHeader = document.getElementById('app-header');
const appContainer = document.getElementById('app-container');
const lblUserEmail = document.getElementById('current-user-email');
const btnLogout = document.getElementById('btn-logout');

const views = {
    list: document.getElementById('view-list'),
    detail: document.getElementById('view-detail'),
    compose: document.getElementById('view-compose')
};

const folderListUI = document.getElementById('folder-list');
const lblFolderTitle = document.getElementById('current-folder-title');
const emailListUI = document.getElementById('email-list');
const listLoader = document.getElementById('list-loader');
const btnRefresh = document.getElementById('btn-refresh');
const statusBar = document.getElementById('status-bar');

// Detail View Elements
const detailContent = document.getElementById('detail-content');
const detailSubject = document.getElementById('detail-subject');
const detailFrom = document.getElementById('detail-from');
const detailTo = document.getElementById('detail-to');
const detailDate = document.getElementById('detail-date');
const detailBody = document.getElementById('detail-body');
const detailAttachments = document.getElementById('detail-attachments');
const btnDetailTrash = document.getElementById('btn-detail-trash');
const btnDetailReply = document.getElementById('btn-detail-reply');

// Compose View Elements
const btnComposeNav = document.getElementById('btn-compose-nav');
const formCompose = document.getElementById('compose-form');
const composeTo = document.getElementById('compose-to');
const composeCc = document.getElementById('compose-cc');
const composeSubject = document.getElementById('compose-subject');
const composeAttachments = document.getElementById('compose-attachments');
const btnDiscard = document.getElementById('btn-discard');

// Initialize Quill editor
let quill;
// --- Dynamic CSS & Theme Loading ---
async function loadStyles() {
    try {
        const response = await fetch('styles.json');
        if (!response.ok) return;
        const styles = await response.json();

        let cssString = '';

        // Handle @import
        if (styles['@import']) {
            styles['@import'].forEach(imp => { cssString += `${imp}\n`; });
            delete styles['@import'];
        }

        // Process selectors
        for (const [selector, rules] of Object.entries(styles)) {
            if (selector.startsWith('@keyframes')) {
                cssString += `${selector} {\n`;
                for (const [frame, props] of Object.entries(rules)) {
                    cssString += `  ${frame} {\n`;
                    for (const [prop, val] of Object.entries(props)) {
                        cssString += `    ${prop}: ${val};\n`;
                    }
                    cssString += `  }\n`;
                }
                cssString += `}\n`;
            } else {
                cssString += `${selector} {\n`;
                for (const [prop, val] of Object.entries(rules)) {
                    cssString += `  ${prop}: ${val};\n`;
                }
                cssString += `}\n`;
            }
        }

        // Inject into DOM
        const styleEl = document.createElement('style');
        styleEl.innerHTML = cssString;
        document.head.appendChild(styleEl);

    } catch(e) {
        console.error('Error loading styles.json', e);
    }
}

async function loadTheme() {
    try {
        const response = await fetch('theme.json');
        if (!response.ok) return;
        const theme = await response.json();

        // Wait for base styles to be injected first
        await loadStyles();

        // Override Colors if provided in theme.json
        if (theme.colors) {
            const root = document.documentElement;
            for (const [key, value] of Object.entries(theme.colors)) {
                root.style.setProperty(key, value);
            }
        }

        // Update Branding
        if (theme.branding) {
            document.title = theme.branding.appName;
            const logoHtml = `<i class="${theme.branding.iconClass}"></i> ${escapeHtml(theme.branding.appName)}`;
            document.querySelectorAll('.logo').forEach(el => el.innerHTML = logoHtml);
            // Login box title
            const loginTitle = document.querySelector('.login-box h2');
            if(loginTitle) loginTitle.innerHTML = logoHtml;
        }
    } catch(e) {
        console.error('No custom theme found or error loading theme.json', e);
    }
}

// Avatar Generator Utils
function getAvatarColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    // Create a beautiful gradient
    const color1 = `hsl(${hue}, 70%, 60%)`;
    const color2 = `hsl(${(hue + 40) % 360}, 80%, 45%)`;
    return `linear-gradient(135deg, ${color1}, ${color2})`;
}

function getInitials(name) {
    if (!name) return '?';
    const cleanName = name.replace(/["']/g, '');
    const parts = cleanName.split('@')[0].split(/[.\-_ ]/);
    let initials = parts[0].substring(0, 1).toUpperCase();
    if (parts.length > 1 && parts[1].length > 0) {
        initials += parts[1].substring(0, 1).toUpperCase();
    }
    return initials;
}

function createAvatarHtml(nameStr, className = 'avatar') {
    const cleanName = escapeHtml(nameStr || 'Unknown');
    const initials = getInitials(cleanName);
    const bgGradient = getAvatarColor(cleanName);
    return `<div class="${className}" style="background: ${bgGradient};" title="${cleanName}">${initials}</div>`;
}

document.addEventListener('DOMContentLoaded', async () => {
    // Load Dynamic Theme and CSS First
    await loadTheme();

    quill = new Quill('#editor-container', {
        theme: 'snow',
        placeholder: 'Escribe tu mensaje aquí...',
        modules: {
            toolbar: [
                [{ 'font': [] }, { 'size': [] }],
                ['bold', 'italic', 'underline', 'strike'],
                [{ 'color': [] }, { 'background': [] }],
                [{ 'script': 'sub'}, { 'script': 'super' }],
                [{ 'header': '1'}, { 'header': '2' }, 'blockquote'],
                [{ 'list': 'ordered'}, { 'list': 'bullet' }, { 'indent': '-1'}, { 'indent': '+1' }],
                [{ 'align': [] }],
                ['link', 'image'],
                ['clean']
            ]
        }
    });

    // Check if already logged in via credentials
    const userEmail = localStorage.getItem('userEmail');
    const userPass = localStorage.getItem('userPass');
    if (userEmail && userPass) {
        loginOverlay.classList.add('hidden');
        appHeader.classList.remove('hidden');
        appContainer.classList.remove('hidden');
        lblUserEmail.textContent = userEmail;
        await loadFolders();
        await loadEmails();
    }
});

// --- API Helpers ---
async function apiRequest(endpoint, method = 'GET', data = null, isFormData = false) {
    const userEmail = localStorage.getItem('userEmail');
    const userPass = localStorage.getItem('userPass');

    const headers = {};
    if (userEmail && userPass) {
        headers['x-email-user'] = userEmail;
        headers['x-email-pass'] = userPass;
    }

    if (!isFormData && data) headers['Content-Type'] = 'application/json';

    const options = { method, headers };
    if (data) {
        options.body = isFormData ? data : JSON.stringify(data);
    }

    try {
        const res = await fetch(endpoint, options);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'API Error');
        return json;
    } catch (err) {
        if (err.message === 'Credenciales de email requeridas.' || err.message.includes('Auth failed') || err.message === 'Unauthorized') {
            handleLogout();
        }
        throw err;
    }
}

// --- UI Helpers ---
function escapeHtml(unsafe) {
    return (unsafe || '').toString()
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

function showStatus(msg, isError = false) {
    statusBar.textContent = msg;
    statusBar.className = `status-msg ${isError ? 'status-error' : 'status-success'}`;
    statusBar.style.display = 'block';
    setTimeout(() => { statusBar.style.display = 'none'; }, 4000);
}

function switchView(viewName) {
    Object.values(views).forEach(v => v.style.display = 'none');
    views[viewName].style.display = viewName === 'list' || viewName === 'detail' ? 'flex' : 'flex';
}

async function loadFolders() {
    try {
        const data = await apiRequest('/api/folders');
        if (data.success) {
            folderListUI.innerHTML = '';

            // Map common system folders to icons (names are handled by backend FOLDER_NAMES)
            const folderIconMap = {
                'INBOX': 'fa-inbox',
                'Sent': 'fa-paper-plane',
                'Drafts': 'fa-file-lines',
                'Trash': 'fa-trash',
                'Junk': 'fa-circle-exclamation',
                'Archive': 'fa-box-archive'
            };

            // Order: INBOX first, then others alphabetically by their translated name
            let folders = data.folders.sort((a, b) => {
                if(a.id === 'INBOX') return -1;
                if(b.id === 'INBOX') return 1;
                return a.name.localeCompare(b.name);
            });

            folders.forEach(folder => {
                const li = document.createElement('li');
                const iconClass = folderIconMap[folder.id] || 'fa-folder';
                const displayName = folder.name;

                li.className = `folder-item ${folder.path === currentFolder ? 'active' : ''}`;
                li.innerHTML = `<i class="fa-solid ${iconClass}"></i> ${escapeHtml(displayName)}`;
                li.onclick = () => {
                    document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
                    li.classList.add('active');
                    currentFolder = folder.path;
                    lblFolderTitle.textContent = displayName;
                    loadEmails();
                };
                folderListUI.appendChild(li);
            });
        }
    } catch (err) {
        showStatus('Error cargando carpetas: ' + err.message, true);
    }
}

// Format date relative to now
function formatFriendlyDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr; // fallback

    const now = new Date();
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const isThisYear = d.getFullYear() === now.getFullYear();

    if (isToday) {
        return d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    } else if (isThisYear) {
        return d.toLocaleDateString([], {day: 'numeric', month: 'short'});
    } else {
        return d.toLocaleDateString([], {year: 'numeric', month: 'numeric', day: 'numeric'});
    }
}

async function loadEmails() {
    switchView('list');
    listLoader.classList.remove('hidden');
    emailListUI.classList.add('hidden');
    emailListUI.innerHTML = '';
    emails = [];

    try {
        const data = await apiRequest(`/api/folders/${encodeURIComponent(currentFolder)}/messages`);
        if (data.success) {
            emails = data.emails || [];
            if (emails.length === 0) {
                emailListUI.innerHTML = `<li class="status-info">No hay mensajes en esta carpeta.</li>`;
            } else {
                emails.forEach(msg => {
                    const li = document.createElement('li');
                    const isUnread = !msg.isRead;
                    const isStarred = msg.isStarred;
                    li.className = `email-item ${isUnread ? 'unread' : 'read'}`;
                    li.id = `msg-${msg.id}`;

                    // Extract name vs email for clean display
                    const fromStr = escapeHtml(msg.from || '(Desconocido)');
                    const subjectStr = escapeHtml(msg.subject || '(Sin asunto)');
                    const dateStr = formatFriendlyDate(msg.date);
                    const snippetStr = escapeHtml(msg.textSnippet || msg.preview || 'Haz clic para leer');

                    const avatarHtml = createAvatarHtml(msg.from);

                    const attIcon = msg.hasAttachments ? `<i class="fa-solid fa-paperclip attachment-icon"></i>` : '';

                    li.innerHTML = `
                        <div class="star ${isStarred ? 'starred' : ''}" onclick="toggleStar(event, ${msg.id})">
                            <i class="${isStarred ? 'fa-solid' : 'fa-regular'} fa-star"></i>
                        </div>
                        <div class="email-content" onclick="openMessage(${msg.id})">
                            ${avatarHtml}
                            <span class="email-from">${fromStr}</span>
                            <span class="email-subject">${subjectStr} <span class="email-preview" style="color: var(--text-light); font-weight: 400; margin-left: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; display: inline-block;">- ${snippetStr}</span></span>
                        </div>
                        <div class="email-meta">
                            ${attIcon}
                            <span class="email-date">${dateStr}</span>
                        </div>
                    `;
                    emailListUI.appendChild(li);
                });
            }
        }
    } catch (err) {
        showStatus('Error cargando mensajes: ' + err.message, true);
        emailListUI.innerHTML = `<li class="status-info" style="color: var(--danger)">Error: ${escapeHtml(err.message)}</li>`;
    } finally {
        listLoader.classList.add('hidden');
        emailListUI.classList.remove('hidden');
    }
}

// Dummy toggle star function (requires backend support for \Flagged flag)
function toggleStar(event, uid) {
    event.stopPropagation(); // prevent opening email
    const starIcon = event.currentTarget.querySelector('i');
    if (starIcon.classList.contains('fa-regular')) {
        starIcon.classList.remove('fa-regular');
        starIcon.classList.add('fa-solid');
        event.currentTarget.classList.add('starred');
    } else {
        starIcon.classList.remove('fa-solid');
        starIcon.classList.add('fa-regular');
        event.currentTarget.classList.remove('starred');
    }
}

// Open Message
async function openMessage(uid) {
    switchView('detail');
    currentMessageId = uid;
    document.getElementById('detail-loader').classList.remove('hidden');
    detailContent.classList.add('hidden');
    detailAttachments.classList.add('hidden');

    try {
        const data = await apiRequest(`/api/folders/${encodeURIComponent(currentFolder)}/messages/${uid}`);
        const email = data.email;
        currentEmailDetail = email;

        detailSubject.textContent = email.subject || '(Sin asunto)';

        const fromStr = escapeHtml(email.from);
        document.querySelector('.email-sender-wrapper').innerHTML = `
            ${createAvatarHtml(fromStr, 'avatar detail-avatar')}
            <div>
                <div class="sender">${fromStr}</div>
                <div class="to">Para: ${escapeHtml(email.to) + (email.cc ? ` (CC: ${escapeHtml(email.cc)})` : '')}</div>
            </div>
        `;

        detailDate.textContent = formatFriendlyDate(email.date);

        // Handle Attachments
        if (email.attachments && email.attachments.length > 0) {
            detailAttachments.innerHTML = '';
            email.attachments.forEach(att => {
                const downloadLink = document.createElement('a');
                downloadLink.href = '#';
                downloadLink.className = 'attachment-pill';
                const kb = (att.size / 1024).toFixed(2);
                downloadLink.innerHTML = `<i class="fa-solid fa-paperclip"></i> <span>${escapeHtml(att.filename || 'Archivo')} <br><small style="color:var(--text-light)">${kb} KB</small></span>`;
                downloadLink.onclick = async (e) => {
                    e.preventDefault();
                    await downloadAttachment(currentFolder, uid, att.index, att.filename);
                };
                detailAttachments.appendChild(downloadLink);
            });
            detailAttachments.classList.remove('hidden');
        }

        // Render content via iframe sandbox
        const iframe = document.createElement('iframe');
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.setAttribute('sandbox', '');

        detailBody.innerHTML = '';
        detailBody.appendChild(iframe);

        if ('srcdoc' in iframe) {
            iframe.srcdoc = email.html || email.textAsHtml || email.text || '(Sin cuerpo)';
        } else {
            iframe.contentWindow.document.open();
            iframe.contentWindow.document.write(email.html || email.textAsHtml || email.text || '(Sin cuerpo)');
            iframe.contentWindow.document.close();
        }

        // Mark read in UI
        const row = document.getElementById(`msg-${uid}`);
        if (row) {
            row.classList.remove('unread');
            row.classList.add('read');
        }

        document.getElementById('detail-loader').classList.add('hidden');
        detailContent.classList.remove('hidden');

    } catch (err) {
        showStatus(err.message, true);
        switchView('list');
    }
}

// Download Attachment
async function downloadAttachment(folder, uid, partIndex, filename) {
    try {
        showStatus(`Descargando ${filename}...`);

        const authHeaders = {
            'x-email-user': localStorage.getItem('userEmail'),
            'x-email-pass': localStorage.getItem('userPass')
        };

        // Backend responds with raw binary data directly via res.send() and route is /attachments/:index
        const response = await fetch(`/api/folders/${encodeURIComponent(folder)}/messages/${uid}/attachments/${partIndex}`, {
            headers: authHeaders
        });

        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }

        const blob = await response.blob();

        // Create hidden link and trigger download
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename || 'adjunto';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        showStatus('Descarga completada');
    } catch (err) {
        showStatus('Error descargando adjunto: ' + err.message, true);
    }
}

// Delete Message
btnDetailTrash.addEventListener('click', async () => {
    if (!currentMessageId) return;
    if (!confirm('¿Seguro que deseas eliminar este mensaje?')) return;

    try {
        const data = await apiRequest(`/api/folders/${encodeURIComponent(currentFolder)}/messages/${currentMessageId}`, 'DELETE');
        if (data.success) {
            showStatus('Mensaje eliminado');
            loadEmails();
        }
    } catch (err) {
        showStatus('Error al eliminar: ' + err.message, true);
    }
});

// Reply Message
btnDetailReply.addEventListener('click', () => {
    if (!currentEmailDetail) return;

    composeTo.value = currentEmailDetail.from;
    composeSubject.value = currentEmailDetail.subject.startsWith('Re:') ? currentEmailDetail.subject : `Re: ${currentEmailDetail.subject}`;

    const replyBody = `<br><br><blockquote>El ${new Date(currentEmailDetail.date).toLocaleString()}, ${escapeHtml(currentEmailDetail.from)} escribió:<br/>${currentEmailDetail.html || currentEmailDetail.textAsHtml || currentEmailDetail.text}</blockquote>`;
    quill.root.innerHTML = replyBody;

    switchView('compose');
});

// --- Event Listeners ---

// Login
formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const senderName = document.getElementById('login-sender-name').value;
    const errDiv = document.getElementById('login-error');
    const btn = document.getElementById('btn-login-submit');

    btn.textContent = 'Iniciando...';
    btn.disabled = true;
    errDiv.style.display = 'none';

    try {
        // Test connection to verify credentials
        localStorage.setItem('userEmail', email);
        localStorage.setItem('userPass', password);
        if (senderName) {
            localStorage.setItem('senderName', senderName);
        } else {
            localStorage.removeItem('senderName');
        }

        const data = await apiRequest('/api/test-connection', 'POST');
        if (data.success && data.connected) {
            lblUserEmail.textContent = email;

            loginOverlay.classList.add('hidden');
            appHeader.classList.remove('hidden');
            appContainer.classList.remove('hidden');

            await loadFolders();
            await loadEmails();
        }
    } catch (err) {
        localStorage.removeItem('userEmail');
        localStorage.removeItem('userPass');
        errDiv.textContent = 'Error de autenticación: ' + err.message;
        errDiv.style.display = 'block';
    } finally {
        btn.textContent = 'Siguiente';
        btn.disabled = false;
    }
});

function handleLogout() {
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userPass');
    window.location.reload();
}

btnLogout.addEventListener('click', (e) => {
    e.preventDefault();
    handleLogout();
});

btnRefresh.addEventListener('click', loadEmails);
document.getElementById('btn-back-to-list').addEventListener('click', () => switchView('list'));

btnComposeNav.addEventListener('click', () => {
    formCompose.reset();
    quill.root.innerHTML = '';
    composeAttachments.value = '';
    switchView('compose');
});

btnDiscard.addEventListener('click', () => {
    if (confirm('¿Descartar mensaje?')) {
        switchView('list');
    }
});

// Send Email
formCompose.addEventListener('submit', async (e) => {
    e.preventDefault();
    const to = composeTo.value;
    const cc = composeCc.value;
    const subject = composeSubject.value;
    const htmlBody = quill.root.innerHTML;
    const textBody = quill.getText();
    const files = composeAttachments.files;

    const btnSend = document.getElementById('btn-send');
    btnSend.disabled = true;
    btnSend.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Enviando...';

    try {
        const formData = new FormData();
        formData.append('to', to);
        if (cc) formData.append('cc', cc);
        formData.append('subject', subject);
        // The backend expects 'body'
        formData.append('body', htmlBody);

        // Add senderName if it exists in localStorage
        const senderName = localStorage.getItem('senderName');
        if (senderName) {
            formData.append('senderName', senderName);
        }

        for (let i = 0; i < files.length; i++) {
            formData.append('attachments', files[i]);
        }

        const data = await apiRequest('/api/emails/send', 'POST', formData, true);
        if (data.success) {
            showStatus('Mensaje enviado con éxito');
            switchView('list');
            formCompose.reset();
            quill.root.innerHTML = '';
        }
    } catch (err) {
        showStatus('Error enviando mensaje: ' + err.message, true);
    } finally {
        btnSend.disabled = false;
        btnSend.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Enviar Mensaje';
    }
});
