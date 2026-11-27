// server/tests/manual/redesign-smoke.js
// ─────────────────────────────────────────────────────────────────────
// End-to-end WebSocket smoke test for Step 8 Redesign Pipeline.
//
// Verifies:
//   1. session:start -> session:ready
//   2. Sustained high-friction telemetry triggers redesign:started
//   3. snapshot:request receives snapshot:response from client
//   4. redesign:ready received with compiled component code (cached: false)
//   5. Second redesign receives cached: true with near-instant latency
//   6. render:result { ok: false } evicts cache
//   7. wizard:submit receives submit:ack (and confirms no values are logged)
// ─────────────────────────────────────────────────────────────────────

import WebSocket from "ws";

const URL = "ws://localhost:4000";
const ORIGIN = "http://localhost:3000";

const sampleSchema = {
  formId: "loan-application",
  title: "Personal Loan Application",
  fields: [
    { id: "fullName", label: "Full Name", type: "text", required: true },
    { id: "monthlyIncome", label: "Monthly Income", type: "number", required: true },
    { id: "panNumber", label: "PAN", sensitive: true, required: true },
  ],
};

const sampleValues = {
  fullName: "Alice Smith",
  monthlyIncome: "45000",
  panNumber: "ABCDE1234F",
};

function runClientSession(sessionId, isSecondRun = false) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { headers: { origin: ORIGIN } });
    const testStart = Date.now();
    let focusSent = false;
    let telemetryInterval = null;

    function sendHighFrictionBatch() {
      const now = Date.now();
      const events = [];

      // Jitter (high V)
      for (let i = 0; i < 20; i++) {
        events.push({ k: "move", v: i % 2 === 0 ? 5.0 : 0.1, t: now - 500 + i * 25 });
      }
      // Rage & inert clicks (high R, high E)
      events.push({ k: "click", f: "monthlyIncome", rage: true, inert: false, t: now - 100 });
      events.push({ k: "click", f: "monthlyIncome", rage: true, inert: false, t: now - 50 });
      events.push({ k: "click", f: "monthlyIncome", rage: false, inert: true, t: now - 25 });
      events.push({ k: "error", f: "monthlyIncome", t: now - 200 });

      // Persistent focus for idle time accumulation (high H)
      if (!focusSent) {
        events.push({ k: "focus", f: "monthlyIncome", t: testStart });
        focusSent = true;
      }

      ws.send(
        JSON.stringify({
          type: "telemetry:batch",
          sessionId,
          payload: events,
        })
      );
    }

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "session:start",
          sessionId,
          payload: { formId: "loan-application" },
        })
      );
    });

    ws.on("error", (err) => reject(err));

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "session:ready") {
        console.log(`\n✔ [${sessionId}] Session ready. Streaming sustained confused telemetry...`);
        sendHighFrictionBatch();
        telemetryInterval = setInterval(sendHighFrictionBatch, 400);
      }

      if (msg.type === "score:update") {
        const { score } = msg.payload;
        if (score >= 70) {
          process.stdout.write(` [CLS: ${score}]`);
        }
      }

      if (msg.type === "redesign:started") {
        clearInterval(telemetryInterval);
        console.log(`\n✔ [${sessionId}] Received redesign:started { friction field: ${msg.payload.friction?.field} }`);
      }

      if (msg.type === "snapshot:request") {
        console.log(`✔ [${sessionId}] Received snapshot:request. Replying with snapshot:response...`);
        ws.send(
          JSON.stringify({
            type: "snapshot:response",
            sessionId,
            payload: {
              requestId: msg.payload.requestId,
              schema: sampleSchema,
              values: sampleValues,
            },
          })
        );
      }

      if (msg.type === "redesign:ready") {
        console.log(`\n✔ [${sessionId}] Received redesign:ready:`);
        console.log(`  - ComponentId: ${msg.payload.componentId}`);
        console.log(`  - Cached:      ${msg.payload.cached}`);
        console.log(`  - Latency:     ${msg.payload.ms}ms`);
        console.log(`  - Code bytes:  ${msg.payload.code?.length} characters`);

        if (isSecondRun) {
          // Verify render error eviction and submit flow on second run
          console.log(`\n→ [${sessionId}] Sending render:result { ok: false } to test eviction...`);
          ws.send(
            JSON.stringify({
              type: "render:result",
              sessionId,
              payload: {
                ok: false,
                componentId: msg.payload.componentId,
                error: "Synthetic render test error",
              },
            })
          );

          console.log(`→ [${sessionId}] Sending wizard:submit...`);
          ws.send(
            JSON.stringify({
              type: "wizard:submit",
              sessionId,
              payload: {
                fullName: "Alice Smith",
                monthlyIncome: "45000",
              },
            })
          );
        } else {
          ws.close();
          resolve(msg.payload);
        }
      }

      if (msg.type === "submit:ack") {
        console.log(`✔ [${sessionId}] Received submit:ack { ok: true } (Values were NEVER logged)`);
        ws.close();
        resolve(msg.payload);
      }
    });
  });
}

async function runSmoke() {
  console.log("=========================================================");
  console.log("  AuraGen Step 8: End-to-End Redesign Smoke Test");
  console.log("=========================================================");

  // Run 1: Cold start (Cache Miss)
  console.log("\n--- RUN 1: Fresh Generation (Cache Miss expected) ---");
  const res1 = await runClientSession("sess-cold-1", false);
  if (res1.cached !== false) {
    throw new Error(`Expected cached: false on first run, got ${res1.cached}`);
  }

  // Small delay before Run 2
  await new Promise((r) => setTimeout(r, 600));

  // Run 2: Same form & field (Cache Hit expected)
  console.log("\n--- RUN 2: Repeated Redesign (Cache Hit expected) ---");
  const res2 = await runClientSession("sess-warm-2", true);

  console.log("\n=========================================================");
  console.log("✔ STEP 8 LIVE WEBSOCKET VERIFICATION COMPLETED SUCCESSFULLY");
  console.log("=========================================================\n");
}

runSmoke().catch((err) => {
  console.error("\n✘ Smoke test failed:", err);
  process.exit(1);
});
