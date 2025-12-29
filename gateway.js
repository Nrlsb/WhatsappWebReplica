const http = require('http');
const httpProxy = require('http-proxy');
const url = require('url');

const proxy = httpProxy.createProxyServer({});
const PORT = 8080;

// List of worker servers (add your PC IPs or ports here)
const SERVERS = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002'
];

// Map to store session -> server assignments
const sessionMap = new Map();

const server = http.createServer((req, res) => {
    // 1. Get Session ID from URL query params or Headers
    const parsedUrl = url.parse(req.url, true);
    let sessionId = parsedUrl.query.sessionId;

    // Also check headers (for API requests)
    if (!sessionId && req.headers['x-session-id']) {
        sessionId = req.headers['x-session-id'];
    }

    // 2. Determine Target Server
    let target = SERVERS[0]; // Default to first server

    if (sessionId) {
        if (sessionMap.has(sessionId)) {
            target = sessionMap.get(sessionId);
        } else {
            // New session: Assign using Round-Robin or Random
            // Simple Round-Robin based on map size
            const index = sessionMap.size % SERVERS.length;
            target = SERVERS[index];
            sessionMap.set(sessionId, target);
            console.log(`New Session ${sessionId} assigned to ${target}`);
        }
    }

    // 3. Proxy the request
    proxy.web(req, res, { target: target }, (err) => {
        console.error('Proxy error:', err);
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
    });
});

// Handle WebSocket upgrades
server.on('upgrade', (req, socket, head) => {
    const parsedUrl = url.parse(req.url, true);
    let sessionId = parsedUrl.query.sessionId;

    // Socket.io sends query params in the handshake
    // e.g. /socket.io/?sessionId=abc&EIO=4&transport=websocket

    let target = SERVERS[0];

    if (sessionId) {
        if (sessionMap.has(sessionId)) {
            target = sessionMap.get(sessionId);
        } else {
            const index = sessionMap.size % SERVERS.length;
            target = SERVERS[index];
            sessionMap.set(sessionId, target);
            console.log(`New WebSocket Session ${sessionId} assigned to ${target}`);
        }
    }

    proxy.ws(req, socket, head, { target: target }, (err) => {
        console.error('Proxy WS error:', err);
        socket.end();
    });
});

console.log(`Gateway running on http://localhost:${PORT}`);
console.log(`Balancing load between: ${SERVERS.join(', ')}`);

server.listen(PORT);
