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

    async sendMessage(sessionId, to, message, media = null, quotedMessageId = null) {
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
                    sentMsg = await session.client.sendMessage(to, msgMedia, { caption: message, quotedMessageId });

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
                    sentMsg = await session.client.sendMessage(to, message, { quotedMessageId });
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

            // Sort chats by timestamp descending (newest first)
            chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

            const totalChats = chats.length;
            const CHATS_TO_SYNC_MESSAGES = 20; // Only sync full message history for the top 20 chats

            // --- Step 1: Sync Chat List (Batched & Parallel) ---
            console.log(`Processing ${totalChats} chats metadata...`);

            const CHAT_BATCH_SIZE = 10; // Process 10 chats in parallel for metadata
            const chatsToUpsert = [];
            let errorCount = 0;

            // Helper to process a single chat's metadata
            const processChatMetadata = async (chat) => {
                try {
                    let contactName = chat.name || chat.id.user;
                    let profilePicUrl = null;

                    // 1. Get Contact Name
                    try {
                        const contact = await chat.getContact();
                        contactName = contact.name || contact.pushname || contactName;
                    } catch (contactErr) {
                        if (!contactErr.message.includes('getIsMyContact')) {
                            // console.warn(`Error fetching contact details for ${contactName}:`, contactErr.message);
                        }
                    }

                    // 2. Get Profile Pic (with timeout)
                    try {
                        profilePicUrl = await this.promiseWithTimeout(
                            client.getProfilePicUrl(chat.id._serialized),
                            5000, // 5s timeout
                            'Profile pic fetch timed out'
                        );
                    } catch (picErr) {
                        // console.warn(`Error fetching profile pic for ${contactName}:`, picErr.message);
                        errorCount++;
                    }

                    const timestamp = chat.timestamp ? chat.timestamp * 1000 : Date.now();

                    return {
                        id: chat.id._serialized,
                        session_id: sessionId,
                        contact_name: contactName,
                        last_message: chat.lastMessage ? chat.lastMessage.body : '',
                        timestamp: timestamp,
                        profile_pic_url: profilePicUrl,
                        unread_count: chat.unreadCount
                    };
                } catch (err) {
                    console.error(`Error processing chat metadata for ${chat.id._serialized}:`, err);
                    return null;
                }
            };

            // Process chats in chunks to avoid overwhelming the client
            for (let i = 0; i < totalChats; i += CHAT_BATCH_SIZE) {
                const batch = chats.slice(i, i + CHAT_BATCH_SIZE);
                const results = await Promise.all(batch.map(chat => processChatMetadata(chat)));

                // Filter out nulls and add to upsert list
                results.forEach(res => {
                    if (res) chatsToUpsert.push(res);
                });

                // Optional: Emit progress for UI
                const percent = Math.round(((i + batch.length) / totalChats) * 50); // First 50% is chat list
                this.io.to(sessionId).emit('sync-progress', {
                    current: i + batch.length,
                    total: totalChats,
                    percent: percent,
                    status: 'Syncing chat list...'
                });
            }

            // Bulk Upsert Chats
            if (chatsToUpsert.length > 0) {
                const { error: upsertError } = await supabase.from('chats').upsert(chatsToUpsert);
                if (upsertError) {
                    console.error('Error bulk upserting chats:', upsertError.message);
                } else {
                    console.log(`Successfully synced ${chatsToUpsert.length} chats metadata.`);
                }
            }

            // Notify frontend that chat list is ready (so they can see the list while messages load)
            this.io.to(sessionId).emit('chats-synced');


            // --- Step 2: Sync Messages (Batched & Parallel) ---
            console.log(`Syncing messages for top ${CHATS_TO_SYNC_MESSAGES} chats...`);

            const MESSAGE_CHAT_BATCH_SIZE = 5; // Process messages for 5 chats in parallel
            const chatsToSyncMessages = chats.slice(0, CHATS_TO_SYNC_MESSAGES);

            for (let i = 0; i < chatsToSyncMessages.length; i += MESSAGE_CHAT_BATCH_SIZE) {
                const batch = chatsToSyncMessages.slice(i, i + MESSAGE_CHAT_BATCH_SIZE);
                let allMessagesToInsert = [];

                await Promise.all(batch.map(async (chat) => {
                    try {
                        const messages = await this.promiseWithTimeout(
                            chat.fetchMessages({ limit: 20 }),
                            10000,
                            'Message fetch timed out'
                        );

                        const mappedMessages = await Promise.all(messages.map(async (msg) => {
                            let participantId = null;
                            let senderName = msg.fromMe ? 'Me' : (chat.name || chat.id.user); // Default to chat name

                            if (chat.isGroup && !msg.fromMe) {
                                participantId = msg.author;
                                // Try to get sender name from cached contact or ID
                                // Optimization: Skip heavy contact fetch here for speed, or use simple cache if available
                                senderName = participantId ? participantId.split('@')[0] : 'Unknown';
                            }

                            return {
                                chat_id: chat.id._serialized,
                                whatsapp_id: msg.id._serialized,
                                body: msg.body,
                                from_me: msg.fromMe,
                                sender_name: senderName,
                                timestamp: msg.timestamp * 1000,
                                media_url: null,
                                media_type: msg.type,
                                caption: msg.body,
                                ack: msg.ack,
                                participant_id: participantId
                            };
                        }));

                        allMessagesToInsert = allMessagesToInsert.concat(mappedMessages);

                    } catch (msgErr) {
                        console.warn(`Could not fetch messages for ${chat.id._serialized}: ${msgErr.message}`);
                    }
                }));

                // Bulk Upsert Messages for this batch
                if (allMessagesToInsert.length > 0) {
                    const { error } = await supabase.from('messages').upsert(allMessagesToInsert, { onConflict: 'whatsapp_id', ignoreDuplicates: true });
                    if (error) {
                        console.warn('Error bulk inserting messages:', error.message);
                    }
                }

                // Emit progress
                const currentCount = i + batch.length;
                const percent = 50 + Math.round((currentCount / CHATS_TO_SYNC_MESSAGES) * 50); // Remaining 50%
                this.io.to(sessionId).emit('sync-progress', {
                    current: currentCount,
                    total: CHATS_TO_SYNC_MESSAGES,
                    percent: percent,
                    status: 'Syncing messages...'
                });
            }

            console.log(`Sync completed for session ${sessionId}.`);
            this.io.to(sessionId).emit('sync-complete'); // New event to indicate full completion

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
