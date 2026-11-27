// server/index.js
// ─────────────────────────────────────────────────────────────────────
// Entry point: Express HTTP server + hardened WebSocket layer.
//
// SECURITY & RESOURCE GUARANTEES:
//   - Rejects disallowed Origins (code 1008).
//   - Bounds incoming WS frame payload to 64 KB via `ws` `maxPayload`.
//   - Enforces max active connections (`MAX_SESSIONS`) and per-socket
//     message flood limit (100 messages/second).
//   - Requires session:start handshake before processing telemetry.
//   - Cleans up timers, pending snapshot requests, and aborts active
//     redesign streams when a client disconnects mid-operation.
//   - Guards process against unhandledRejection / uncaughtException.
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
import {
  resolveSnapshot,
  clearPendingSnapshots,
} from "./agent/snapshot.js";
import { isFieldSensitive } from "./agent/mask.js";
import cache from "./cache/cache.js";
import {
  startRedesign,
  prewarmRedesign,
  evictComponent,
} from "./pipeline/redesign.js";

// ── constants ────────────────────────────────────────────────────────

const MAX_MESSAGE_BYTES = 64 * 1024; // 64 KB frame cap
const HEARTBEAT_INTERVAL_MS = 30_000; // ping every 30 s
const MAX_MESSAGES_PER_SEC = 100; // per-socket flood threshold
const MAX_SESSIONS = 500; // max concurrent WebSocket sessions
const MAX_EVENTS_PER_BATCH = 200;

// ── session store ────────────────────────────────────────────────────

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
  maxPayload: MAX_MESSAGE_BYTES,
});

export { app, server, wss, sessions, send };

// ── message handlers ─────────────────────────────────────────────────

/** @type {Record<string, (session: object, payload: object) => Promise<void>>} */
export const handlers = {};

handlers["session:start"] = async (session, payload) => {
  session.formId =
    typeof payload?.formId === "string" ? payload.formId.slice(0, 64) : null;
  session.started = true;

  session.window = createWindow();
  session.trigger = createTrigger({
    threshold: config.CLS_THRESHOLD,
    sustainMs: config.CLS_SUSTAIN_MS,
    cooldownMs: config.REDESIGN_COOLDOWN_MS,
  });

  log.info("session:start", { sessionId: session.id, formId: session.formId });
  send(session, "session:ready", {});
};

handlers["telemetry:batch"] = async (session, payload) => {
  if (!session.started) {
    log.warn("ws:session_not_started", { sessionId: session.id, type: "telemetry:batch" });
    return;
  }

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

  if (!session.window) {
    session.window = createWindow();
  }

  session.window.add(payload);

  const now = Date.now();
  const metrics = session.window.snapshot(now);
  const hotField = isFieldSensitive(metrics.hotField, null)
    ? null
    : metrics.hotField;
  const { score, parts } = computeCLS(metrics);

  send(session, "score:update", { score, parts });

  log.info("score:update", {
    sessionId: session.id,
    score,
    parts,
    hotField,
  });

  if (!session.trigger) {
    session.trigger = createTrigger({
      threshold: config.CLS_THRESHOLD,
      sustainMs: config.CLS_SUSTAIN_MS,
      cooldownMs: config.REDESIGN_COOLDOWN_MS,
    });
  }

  const { fire, friction } = session.trigger.update(
    score,
    hotField,
    now
  );

  const triggerState = session.trigger._state();

  if (triggerState === "IDLE" && !session.trigger.isRising(score)) {
    session.prewarmAttempted = false;
  }

  if (
    !fire &&
    config.PREWARM_ENABLED &&
    triggerState !== "COOLDOWN" &&
    session.trigger.isRising(score) &&
    !session.prewarmAttempted &&
    !session.redesigning
  ) {
    session.prewarmAttempted = true;
    log.info("prewarm_started", {
      sessionId: session.id,
      score,
      field: hotField,
    });
    prewarmRedesign(session, { field: hotField, score }).catch((err) => {
      log.warn("prewarm:uncaught_error", {
        sessionId: session.id,
        error: err.message,
      });
    });
  }

  if (fire) {
    session.prewarmAttempted = false;
    log.info("redesign_triggered", {
      sessionId: session.id,
      score: friction.score,
      field: friction.field,
    });

    startRedesign(session, friction).catch((err) => {
      log.error("redesign:uncaught_error", {
        sessionId: session.id,
        error: err.message,
      });
    });
  }
};

handlers["snapshot:response"] = async (session, payload) => {
  if (!session.started) {
    log.warn("ws:session_not_started", { sessionId: session.id, type: "snapshot:response" });
    return;
  }

  if (!payload || typeof payload.requestId !== "string") {
    log.warn("snapshot:invalid_payload", { sessionId: session.id });
    return;
  }

  log.info("snapshot:response", {
    sessionId: session.id,
    requestId: payload.requestId,
  });

  resolveSnapshot(payload.requestId, payload, session.id);
};

