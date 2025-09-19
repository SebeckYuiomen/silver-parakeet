const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const fs = require('fs').promises;
const path = require('path');
const bcrypt = require('bcrypt');
const sharedsession = require('express-socket.io-session');
const webpush = require('web-push'); // Add web-push

// Path to the user data file
const USERS_FILE = path.join(__dirname, 'users.json');

// In-memory store for online users, last message timestamps, and push subscriptions
const onlineUsers = new Set();
const lastMessageTimestamps = new Map();
const userSubscriptions = new Map(); // Store user push subscriptions
const MESSAGE_TIMEOUT_MS = 3000;
const MAX_MESSAGE_LENGTH = 200;

// VAPID keys (replace with your generated keys)
const vapidKeys = {
    publicKey: 'BPnapha7CzialmcHU74wQn7soWvBnPDVdCEmtHSskC5XBmspIJ2SR9nRdKsR7fg3mELudJFqmpWEUiN4ZasMPhQ',
    privateKey: 'DqD_C6rj9sIIovZkc5wLTpsctqchFULrkkMonfUh6HU'
};
webpush.setVapidDetails(
    'mailto:youremail@example.com',
    vapidKeys.publicKey,
    vapidKeys.privateKey
);

// Helper function to send push notifications
function sendPushNotification(subscription, payload) {
    webpush.sendNotification(subscription, JSON.stringify(payload)).catch(error => {
        console.error('Push notification failed:', error);
        // TODO: Handle subscriptions that are no longer valid
    });
}

// Load user data from JSON file
async function loadUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data).users;
    } catch (error) {
        console.error("Could not load users file:", error);
        return [];
    }
}

// Write user data to JSON file
async function saveUsers(users) {
    try {
        await fs.writeFile(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
    } catch (error) {
        console.error("Could not save users file:", error);
    }
}

// Configure session middleware
const sessionMiddleware = session({
    store: new FileStore({ path: './sessions' }),
    secret: 'your-super-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(sessionMiddleware);
io.engine.use(sessionMiddleware);

// Expose the public VAPID key to the client
app.get('/vapid-key', (req, res) => {
    res.send(vapidKeys.publicKey);
});

// Handle push subscription from the client
app.post('/subscribe', (req, res) => {
    const username = req.session.username;
    if (!username) {
        return res.status(401).send('Unauthorized');
    }
    const subscription = req.body;
    userSubscriptions.set(username, subscription);
    console.log(`User ${username} subscribed for push notifications.`);
    res.status(201).json({});
});

// Function to broadcast the online user count
function broadcastOnlineCount() {
    io.emit('online count', onlineUsers.size);
}

// Serve the chat page, checking for an active session
app.get('/', (req, res) => {
    let username = req.session.username || 'Guest';
    res.send(getChatPage(username, req.session.username !== undefined));
});

// Serve static files, including the service worker
app.use(express.static(path.join(__dirname)));

// Serve the login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'login.html'));
});

// Serve the signup page
app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'signup.html'));
});

// Handle login POST request
app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const users = await loadUsers();
    const user = users.find(u => u.username === username);

    if (user && await bcrypt.compare(password, user.password)) {
        req.session.username = user.username;
        res.redirect('/');
    } else {
        res.status(401).send('Invalid credentials');
    }
});

