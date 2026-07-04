/**
 * signaling.js
 * Handlers for call-related events: incoming_call, accept_call,
 * decline_call, offer, answer, ice_candidate, hangup.
 *
 * Every handler is a pure relay: validate the authenticated sender,
 * validate the target exists in-memory, forward the payload, done.
 * No call state, no history, no database - that all lives in PHP and is
 * written by the browser via REST calls the relay never makes itself.
 */

const socketRegistry = require('./socket');

function registerSignalingHandlers(socket, getAuthedUserId) {
  function forwardToTarget(event, data, extraFields = {}) {
    const fromUserId = getAuthedUserId();
    if (!fromUserId) return;

    const toUserId = Number(data && data.to);
    if (!toUserId) return;

    const delivered = socketRegistry.emitToUser(toUserId, event, {
      from: fromUserId,
      ...extraFields,
    });

    if (!delivered) {
      // Target is offline - inform the sender so the UI can show
      // "missed call" / "user unavailable" rather than hanging silently.
      socket.emit('peer_unavailable', { event, to: toUserId });
    }
  }

  socket.on('incoming_call', (data) => {
    // call_type is purely informational for the callee's UI (ring
    // screen label, proactively requesting camera permission) - the
    // actual media negotiation is entirely encoded in the offer/answer
    // SDP regardless of this field, so an unrecognized/missing value
    // safely defaults to 'audio' rather than breaking anything.
    const callType = data && data.call_type === 'video' ? 'video' : 'audio';
    forwardToTarget('incoming_call', data, { call_type: callType });
  });

  socket.on('accept_call', (data) => {
    forwardToTarget('call_accepted', data);
  });

  socket.on('decline_call', (data) => {
    forwardToTarget('call_declined', data);
  });

  socket.on('offer', (data) => {
    forwardToTarget('offer', data, { sdp: data && data.sdp });
  });

  socket.on('answer', (data) => {
    forwardToTarget('answer', data, { sdp: data && data.sdp });
  });

  socket.on('ice_candidate', (data) => {
    forwardToTarget('ice_candidate', data, { candidate: data && data.candidate });
  });

  socket.on('hangup', (data) => {
    forwardToTarget('hangup', data);
  });
}

module.exports = { registerSignalingHandlers };
