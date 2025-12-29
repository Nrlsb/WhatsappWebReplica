const socket = io();
let currentSessionId = null;
let chats = {}; // { phoneNumber: { messages: [], lastMessage: '', timestamp: 0 } }
let currentChatId = null;

const loginContainer = document.getElementById('login-container');
const appContainer = document.getElementById('app-container');
const qrOverlay = document.getElementById('qr-overlay');
const qrImg = document.getElementById('qr-code');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-text');
const contactList = document.getElementById('contact-list');
const chatTitle = document.getElementById('chat-title');
const targetNumberInput = document.getElementById('target-number');
const newChatBtn = document.querySelector('.fa-edit'); // Updated selector for New Chat (Edit icon)
const syncBtn = document.getElementById('sync-btn');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');

// Initialize New Chat Button
newChatBtn.addEventListener('click', () => {
    const number = prompt('Enter phone number (e.g., 5491122334455@c.us):');
    if (number) {
        selectChat(number);
    }
});

// Check for saved session on load
window.addEventListener('load', () => {
    const savedSessionId = localStorage.getItem('whatsapp_session_id');
    if (savedSessionId) {
        console.log('Found saved session:', savedSessionId);
        document.getElementById('session-id-input').value = savedSessionId;
        joinSession();
    }
});

// Initialize Sync Button
if (syncBtn) {
    syncBtn.addEventListener('click', () => {
        if (currentSessionId) {
            console.log('Requesting manual sync...');
            socket.emit('force-sync', currentSessionId);
            // Rotate icon
            syncBtn.classList.add('fa-spin');
        } else {
            alert('Please login first');
        }
    });
}

// Toggle Send/Mic button
messageInput.addEventListener('input', () => {
    if (messageInput.value.trim()) {
        sendBtn.style.display = 'block';
        micBtn.style.display = 'none';
    } else {
        sendBtn.style.display = 'none';
        micBtn.style.display = 'block';
    }
});

// Logout Button
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem('whatsapp_session_id'); // Clear saved session
            socket.emit('logout', currentSessionId);
        }
    });
}

socket.on('status', (status) => {
    console.log('Status update:', status);
    if (status === 'WhatsApp disconnected' || status === 'Session logged out') {
        // Reset UI
        appContainer.style.display = 'none';
        loginContainer.style.display = 'block';
        qrOverlay.style.display = 'none';
        currentSessionId = null;
        chats = {};
        contactList.innerHTML = '';
        chatMessages.innerHTML = '';
        localStorage.removeItem('whatsapp_session_id'); // Ensure it's cleared
        alert('Session disconnected');
    }
});

const syncStatusDiv = document.getElementById('sync-status');

socket.on('sync-progress', (data) => {
    if (syncStatusDiv) {
        syncStatusDiv.style.display = 'block';
        syncStatusDiv.innerText = `Syncing chats... ${data.current}/${data.total} (${data.percent}%)`;
    }
});

socket.on('chats-synced', () => {
    if (syncStatusDiv) {
        syncStatusDiv.innerText = 'Sync complete!';
        setTimeout(() => {
            syncStatusDiv.style.display = 'none';
        }, 3000);
    }
    const syncBtn = document.getElementById('sync-btn');
    if (syncBtn) syncBtn.classList.remove('fa-spin');
    // Refresh chat list
    if (currentSessionId) {
        fetch(`/api/chats/${currentSessionId}`)
            .then(res => res.json())
            .then(data => {
                data.forEach(chat => {
                    chats[chat.id] = {
                        messages: [],
                        lastMessage: chat.last_message,
                        timestamp: chat.timestamp,
                        name: chat.contact_name,
                        profile_pic_url: chat.profile_pic_url,
                        unreadCount: chat.unread_count || 0
                    };
                });
                renderChatList();
            })
            .catch(err => console.error('Error refreshing chats:', err));
    }
});

function joinSession() {
    const sessionId = document.getElementById('session-id-input').value.trim();
    if (!sessionId) {
        alert('Please enter a Session ID');
        return;
    }

    currentSessionId = sessionId;
    localStorage.setItem('whatsapp_session_id', sessionId); // Save session

    loginContainer.style.display = 'none';
    appContainer.style.display = 'flex';

    socket.emit('join-session', sessionId);

    // Fetch existing chats
    fetch(`/api/chats/${sessionId}`)
        .then(res => res.json())
        .then(data => {
            data.forEach(chat => {
                chats[chat.id] = {
                    messages: [], // We'll load these on demand
                    lastMessage: chat.last_message,
                    timestamp: chat.timestamp,
                    name: chat.contact_name,
                    profile_pic_url: chat.profile_pic_url,
                    unreadCount: chat.unread_count || 0
                };
            });
            renderChatList();
        })
        .catch(err => console.error('Error fetching chats:', err));
}

