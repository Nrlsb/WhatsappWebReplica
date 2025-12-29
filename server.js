const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const SessionManager = require('./sessionManager');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const port = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

const sessionManager = new SessionManager(io);
const supabase = require('./db');

// API to get chats for a session
app.get('/api/chats/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { data, error } = await supabase
        .from('chats')
        .select('*')
        .eq('session_id', sessionId)
        .order('timestamp', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

// API to get messages for a chat
app.get('/api/messages/:chatId', async (req, res) => {
    const { chatId } = req.params;
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('timestamp', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
});

io.on('connection', (socket) => {
    console.log('New socket connection');

    socket.on('join-session', (sessionId) => {
        if (!sessionId) return;
        console.log(`Socket joining session: ${sessionId}`);
        sessionManager.startSession(sessionId, socket);
    });

    socket.on('send-message', async (data) => {
        const { sessionId, to, message, media, quotedMessageId } = data;
        if (sessionId && to && (message || media)) {
            const success = await sessionManager.sendMessage(sessionId, to, message, media, quotedMessageId);
            if (success) {
                console.log(`Message sent in session ${sessionId} to ${to}`);
            } else {
                socket.emit('status', 'Failed to send message');
            }
        }
    });

    socket.on('force-sync', async (sessionId) => {
        if (sessionId) {
            console.log(`Force sync requested for session: ${sessionId}`);
            const success = await sessionManager.forceSync(sessionId);
            if (!success) {
                socket.emit('status', 'Session not ready for sync');
            }
        }
    });

    socket.on('logout', (sessionId) => {
        if (sessionId) {
            console.log(`Logout requested for session: ${sessionId}`);
            sessionManager.logout(sessionId);
        }
    });
});

server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
