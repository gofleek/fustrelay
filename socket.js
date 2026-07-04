/**
 * socket.js
 * Small registry mapping userId -> Socket.IO socket instances, used by
 * signaling.js and the message/typing relays to deliver events to a
 * specific user's active connection(s) without querying anything
 * external. Pure in-memory, rebuilt on every connection.
 */

// Map<number, Map<string, Socket>>  (userId -> socketId -> socket)
const userSockets = new Map();

function register(userId, socket) {
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Map());
  }
  userSockets.get(userId).set(socket.id, socket);
}

function unregister(userId, socketId) {
  const sockets = userSockets.get(userId);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    userSockets.delete(userId);
  }
}

/**
 * Emit an event to every active socket belonging to a user (handles
 * multiple open tabs/devices). Returns true if at least one socket
 * received the emit (i.e. the user has an active connection).
 */
function emitToUser(userId, event, payload) {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return false;
  sockets.forEach((socket) => socket.emit(event, payload));
  return true;
}

function getSocketsForUser(userId) {
  const sockets = userSockets.get(userId);
  return sockets ? Array.from(sockets.values()) : [];
}

module.exports = { register, unregister, emitToUser, getSocketsForUser };
