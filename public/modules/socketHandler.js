import { state, setState } from './state.js';
import { renderChatList, renderMessages, showTyping, toggleNetworkError, selectChat } from './chatUI.js';
import { showModal, showToast, updatePageTitle } from './uiNotifications.js';

function calculateTotalUnread() {
    let total = 0;
    Object.values(state.chats).forEach(chat => {
        total += (chat.unreadCount || 0);
    });
    return total;
}

export function initializeSocket() {
    const { socket } = state;
    const qrOverlay = document.getElementById('qr-overlay');
    const qrImg = document.getElementById('qr-code');
    const appContainer = document.getElementById('app-container');
    const loginContainer = document.getElementById('login-container');
    const contactList = document.getElementById('contact-list');
    const chatMessages = document.getElementById('chat-messages');
    const syncStatusDiv = document.getElementById('sync-status');

    socket.on('connect', () => {
        console.log('Socket connected');
        toggleNetworkError(false);
    });

    socket.on('disconnect', () => {
        console.log('Socket disconnected');
        toggleNetworkError(true);
    });

    socket.on('status', (status) => {
        console.log('Status update:', status);
        if (status === 'WhatsApp disconnected' || status === 'Session logged out') {
            // Reset UI
            appContainer.style.display = 'none';
            loginContainer.style.display = 'block';
            qrOverlay.style.display = 'none';
            setState('currentSessionId', null);
            setState('chats', {});
            contactList.innerHTML = '';
            chatMessages.innerHTML = '';
            localStorage.removeItem('whatsapp_session_id');
            localStorage.removeItem('whatsapp_session_id');
            localStorage.removeItem('whatsapp_session_id');
            showModal('Disconnected', 'Session disconnected');
            updatePageTitle(0);
        }
    });

    socket.on('auth-failure', (msg) => {
        console.error('Auth failure:', msg);
        showModal('Authentication Failed', `Could not connect: ${msg}`);

        // Reset UI
        appContainer.style.display = 'none';
        loginContainer.style.display = 'block';
        qrOverlay.style.display = 'none';
        setState('currentSessionId', null);
        localStorage.removeItem('whatsapp_session_id');
    });

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
        if (state.currentSessionId) {
            fetch(`/api/chats/${state.currentSessionId}`)
                .then(res => res.json())
                .then(data => {
                    data.forEach(chat => {
                        state.chats[chat.id] = {
                            messages: [],
                            lastMessage: chat.last_message,
                            timestamp: chat.timestamp,
                            name: chat.contact_name,
                            profile_pic_url: chat.profile_pic_url,
                            unreadCount: chat.unread_count || 0
                        };
                    });
                    renderChatList();
                    updatePageTitle(calculateTotalUnread());
                })
                .catch(err => console.error('Error refreshing chats:', err));
        }
    });

    socket.on('qr', (url) => {
        qrImg.src = url;
        qrOverlay.style.display = 'flex';
    });

    socket.on('ready', (msg) => {
        qrOverlay.style.display = 'none';
    });

    socket.on('new-message', (data) => {
        const from = data.from;

        // Simulate typing indicator
        if (state.currentChatId === from) {
            showTyping();
        }

        if (!state.chats[from]) {
            state.chats[from] = { messages: [], lastMessage: '', timestamp: Date.now(), name: data.name };
        }

        // Duplicate check
        const lastMsg = state.chats[from].messages[state.chats[from].messages.length - 1];
        const isDuplicate = lastMsg &&
            lastMsg.body === data.body &&
            ((lastMsg.type === 'outgoing' && data.from_me) || (lastMsg.type === 'incoming' && !data.from_me)) &&
            (new Date() - new Date(lastMsg.timestamp) < 10000);

        if (isDuplicate) {
            console.log('Ignoring duplicate message:', data.body);
            return;
        }

        state.chats[from].messages.push({
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

        state.chats[from].lastMessage = data.body;
        state.chats[from].timestamp = Date.now();

        renderChatList();

        if (state.currentChatId === from) {
            renderMessages(from);
        } else {
            if (state.chats[from]) {
                state.chats[from].unreadCount = (state.chats[from].unreadCount || 0) + 1;
                state.chats[from].unreadCount = (state.chats[from].unreadCount || 0) + 1;
                renderChatList();
            }
            updatePageTitle(calculateTotalUnread());
            // Show toast notification
            const senderName = data.name || data.senderName || from;
            showToast(`New message from ${senderName}`);
        }
    });
}

export function joinSession(sessionId) {
    if (!sessionId) {
        showModal('Error', 'Please enter a Session ID');
        return;
    }

    setState('currentSessionId', sessionId);
    localStorage.setItem('whatsapp_session_id', sessionId);

    document.getElementById('login-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('no-chat-placeholder').style.display = 'flex';
    document.getElementById('chat-view').style.display = 'none';

    state.socket.emit('join-session', sessionId);

    // Fetch existing chats
    fetch(`/api/chats/${sessionId}`)
        .then(res => res.json())
        .then(data => {
            data.forEach(chat => {
                state.chats[chat.id] = {
                    messages: [],
                    lastMessage: chat.last_message,
                    timestamp: chat.timestamp,
                    name: chat.contact_name,
                    profile_pic_url: chat.profile_pic_url,
                    unreadCount: chat.unread_count || 0
                };
            });
            renderChatList();
            updatePageTitle(calculateTotalUnread());
        })
        .catch(err => console.error('Error fetching chats:', err));
}
