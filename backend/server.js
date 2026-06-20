// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: "http://localhost:5173", methods: ["GET", "POST"] }
});

const BOARD_SIZE = 10;
// NOTE: keep this in sync with INITIAL_FLEET in frontend/src/App.jsx
const FLEET_SIZES = [5, 4, 3]; // Carrier, Battleship, Cruiser
const TOTAL_SHIP_CELLS = FLEET_SIZES.reduce((a, b) => a + b, 0);

// In-memory room state. The server is the single source of truth for both
// players' boards, whose turn it is, and remaining health — clients only ever
// see their own ship layout plus hit/miss markers, never the opponent's ships.
//
// rooms[roomId] = {
//   players: [socketId1, socketId2],        // index 0 = Player 1, always fires first
//   boards: { [socketId]: board },          // each player's validated ship layout
//   shotsTaken: { [socketId]: Set("x,y") }, // cells already fired at that player's board
//   ready: { [socketId]: true },
//   health: { [socketId]: number },
//   turn: socketId,
//   started: boolean
// }
const rooms = {};

function createEmptyRoom() {
    return {
        players: [],
        boards: {},
        shotsTaken: {},
        ready: {},
        health: {},
        turn: null,
        started: false
    };
}

// Re-validates a submitted board so a tampered client can't cheat at placement
// (wrong ship count, overlapping ships, ships that don't match the fleet, etc).
function isValidFleetBoard(board) {
    if (!Array.isArray(board) || board.length !== BOARD_SIZE) return false;

    let totalShipCells = 0;
    for (let x = 0; x < BOARD_SIZE; x++) {
        if (!Array.isArray(board[x]) || board[x].length !== BOARD_SIZE) return false;
        for (let y = 0; y < BOARD_SIZE; y++) {
            const cell = board[x][y];
            if (cell !== 0 && cell !== 1) return false; // only water/ship allowed at submission time
            if (cell === 1) totalShipCells++;
        }
    }
    if (totalShipCells !== TOTAL_SHIP_CELLS) return false;

    // Walk the board, measuring each contiguous run of ship cells, and confirm
    // the set of run lengths matches the expected fleet exactly.
    const visited = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(false));
    const shipLengths = [];

    for (let x = 0; x < BOARD_SIZE; x++) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            if (board[x][y] !== 1 || visited[x][y]) continue;

            let hLen = 0;
            while (y + hLen < BOARD_SIZE && board[x][y + hLen] === 1) hLen++;
            let vLen = 0;
            while (x + vLen < BOARD_SIZE && board[x + vLen][y] === 1) vLen++;

            if (hLen > 1 && vLen > 1) return false; // real ships are straight, not L/cross shaped

            if (hLen >= vLen) {
                for (let i = 0; i < hLen; i++) visited[x][y + i] = true;
                shipLengths.push(hLen);
            } else {
                for (let i = 0; i < vLen; i++) visited[x + i][y] = true;
                shipLengths.push(vLen);
            }
        }
    }

    const actual = shipLengths.sort((a, b) => b - a);
    const expected = [...FLEET_SIZES].sort((a, b) => b - a);
    if (actual.length !== expected.length) return false;
    return actual.every((len, i) => len === expected[i]);
}

io.on('connection', (socket) => {
    console.log(`[NETWORK] Player connected: ${socket.id}`);

    // --- 1. LOBBY & ROLES ---
    socket.on('join-room', (roomId) => {
        const cleanRoomId = (roomId || '').trim();
        if (!cleanRoomId) {
            socket.emit('room-error', 'Room code cannot be empty.');
            return;
        }

        if (!rooms[cleanRoomId]) rooms[cleanRoomId] = createEmptyRoom();
        const room = rooms[cleanRoomId];

        if (room.players.length >= 2) {
            socket.emit('room-error', 'Room is currently full.');
            return;
        }

        socket.join(cleanRoomId);
        socket.data.roomId = cleanRoomId;
        room.players.push(socket.id);
        room.health[socket.id] = TOTAL_SHIP_CELLS;
        room.shotsTaken[socket.id] = new Set();

        console.log(`[LOBBY] Player joined room: ${cleanRoomId} (${room.players.length}/2)`);

        if (room.players.length === 1) {
            socket.emit('player-role', 1);
            socket.emit('waiting-for-opponent');
        } else {
            socket.emit('player-role', 2);
            room.turn = room.players[0]; // Player 1 always fires first
            io.to(cleanRoomId).emit('game-start');
        }
    });

    // --- 2. FLEET SUBMISSION ---
    socket.on('submit-fleet', (payload) => {
        const roomId = (payload?.roomId || '').trim();
        const room = rooms[roomId];
        if (!room || !room.players.includes(socket.id)) return;

        if (!isValidFleetBoard(payload.board)) {
            socket.emit('fleet-rejected', 'Invalid fleet layout.');
            return;
        }

        room.boards[socket.id] = payload.board;
        room.ready[socket.id] = true;
        socket.to(roomId).emit('opponent-ready');

        const bothReady = room.players.length === 2 && room.players.every((id) => room.ready[id]);
        if (bothReady) {
            room.started = true;
            room.players.forEach((id) => {
                io.to(id).emit('battle-start', { yourTurn: id === room.turn });
            });
        }
    });

    // --- 3. COMBAT (server resolves hit/miss itself) ---
    socket.on('fire-shot', (payload) => {
        const roomId = (payload?.roomId || '').trim();
        const room = rooms[roomId];
        if (!room || !room.started) return;
        if (room.turn !== socket.id) return; // not your turn — ignore

        const opponentId = room.players.find((id) => id !== socket.id);
        if (!opponentId) return;

        const { x, y } = payload;
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return;

        const cellKey = `${x},${y}`;
        const alreadyShot = room.shotsTaken[opponentId];
        if (alreadyShot.has(cellKey)) return; // ignore repeat shots on an already-fired cell
        alreadyShot.add(cellKey);

        const defenderBoard = room.boards[opponentId];
        const isHit = defenderBoard?.[x]?.[y] === 1;
        const status = isHit ? 'hit' : 'miss';

        if (isHit) room.health[opponentId] -= 1;

        // Hits keep the turn with the attacker ("go again"); a miss passes it
        // to the opponent. Flip this ternary if you want classic alternating turns.
        room.turn = isHit ? socket.id : opponentId;

        io.to(roomId).emit('attack-result', {
            x,
            y,
            status,
            attackerId: socket.id,
            defenderId: opponentId,
            defenderHealth: room.health[opponentId],
            nextTurn: room.turn
        });

        if (room.health[opponentId] <= 0) {
            room.started = false;
            io.to(socket.id).emit('game-over', { youWin: true });
            io.to(opponentId).emit('game-over', { youWin: false });
        }
    });

    // --- 4. DISCONNECT HANDLING ---
    socket.on('disconnect', () => {
        console.log(`[NETWORK] Player disconnected: ${socket.id}`);
        const roomId = socket.data.roomId;
        const room = roomId && rooms[roomId];
        if (!room) return;

        if (room.players.length > 1) {
            socket.to(roomId).emit('opponent-left');
        }

        // No reconnection support yet — once anyone leaves, the room is done
        // rather than risk leaving the remaining player in an inconsistent state.
        delete rooms[roomId];
    });
});

server.listen(3000, () => console.log(`🚀 BATTLESHIP ENGINE ONLINE ON PORT 3000`));