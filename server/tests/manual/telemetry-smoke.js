// server/tests/manual/telemetry-smoke.js
// ─────────────────────────────────────────────────────────────────────
// Sends fake calm and confused telemetry batches, prints score:update
// replies.  Used to verify wiring and to capture baseline numbers.
//
// RUN:  1. npm run dev        (in one terminal)
//       2. node server/tests/manual/telemetry-smoke.js   (in another)
// ─────────────────────────────────────────────────────────────────────

import WebSocket from "ws";

const URL = "ws://localhost:4000";
const ORIGIN = "http://localhost:3000";

const ws = new WebSocket(URL, { headers: { origin: ORIGIN } });

let step = 0;

ws.on("open", () => {
  console.log("✔ Connected\n");

  // Start session.
  ws.send(JSON.stringify({
    type: "session:start",
    sessionId: "tel-smoke",
    payload: { formId: "loan-form" },
  }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.type === "session:ready") {
    console.log("✔ Session ready:", msg.sessionId, "\n");
    sendCalm();
  }

  if (msg.type === "score:update") {
    const { score, parts } = msg.payload;
    const label = step === 1 ? "CALM" : "CONFUSED";
    console.log(`── ${label} ──`);
    console.log(`   Score : ${score}`);
    console.log(`   V     : ${parts.V.toFixed(3)}`);
    console.log(`   H     : ${parts.H.toFixed(3)}`);
    console.log(`   R     : ${parts.R.toFixed(3)}`);
    console.log(`   E     : ${parts.E.toFixed(3)}`);
    console.log();

    if (step === 1) {
      sendConfused();
    } else {
      console.log("✔ Both batches scored — done.");
      ws.close();
    }
  }
});

ws.on("close", () => console.log("✔ Disconnected"));
ws.on("error", (e) => console.error("✘", e.message));

// ── calm batch: steady slow moves, no clicks ─────────────────────────
function sendCalm() {
  step = 1;
  const now = Date.now();
  const events = Array.from({ length: 50 }, (_, i) => ({
    k: "move", v: 0.5, t: now - 10000 + i * 200,
  }));

  ws.send(JSON.stringify({
    type: "telemetry:batch",
    sessionId: "tel-smoke",
    payload: events,
  }));
}

// ── confused batch: jittery + rage clicks + idle + errors ────────────
function sendConfused() {
  step = 2;
  const now = Date.now();
  const events = [];

  // Jittery mouse moves
  for (let i = 0; i < 60; i++) {
    events.push({
      k: "move", v: i % 2 === 0 ? 5.0 : 0.1, t: now - 10000 + i * 150,
    });
  }

  // 4 rage clicks
  for (let i = 0; i < 4; i++) {
    events.push({
      k: "click", f: "income", rage: true, inert: false, t: now - 5000 + i * 80,
    });
  }

  // Focus for 10 s with no input (idle)
  events.push({ k: "focus", f: "income", t: now - 10000 });

  // Validation error
  events.push({ k: "error", f: "income", t: now - 3000 });

  ws.send(JSON.stringify({
    type: "telemetry:batch",
    sessionId: "tel-smoke",
    payload: events,
  }));
}

