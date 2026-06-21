// frontend/src/App.jsx
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import Board from './components/Board';
import { createEmptyBoard, canPlaceShip } from './gameLogic';
import './App.css';

const socket = io('http://localhost:3000');

const INITIAL_FLEET = [
    { id: 'Carrier', size: 5 },
    { id: 'Battleship', size: 4 },
    { id: 'Cruiser', size: 3 }
];
// 5 + 4 + 3 = 12 total health points.
// NOTE: keep this in sync with FLEET_SIZES in backend/server.js — the server
// independently re-validates every submitted fleet against that constant.
const MAX_HEALTH = 12;

export default function App() {
    const [isConnected, setIsConnected] = useState(false);

    // --- LOBBY & ROLES ---
    const [roomId, setRoomId] = useState("");
    const [roomInput, setRoomInput] = useState("");
    const [playerRole, setPlayerRole] = useState(1); // 1 or 2
    const [lobbyError, setLobbyError] = useState("");

    // --- GAME ENGINE STATES ---
    const [gamePhase, setGamePhase] = useState('lobby'); // lobby, placement, ready, battle, game-over, opponent-left
    const [myBoard, setMyBoard] = useState(createEmptyBoard());
    const [enemyBoard, setEnemyBoard] = useState(createEmptyBoard());
    const [fleetToPlace, setFleetToPlace] = useState(INITIAL_FLEET);
    const [isHorizontal, setIsHorizontal] = useState(true);
    const [placementError, setPlacementError] = useState("");
    const [deployedSkins, setDeployedSkins] = useState([]);

    // --- COMBAT STATES ---
    const [isMyTurn, setIsMyTurn] = useState(false);
    const [health, setHealth] = useState(MAX_HEALTH);
    const [endgameMessage, setEndgameMessage] = useState("");

    // --- SYNC STATES ---
    const [myReady, setMyReady] = useState(false);
    const [opponentReady, setOpponentReady] = useState(false);
    const [announcement, setAnnouncement] = useState("");

    // Refs mirror the latest roomId / our own socket id so the long-lived
    // listener effect below never has to re-subscribe mid-game. (The original
    // version re-bound every socket listener whenever roomId/gamePhase changed,
    // which left a brief window on every phase transition where events could
    // arrive with no listener attached.)
    const roomIdRef = useRef("");
    const myIdRef = useRef(null);
    useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

    // --- NETWORK LIFECYCLE (subscribes exactly once) ---
    useEffect(() => {
        socket.on('connect', () => {
            setIsConnected(true);
            myIdRef.current = socket.id;
        });
        socket.on('disconnect', () => setIsConnected(false));

        socket.on('room-error', (message) => {
            setLobbyError(message);
            setRoomId("");
        });

        socket.on('player-role', (role) => setPlayerRole(role));

        socket.on('game-start', () => {
            setGamePhase('placement');
        });

        // The opponent finished placing their ships
        socket.on('opponent-ready', () => {
            setOpponentReady(true);
        });

        // Server rejected our fleet layout. Should basically never fire since the
        // client runs the same placement rules before submitting, but it's the
        // server that has final say.
        socket.on('fleet-rejected', (message) => {
            console.error('Fleet rejected by server:', message);
            setLobbyError('Your fleet was rejected by the server. Please refresh and try again.');
            alert("SERVER REJECTED YOUR BOARD! (Make sure ships aren't touching!). Refreshing...");
            window.location.reload();
        });

        // Server confirms both fleets are in and tells each socket whether it goes first.
        socket.on('battle-start', ({ yourTurn }) => {
            setGamePhase('battle');
            setIsMyTurn(yourTurn);
        });

        // Server is the single source of truth for every shot — it knows both
        // boards, so it determines hit/miss itself rather than trusting whichever
        // client happens to report a result.
        socket.on('attack-result', ({ x, y, status, attackerId, defenderId, defenderHealth, nextTurn,sunkShip }) => {
            const myId = myIdRef.current;

            if (sunkShip) {
                if (attackerId === myId) {
                    setAnnouncement(`💥 Target destroyed! You sunk the enemy ${sunkShip}!`);
                } else {
                    setAnnouncement(`🚨 Mayday! The enemy sunk our ${sunkShip}!`);
                }
                // Auto-hide the message after 4 seconds
                setTimeout(() => setAnnouncement(""), 4000); 
            }

            if (attackerId === myId) {
                // This was my shot — paint the result on the enemy radar.
                setEnemyBoard((prevBoard) => {
                    const newBoard = structuredClone(prevBoard);
                    newBoard[x][y] = status === 'hit' ? 3 : 2;
                    return newBoard;
                });
            }

            if (defenderId === myId) {
                // This was a shot against me — paint the result on my own board
                // and trust the server's health count, not a locally-recomputed one.
                setMyBoard((prevBoard) => {
                    const newBoard = structuredClone(prevBoard);
                    newBoard[x][y] = status === 'hit' ? 3 : 2;
                    return newBoard;
                });
                setHealth(defenderHealth);
            }

            setIsMyTurn(nextTurn === myId);
        });

        socket.on('game-over', ({ youWin }) => {
            setGamePhase('game-over');
            setEndgameMessage(youWin ? "VICTORY! Enemy fleet destroyed. 🏆" : "DEFEAT. Your fleet was wiped out. 💀");
            setAnnouncement("retry");
        });

        socket.on('opponent-left', () => {
            setGamePhase('opponent-left');
        });

        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('room-error');
            socket.off('player-role');
            socket.off('game-start');
            socket.off('opponent-ready');
            socket.off('fleet-rejected');
            socket.off('battle-start');
            socket.off('attack-result');
            socket.off('game-over');
            socket.off('opponent-left');
        };
    }, []); // mount-only — see roomIdRef / myIdRef for "current value" access instead

    // --- ACTIONS ---
    const handleJoinRoom = () => {
        const cleanId = roomInput.trim();
        if (!cleanId) {
            setLobbyError("Enter a room code first.");
            return;
        }
        setLobbyError("");
        setRoomId(cleanId);
        socket.emit('join-room', cleanId);
    };

    const handlePlacementClick = (x, y) => {
        if (gamePhase !== 'placement' || fleetToPlace.length === 0) return;

        const currentShip = fleetToPlace[0];

        if (canPlaceShip(myBoard, x, y, currentShip.size, isHorizontal)) {
            setPlacementError("");
            setDeployedSkins(prev => [...prev, {
                id: currentShip.id,         // e.g. "carrier"
                row: x,                     
                col: y,                     
                size: currentShip.size,     // e.g. 5
                isHorizontal: isHorizontal
            }]);
            const newBoard = structuredClone(myBoard);
            for (let i = 0; i < currentShip.size; i++) {
                if (isHorizontal) newBoard[x][y + i] = 1;
                else newBoard[x + i][y] = 1;
            }
            setMyBoard(newBoard);

            const remainingShips = fleetToPlace.slice(1);
            setFleetToPlace(remainingShips);

            if (remainingShips.length === 0) {
                setGamePhase('ready');
                setMyReady(true);
                // Create the final ship data manually so we don't have to wait for React state to update
                const finalShipData = {
                    id: currentShip.id,
                    row: x,
                    col: y,
                    size: currentShip.size,
                    isHorizontal: isHorizontal
                };
                
                // Send the board AND the ships to the server
                socket.emit('submit-fleet', { 
                    roomId: roomIdRef.current, 
                    board: newBoard,
                    ships: [...deployedSkins, finalShipData] // <--- Here is the magic!
                });
            }
        }
        else {
            setPlacementError("Cannot place it like this");
            setTimeout(() => setPlacementError(""), 3000);
        }
    };

    const handleFireClick = (x, y) => {
        if (gamePhase !== 'battle' || !isMyTurn || enemyBoard[x][y] !== 0) return;

        // Lock controls so you can't double-fire while waiting on the server's reply.
        setIsMyTurn(false);
        socket.emit('fire-shot', { roomId: roomIdRef.current, x, y });
    };

    // --- RENDER ---
    return (
        <div className="battleship-container">
            <h1 style={{ color: 'white' }}>Command Center</h1>

            {gamePhase === 'lobby' && (
                <div style={{ textAlign: 'center', marginTop: '2rem', color: 'white' }}>
                    <h2>Enter Matchmaking Lobby</h2>
                    <input
                        type="text"
                        value={roomInput}
                        onChange={(e) => setRoomInput(e.target.value)}
                        placeholder="Enter Room Code (e.g. 4047)"
                        style={{ padding: '10px', fontSize: '1.2rem', marginRight: '10px', color: 'black' }}
                    />
                    <button
                        onClick={handleJoinRoom}
                        style={{ padding: '10px 20px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#2563eb', color: 'white', border: 'none' }}
                    >
                        Join Room
                    </button>
                    {roomId && <p style={{ marginTop: '20px', color: '#facc15' }}>Waiting in Room: {roomId} for opponent...</p>}
                    {lobbyError && <p style={{ marginTop: '20px', color: '#f87171' }}>{lobbyError}</p>}
                    {!isConnected && <p style={{ marginTop: '20px', color: '#f87171' }}>Connecting to server...</p>}
                </div>
            )}

            {gamePhase === 'opponent-left' && (
                <div style={{ textAlign: 'center', marginTop: '2rem', color: 'white' }}>
                    <h2 style={{ color: '#f87171' }}>Your opponent disconnected.</h2>
                    <button
                        onClick={() => window.location.reload()}
                        style={{ padding: '10px 20px', fontSize: '1.2rem', cursor: 'pointer', backgroundColor: '#2563eb', color: 'white', border: 'none', marginTop: '1rem' }}
                    >
                        Return to Lobby
                    </button>
                </div>
            )}

            {gamePhase !== 'lobby' && gamePhase !== 'opponent-left' && (
                <>
                    <div className="hud">
                        {announcement && <h2 style={{ color: announcement.includes('💥') ? '#4ade80' : '#f87171', fontSize: '2rem' }}>{announcement}</h2>}
                        {gamePhase === 'placement' && (
                            <>
                                <h2>Deploy: {fleetToPlace[0]?.id} (Len: {fleetToPlace[0]?.size})</h2>
                                <button onClick={() => setIsHorizontal(!isHorizontal)}>
                                    Rotate: {isHorizontal ? "Horizontal ➔" : "Vertical ⬇"}
                                </button>
                                {placementError && <p style={{ color: '#f87171', marginTop: '10px', fontWeight: 'bold' }}>{placementError}</p>}
                            </>
                        )}
                        {gamePhase === 'ready' && <h2 style={{ color: '#facc15' }}>Waiting for opponent to finish deployment...</h2>}
                        {gamePhase === 'battle' && (
                            <h2 style={{ color: isMyTurn ? '#4ade80' : '#f87171' }}>
                                {isMyTurn ? "YOUR TURN: Select Target!" : "ENEMY TURN: Brace for impact..."}
                                <span style={{ marginLeft: '20px', color: '#e5e7eb', fontSize: '0.9rem' }}>
                                    (Fleet Health: {health} / {MAX_HEALTH})
                                </span>
                            </h2>
                        )}
                        {gamePhase === 'game-over' && (
                            <h1 style={{ color: endgameMessage.includes('VICTORY') ? '#4ade80' : '#f87171', fontSize: '2.5rem' }}>
                                {endgameMessage}
                            </h1>
                        )}
                    </div>

                    <div className="boards-wrapper">
                        <div className="board-section">
                            <h3>Your Fleet</h3>
                            <Board matrix={myBoard} onCellClick={handlePlacementClick} variant="own" deployedSkins={deployedSkins} />
                        </div>

                        {gamePhase !== 'placement' && (
                            <div className="board-section">
                                <h3>Enemy Radar</h3>
                                <Board matrix={enemyBoard} onCellClick={handleFireClick} />
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}