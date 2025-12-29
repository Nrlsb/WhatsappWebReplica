const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const supabase = require('./db');

class SessionManager {
    constructor(io) {
        this.io = io;
        this.sessions = new Map();
    }

    async startSession(sessionId, socket) {
        // Join the socket to a room dedicated to this session
        socket.join(sessionId);

        // Upsert session in DB
        await supabase.from('sessions').upsert({ id: sessionId, status: 'initializing' });

        if (this.sessions.has(sessionId)) {
            const session = this.sessions.get(sessionId);
            if (session.ready) {
                socket.emit('ready', 'WhatsApp is connected');
                socket.emit('status', 'Session restored');
            } else {
                socket.emit('status', 'Session is initializing...');
            }
            return;
        }

        console.log(`Starting session: ${sessionId}`);
        socket.emit('status', 'Initializing WhatsApp client...');

        const client = new Client({
            authStrategy: new LocalAuth({ clientId: sessionId }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }
        });

        const sessionData = {
            client: client,
            ready: false
        };

        this.sessions.set(sessionId, sessionData);

        client.on('qr', (qr) => {
            qrcode.toDataURL(qr, (err, url) => {
                if (err) {
                    console.error('Error generating QR', err);
                    return;
                }
                this.io.to(sessionId).emit('qr', url);
                this.io.to(sessionId).emit('status', 'Waiting for QR scan...');
            });
        });

        client.on('ready', async () => {
            sessionData.ready = true;
            this.io.to(sessionId).emit('ready', 'WhatsApp is connected');
            this.io.to(sessionId).emit('status', 'Session active');
            console.log(`Session ${sessionId} is ready`);

            // Update session status in DB
            await supabase.from('sessions').upsert({ id: sessionId, status: 'ready' });

            // Sync existing chats
            this.syncChats(sessionId, client);
        });

        client.on('message_create', async (msg) => {
            console.log(`Message received in session ${sessionId}:`, msg.id._serialized);
            try {
                const chat = await msg.getChat();
                const chatId = chat.id._serialized;
                let contactName = chat.name || chatId;

                // Try to get contact name if chat name is missing (e.g. for private chats)
                if (!chat.name) {
                    try {
                        const contact = await chat.getContact();
                        contactName = contact.name || contact.pushname || chatId;
                    } catch (err) {
                        // Ignore
                    }
                }

                // Save message to DB
                const timestamp = Date.now();
                let mediaUrl = null;
                let mediaType = null;
                let caption = msg.body;

                if (msg.hasMedia) {
                    try {
                        const media = await msg.downloadMedia();
                        if (media) {
                            const extension = media.mimetype.split('/')[1].split(';')[0];
                            const filename = `${msg.id.id}.${extension}`;

                            // Convert Base64 to Buffer
                            const buffer = Buffer.from(media.data, 'base64');

                            // Upload to Supabase Storage
                            const { data, error } = await supabase
                                .storage
                                .from('whatsapp-media')
                                .upload(filename, buffer, {
                                    contentType: media.mimetype,
                                    upsert: true
                                });

                            if (error) {
                                console.error('Error uploading to Supabase:', error);
                            } else {
                                // Get Public URL
                                const { data: publicUrlData } = supabase
                                    .storage
                                    .from('whatsapp-media')
                                    .getPublicUrl(filename);

                                mediaUrl = publicUrlData.publicUrl;
                                console.log(`Media uploaded to Supabase: ${mediaUrl}`);
                            }

                            mediaType = media.mimetype.startsWith('image') ? 'image' :
                                media.mimetype.startsWith('audio') ? 'audio' :
                                    media.mimetype.startsWith('video') ? 'video' : 'document';
                        }

                        // If it's an audio/voice message, it might not have a body/caption
                        if (!caption) {
                            if (mediaType === 'audio') {
                                caption = 'Audio Message';
                            } else if (mediaType === 'document') {
                                caption = media.filename || 'Document';
                            }
                        }
                    } catch (mediaErr) {
                        console.error('Error downloading media:', mediaErr);
                    }
                }

                // Get participant info for groups
                let participantId = null;
                let senderName = msg.fromMe ? 'Me' : contactName;

                if (chat.isGroup && !msg.fromMe) {
                    participantId = msg.author;
                    try {
                        const contact = await client.getContactById(participantId);
                        senderName = contact.name || contact.pushname || participantId.split('@')[0];
                        // Format: +123456789 ~Pushname
                        if (!contact.name && contact.pushname) {
                            senderName = `+${participantId.split('@')[0]} ~${contact.pushname}`;
                        } else if (!contact.name) {
                            senderName = `+${participantId.split('@')[0]}`;
                        }
                    } catch (err) {
                        console.warn('Error fetching participant contact:', err);
                        senderName = participantId.split('@')[0];
                    }
                }

                // Upsert chat
                await supabase.from('chats').upsert({
                    id: chatId,
                    session_id: sessionId,
                    contact_name: contactName,
                    last_message: caption || (mediaType ? `[${mediaType}]` : msg.body),
                    timestamp: timestamp
                });

                // Insert message
                await supabase.from('messages').upsert({
                    chat_id: chatId,
                    whatsapp_id: msg.id._serialized,
                    body: caption || msg.body,
                    from_me: msg.fromMe,
                    sender_name: senderName,
                    timestamp: timestamp,
                    media_url: mediaUrl,
                    media_type: mediaType,
                    caption: caption,
                    participant_id: participantId
                }, { onConflict: 'whatsapp_id', ignoreDuplicates: true });

                this.io.to(sessionId).emit('new-message', {
                    from: chatId, // Use Chat ID as 'from' so frontend updates the correct chat
                    body: caption || msg.body,
                    name: contactName,
                    senderName: senderName, // Specific sender name for group
                    participantId: participantId,
                    media_url: mediaUrl,
                    media_type: mediaType,
                    from_me: msg.fromMe,
                    caption: caption
                });
            } catch (err) {
                console.error('Error handling message_create:', err);
            }
        });

        client.on('message_ack', async (msg, ack) => {
            console.log(`Message ack in session ${sessionId}: ${msg.id._serialized} status: ${ack}`);
            /*
                ack values:
                1: Sent
                2: Delivered
                3: Read
            */
            // console.log(`Message ${msg.id._serialized} ack: ${ack}`);

            // Update message in DB
            await supabase.from('messages').update({ ack: ack }).eq('whatsapp_id', msg.id._serialized);

            // Emit to frontend
            this.io.to(sessionId).emit('message-ack', {
                msgId: msg.id._serialized,
                ack: ack,
                chatId: msg.to // or msg.from depending on who sent it, but for outgoing it's usually to
            });
        });

        client.on('disconnected', async (reason) => {
            console.log(`Session ${sessionId} disconnected: ${reason}`);
            this.io.to(sessionId).emit('status', 'WhatsApp disconnected');
            this.sessions.delete(sessionId);
            client.destroy();

            // Update session status in DB
            await supabase.from('sessions').upsert({ id: sessionId, status: 'disconnected' });
        });

        socket.on('chat-read', async (chatId) => {
            const session = this.sessions.get(sessionId);
            if (session && session.ready) {
                try {
                    // Mark as read on WhatsApp
                    await session.client.sendSeen(chatId);

                    // Update DB
                    await supabase.from('chats').update({ unread_count: 0 }).eq('id', chatId);
                    // console.log(`Chat ${chatId} marked as read`);
                } catch (err) {
                    console.error(`Error marking chat ${chatId} as read:`, err);
                }
            }
        });

        try {
            await client.initialize();
        } catch (err) {
            console.error(`Error initializing session ${sessionId}:`, err);
            socket.emit('status', 'Error initializing session');
            this.sessions.delete(sessionId);
        }
    }

