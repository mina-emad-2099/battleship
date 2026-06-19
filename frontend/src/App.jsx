// frontend/src/App.jsx
import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

export default function App() {
    const [isConnected, setIsConnected] = useState(false);
    const [serverMessage, setServerMessage] = useState("Waiting for server...");

    useEffect(() => {
        socket.on('connect', () => setIsConnected(true));
        socket.on('disconnect', () => setIsConnected(false));
        
        socket.on('test-pong', (response) => {
            setServerMessage(response.message);
        });

        return () => {
            socket.off('connect');
            socket.off('disconnect');
            socket.off('test-pong');
        };
    }, []);

    const handleFirePing = () => {
        socket.emit('test-ping', { status: "Initiating tactical strike" });
    };

    return (
        <div style={{ padding: '2rem', fontFamily: 'sans-serif', backgroundColor: '#1a1a1a', color: 'white', minHeight: '100vh' }}>
            <h1>Battleship Command Center</h1>
            
            <div style={{ margin: '1rem 0', padding: '1rem', border: '1px solid #333' }}>
                <p>Status: <span style={{ color: isConnected ? '#4ade80' : '#f87171' }}>
                    {isConnected ? "ONLINE" : "OFFLINE"}
                </span></p>
                <p>Telemetry: {serverMessage}</p>
            </div>

            <button 
                onClick={handleFirePing}
                disabled={!isConnected}
                style={{ padding: '10px 20px', cursor: 'pointer', backgroundColor: '#2563eb', color: 'white', border: 'none' }}
            >
                Fire Test Ping to Server
            </button>
        </div>
    );
}