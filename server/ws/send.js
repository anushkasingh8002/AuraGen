// server/ws/send.js
// ─────────────────────────────────────────────────────────────────────
// Outbound WebSocket envelope sender.
//
// WHY a separate helper file?
//   Decouples message dispatching from index.js so agent modules,
//   pipelines, and tests can send messages without importing the Express
//   server instance or triggering side-effects.
// ─────────────────────────────────────────────────────────────────────

const WS_OPEN_STATE = 1;

/**
 * Send a typed JSON envelope to a session.
 * No-ops safely if the socket is not currently in OPEN readyState.
 *
 * @param {object} session
 * @param {string} type
 * @param {object} [payload={}]
 */
export function send(session, type, payload = {}) {
  const openState = session?.socket?.OPEN ?? WS_OPEN_STATE;
  if (!session?.socket || session.socket.readyState !== openState) {
    return;
  }

  session.socket.send(
    JSON.stringify({
      type,
      sessionId: session.id,
      payload,
    })
  );
}

export default send;
