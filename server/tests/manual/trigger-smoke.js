// server/tests/manual/trigger-smoke.js
// ─────────────────────────────────────────────────────────────────────
// Live test: sends confused telemetry batches every 500 ms for 8
// seconds, then calm batches for 4 more.  Checks:
//   1. Exactly one redesign_triggered appears (watch the server log).
//   2. score:update messages arrive every batch.
//   3. After firing, continued high scores do NOT trigger again.
//
// RUN:  1. npm run dev        (watch the server output)
//       2. node server/tests/manual/trigger-smoke.js
// ─────────────────────────────────────────────────────────────────────

import WebSocket from "ws";

const URL = "ws://localhost:4000";
const ORIGIN = "http://localhost:3000";
const ws = new WebSocket(URL, { headers: { origin: ORIGIN } });

let batchNum = 0;
let scoreUpdates = 0;
let interval;

// Record the absolute start time so we can build a coherent focus
// session that spans the entire test (never blurred → idle accumulates).
const testStart = Date.now();
let focusSent = false;

ws.on("open", () => {
  console.log("✔ Connected — sending confused batches for ~8 s\n");

  ws.send(JSON.stringify({
    type: "session:start",
    sessionId: "trigger-test",
    payload: { formId: "loan-form" },
  }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "session:ready") {
    // Start sending batches every 500 ms.
    interval = setInterval(() => sendBatch(), 500);
  }

  if (msg.type === "score:update") {
    scoreUpdates++;
    const { score, parts } = msg.payload;
    const bar = "█".repeat(Math.round(score / 5)).padEnd(20, "░");
    console.log(
      `  #${String(scoreUpdates).padStart(2)} score=${score} ${bar}` +
      `  V=${parts.V.toFixed(2)} H=${parts.H.toFixed(2)}` +
      ` R=${parts.R.toFixed(2)} E=${parts.E.toFixed(2)}`
    );
  }
});

ws.on("close", () => {
  console.log(`\n✔ Done — received ${scoreUpdates} score:update messages.`);
  console.log("→ Check server output for exactly ONE 'redesign_triggered' log.");
});

ws.on("error", (e) => console.error("✘", e.message));

function sendBatch() {
  batchNum++;
  const now = Date.now();

  if (batchNum <= 16) {
    // ── confused batch for the first ~8 seconds ──────────────────
    const events = [];

    // Jittery mouse (high V)
    for (let i = 0; i < 20; i++) {
      events.push({
        k: "move", v: i % 2 === 0 ? 5.0 : 0.1, t: now - 500 + i * 25,
      });
    }

    // Rage clicks (high R) + inert clicks (high E)
    events.push({ k: "click", f: "income", rage: true, inert: false, t: now - 100 });
    events.push({ k: "click", f: "income", rage: true, inert: false, t: now - 50 });
    events.push({ k: "click", f: "income", rage: false, inert: true, t: now - 25 });

    // Validation error (adds to E)
    events.push({ k: "error", f: "income", t: now - 200 });

    // Send ONE focus event at the very start (never blur).
    // The idle time (H) will grow with each batch because there is
    // no input event and no blur — the window sees continuous idle.
    if (!focusSent) {
      events.push({ k: "focus", f: "income", t: testStart });
      focusSent = true;
    }

    ws.send(JSON.stringify({
      type: "telemetry:batch",
      sessionId: "trigger-test",
      payload: events,
    }));
  } else if (batchNum <= 24) {
    // ── calm batch for 4 more seconds ────────────────────────────
    if (batchNum === 17) console.log("\n  — switching to calm input —\n");
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push({ k: "move", v: 0.5, t: now - 500 + i * 50 });
    }
    ws.send(JSON.stringify({
      type: "telemetry:batch",
      sessionId: "trigger-test",
      payload: events,
    }));
  } else {
    // ── done ─────────────────────────────────────────────────────
    clearInterval(interval);
    ws.close();
  }
}
