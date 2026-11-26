// server/agent/snapshot.js
// ─────────────────────────────────────────────────────────────────────
// Asynchronous DOM snapshot request / response coordinator.
//
// WHY a request-response coordinator over WebSockets?
//   WebSockets are inherently full-duplex message streams with no
//   built-in request/reply semantics. By assigning each request a unique
//   requestId and keeping a pending map, we can turn an async WS message
//   into a standard Promise that either resolves with the DOM snapshot
//   or rejects on timeout.
// ─────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { send } from "../ws/send.js";
import { SnapshotTimeoutError } from "../safety/errors.js";
import log from "../safety/logger.js";

/**
 * Registry of pending snapshot requests awaiting a response.
 * Key: requestId (string)
 * Value: { resolve: Function, reject: Function, timer: NodeJS.Timeout, sessionId: string }
 * @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout, sessionId: string }>}
 */
const pendingRequests = new Map();

/**
 * Request a form snapshot from the client browser.
 *
 * @param {object} session         – the active WebSocket session
 * @param {string} reason          – reason for the snapshot (e.g. "redesign_trigger")
 * @param {number} [timeoutMs=2000]– milliseconds to wait before failing
 * @returns {Promise<{ schema: object, values: object }>}
 */
export function requestSnapshot(session, reason, timeoutMs = 2000) {
  const requestId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    // Set a strict timer to fail fast if the client is unresponsive
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      log.warn("snapshot:timeout", {
        sessionId: session.id,
        requestId,
        timeoutMs,
      });
      reject(new SnapshotTimeoutError(requestId, timeoutMs));
    }, timeoutMs);

    pendingRequests.set(requestId, {
      resolve,
      reject,
      timer,
      sessionId: session.id,
    });

    log.info("snapshot:request_sent", {
      sessionId: session.id,
      requestId,
      reason,
    });

    // Send envelope { type: "snapshot:request", sessionId, payload: { requestId, reason } }
    send(session, "snapshot:request", { requestId, reason });
  });
}

/**
 * Called by the WebSocket `snapshot:response` handler when the browser
 * returns the requested snapshot. Verifies session ownership when provided.
 *
 * @param {string} requestId          – the ID from the incoming payload
 * @param {object} payload            – { schema, values }
 * @param {string} [expectedSessionId]– caller session ID for isolation
 * @returns {boolean} true if a matching request was found and resolved
 */
export function resolveSnapshot(requestId, payload, expectedSessionId) {
  const pending = pendingRequests.get(requestId);
  if (!pending) {
    log.warn("snapshot:unmatched_response", { requestId });
    return false;
  }

  if (expectedSessionId && pending.sessionId !== expectedSessionId) {
    log.warn("snapshot:session_mismatch", {
      requestId,
      sessionId: expectedSessionId,
    });
    return false;
  }

  clearTimeout(pending.timer);
  pendingRequests.delete(requestId);

  log.info("snapshot:received", {
    sessionId: pending.sessionId,
    requestId,
  });

  pending.resolve({
    schema: payload?.schema ?? {},
    values: payload?.values ?? {},
  });

  return true;
}

/**
 * Explicitly reject a pending snapshot (e.g. client reported an error).
 *
 * @param {string} requestId
 * @param {Error} error
 * @returns {boolean}
 */
export function rejectSnapshot(requestId, error) {
  const pending = pendingRequests.get(requestId);
  if (!pending) return false;

  clearTimeout(pending.timer);
  pendingRequests.delete(requestId);

  pending.reject(error);
  return true;
}

/**
 * Clear all pending requests (useful during test cleanup or session teardown).
 * @param {string} [sessionId] – if provided, only clear requests for this session
 */
export function clearPendingSnapshots(sessionId) {
  for (const [id, req] of pendingRequests.entries()) {
    if (!sessionId || req.sessionId === sessionId) {
      clearTimeout(req.timer);
      pendingRequests.delete(id);
    }
  }
}

export { SnapshotTimeoutError };
