// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); 

const server = http.createServer(app);

// Initialize Socket.io with explicit CORS permissions for the React dev server
const io = new Server(server, {
    cors: {
        origin: "http://localhost:5174",
        methods: ["GET", "POST"]
    }
});

io.on('connection', (socket) => {
    console.log(`[NETWORK] Target acquired. Client connected: ${socket.id}`);

    socket.on('test-ping', (data) => {
        console.log(`[PAYLOAD] Received from frontend:`, data);
        socket.emit('test-pong', { message: "Server acknowledges your ping. Pipeline is green." });
    });

    socket.on('disconnect', () => {
        console.log(`[NETWORK] Connection lost: ${socket.id}`);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`🚀 Node Engine running on port ${PORT}`);
});