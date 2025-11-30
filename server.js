import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow all for MVP, lock down later
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.send('fan_h2h Backend is running');
});

import { matchmaking } from './matchmaking.js';
import GameManager from './gameManager.js';

const gameManager = new GameManager(io);

// Socket.IO Logic
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User Data: { id, email, name, club }

  socket.on('join_queue', (userData) => {
    console.log('Join queue:', userData);
    matchmaking.addToQueue(socket.id, userData);

    const match = matchmaking.findMatch();
    if (match) {
      gameManager.createMatch(match.player1, match.player2);
    }
  });

  socket.on('create_private_room', (userData, callback) => {
    const roomId = matchmaking.createPrivateRoom(socket.id, userData);
    callback({ roomId });
  });

  socket.on('join_private_room', ({ roomId, user }, callback) => {
    const result = matchmaking.joinPrivateRoom(roomId, socket.id, user);
    if (result.error) {
      callback({ error: result.error });
    } else {
      callback({ success: true });
      gameManager.createMatch(result.match.player1, result.match.player2);
    }
  });

  socket.on('submit_answer', ({ matchId, answerIndex }) => {
    gameManager.handleAnswer(matchId, socket.id, answerIndex);
  });

  socket.on('cancel_wait', () => {
    matchmaking.removeFromQueue(socket.id);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    matchmaking.removeFromQueue(socket.id);
    gameManager.handleDisconnect(socket.id);
  });
});

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
