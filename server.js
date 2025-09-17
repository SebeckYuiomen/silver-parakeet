    const express = require('express');
    const app = express();
    const http = require('http').Server(app);
    const io = require('socket.io')(http);
    const path = require('path');

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    io.on('connection', (socket) => {
        console.log('A user connected');

        socket.on('chat message', (msg) => {
            io.emit('chat message', msg); // Broadcast message to all connected clients
        });

        socket.on('disconnect', () => {
            console.log('A user disconnected');
        });
    });

    http.listen(3000, () => {
        console.log('listening on *:3000');
    });