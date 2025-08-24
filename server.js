// backend/server.js
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Client } = require('ssh2');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Use Socket.IO instead of ws
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all origins for simplicity, adjust for production
    },
    // Optimizations for low latency
    transports: ['websocket'],
    pingInterval: 5000,
    pingTimeout: 10000,
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);
    const ssh = new Client();

    socket.on('connect-ssh', (details) => {
        const { host, port, username, password, privateKey, authMethod, termSize } = details;

        const sshConfig = {
            host,
            port: parseInt(port, 10),
            username,
            readyTimeout: 20000,
            // RE-INTRODUCED: A balanced and fast algorithm list for speed and compatibility
            algorithms: {
                kex: ['curve25519-sha256', 'curve25519-sha256@libssh.org', 'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521', 'diffie-hellman-group-exchange-sha256', 'diffie-hellman-group14-sha256'],
                cipher: ['aes128-ctr', 'aes192-ctr', 'aes256-ctr', 'aes128-gcm@openssh.com', 'aes256-gcm@openssh.com', 'chacha20-poly1305@openssh.com'],
                serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-rsa'],
                hmac: ['hmac-sha2-256-etm@openssh.com', 'hmac-sha2-512-etm@openssh.com', 'hmac-sha2-256', 'hmac-sha2-512'],
            },
            // RETAINED: The critical latency optimization
            noDelay: true
        };

        if (authMethod === 'key' && privateKey) {
            sshConfig.privateKey = privateKey;
        } else {
            sshConfig.password = password;
        }

        ssh.on('ready', () => {
            socket.emit('status', 'ssh_ready');
            ssh.shell({ term: 'xterm-256color', rows: termSize.rows, cols: termSize.cols }, (err, stream) => {
                if (err) {
                    socket.emit('error', 'Failed to open shell: ' + err.message);
                    ssh.end(); return;
                }
                
                socket.emit('status', 'connected');

                // Client -> SSH
                socket.on('terminal-data', (data) => {
                    stream.write(data);
                });

                // SSH -> Client
                stream.on('data', (chunk) => {
                    socket.emit('terminal-output', chunk.toString('utf-8'));
                });
                
                stream.on('close', () => ssh.end());

                socket.on('terminal-resize', (size) => {
                    stream.setWindow(size.rows, size.cols);
                });
            });
        }).on('error', (err) => {
            let errorMessage = 'SSH Error: ' + err.message;
            if (err.level === 'client-authentication' || err.message.includes('authentication methods failed')) {
                errorMessage = '身份验证失败，请检查您的凭据。';
            }
            socket.emit('error', errorMessage);
        }).on('close', () => {
            socket.disconnect();
        });

        ssh.connect(sshConfig);
    });

    socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
        ssh.end();
    });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