    async sendMessage(sessionId, to, message, media = null) {
        const session = this.sessions.get(sessionId);
        if (session && session.ready) {
            try {
                let sentMsg;
                let mediaUrl = null;
                let mediaType = null;
                const timestamp = Date.now();

                if (media) {
                    const { MessageMedia } = require('whatsapp-web.js');
                    const msgMedia = new MessageMedia(media.mimetype, media.data, media.filename);
                    sentMsg = await session.client.sendMessage(to, msgMedia, { caption: message });

                    // For outgoing media, we assume it's already uploaded or we upload it here
                    // For simplicity, let's assume media.url is provided if it's already uploaded
                    // Or, if media.data is provided, we'd upload it to Supabase here.
                    // For now, we'll just set mediaUrl if media.url is present in the media object.
                    if (media.url) {
                        mediaUrl = media.url;
                    } else if (media.data && media.mimetype && media.filename) {
                        // Example: Upload to Supabase Storage if not already done
                        const extension = media.mimetype.split('/')[1].split(';')[0];
                        const filename = `outgoing_${Date.now()}.${extension}`;
                        const buffer = Buffer.from(media.data, 'base64');

                        const { data, error } = await supabase
                            .storage
                            .from('whatsapp-media')
                            .upload(filename, buffer, {
                                contentType: media.mimetype,
                                upsert: true
                            });

                        if (error) {
                            console.error('Error uploading outgoing media to Supabase:', error);
                        } else {
                            const { data: publicUrlData } = supabase
                                .storage
                                .from('whatsapp-media')
                                .getPublicUrl(filename);
                            mediaUrl = publicUrlData.publicUrl;
                            console.log(`Outgoing media uploaded to Supabase: ${mediaUrl}`);
                        }
                    }
                    mediaType = media.mimetype.startsWith('image') ? 'image' :
                        media.mimetype.startsWith('audio') ? 'audio' :
                            media.mimetype.startsWith('video') ? 'video' : 'document';

                } else {
                    sentMsg = await session.client.sendMessage(to, message);
                }

                // Determine final caption for DB
                let finalCaption = message;
                if (!finalCaption && mediaType === 'document' && media.filename) {
                    finalCaption = media.filename;
                } else if (!finalCaption && mediaType === 'audio') {
                    finalCaption = 'Audio Message';
                }

                // Upsert chat (ensure it exists)
                await supabase.from('chats').upsert({
                    id: to,
                    session_id: sessionId,
                    contact_name: to, // Ideally we fetch the name if known, but for now use ID
                    last_message: finalCaption || (mediaType ? `[${mediaType}]` : ''),
                    timestamp: timestamp
                });

                // Insert message
                await supabase.from('messages').upsert({
                    chat_id: to,
                    whatsapp_id: sentMsg.id._serialized,
                    body: finalCaption || '',
                    from_me: true,
                    timestamp: timestamp,
                    media_url: mediaUrl,
                    media_type: mediaType,
                    caption: finalCaption
                }, { onConflict: 'whatsapp_id', ignoreDuplicates: true });

                return true;
            } catch (err) {
                console.error(`Error sending message in session ${sessionId}:`, err);
                return false;
            }
        }
        return false;
    }