socket.on('qr', (url) => {
    qrImg.src = url;
    qrOverlay.style.display = 'flex';
});

socket.on('ready', (msg) => {
    qrOverlay.style.display = 'none';
});

socket.on('new-message', (data) => {
    const from = data.from; // This is the Chat ID

    if (!chats[from]) {
        chats[from] = { messages: [], lastMessage: '', timestamp: Date.now(), name: data.name };
    }

    // Duplicate check to prevent double rendering of messages sent from this client
    const lastMsg = chats[from].messages[chats[from].messages.length - 1];
    const isDuplicate = lastMsg &&
        lastMsg.body === data.body &&
        ((lastMsg.type === 'outgoing' && data.from_me) || (lastMsg.type === 'incoming' && !data.from_me)) &&
        (new Date() - new Date(lastMsg.timestamp) < 10000); // 10 seconds window

    if (isDuplicate) {
        console.log('Ignoring duplicate message:', data.body);
        return;
    }

    chats[from].messages.push({
        body: data.body,
        type: data.from_me ? 'outgoing' : 'incoming',
        from: from,
        timestamp: new Date(),
        media_url: data.media_url,
        media_type: data.media_type,
        caption: data.caption,
        senderName: data.senderName,
        participantId: data.participantId
    });

    chats[from].lastMessage = data.body;
    chats[from].timestamp = Date.now();

    renderChatList();

    if (currentChatId === from) {
        renderMessages(from);
    } else {
        // Increment unread count if not in current chat
        if (chats[from]) {
            chats[from].unreadCount = (chats[from].unreadCount || 0) + 1;
            renderChatList();
        }
    }
});



function sendMessage() {
    const message = messageInput.value;
    const to = currentChatId; // Always use the current chat ID

    if (to && message) {
        if (!chats[to]) {
            chats[to] = { messages: [], lastMessage: '', timestamp: Date.now() };
        }

        chats[to].messages.push({
            body: message,
            type: 'outgoing',
            timestamp: new Date()
        });
        chats[to].lastMessage = message;
        chats[to].timestamp = Date.now();

        renderMessages(to); // Render immediately
        renderChatList();

        socket.emit('send-message', {
            sessionId: currentSessionId,
            to,
            message
        });
        messageInput.value = '';

        // Reset send button visibility
        sendBtn.style.display = 'none';
        micBtn.style.display = 'block';
    } else {
        alert('Please select a chat or start a new one');
    }
}

function selectChat(chatId) {
    currentChatId = chatId;
    const chat = chats[chatId];

    // Reset unread count
    if (chat.unreadCount > 0) {
        chat.unreadCount = 0;
        // Emit read event to server
        if (currentSessionId) {
            socket.emit('chat-read', chatId);
        }
    }

    chatTitle.innerText = chat.name || chatId; // Display name if available

    // Update Header Avatar
    const headerAvatar = document.querySelector('#chat-header .user-avatar');
    if (headerAvatar) {
        if (chat.profile_pic_url) {
            headerAvatar.innerHTML = `<img src="${chat.profile_pic_url}" class="avatar-img" onerror="this.onerror=null;this.src='';this.parentElement.innerHTML='<i class=\\'fas fa-user\\'></i>'">`;
        } else {
            headerAvatar.innerHTML = '<i class="fas fa-user"></i>';
        }
    }

    // Ensure chat exists in state
    if (!chats[chatId]) {
        chats[chatId] = { messages: [], lastMessage: '', timestamp: Date.now(), name: chatId };
    }

    // Fetch messages if empty (or could always fetch to sync)
    if (chats[chatId].messages.length === 0) {
        fetch(`/api/messages/${chatId}`)
            .then(res => res.json())
            .then(data => {
                chats[chatId].messages = data.map(msg => ({
                    body: msg.body,
                    type: msg.from_me ? 'outgoing' : 'incoming',
                    from: msg.chat_id, // or sender_name
                    timestamp: new Date(parseInt(msg.timestamp)),
                    media_url: msg.media_url,
                    media_type: msg.media_type,
                    caption: msg.caption,
                    ack: msg.ack,
                    ack: msg.ack,
                    id: msg.whatsapp_id,
                    senderName: msg.sender_name,
                    participantId: msg.participant_id
                }));
                renderMessages(chatId);
            })
            .catch(err => console.error('Error fetching messages:', err));
    } else {
        renderMessages(chatId);
    }

    renderChatList(); // To update active state
}

