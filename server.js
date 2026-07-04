/**
 * server.js
 * Lightweight, stateless Socket.IO relay.
 *
 * Responsibilities (and ONLY these):
 *   - accept Socket.IO connections
 *   - verify socket authentication tokens (HMAC, see auth.js)
 *   - track online users in memory (presence.js, socket.js)
 *   - relay private messages, typing indicators, presence updates
 *   - relay WebRTC signaling (signaling.js)
 *   - handle heartbeat ping/pong, reconnects, disconnects
 *
 * This file NEVER imports a database client, NEVER calls fetch() against
 * the PHP app, and NEVER persists anything to disk. All state here is
 * memory-only and intentionally lost on restart - clients reconnect and
 * re-authenticate automatically (see assets/js/socket-client.js).
 */

require('dotenv').config();

const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const { verifySocketToken } = require('./auth');
const presence = require('./presence');
const socketRegistry = require('./socket');
const { registerSignalingHandlers } = require('./signaling');

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const HEARTBEAT_TIMEOUT_MS = parseInt(process.env.HEARTBEAT_TIMEOUT_MS || '30000', 10);

// --- Plain HTTP server with a health-check endpoint (Render pings this) ---
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', onlineUsers: presence.getOnlineUserIds().length }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const corsOptions = {
  origin: ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : '*',
  methods: ['GET', 'POST'],
  credentials: true,
};

const io = new Server(httpServer, {
  cors: corsOptions,
  // Generous timeouts to tolerate Render free-tier cold starts and
  // mobile network jitter, while still reaping genuinely dead sockets.
  pingTimeout: HEARTBEAT_TIMEOUT_MS,
  pingInterval: 15000,
  connectTimeout: 20000,
  transports: ['websocket', 'polling'],
});

io.on('connection', (socket) => {
  let authedUserId = null;
  let authTimeoutHandle = null;

  // Require authentication within a short grace period after connecting;
  // otherwise disconnect the socket to avoid accumulating unauthenticated
  // dangling connections.
  authTimeoutHandle = setTimeout(() => {
    if (!authedUserId) {
      socket.disconnect(true);
    }
  }, 10000);

  socket.on('authenticate', ({ token } = {}) => {
    const result = verifySocketToken(token);

    if (!result.valid) {
      socket.emit('auth_error', { reason: result.reason });
      return;
    }

    clearTimeout(authTimeoutHandle);
    authedUserId = result.userId;

    socketRegistry.register(authedUserId, socket);
    const justCameOnline = presence.addConnection(authedUserId, socket.id);

    socket.emit('authenticated', { userId: authedUserId });

    if (justCameOnline) {
      // Broadcast to everyone else that this user is now online. A simple
      // broadcast is acceptable at this app's scale; for very large user
      // bases this could be narrowed to "users who have this person in an
      // open conversation," but presence is inherently a broadcast concept
      // in a contacts-style app where anyone can see anyone's status.
      socket.broadcast.emit('presence', {
        user_id: authedUserId,
        is_online: true,
        last_seen: null,
      });
    }

    // Send the new connection the current online set so its contact list
    // can render correct presence dots immediately, without waiting for
    // individual events.
    socket.emit('presence_snapshot', {
      online_user_ids: presence.getOnlineUserIds(),
    });

    registerSignalingHandlers(socket, () => authedUserId);
  });

  function requireAuthed(handler) {
    return (data) => {
      if (!authedUserId) return;
      handler(data);
    };
  }

  socket.on('private_message', requireAuthed((data) => {
    const toUserId = Number(data && data.to);
    if (!toUserId || typeof data.body !== 'string') return;

    // message_type distinguishes plain text from a voice note - for a
    // voice note, "body" carries the note's URL rather than text (same
    // column reused server-side too, see php-app/schema.sql). Unknown/
    // missing values default to 'text' so older clients keep working
    // unchanged.
    const messageType = data.message_type === 'voice_note' ? 'voice_note' : 'text';
    const voiceNoteDurationSecs = messageType === 'voice_note'
      ? Math.max(0, Number(data.voice_note_duration_secs) || 0)
      : undefined;

    socketRegistry.emitToUser(toUserId, 'private_message', {
      from: authedUserId,
      body: data.body,
      client_msg_id: data.client_msg_id || null,
      created_at: data.created_at || new Date().toISOString(),
      message_type: messageType,
      ...(voiceNoteDurationSecs !== undefined ? { voice_note_duration_secs: voiceNoteDurationSecs } : {}),
      // message_id is intentionally absent here - the relay never knows
      // the DB id. The receiver gets it from the PHP-persisted history on
      // next load, or the sender's send_message.php response if they're
      // also the recipient context (n/a for 1:1 chat). Read/delivered
      // receipts are reconciled via REST, not the relay.
    });
  }));

  socket.on('typing', requireAuthed((data) => {
    const toUserId = Number(data && data.to);
    if (!toUserId) return;
    socketRegistry.emitToUser(toUserId, 'typing', {
      from: authedUserId,
      is_typing: !!data.is_typing,
    });
  }));

  socket.on('heartbeat', requireAuthed(() => {
    socket.emit('heartbeat_ack', { t: Date.now() });
  }));

  socket.on('disconnect', () => {
    clearTimeout(authTimeoutHandle);
    if (!authedUserId) return;

    socketRegistry.unregister(authedUserId, socket.id);
    const wentFullyOffline = presence.removeConnection(authedUserId, socket.id);

    if (wentFullyOffline) {
      socket.broadcast.emit('presence', {
        user_id: authedUserId,
        is_online: false,
        last_seen: new Date().toISOString(),
      });
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Relay listening on port ${PORT}`);
  if (ALLOWED_ORIGINS.length === 0) {
    console.warn('WARNING: ALLOWED_ORIGINS is not set - CORS is wide open. Set it before going to production.');
  }
});