    async syncChats(sessionId, client) {
        console.log(`Syncing chats for session ${sessionId}...`);
        try {
            let chats = await client.getChats();

            // Sort chats by timestamp descending (newest first) to prioritize active chats
            chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            const totalChats = chats.length;
            const CHATS_TO_SYNC_MESSAGES = 20; // Only sync full message history for the top 20 chats

            let errorCount = 0;
            for (let i = 0; i < totalChats; i++) {
                const chat = chats[i];
                try {
                    let contactName = chat.name || chat.id.user;
                    let profilePicUrl = null;

                    try {
                        const contact = await chat.getContact();
                        contactName = contact.name || contact.pushname || contactName;
                    } catch (contactErr) {
                        // Suppress individual contact errors to avoid console spam
                        // Ignore specific WWebJS internal error that happens on some contacts
                        if (!contactErr.message.includes('getIsMyContact')) {
                            console.warn(`Error fetching contact details for ${contactName}:`, contactErr.message);
                        }
                    }

                    try {
                        // Fetch profile picture
                        // Use client.getProfilePicUrl directly to avoid contact object errors
                        // Add 5s timeout to prevent hanging
                        profilePicUrl = await this.promiseWithTimeout(
                            client.getProfilePicUrl(chat.id._serialized),
                            5000,
                            'Profile pic fetch timed out'
                        );
                        console.log(`Profile pic for ${contactName} (${chat.id._serialized}): ${profilePicUrl}`);
                    } catch (picErr) {
                        console.warn(`Error fetching profile pic for ${contactName}:`, picErr.message);
                        errorCount++;
                    }

                    const timestamp = chat.timestamp ? chat.timestamp * 1000 : Date.now();

                    // Upsert chat
                    const { error: upsertError } = await supabase.from('chats').upsert({
                        id: chat.id._serialized,
                        session_id: sessionId,
                        contact_name: contactName,
                        last_message: chat.lastMessage ? chat.lastMessage.body : '',
                        timestamp: timestamp,
                        profile_pic_url: profilePicUrl,
                        unread_count: chat.unreadCount
                    });

                    if (upsertError) {
                        console.error(`Error upserting chat ${contactName}:`, upsertError.message);
                    } else {
                        // console.log(`Chat ${contactName} updated/inserted`);
                    }

                    // Sync messages only for the most recent chats to speed up startup
                    if (i < CHATS_TO_SYNC_MESSAGES) {
                        try {
                            // Add 10s timeout for message fetching
                            const messages = await this.promiseWithTimeout(
                                chat.fetchMessages({ limit: 20 }),
                                10000,
                                'Message fetch timed out'
                            );
                            const messagesToInsert = await Promise.all(messages.map(async (msg) => {
                                let participantId = null;
                                let senderName = msg.fromMe ? 'Me' : contactName;

                                if (chat.isGroup && !msg.fromMe) {
                                    participantId = msg.author;
                                    try {
                                        // We might need to fetch contact here if not cached, but for sync speed we might skip or try
                                        // For now, let's try to get basic info from the ID or if we can fetch contact cheaply
                                        // client.getContactById might be slow in a loop.
                                        // Let's use a simple formatting for now or try to fetch if critical.
                                        // To avoid slowing down sync too much, we might just use the ID or try to fetch.
                                        // Let's try to fetch but handle errors/timeouts.
                                        const contact = await client.getContactById(participantId);
                                        senderName = contact.name || contact.pushname || participantId.split('@')[0];
                                        if (!contact.name && contact.pushname) {
                                            senderName = `+${participantId.split('@')[0]} ~${contact.pushname}`;
                                        } else if (!contact.name) {
                                            senderName = `+${participantId.split('@')[0]}`;
                                        }
                                    } catch (e) {
                                        senderName = participantId ? participantId.split('@')[0] : 'Unknown';
                                    }
                                }

                                return {
                                    chat_id: chat.id._serialized,
                                    whatsapp_id: msg.id._serialized, // Unique ID from WhatsApp
                                    body: msg.body,
                                    from_me: msg.fromMe,
                                    sender_name: senderName,
                                    timestamp: msg.timestamp * 1000,
                                    media_url: null, // We'd need to process media for history too, but for now null
                                    media_type: msg.type,
                                    caption: msg.body,
                                    ack: msg.ack,
                                    participant_id: participantId
                                };
                            }));

                            if (messagesToInsert.length > 0) {
                                // Use upsert to prevent duplicates based on whatsapp_id (requires unique constraint)
                                const { error } = await supabase.from('messages').upsert(messagesToInsert, { onConflict: 'whatsapp_id', ignoreDuplicates: true });
                                if (error) {
                                    // console.warn('Error inserting messages:', error.message);
                                }
                            }
                        } catch (msgErr) {
                            console.warn(`Could not fetch messages for ${chat.id._serialized}: ${msgErr.message}`);
                        }
                    }

                    // Emit progress every 5 chats or on the last one
                    if ((i + 1) % 5 === 0 || i === totalChats - 1) {
                        const percent = Math.round(((i + 1) / totalChats) * 100);
                        this.io.to(sessionId).emit('sync-progress', {
                            current: i + 1,
                            total: totalChats,
                            percent: percent
                        });
                        // Also log to terminal every 10 chats
                        if ((i + 1) % 10 === 0 || i === totalChats - 1) {
                            console.log(`Syncing... ${i + 1}/${totalChats} (${percent}%)`);
                        }
                    }

                } catch (chatErr) {
                    console.error(`Error processing chat ${chat.id._serialized}:`, chatErr);
                }
            }
            console.log(`Synced ${chats.length} chats for session ${sessionId}. (Errors fetching details: ${errorCount})`);
            this.io.to(sessionId).emit('chats-synced');

        } catch (err) {
            console.error(`Error syncing chats for session ${sessionId}:`, err);
            this.io.to(sessionId).emit('status', 'Error syncing chats');
        }
    }

    async forceSync(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && session.ready) {
            console.log(`Force syncing chats for session ${sessionId}...`);
            this.syncChats(sessionId, session.client);
            return true;
        }
        return false;
    }

    async logout(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            try {
                await session.client.logout(); // Logout from WhatsApp
                await session.client.destroy(); // Destroy puppeteer instance
            } catch (err) {
                console.error(`Error logging out session ${sessionId}:`, err);
                // Force destroy if logout fails
                try { await session.client.destroy(); } catch (e) { }
            }

            this.sessions.delete(sessionId);
            this.io.to(sessionId).emit('status', 'WhatsApp disconnected');

            // Update DB
            await supabase.from('sessions').upsert({ id: sessionId, status: 'disconnected' });
            console.log(`Session ${sessionId} logged out`);
        }
    }

    promiseWithTimeout(promise, ms, timeoutError = 'Operation timed out') {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(timeoutError));
            }, ms);

            promise
                .then(res => {
                    clearTimeout(timer);
                    resolve(res);
                })
                .catch(err => {
                    clearTimeout(timer);
                    reject(err);
                });
        });
    }
}

module.exports = SessionManager;
