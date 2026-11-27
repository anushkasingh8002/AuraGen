// server/tests/manual/ws-smoke.js
// ─────────────────────────────────────────────────────────────────────
// Quick manual smoke test for the WebSocket layer.
//
// HOW TO RUN
//   1. Start the server:       npm run dev
//   2. In another terminal:    node server/tests/manual/ws-smoke.js
//
// WHAT IT DOES
//   – Connects to ws://localhost:4000 with the allowed origin.
//   – Sends a session:start message.
//   – Prints the server's reply (should be session:ready with a UUID).
//   – Disconnects cleanly.
// ─────────────────────────────────────────────────────────────────────

import WebSocket from "ws";

const URL = "ws://localhost:4000";
const ORIGIN = "http://localhost:3000"; // must match ALLOWED_ORIGINS

const ws = new WebSocket(URL, { headers: { origin: ORIGIN } });

ws.on("open", () => {
  console.log("✔ Connected to", URL);

  const msg = {
    type: "session:start",
    sessionId: "smoke-test",
    payload: { formId: "loan-application" },
  };

  console.log("→ Sending:", JSON.stringify(msg));
  ws.send(JSON.stringify(msg));
});

ws.on("message", (data) => {
  const reply = JSON.parse(data.toString());
  console.log("← Received:", JSON.stringify(reply, null, 2));

  // If we got session:ready, the test passed.
  if (reply.type === "session:ready") {
    console.log("✔ session:ready received — smoke test PASSED");
  }

  ws.close();
});

ws.on("close", (code, reason) => {
  console.log(`✔ Disconnected (code=${code} reason=${reason || "clean"})`);
});

ws.on("error", (err) => {
  console.error("✘ WebSocket error:", err.message);
});