handlers["render:result"] = async (session, payload) => {
  if (!session.started) {
    log.warn("ws:session_not_started", { sessionId: session.id, type: "render:result" });
    return;
  }

  if (payload?.ok === false) {
    log.warn("render:failed", {
      sessionId: session.id,
      componentId: payload.componentId,
      error: payload.error,
    });
    // Ownership check prevents cross-session cache eviction DoS
    evictComponent(payload.componentId, cache, session);
  } else {
    log.info("render:ok", {
      sessionId: session.id,
      componentId: payload?.componentId,
    });
  }
};

handlers["wizard:submit"] = async (session, payload) => {
  if (!session.started) {
    log.warn("ws:session_not_started", { sessionId: session.id, type: "wizard:submit" });
    return;
  }

  // CRITICAL PRIVACY RULE: Never log form field values (only session and field count)
  log.info("wizard:submit", {
    sessionId: session.id,
    ok: true,
    fieldCount: payload && typeof payload === "object" ? Object.keys(payload).length : 0,
  });

  send(session, "submit:ack", { ok: true });
};

// ── connection lifecycle ─────────────────────────────────────────────

wss.on("connection", (socket, req) => {
  const origin = req.headers.origin ?? "";
  let sessionId = null;

  // Attach before origin/session checks so protocol errors (including
  // oversized frames) can never become unhandled socket errors.
  socket.on("error", (err) => {
    log.error("ws:error", { sessionId, message: err.message });
  });

  if (!config.ALLOWED_ORIGINS.includes(origin)) {
    log.warn("ws:rejected", { origin, reason: "origin_not_allowed" });
    socket.close(1008, "Origin not allowed");
    return;
  }

  if (sessions.size >= MAX_SESSIONS) {
    log.warn("ws:rejected", { reason: "max_sessions_reached", count: sessions.size });
    socket.close(1013, "Server busy");
    return;
  }

  sessionId = crypto.randomUUID();
  const msgTimestamps = [];

  const session = {
    id: sessionId,
    socket,
    formId: null,
    started: false,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    window: null,
    trigger: null,
    lastRedesignAt: 0,
    redesigning: false,
    prewarming: false,
    prewarmAttempted: false,
    deliveredComponents: new Set(),
    abortController: new AbortController(),
  };

  sessions.set(sessionId, session);
  log.info("ws:open", { sessionId, origin });

  socket.isAlive = true;
  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", async (raw) => {
    if (session.closing) return;

    // Per-socket sliding 1-second flood limit (drop & close > 100 msg/s)
    const now = Date.now();
    const cutoff = now - 1000;
    while (msgTimestamps.length > 0 && msgTimestamps[0] <= cutoff) {
      msgTimestamps.shift();
    }
    msgTimestamps.push(now);
    if (msgTimestamps.length > MAX_MESSAGES_PER_SEC) {
      session.closing = true;
      log.warn("ws:flood_dropped", { sessionId, msgsPerSec: msgTimestamps.length });
      socket.close(1008, "Message rate limit exceeded");
      return;
    }

    if (raw.length > MAX_MESSAGE_BYTES) {
      log.warn("ws:msg_too_large", { sessionId, bytes: raw.length });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      log.warn("ws:bad_json", { sessionId });
      return;
    }

    if (!msg || typeof msg.type !== "string") {
      log.warn("ws:missing_type", { sessionId });
      return;
    }

    session.lastSeen = now;

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

  socket.on("close", (closeCode, reason) => {
    // Clean up timers, pending snapshot promises, and active abort controller
    clearPendingSnapshots(sessionId);
    try {
      session.abortController?.abort();
    } catch {}
    session.redesigning = false;
    session.prewarming = false;
    sessions.delete(sessionId);

    log.info("ws:close", {
      sessionId,
      closeCode,
      reason: reason?.toString() || "",
    });
  });

});

// ── heartbeat ────────────────────────────────────────────────────────

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

if (typeof heartbeat.unref === "function") {
  heartbeat.unref();
}

wss.on("close", () => clearInterval(heartbeat));

// ── start listening ──────────────────────────────────────────────────

if (process.env.NODE_ENV !== "test") {
  server.listen(config.PORT, () => {
    log.info("server:start", { port: config.PORT });
  });
}

// ── process-level safety ─────────────────────────────────────────────

if (process.env.NODE_ENV !== "test") {
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    log.error("process:unhandledRejection", { message });
    // Keep server alive on unhandledRejection
  });

  process.on("uncaughtException", (err) => {
    log.error("process:uncaughtException", {
      name: err?.name,
      message: err?.message,
    });
    shutdown(1);
  });
}

// ── graceful shutdown ────────────────────────────────────────────────

export function shutdown(exitCode = 0) {
  log.info("server:shutdown", {});

  for (const [id, session] of sessions) {
    clearPendingSnapshots(id);
    try {
      session.abortController?.abort();
    } catch {}
    session.socket.close(1001, "Server shutting down");
    sessions.delete(id);
  }

  clearInterval(heartbeat);

  server.close(() => {
    log.info("server:stopped", {});
    process.exit(exitCode);
  });

  const forceExit = setTimeout(() => process.exit(1), 5000);
  if (typeof forceExit.unref === "function") {
    forceExit.unref();
  }
}

if (process.env.NODE_ENV !== "test") {
  process.on("SIGINT", () => shutdown(0));
  process.on("SIGBREAK", () => shutdown(0));
}
