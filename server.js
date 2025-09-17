const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const sharedsession = require('express-socket.io-session'); // Note: See the alternative approach below for a simpler implementation.

// Load user data from JSON file
const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8')).users;

// Configure session middleware
const sessionMiddleware = session({
    store: new FileStore({ path: './sessions' }), // Stores session files in a 'sessions' directory
    secret: 'your-super-secret-key', // WARNING: Use environment variables for this in production
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true in production over HTTPS
        httpOnly: true, // Prevents client-side JS access to the cookie
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
});

// Use middleware to parse request bodies
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set up the session middleware for Express
app.use(sessionMiddleware);

// Share the session middleware with Socket.IO
io.engine.use(sessionMiddleware);

// Serve the chat page, checking for an active session
app.get('/', (req, res) => {
    let username = req.session.username || 'Guest';
    res.send(getChatPage(username, req.session.username !== undefined));
});

// Serve the login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Handle login POST request
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username);

    if (user && await bcrypt.compare(password, user.password)) {
        req.session.username = user.username;
        res.redirect('/');
    } else {
        res.status(401).send('Invalid credentials');
    }
});

// Handle logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        // Redirect to the homepage after destroying the session
        res.redirect('/');
    });
});

io.on('connection', (socket) => {
    // Get username from the session
    const username = socket.request.session.username || 'Guest';

    console.log(`${username} connected`);
    
    socket.on('chat message', (msg) => {
        io.emit('chat message', `${username}: ${msg}`);
    });

    socket.on('disconnect', () => {
        console.log(`${username} disconnected`);
    });
});

server.listen(3000, () => {
    console.log('Listening on http://localhost:3000');
});

function getChatPage(username, authenticated) {
    const loginLogoutLink = authenticated ? '<a href="/logout">Logout</a>' : '<a href="/login">Login</a>';
    return `
<!DOCTYPE html>
<html>
    <head>
        <title>Socket.IO chat</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
            body { margin: 0; padding-bottom: 3rem; font-family: sans-serif; }
            #form { background: rgba(0, 0, 0, 0.15); padding: 0.25rem; position: fixed; bottom: 0; left: 0; right: 0; display: flex; height: 3rem; box-sizing: border-box; backdrop-filter: blur(10px); }
            #input { border: none; padding: 0 1rem; flex-grow: 1; border-radius: 2rem; margin: 0.25rem; }
            #input:focus { outline: none; }
            #form > button { background: #333; border: none; padding: 0 1rem; margin: 0.25rem; border-radius: 3px; outline: none; color: #fff; }
            #messages { list-style-type: none; margin: 0; padding: 0; }
            #messages > li { padding: 0.5rem 1rem; }
            #messages > li:nth-child(odd) { background: #efefef; }
            h1 { text-align: center; }
        </style>
    </head>
    <body>
        <h1>Hello, ${username}!</h1>
        ${loginLogoutLink}
        <ul id="messages"></ul>
        <form id="form">
            <input id="input" autocomplete="off" /><button>Send</button>
        </form>
        <script>
            const form = document.getElementById('form');
            const input = document.getElementById('input');
            const messages = document.getElementById('messages');
            
            const socket = io();

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (input.value) {
                    socket.emit('chat message', input.value);
                    input.value = '';
                }
            });

            socket.on('chat message', (msg) => {
                const item = document.createElement('li');
                item.textContent = msg;
                messages.appendChild(item);
                window.scrollTo(0, document.body.scrollHeight);
            });
        </script>
    </body>
</html>
    `;
}