// Handle signup POST request
app.post('/signup', async (req, res) => {
    const { username, password } = req.body;
    const users = await loadUsers();

    if (users.find(u => u.username === username)) {
        return res.status(409).send('Username already exists');
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    users.push({ username, password: hashedPassword });
    await saveUsers(users);

    req.session.username = username;
    res.redirect('/');
});

// Handle logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

io.on('connection', (socket) => {
    const username = socket.request.session.username || 'Guest';
    
    onlineUsers.add(username);
    broadcastOnlineCount();

    console.log(`${username} connected`);
    
    socket.on('chat message', (msg) => {
        const now = Date.now();
        const lastTimestamp = lastMessageTimestamps.get(username) || 0;

        if (now - lastTimestamp < MESSAGE_TIMEOUT_MS) {
            socket.emit('error', `Please wait ${MESSAGE_TIMEOUT_MS / 1000} seconds before sending another message.`);
            return;
        }

        if (msg.length > MAX_MESSAGE_LENGTH) {
            socket.emit('error', 'Message exceeds 200 character limit.');
            return;
        }
        
        lastMessageTimestamps.set(username, now);

        const fullMessage = `${username}: ${msg}`;
        io.emit('chat message', fullMessage);

        // Send push notifications to all other users
        const onlineOtherUsers = [...onlineUsers].filter(u => u !== username);
        onlineOtherUsers.forEach(user => {
            if (userSubscriptions.has(user)) {
                const subscription = userSubscriptions.get(user);
                sendPushNotification(subscription, { body: fullMessage });
            }
        });
    });

    socket.on('disconnect', () => {
        console.log(`${username} disconnected`);
        onlineUsers.delete(username);
        broadcastOnlineCount();
    });
});

server.listen(3000, () => {
    console.log('Listening on http://localhost:3000');
});

function getChatPage(username, authenticated) {
    const loginLogoutLink = authenticated ? '<a href="/logout">Logout</a>' : '<a href="/login">Login</a> | <a href="/signup">Sign Up</a>';
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
            .online-counter { text-align: center; font-size: 1.2em; padding: 10px; background: #eee; border-bottom: 1px solid #ddd; }
            
            /* CSS for the version text */
            .version-info {
                position: fixed;
                bottom: 10px;
                right: 10px;
                font-size: 0.8em;
                color: #888;
            }
        </style>
    </head>
    <body>
        <h1>Hello, ${username}!</h1>
        <div class="online-counter">Online users: <span id="user-count">0</span></div>
        ${loginLogoutLink}
        <ul id="messages"></ul>
        <form id="form">
            <input id="input" autocomplete="off" maxlength="200" /><button>Send</button>
        </form>
        <div class="version-info">v1.2.2.1 beta</div>
        <script>
            const form = document.getElementById('form');
            const input = document.getElementById('input');
            const messages = document.getElementById('messages');
            const userCountSpan = document.getElementById('user-count');
            const username = '${username}';
            
            const socket = io();
            let notificationPermission = Notification.permission;
            
            // Function to handle push notification subscription
            async function subscribeUserToPush() {
                if ('serviceWorker' in navigator && 'PushManager' in window && notificationPermission === 'granted') {
                    const registration = await navigator.serviceWorker.ready;
                    const vapidKeyResponse = await fetch('/vapid-key');
                    const vapidPublicKey = await vapidKeyResponse.text();

                    const subscription = await registration.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: vapidPublicKey
                    });
                    
                    await fetch('/subscribe', {
                        method: 'POST',
                        body: JSON.stringify(subscription),
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                }
            }

            // Request notification permission and subscribe to push
            document.addEventListener('DOMContentLoaded', () => {
                if (notificationPermission !== 'granted') {
                    Notification.requestPermission().then(permission => {
                        notificationPermission = permission;
                        if (permission === 'granted') {
                            subscribeUserToPush();
                        }
                    });
                } else {
                    subscribeUserToPush();
                }
                
                // Register service worker
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.register('/sw.js').then(reg => {
                        console.log('Service worker registered!', reg);
                    });
                }
            });

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

            // Listen for the online user count update
            socket.on('online count', (count) => {
                userCountSpan.textContent = count;
            });
            
            // Listen for server-side validation errors
            socket.on('error', (msg) => {
                const item = document.createElement('li');
                item.textContent = 'Error: ' + msg;
                item.style.color = 'red';
                messages.appendChild(item);
                window.scrollTo(0, document.body.scrollHeight);
            });
        </script>
    </body>
</html>
    `;
}
