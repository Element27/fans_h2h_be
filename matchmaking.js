import { v4 as uuidv4 } from 'uuid';

class MatchmakingService {
  constructor() {
    this.queue = []; // Array of { socketId, user }
    this.privateRooms = new Map(); // roomId -> { host: { socketId, user }, createdAt, timeoutId }
    this.ROOM_TTL_MS = 5 * 60 * 1000; // 5 minutes
  }

  // Add player to random queue
  addToQueue(socketId, user) {
    // Check if already in queue
    if (this.queue.find(p => p.socketId === socketId)) return;

    this.queue.push({ socketId, user });
    console.log(`User ${user.email} added to queue. Queue size: ${this.queue.length}`);
  }

  // Remove player from queue (e.g. disconnect)
  removeFromQueue(socketId) {
    this.queue = this.queue.filter(p => p.socketId !== socketId);

    // Also remove from private rooms if hosting
    for (const [roomId, room] of this.privateRooms.entries()) {
      if (room.host.socketId === socketId) {
        this.privateRooms.delete(roomId);
      }
    }
  }

  // Try to find a match from the queue
  findMatch() {
    if (this.queue.length >= 2) {
      const player1 = this.queue.shift();
      const player2 = this.queue.shift();
      return { player1, player2 };
    }
    return null;
  }

  // Create a private room
  createPrivateRoom(socketId, user) {
    const roomId = uuidv4().slice(0, 6).toUpperCase(); // Short code
    const timeoutId = setTimeout(() => {
      this.privateRooms.delete(roomId);
    }, this.ROOM_TTL_MS);
    this.privateRooms.set(roomId, { host: { socketId, user }, createdAt: Date.now(), timeoutId });
    return roomId;
  }

  // Join a private room
  joinPrivateRoom(roomId, socketId, user) {
    const room = this.privateRooms.get(roomId);
    if (!room) return { error: 'Room not found or expired' };

    if (room.host.socketId === socketId) return { error: 'You are already in this room' };

    // Match found!
    const player1 = room.host;
    const player2 = { socketId, user };

    // Remove room
    clearTimeout(room.timeoutId);
    this.privateRooms.delete(roomId);

    return { match: { player1, player2 } };
  }
}

export const matchmaking = new MatchmakingService();
