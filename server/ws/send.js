// server/ws/send.js
// ─────────────────────────────────────────────────────────────────────
// Outbound WebSocket envelope sender with backpressure guard.
// ─────────────────────────────────────────────────────────────────────

const WS_OPEN_STATE = 1;
const MAX_BUFFERED_BYTES = 1024 * 1024; // 1 MB slow-client backpressure cap

/**
 * Send a typed JSON envelope to a session.
 * No-ops safely if the socket is closed or severely backpressured.
 *
 * @param {object} session
 * @param {string} type
 * @param {object} [payload={}]
 */
export function send(session, type, payload = {}) {
  const socket = session?.socket;
  const openState = socket?.OPEN ?? WS_OPEN_STATE;
  if (!socket || socket.readyState !== openState) {
    return;
  }

  if (typeof socket.bufferedAmount === "number" && socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    return;
  }

  socket.send(
    JSON.stringify({
      type,
      sessionId: session.id,
      payload,
    })
  );
}

export default send;
