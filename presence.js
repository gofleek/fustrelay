/**
 * presence.js
 * In-memory presence tracking: userId -> Set of socket ids (a user can
 * have multiple tabs/devices open). Never persisted - this is purely
 * transient connection state, rebuilt naturally as clients reconnect
 * after any relay restart.
 */

// Map<number, Set<string>>
const onlineUsers = new Map();

function addConnection(userId, socketId) {
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socketId);
  // returns true if this is the user's FIRST connection (i.e. they just
  // came online, as opposed to opening a second tab)
  return onlineUsers.get(userId).size === 1;
}

function removeConnection(userId, socketId) {
  const sockets = onlineUsers.get(userId);
  if (!sockets) return false;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    onlineUsers.delete(userId);
    return true; // user just went fully offline
  }
  return false;
}

function isOnline(userId) {
  return onlineUsers.has(userId);
}

function getSocketIds(userId) {
  return onlineUsers.has(userId) ? Array.from(onlineUsers.get(userId)) : [];
}

function getOnlineUserIds() {
  return Array.from(onlineUsers.keys());
}

module.exports = {
  addConnection,
  removeConnection,
  isOnline,
  getSocketIds,
  getOnlineUserIds,
};
