
// server/index.js
// ─────────────────────────────────────────────────────────────────────
// Entry point: Express HTTP server + WebSocket layer.
//
// RESPONSIBILITIES
//   1. Serve the /health endpoint (liveness probe).
//   2. Accept WebSocket connections and enforce origin policy.
//   3. Assign each connection a unique session and manage its lifecycle.
//   4. Route incoming JSON messages to the correct handler.
//   5. Keep connections alive with ping / pong heartbeat.
//   6. Shut down gracefully on SIGINT.
//
// LATER STEPS will register more handlers (telemetry, snapshot, etc.)
// by adding entries to the `handlers` map.
// ─────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import http from "node:http";
import express from "express";
import { WebSocketServer } from "ws";

import config from "./config.js";
import log from "./safety/logger.js";
import { send } from "./ws/send.js";
import { createWindow } from "./friction/sessionWindow.js";
import { computeCLS } from "./friction/score.js";
import { createTrigger } from "./friction/trigger.js";
import { resolveSnapshot } from "./agent/snapshot.js";
import { startRedesign, evictComponent } from "./pipeline/redesign.js";

// ── constants ────────────────────────────────────────────────────────

const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB safety cap
const HEARTBEAT_INTERVAL_MS = 30_000; // ping every 30 s

// ── session store ────────────────────────────────────────────────────
// A plain Map keyed by sessionId.  Every session object owns the socket
// reference so handlers never need to look it up separately.

/** @type {Map<string, import("./types").Session>} */
const sessions = new Map();

// ── Express app ──────────────────────────────────────────────────────

const app = express();

