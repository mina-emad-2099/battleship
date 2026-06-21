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
        started: false,
        ships: {} 
    };
}

// Upgraded Validation: Allows touching ships by using the ships ledger
function isValidFleetBoard(board, ships) {
    if (!Array.isArray(board) || board.length !== BOARD_SIZE) return false;
    if (!Array.isArray(ships)) return false; // Missing the ships ledger

    // 1. Verify the exact correct fleet was submitted [5, 4, 3]
    const actualSizes = ships.map(s => s.size).sort((a, b) => b - a);
    const expectedSizes = [...FLEET_SIZES].sort((a, b) => b - a);
    if (actualSizes.length !== expectedSizes.length) return false;
    if (!actualSizes.every((len, i) => len === expectedSizes[i])) return false;

    const seenCells = new Set();
    let boardOneCount = 0;

    // 2. Count the raw '1's on the matrix (Anti-cheat check)
    for (let x = 0; x < BOARD_SIZE; x++) {
        for (let y = 0; y < BOARD_SIZE; y++) {
            if (board[x][y] === 1) boardOneCount++;
        }
    }
    if (boardOneCount !== TOTAL_SHIP_CELLS) return false;

    // 3. Verify every individual ship's coordinates
    for (const ship of ships) {
        for (let i = 0; i < ship.size; i++) {
            // Re-calculate the ship's path based on its starting point and orientation
            const x = ship.isHorizontal ? ship.row : ship.row + i;
            const y = ship.isHorizontal ? ship.col + i : ship.col;
            
            // Rule A: Cannot go off the map
            if (x < 0 || x >= BOARD_SIZE || y < 0 || y >= BOARD_SIZE) return false;
            
            // Rule B: Cannot overlap another ship (same cell claimed twice)
            const cellKey = `${x},${y}`;
            if (seenCells.has(cellKey)) return false;
            seenCells.add(cellKey);
            
            // Rule C: The Matrix MUST actually have a '1' at this coordinate
            if (board[x][y] !== 1) return false;
        }
    }

    return true; // Passed all checks!
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

        if (!isValidFleetBoard(payload.board, payload.ships)) {
            socket.emit('fleet-rejected', 'Invalid fleet layout.');
            return;
        }

        room.boards[socket.id] = payload.board;
        room.ready[socket.id] = true;
        if (payload.ships) {
            room.ships[socket.id] = payload.ships.map(skin => ({
                id: skin.id,
                size: skin.size,
                hits: 0, // Starts at 0 damage
                // Generate every "x,y" coordinate this ship sits on
                coords: Array.from({ length: skin.size }).map((_, i) =>
                    skin.isHorizontal ? `${skin.row},${skin.col + i}` : `${skin.row + i},${skin.col}`
                )
            }));
        }
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

        let sunkShipName = null; // Start by assuming nothing sank

        if (isHit) { 
            room.health[opponentId] -= 1;
            
            // 👇 ADD THIS: Find WHICH ship got hit
            const hitShip = room.ships[opponentId].find(ship => ship.coords.includes(cellKey));
            if (hitShip) {
                hitShip.hits += 1; // Add damage
                if (hitShip.hits === hitShip.size) {
                    sunkShipName = hitShip.id; // The ship's health reached 0!
                }
            }
        }
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
            nextTurn: room.turn,
            sunkShip: sunkShipName // <-- Send the bad news to the players
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