function renderChatList() {
    contactList.innerHTML = '';

    // Sort chats by timestamp desc
    const sortedChats = Object.keys(chats)
        .filter(id => id.endsWith('@c.us') || id.endsWith('@g.us'))
        .sort((a, b) => chats[b].timestamp - chats[a].timestamp);

    sortedChats.forEach(chatId => {
        const chat = chats[chatId];
        const div = document.createElement('div');
        div.className = `contact-item ${currentChatId === chatId ? 'active' : ''}`;
        div.onclick = () => selectChat(chatId);

        console.log(`Rendering chat ${chatId}:`, chat.name, chat.profile_pic_url);
        const profilePic = chat.profile_pic_url
            ? `<img src="${chat.profile_pic_url}" class="avatar-img" onerror="this.onerror=null;this.src='';this.parentElement.innerHTML='<i class=\\'fas fa-user\\'></i>'">`
            : '<i class="fas fa-user"></i>';

        div.innerHTML = `
            <div class="user-avatar">
                ${profilePic}
            </div>
            <div class="contact-info">
                <div class="contact-row-top">
                    <div class="contact-name">${chat.name || chatId}</div>
                    <div class="contact-time">${formatTime(chat.timestamp)}</div>
                </div>
                <div class="contact-row-bottom">
                    <div class="contact-status">
                        ${chat.lastMessage.substring(0, 30)}...
                    </div>
                    ${chat.unreadCount > 0 ? `<div class="unread-badge">${chat.unreadCount}</div>` : ''}
                </div>
            </div>
        `;
        contactList.appendChild(div);
    });
}

const fileInput = document.getElementById('file-input');
const stopBtn = document.getElementById('stop-btn');
let mediaRecorder;
let audioChunks = [];

// File Attachment
fileInput.addEventListener('change', (e) => {
    console.log('File input changed');
    const file = e.target.files[0];
    if (file) {
        console.log('File selected:', file.name);
        const reader = new FileReader();
        reader.onload = function (evt) {
            const base64Data = evt.target.result.split(',')[1];
            const media = {
                data: base64Data,
                mimetype: file.type,
                filename: file.name
            };
            console.log('Sending media message...');
            sendMessage(null, media);
        };
        reader.readAsDataURL(file);
    }
});

// Audio Recording
micBtn.addEventListener('click', async () => {
    console.log('Mic button clicked');
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            console.log('Microphone access granted');
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                audioChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                console.log('Recording stopped');
                const audioBlob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64Data = reader.result.split(',')[1];
                    const media = {
                        data: base64Data,
                        mimetype: 'audio/ogg; codecs=opus',
                        filename: 'voice_note.ogg'
                    };
                    sendMessage(null, media);
                };
            };

            mediaRecorder.start();
            micBtn.style.display = 'none';
            stopBtn.style.display = 'block';
        } catch (err) {
            console.error('Error accessing microphone:', err);
            alert('Could not access microphone: ' + err.message);
        }
    } else {
        console.error('navigator.mediaDevices not supported');
        alert('Audio recording not supported in this browser context (requires HTTPS or localhost)');
    }
});

stopBtn.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        micBtn.style.display = 'block';
        stopBtn.style.display = 'none';
    }
});

// Allow sending with Enter key
messageInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
        sendMessage();
    }
});

function sendMessage(text = null, media = null) {
    const message = text || messageInput.value;
    const to = currentChatId;

    if (to && (message || media)) {
        if (!chats[to]) {
            chats[to] = { messages: [], lastMessage: '', timestamp: Date.now() };
        }

        const msgObj = {
            body: message,
            type: 'outgoing',
            timestamp: new Date(),
            media_url: media ? URL.createObjectURL(dataURItoBlob(media.data, media.mimetype)) : null, // Temporary preview
            media_type: media ? (
                media.mimetype.startsWith('image') ? 'image' :
                    media.mimetype.startsWith('audio') ? 'audio' :
                        media.mimetype.startsWith('video') ? 'video' : 'document'
            ) : null,
            caption: message || (media ? media.filename : null)
        };

        chats[to].messages.push(msgObj);
        chats[to].lastMessage = media ? (
            media.mimetype.startsWith('image') ? '📷 Image' :
                media.mimetype.startsWith('audio') ? '🎤 Audio' :
                    media.mimetype.startsWith('video') ? '🎥 Video' : '📄 Document'
        ) : message;
        chats[to].timestamp = Date.now();

        renderMessages(to);
        renderChatList();

        socket.emit('send-message', {
            sessionId: currentSessionId,
            to,
            message,
            media
        });
        messageInput.value = '';
        fileInput.value = ''; // Reset file input

        // Reset send button visibility
        sendBtn.style.display = 'none';
        micBtn.style.display = 'block';
    } else {
        alert('Please select a chat or start a new one');
    }
}