app.get("/health", (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

// ── HTTP + WebSocket servers ─────────────────────────────────────────

const server = http.createServer(app);

const wss = new WebSocketServer({
  server,
  // We verify the origin manually in the "connection" event so we can
  // log the rejection.  `verifyClient` would work too, but gives us
  // less control over the close code / log message.
});

// ── helpers ──────────────────────────────────────────────────────────

export { send };

// ── message handlers ─────────────────────────────────────────────────
// Each key is a message `type`; the value is an async function receiving
// (session, payload).  Later steps will import this map and add entries.

/** @type {Record<string, (session: object, payload: object) => Promise<void>>} */
export const handlers = {};

handlers["session:start"] = async (session, payload) => {
  // The browser tells us which form it is showing.
  session.formId = payload.formId ?? null;

  // Initialise the telemetry sliding window for this session.
  session.window = createWindow();

  // Initialise the redesign trigger for this session.
  session.trigger = createTrigger({
    threshold: config.CLS_THRESHOLD,
    sustainMs: config.CLS_SUSTAIN_MS,
    cooldownMs: config.REDESIGN_COOLDOWN_MS,
  });

  log.info("session:start", { sessionId: session.id, formId: session.formId });

  send(session, "session:ready", {});
};

// ── telemetry batch → compute Cognitive Load Score ───────────────────

const MAX_EVENTS_PER_BATCH = 200;

handlers["telemetry:batch"] = async (session, payload) => {
  // payload must be an array of telemetry events.
  if (!Array.isArray(payload)) {
    log.warn("telemetry:invalid_payload", { sessionId: session.id });
    return;
  }

  if (payload.length > MAX_EVENTS_PER_BATCH) {
    log.warn("telemetry:batch_too_large", {
      sessionId: session.id,
      count: payload.length,
    });
    return;
  }

  // Lazily create the window if session:start was missed / out of order.
  if (!session.window) {
    session.window = createWindow();
  }

  session.window.add(payload);

  const now = Date.now();
  const metrics = session.window.snapshot(now);
  const { score, parts } = computeCLS(metrics);

  send(session, "score:update", { score, parts });

  log.info("score:update", {
    sessionId: session.id,
    score,
    parts,
    hotField: metrics.hotField,
  });

  // ── trigger check ──────────────────────────────────────────────────
  // Lazily create the trigger if session:start was missed.
  if (!session.trigger) {
    session.trigger = createTrigger({
      threshold: config.CLS_THRESHOLD,
      sustainMs: config.CLS_SUSTAIN_MS,
      cooldownMs: config.REDESIGN_COOLDOWN_MS,
    });
  }

  const { fire, friction } = session.trigger.update(
    score,
    metrics.hotField,
    now,
  );

  if (fire) {
    log.info("redesign_triggered", {
      sessionId: session.id,
      score: friction.score,
      field: friction.field,
    });

    // Execute redesign pipeline asynchronously
    startRedesign(session, friction).catch((err) => {
      log.error("redesign:uncaught_error", {
        sessionId: session.id,
        error: err.message,
      });
    });
  }
};

// ── DOM snapshot response from browser ───────────────────────────────

handlers["snapshot:response"] = async (session, payload) => {
  if (!payload || typeof payload.requestId !== "string") {
    log.warn("snapshot:invalid_payload", { sessionId: session.id });
    return;
  }

  log.info("snapshot:response", {
    sessionId: session.id,
    requestId: payload.requestId,
  });

  resolveSnapshot(payload.requestId, payload);
};

// ── browser component render feedback ────────────────────────────────

handlers["render:result"] = async (session, payload) => {
  if (payload?.ok === false) {
    log.warn("render:failed", {
      sessionId: session.id,
      componentId: payload.componentId,
      error: payload.error,
    });
    // Evict faulty component from cache so other sessions don't receive it
    evictComponent(payload.componentId);
  } else {
    log.info("render:ok", {
      sessionId: session.id,
      componentId: payload?.componentId,
    });
  }
};

// ── wizard form submission ───────────────────────────────────────────

handlers["wizard:submit"] = async (session, payload) => {
  // CRITICAL PRIVACY RULE: Never log form field values (only session and field count)
  log.info("wizard:submit", {
    sessionId: session.id,
    ok: true,
    fieldCount: payload ? Object.keys(payload).length : 0,
  });

  send(session, "submit:ack", { ok: true });
};

// ── connection lifecycle ─────────────────────────────────────────────

wss.on("connection", (socket, req) => {
  // ── origin check ───────────────────────────────────────────────────
  const origin = req.headers.origin ?? "";

  if (!config.ALLOWED_ORIGINS.includes(origin)) {
    log.warn("ws:rejected", { origin, reason: "origin_not_allowed" });
    socket.close(1008, "Origin not allowed");
    return;
  }

  // ── create session ─────────────────────────────────────────────────
  const sessionId = crypto.randomUUID();

  const session = {
    id: sessionId,
    socket,
    formId: null,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    window: null,  // initialised in session:start handler
    trigger: null, // initialised in session:start handler
    lastRedesignAt: 0,
  };

  sessions.set(sessionId, session);
  log.info("ws:open", { sessionId, origin });

  // Mark alive for heartbeat.
  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });

  // ── message routing ────────────────────────────────────────────────
  socket.on("message", async (raw) => {
    // Guard: reject oversized payloads before parsing.
    if (raw.length > MAX_MESSAGE_BYTES) {
      log.warn("ws:msg_too_large", {
        sessionId,
        bytes: raw.length,
      });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      log.warn("ws:bad_json", { sessionId });
      return;
    }

    // Validate minimal envelope shape.
    if (!msg || typeof msg.type !== "string") {
      log.warn("ws:missing_type", { sessionId });
      return;
    }

    session.lastSeen = Date.now();

    const handler = handlers[msg.type];
    if (handler) {
      try {
        await handler(session, msg.payload ?? {});
      } catch (err) {
        log.error("handler:error", {
          sessionId,
          type: msg.type,
          message: err.message,
        });
      }
    } else {
      log.warn("ws:unknown_type", { sessionId, type: msg.type });
    }
  });

  // ── close / error ──────────────────────────────────────────────────
  socket.on("close", (closeCode, reason) => {
    sessions.delete(sessionId);
    log.info("ws:close", {
      sessionId,
      closeCode,
      reason: reason?.toString() || "",
    });
  });

  socket.on("error", (err) => {
    log.error("ws:error", { sessionId, message: err.message });
  });
});

// ── heartbeat ────────────────────────────────────────────────────────
// Ping every client; terminate any that didn't pong since last check.

const heartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (!socket.isAlive) {
      log.warn("ws:heartbeat_timeout", {});
      return socket.terminate();
    }
    socket.isAlive = false;
    socket.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => clearInterval(heartbeat));

// ── start listening ──────────────────────────────────────────────────

if (process.env.NODE_ENV !== "test") {
  server.listen(config.PORT, () => {
    log.info("server:start", { port: config.PORT });
  });
}

// ── graceful shutdown ────────────────────────────────────────────────

function shutdown() {
  log.info("server:shutdown", {});

  // Close every WebSocket cleanly.
  for (const [id, session] of sessions) {
    session.socket.close(1001, "Server shutting down");
    sessions.delete(id);
  }

  clearInterval(heartbeat);

  server.close(() => {
    log.info("server:stopped", {});
    process.exit(0);
  });

  // Force-kill if close takes too long (e.g. stuck connections).
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", shutdown);

// On Windows SIGINT may not fire; handle SIGBREAK as well.
process.on("SIGBREAK", shutdown);
