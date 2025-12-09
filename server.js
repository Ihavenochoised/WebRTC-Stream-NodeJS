// server.js - Complete Signaling Server
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Store connections
const rooms = new Map();

io.on('connection', (socket) => {
    console.log(`[${new Date().toLocaleTimeString()}] Client connected: ${socket.id}`);

    socket.on('join-room', ({ roomId, role }) => {
        socket.join(roomId);

        if (!rooms.has(roomId)) {
            rooms.set(roomId, { host: null, viewers: [] });
        }

        const room = rooms.get(roomId);

        if (role === 'host') {
            room.host = socket.id;
            console.log(`[${new Date().toLocaleTimeString()}] 🖥️    Host joined room: ${roomId}`);
            socket.emit('joined', { role: 'host', roomId });

            // Notify all viewers
            socket.to(roomId).emit('host-ready');
        } else {
            room.viewers.push(socket.id);
            console.log(`[${new Date().toLocaleTimeString()}] 👀 Viewer joined room: ${roomId}`);
            socket.emit('joined', { role: 'viewer', roomId });

            // Notify host
            if (room.host) {
                io.to(room.host).emit('viewer-joined', { viewerId: socket.id });
            }
        }
    });

    socket.on('signal', ({ roomId, to, signal }) => {
        io.to(to).emit('signal', { from: socket.id, signal });
    });

    // CRITICAL: Frame forwarding handler
    socket.on('frame', (data) => {
        if (data.to) {
            io.to(data.to).emit('frame', data);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[${new Date().toLocaleTimeString()}] Client disconnected: ${socket.id}`);

        rooms.forEach((room, roomId) => {
            if (room.host === socket.id) {
                room.host = null;
                socket.to(roomId).emit('host-disconnected');
                console.log(`[${new Date().toLocaleTimeString()}] Host left room: ${roomId}`);
            }
            room.viewers = room.viewers.filter(id => id !== socket.id);

            if (!room.host && room.viewers.length === 0) {
                rooms.delete(roomId);
            }
        });
    });
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║     Remote Desktop Server Running      ║');
    console.log('╚════════════════════════════════════════╝');
    console.log(`🌐 Signaling server: http://localhost:${PORT}`);
    console.log(`📺 Open viewer at: http://localhost:${PORT}`);
    console.log(`🖥️    Run host app: node host-simple.js`);
    console.log('');
    console.log('Press Ctrl+C to stop');
    console.log('─────────────────────────────────────────');
});