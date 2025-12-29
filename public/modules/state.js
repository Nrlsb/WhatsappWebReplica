// Socket.io is loaded globally via script tag in index.html
// const socket = window.io(); // Removed auto-connection

export const state = {
    socket: null,
    currentSessionId: null,
    chats: {}, // { phoneNumber: { messages: [], lastMessage: '', timestamp: 0 } }
    currentChatId: null,
    quotedMessageId: null
};

export function setState(key, value) {
    state[key] = value;
}
