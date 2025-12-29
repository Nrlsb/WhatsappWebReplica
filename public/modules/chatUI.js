import { state, setState } from './state.js';
import { formatTime, getSenderColor, getTickIcon, dataURItoBlob } from './utils.js';
import { updatePageTitle } from './uiNotifications.js';

export function renderChatList() {
    const contactList = document.getElementById('contact-list');
    contactList.innerHTML = '';

    // Sort chats by timestamp desc
    const sortedChats = Object.keys(state.chats)
        .filter(id => id.endsWith('@c.us') || id.endsWith('@g.us'))
        .sort((a, b) => state.chats[b].timestamp - state.chats[a].timestamp);

    sortedChats.forEach(chatId => {
        const chat = state.chats[chatId];
        const div = document.createElement('div');
        div.className = `contact-item ${state.currentChatId === chatId ? 'active' : ''}`;
        div.onclick = () => selectChat(chatId);

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
                        ${chat.lastMessage ? chat.lastMessage.substring(0, 30) : ''}...
                    </div>
                    ${chat.unreadCount > 0 ? `<div class="unread-badge">${chat.unreadCount}</div>` : ''}
                </div>
            </div>
        `;
        contactList.appendChild(div);
    });
}

export function renderMessages(chatId) {
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = '';
    const chat = state.chats[chatId];

    if (chat && chat.messages) {
        chat.messages.forEach(msg => {
            const div = document.createElement('div');
            div.className = `message ${msg.type}`;
            const msgId = msg.id || (msg.timestamp instanceof Date ? msg.timestamp.getTime() : msg.timestamp);
            div.dataset.id = msgId;

            const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            let content = msg.body || '';
            if (msg.media_url) {
                if (msg.media_type === 'image') {
                    content = `<img src="${msg.media_url}" style="max-width: 200px; border-radius: 8px; cursor: pointer;" onclick="openLightbox('${msg.media_url}', 'image')"><br>${content}`;
                } else if (msg.media_type === 'video') {
                    content = `<video src="${msg.media_url}" style="max-width: 200px; border-radius: 8px; cursor: pointer;" onclick="openLightbox('${msg.media_url}', 'video')"></video><br>${content}`;
                } else if (msg.media_type === 'audio') {
                    content = `<audio controls src="${msg.media_url}"></audio><br>${content}`;
                } else if (msg.media_type === 'document') {
                    content = `
                        <div class="document-message" style="display: flex; align-items: center; background: rgba(0,0,0,0.05); padding: 10px; border-radius: 8px; cursor: pointer;" onclick="window.open('${msg.media_url}', '_blank')">
                            <i class="fas fa-file-pdf" style="font-size: 24px; color: #e74c3c; margin-right: 10px;"></i>
                            <span style="text-decoration: underline; color: #3498db;">${msg.caption || 'Document'}</span>
                        </div>
                    `;
                }
            }

            // Render Quoted Message
            let quotedContent = '';
            if (msg.quotedMsg) {
                quotedContent = `
                    <div class="quoted-message" onclick="scrollToMessage('${msg.quotedMsg.id}')">
                        <span class="quoted-sender" style="color: ${getSenderColor(msg.quotedMsg.participantId)}">${msg.quotedMsg.senderName || 'Contacto'}</span>
                        <span class="quoted-text">${msg.quotedMsg.body || (msg.quotedMsg.media_url ? '📷 Foto' : 'Mensaje')}</span>
                    </div>
                `;
            }

            div.innerHTML = `
                ${msg.participantId && msg.type !== 'outgoing' ? `<div class="message-sender" style="color: ${getSenderColor(msg.participantId)}; font-size: 0.75rem; font-weight: bold; margin-bottom: 2px;">${msg.senderName}</div>` : ''}
                ${quotedContent}
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

export function scrollToMessage(messageId) {
    // Need to expose this to window for onclick in HTML string
    const msgDiv = document.querySelector(`.message[data-id="${messageId}"]`);
    if (msgDiv) {
        msgDiv.scrollIntoView({ behavior: 'smooth', block: 'center' });
        msgDiv.style.background = 'rgba(0, 168, 132, 0.2)';
        setTimeout(() => {
            msgDiv.style.background = '';
        }, 1000);
    }
}
// Expose to window
window.scrollToMessage = scrollToMessage;

export function selectChat(chatId) {
    setState('currentChatId', chatId);
    const chatTitle = document.getElementById('chat-title');

    // Toggle Views
    document.getElementById('no-chat-placeholder').style.display = 'none';
    document.getElementById('chat-view').style.display = 'flex';

    const chat = state.chats[chatId];

    // Reset unread count
    if (chat.unreadCount > 0) {
        chat.unreadCount = 0;
        if (state.currentSessionId) {
            state.socket.emit('chat-read', chatId);
        }
        // Recalculate total unread
        let totalUnread = 0;
        Object.values(state.chats).forEach(c => {
            totalUnread += (c.unreadCount || 0);
        });
        updatePageTitle(totalUnread);
    }

    chatTitle.innerText = chat.name || chatId;

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
    if (!state.chats[chatId]) {
        state.chats[chatId] = { messages: [], lastMessage: '', timestamp: Date.now(), name: chatId };
    }

    // Fetch messages if empty
    if (state.chats[chatId].messages.length === 0) {
        fetch(`/api/messages/${chatId}`)
            .then(res => res.json())
            .then(data => {
                state.chats[chatId].messages = data.map(msg => ({
                    body: msg.body,
                    type: msg.from_me ? 'outgoing' : 'incoming',
                    from: msg.chat_id,
                    timestamp: new Date(parseInt(msg.timestamp)),
                    media_url: msg.media_url,
                    media_type: msg.media_type,
                    caption: msg.caption,
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

    renderChatList();
}

export function closeChat() {
    setState('currentChatId', null);
    document.getElementById('chat-messages').innerHTML = '';
    document.getElementById('chat-title').innerText = 'WhatsApp Web';

    document.getElementById('no-chat-placeholder').style.display = 'flex';
    document.getElementById('chat-view').style.display = 'none';

    const headerAvatar = document.querySelector('#chat-header .user-avatar');
    if (headerAvatar) {
        headerAvatar.innerHTML = '<i class="fas fa-user"></i>';
    }

    const activeContacts = document.querySelectorAll('.contact-item.active');
    activeContacts.forEach(el => el.classList.remove('active'));
}

let typingTimeout;
export function showTyping() {
    const statusDiv = document.querySelector('.chat-header-info .contact-status');
    if (statusDiv) {
        const originalText = statusDiv.dataset.originalText || statusDiv.innerText;

        if (!statusDiv.dataset.originalText) {
            statusDiv.dataset.originalText = originalText;
        }

        statusDiv.innerText = 'Escribiendo...';
        statusDiv.style.color = 'var(--primary-green)';
        statusDiv.style.fontWeight = 'bold';

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            statusDiv.innerText = originalText;
            statusDiv.style.color = '';
            statusDiv.style.fontWeight = '';
        }, 3000);
    }
}

export function sendMessage(text = null, media = null) {
    const messageInput = document.getElementById('message-text');
    const message = text || messageInput.value;
    const to = state.currentChatId;

    if (to && (message || media)) {
        if (!state.chats[to]) {
            state.chats[to] = { messages: [], lastMessage: '', timestamp: Date.now() };
        }

        const msgObj = {
            body: message,
            type: 'outgoing',
            timestamp: new Date(),
            media_url: media ? URL.createObjectURL(dataURItoBlob(media.data, media.mimetype)) : null,
            media_type: media ? (
                media.mimetype.startsWith('image') ? 'image' :
                    media.mimetype.startsWith('audio') ? 'audio' :
                        media.mimetype.startsWith('video') ? 'video' : 'document'
            ) : null,
            caption: message || (media ? media.filename : null),
            quotedMsg: state.quotedMessageId ? state.chats[to].messages.find(m => {
                const mId = m.id || (m.timestamp instanceof Date ? m.timestamp.getTime() : m.timestamp);
                return mId == state.quotedMessageId;
            }) : null
        };

        state.chats[to].messages.push(msgObj);
        state.chats[to].lastMessage = media ? (
            media.mimetype.startsWith('image') ? '📷 Image' :
                media.mimetype.startsWith('audio') ? '🎤 Audio' :
                    media.mimetype.startsWith('video') ? '🎥 Video' : '📄 Document'
        ) : message;
        state.chats[to].timestamp = Date.now();

        renderMessages(to);
        renderChatList();

        state.socket.emit('send-message', {
            sessionId: state.currentSessionId,
            to,
            message,
            media,
            quotedMessageId: state.quotedMessageId
        });

        cancelReply();

        messageInput.value = '';
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';

        const sendBtn = document.getElementById('send-btn');
        const micBtn = document.getElementById('mic-btn');
        if (sendBtn) sendBtn.style.display = 'none';
        if (micBtn) micBtn.style.display = 'block';
    } else {
        alert('Please select a chat or start a new one');
    }
}

export function startReply(messageId) {
    const chat = state.chats[state.currentChatId];
    const msg = chat.messages.find(m => {
        const mId = m.id || (m.timestamp instanceof Date ? m.timestamp.getTime() : m.timestamp);
        return mId == messageId;
    });

    if (msg) {
        setState('quotedMessageId', messageId);
        const replyPreview = document.getElementById('reply-preview');
        const replySender = replyPreview.querySelector('.reply-sender');
        const replyText = replyPreview.querySelector('.reply-text');

        replySender.innerText = msg.senderName || (msg.type === 'outgoing' ? 'Tú' : 'Contacto');
        replySender.style.color = getSenderColor(msg.participantId);
        replyText.innerText = msg.body || (msg.media_url ? '📷 Foto' : 'Mensaje');

        replyPreview.style.display = 'flex';
        document.getElementById('message-text').focus();
    } else {
        console.error('Message not found for reply:', messageId);
    }
}

export function cancelReply() {
    setState('quotedMessageId', null);
    const replyPreview = document.getElementById('reply-preview');
    if (replyPreview) {
        replyPreview.style.display = 'none';
    }
}
// Expose to window for onclick
window.cancelReply = cancelReply;

export function deleteMessage(messageId) {
    const chat = state.chats[state.currentChatId];
    if (chat) {
        chat.messages = chat.messages.filter(m => {
            const mId = m.id || (m.timestamp instanceof Date ? m.timestamp.getTime() : m.timestamp);
            return mId != messageId;
        });
        renderMessages(state.currentChatId);
    }
}

export function handleContextAction(action) {
    const contextMenu = document.getElementById('context-menu');
    const msgId = contextMenu.dataset.messageId;
    contextMenu.style.display = 'none';

    if (action === 'reply') {
        startReply(msgId);
    } else if (action === 'delete') {
        if (confirm('¿Eliminar este mensaje? (Solo visualmente por ahora)')) {
            deleteMessage(msgId);
        }
    } else if (action === 'info') {
        alert('Info del mensaje: ' + msgId);
    } else if (action === 'forward') {
        alert('Función de reenviar próximamente');
    }
}
// Expose to window
window.handleContextAction = handleContextAction;

export function toggleNetworkError(show) {
    const banner = document.getElementById('network-error-banner');
    if (banner) {
        banner.style.display = show ? 'block' : 'none';
    }
}

export function initializeEmojiPicker() {
    const emojiContainer = document.getElementById('emoji-picker-container');
    const emojiBtn = document.getElementById('emoji-btn');
    const messageInput = document.getElementById('message-text');

    if (window.picmo && emojiContainer) {
        const pickerInstance = window.picmo.createPicker({
            rootElement: emojiContainer
        });

        pickerInstance.addEventListener('emoji:select', (selection) => {
            messageInput.value += selection.emoji;
            messageInput.focus();
            messageInput.dispatchEvent(new Event('input'));
        });

        emojiBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (emojiContainer.style.display === 'none' || emojiContainer.style.display === '') {
                emojiContainer.style.display = 'block';
            } else {
                emojiContainer.style.display = 'none';
            }
        });

        document.addEventListener('click', (e) => {
            if (!emojiContainer.contains(e.target) && e.target !== emojiBtn) {
                emojiContainer.style.display = 'none';
            }
        });
    }
}

export function initializeSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const contactItems = document.querySelectorAll('.contact-item');

            contactItems.forEach(item => {
                const name = item.querySelector('.contact-name').innerText.toLowerCase();
                const lastMsg = item.querySelector('.contact-status').innerText.toLowerCase();

                if (name.includes(query) || lastMsg.includes(query)) {
                    item.style.display = 'flex';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }
}

export function initializeContextMenu() {
    const chatMessages = document.getElementById('chat-messages');
    const contextMenu = document.getElementById('context-menu');

    if (chatMessages) {
        chatMessages.addEventListener('contextmenu', (e) => {
            const messageDiv = e.target.closest('.message');
            if (messageDiv) {
                e.preventDefault();
                contextMenu.style.display = 'block';

                // Adjust position
                let x = e.pageX;
                let y = e.pageY;

                if (x + 150 > window.innerWidth) x -= 150;
                if (y + 150 > window.innerHeight) y -= 150;

                contextMenu.style.left = `${x}px`;
                contextMenu.style.top = `${y}px`;
                contextMenu.dataset.messageId = messageDiv.dataset.id;
            }
        });
    }

    document.addEventListener('click', (e) => {
        if (contextMenu.style.display === 'block' && !contextMenu.contains(e.target)) {
            contextMenu.style.display = 'none';
        }
    });
}