function dataURItoBlob(dataURI, mimetype) {
    const byteString = atob(dataURI);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimetype });
}

function renderMessages(chatId) {
    chatMessages.innerHTML = '';
    const chat = chats[chatId];

    if (chat && chat.messages) {
        chat.messages.forEach(msg => {
            console.log('Rendering message:', msg); // Debug log
            const div = document.createElement('div');
            div.className = `message ${msg.type}`;

            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let content = msg.body || '';
            if (msg.media_url) {
                console.log('Message has media:', msg.media_url, msg.media_type); // Debug log
                if (msg.media_type === 'image') {
                    content = `<img src="${msg.media_url}" style="max-width: 200px; border-radius: 8px; cursor: pointer;" onclick="window.open('${msg.media_url}', '_blank')"><br>${content}`;
                } else if (msg.media_type === 'audio') {
                    content = `<audio controls src="${msg.media_url}"></audio><br>${content}`;
                } else if (msg.media_type === 'video') {
                    content = `<video controls src="${msg.media_url}" style="max-width: 200px; border-radius: 8px;"></video><br>${content}`;
                } else if (msg.media_type === 'document') {
                    content = `
                        <div class="document-message" style="display: flex; align-items: center; background: rgba(0,0,0,0.05); padding: 10px; border-radius: 8px; cursor: pointer;" onclick="window.open('${msg.media_url}', '_blank')">
                            <i class="fas fa-file-pdf" style="font-size: 24px; color: #e74c3c; margin-right: 10px;"></i>
                            <span style="text-decoration: underline; color: #3498db;">${msg.caption || 'Document'}</span>
                        </div>
                    `;
                }
            }

            div.innerHTML = `
                ${msg.participantId && msg.type !== 'outgoing' ? `<div class="message-sender" style="color: ${getSenderColor(msg.participantId)}; font-size: 0.75rem; font-weight: bold; margin-bottom: 2px;">${msg.senderName}</div>` : ''}
                ${content}
                <div class="message-meta">
                    ${time}
                    ${msg.type === 'outgoing' ? getTickIcon(msg.ack) : ''}
                </div>
            `;
            chatMessages.appendChild(div);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function getSenderColor(participantId) {
    if (!participantId) return '#000000';
    const colors = [
        '#e53935', '#d81b60', '#8e24aa', '#5e35b1', '#3949ab',
        '#1e88e5', '#039be5', '#00acc1', '#00897b', '#43a047',
        '#7cb342', '#c0ca33', '#fdd835', '#ffb300', '#fb8c00',
        '#f4511e', '#6d4c41', '#757575', '#546e7a'
    ];
    let hash = 0;
    for (let i = 0; i < participantId.length; i++) {
        hash = participantId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getTickIcon(ack) {
    /*
        ack values:
        1: Sent (one grey tick)
        2: Delivered (two grey ticks)
        3: Read (two blue ticks)
    */
    if (!ack || ack === 0) return '<i class="fas fa-check" style="color: #8696a0; margin-left: 3px;"></i>'; // Pending/Sent
    if (ack === 1) return '<i class="fas fa-check" style="color: #8696a0; margin-left: 3px;"></i>';
    if (ack === 2) return '<i class="fas fa-check-double" style="color: #8696a0; margin-left: 3px;"></i>';
    if (ack === 3 || ack === 4) return '<i class="fas fa-check-double" style="color: #53bdeb; margin-left: 3px;"></i>';
    return '';
}

// Update message-ack handler
socket.on('message-ack', (data) => {
    // data: { msgId, ack, chatId }
    const chatId = data.chatId;
    if (chats[chatId]) {
        const msg = chats[chatId].messages.find(m => m.id === data.msgId);
        if (msg) {
            msg.ack = data.ack;
            if (currentChatId === chatId) {
                renderMessages(chatId);
            }
        }
    }
});
