// scripts/simulate.js
// ─────────────────────────────────────────────────────────────────────
// End-to-end WebSocket simulator for AuraGen backend.
//
// MODES:
//   calm     – 20s of slow, calm moves. Expect no redesign.
//   confused – 15s of high-friction telemetry. Expect redesign:ready.
//   broken   – Delayed snapshot response (>3s). Expect redesign:failed (snapshot_timeout).
//   twice    – Two confused runs (wait for cooldown). Expect second run to be cached.
//
// USAGE:
//   node scripts/simulate.js <mode>
//
// EXIT CODES:
//   0 = Expected behavior observed (CI ready)
//   1 = Failure or unexpected behavior
// ─────────────────────────────────────────────────────────────────────

import WebSocket from "ws";

const URL = process.env.WS_URL || "ws://localhost:4000";
const ORIGIN = process.env.ORIGIN || "http://localhost:3000";
const MODE = (process.argv[2] || "confused").toLowerCase();
const COOLDOWN_MS = parseInt(process.env.REDESIGN_COOLDOWN_MS || "5000", 10);

// ── 6-field DOM schema (includes sensitive aadhaarNumber and panNumber) ─
const sampleSchema = {
  formId: "loan-form",
  title: "Fast Personal Loan Application",
  fields: [
    { id: "fullName", label: "Full Name", type: "text", required: true },
    { id: "annualIncome", label: "Annual Income (₹)", type: "number", required: true },
    { id: "aadhaarNumber", label: "Aadhaar Number", type: "text", sensitive: true, required: true },
    { id: "panNumber", label: "PAN", type: "text", sensitive: true, required: true },
    { id: "employmentType", label: "Employment Type", type: "select", options: ["Salaried", "Self-Employed", "Business"], required: true },
    { id: "loanAmount", label: "Desired Loan Amount (₹)", type: "number", required: true },
  ],
};

const sampleValues = {
  fullName: "Rajesh Sharma",
  annualIncome: "750000",
  aadhaarNumber: "9876 5432 1098",
  panNumber: "ABCDE1234F",
  employmentType: "Salaried",
  loanAmount: "500000",
};

// ── Helpers ──────────────────────────────────────────────────────────
function formatTime(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

function printHeader(title) {
  console.log("\n=======================================================");
  console.log(`  AuraGen E2E Simulator: MODE [${title.toUpperCase()}]`);
  console.log("=======================================================");
}

// ── MODE: CALM ───────────────────────────────────────────────────────
// 20s of steady, calm telemetry. Scores stay low; expect NO redesign.
async function runCalmMode() {
  printHeader("calm");
  console.log("Connecting to", URL, "with Origin", ORIGIN);

  return new Promise((resolve) => {
    let sessionId = null;
    let batchInterval = null;
    let timerTimeout = null;
    let highestScore = 0;
    const scores = [];
    const t0 = Date.now();
    let redesignTriggered = false;

    const ws = new WebSocket(URL, { headers: { origin: ORIGIN } });

    function cleanup() {
      if (batchInterval) clearInterval(batchInterval);
      if (timerTimeout) clearTimeout(timerTimeout);
      if (ws.readyState === WebSocket.OPEN) ws.close();
    }

    ws.on("open", () => {
      console.log("✔ Connected to server. Starting session 'loan-form'...");
      ws.send(JSON.stringify({
        type: "session:start",
        payload: { formId: "loan-form" },
      }));
    });

    ws.on("close", (code, reason) => {
      cleanup();
    });

    ws.on("error", (err) => {
      cleanup();
      console.error("✘ Connection error:", err.message);
      resolve(false);
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "session:ready") {
        sessionId = msg.payload?.sessionId || "active";
        console.log(`✔ Session initialized (${sessionId}).`);
        console.log("  Streaming calm telemetry every 500ms for 20s (expecting low scores & no redesign)...");

        let tick = 0;
        batchInterval = setInterval(() => {
          tick++;
          const now = Date.now();
          const events = [];

          // 5 calm, low-speed moves with very small variance
          for (let i = 0; i < 5; i++) {
            events.push({
              k: "move",
              v: 0.12 + (i % 3) * 0.02,
              t: now - 400 + i * 80,
            });
          }

          // Occasional steady focus/input every 5s
          if (tick % 10 === 0) {
            events.push({ k: "focus", f: "fullName", t: now - 200 });
            events.push({ k: "input", f: "fullName", t: now - 50 });
          }

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "telemetry:batch",
              payload: events,
            }));
          }
        }, 500);

        // Run for 20 seconds
        timerTimeout = setTimeout(() => {
          cleanup();
          const elapsed = (Date.now() - t0) / 1000;
          console.log(`\n\n--- CALM TIMELINE SUMMARY (${elapsed.toFixed(1)}s) ---`);
          console.log(`- Total score updates: ${scores.length}`);
          console.log(`- Peak CLS score:      ${highestScore} / 100`);
          console.log(`- Redesign triggered:  ${redesignTriggered ? "YES (FAIL)" : "NO (PASS)"}`);

          if (!redesignTriggered && highestScore < 50) {
            console.log("\n✔ PASS: No redesign triggered; scores stayed low across 20s.");
            resolve(true);
          } else {
            console.log("\n✘ FAIL: Redesign occurred or scores were unexpectedly high.");
            resolve(false);
          }
        }, 20_000);
      }

      if (msg.type === "score:update") {
        const score = msg.payload.score ?? 0;
        scores.push(score);
        if (score > highestScore) highestScore = score;
        process.stdout.write(` [CLS: ${score}]`);
      }

      if (msg.type === "redesign:started" || msg.type === "redesign:ready") {
        redesignTriggered = true;
        console.error(`\n✘ UNEXPECTED: Server emitted '${msg.type}' in calm mode!`);
      }
    });
  });
}

// ── MODE: CONFUSED / BROKEN / TWICE CORE SESSION ─────────────────────
function runConfusedSession(opts = {}) {
  const {
    isBroken = false,
    sessionLabel = "confused-session",
    onTimelineEvent,
  } = opts;

  return new Promise((resolve) => {
    let ws;
    let batchInterval = null;
    let failTimeout = null;
    const brokenTimeouts = new Set();
    let startTime = Date.now();
    let startedTime = null;
    let readyTime = null;
    const scores = [];

    function cleanup() {
      if (batchInterval) clearInterval(batchInterval);
      if (failTimeout) clearTimeout(failTimeout);
      for (const t of brokenTimeouts) clearTimeout(t);
      brokenTimeouts.clear();
    }

    try {
      ws = new WebSocket(URL, { headers: { origin: ORIGIN } });
    } catch (err) {
      console.error("✘ WebSocket creation error:", err.message);
      return resolve({ ok: false, error: err.message });
    }

    // Fail safety: 25s timeout
    failTimeout = setTimeout(() => {
      cleanup();
      if (ws.readyState === WebSocket.OPEN) ws.close();
      console.error(`\n✘ TIMEOUT: Session '${sessionLabel}' did not complete within 25s.`);
      resolve({ ok: false, error: "timeout" });
    }, 25_000);

    ws.on("open", () => {
      startTime = Date.now();
      console.log(`✔ [${sessionLabel}] Connected. Sending session:start { formId: 'loan-form' }...`);
      ws.send(JSON.stringify({
        type: "session:start",
        payload: { formId: "loan-form" },
      }));
    });

    ws.on("error", (err) => {
      cleanup();
      console.error(`✘ [${sessionLabel}] Socket error:`, err.message);
      resolve({ ok: false, error: err.message });
    });

    ws.on("close", (code, reason) => {
      cleanup();
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "session:ready") {
        console.log(`✔ [${sessionLabel}] Session ready. Streaming confused telemetry...`);

        // Send high-friction batch every 400ms:
        // - Jittery speeds (stddev > 2.4 => high V)
        // - Rage clicks on annualIncome (high R)
        // - Inert clicks on annualIncome (high E)
        // - Validation error on annualIncome
        // - Persistent focus with no input for 12s (high H)
        batchInterval = setInterval(() => {
          const now = Date.now();
          const events = [];

          // Jittery movement (stddev > 2.0 -> V = 1.0)
          for (let i = 0; i < 20; i++) {
            events.push({
              k: "move",
              v: i % 2 === 0 ? 5.0 : 0.1,
              t: now - 380 + i * 18,
            });
          }

          // Rage and inert clicks (saturates R and contributes to E)
          events.push({ k: "click", f: "annualIncome", rage: true, inert: false, t: now - 150 });
          events.push({ k: "click", f: "annualIncome", rage: true, inert: false, t: now - 100 });
          events.push({ k: "click", f: "annualIncome", rage: true, inert: false, t: now - 80 });
          events.push({ k: "click", f: "annualIncome", rage: false, inert: true, t: now - 60 });
          events.push({ k: "click", f: "annualIncome", rage: false, inert: true, t: now - 40 });

          // Validation error on annualIncome
          events.push({ k: "error", f: "annualIncome", t: now - 120 });

          // Field focus with no input in sliding window (9.5s idle -> H ~ 0.63)
          events.push({ k: "focus", f: "annualIncome", t: now - 9500 });

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "telemetry:batch",
              payload: events,
            }));
          }
        }, 400);
      }

      if (msg.type === "score:update") {
        const score = msg.payload.score ?? 0;
        scores.push(score);
        if (score >= 70) {
          process.stdout.write(` [CLS: ${score}]`);
        }
      }

      if (msg.type === "redesign:started") {
        startedTime = Date.now();
        const elapsed = startedTime - startTime;
        console.log(`\n✔ [${sessionLabel}] Received redesign:started at +${formatTime(elapsed)} (friction field: ${msg.payload?.friction?.field})`);
        if (onTimelineEvent) onTimelineEvent("started", elapsed, msg.payload);
      }

      if (msg.type === "snapshot:request") {
        const requestId = msg.payload.requestId;
        console.log(`✔ [${sessionLabel}] Received snapshot:request (requestId: ${requestId})`);

        if (isBroken) {
          console.log(`→ [${sessionLabel}] [BROKEN MODE] Delaying snapshot:response by 3200ms to trigger snapshot timeout...`);
          const timer = setTimeout(() => {
            brokenTimeouts.delete(timer);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "snapshot:response",
                payload: {
                  requestId,
                  schema: sampleSchema,
                  values: sampleValues,
                },
              }));
            }
          }, 3200);
          brokenTimeouts.add(timer);
        } else {
          console.log(`→ [${sessionLabel}] Replying immediately with 6-field schema & values...`);
          ws.send(JSON.stringify({
            type: "snapshot:response",
            payload: {
              requestId,
              schema: sampleSchema,
              values: sampleValues,
            },
          }));
        }
      }

      if (msg.type === "redesign:ready") {
        readyTime = Date.now();
        cleanup();
        const totalMs = readyTime - startTime;
        console.log(`\n✔ [${sessionLabel}] Received redesign:ready at +${formatTime(totalMs)}:`);
        console.log(`  - ComponentId: ${msg.payload.componentId}`);
        console.log(`  - Cached:      ${msg.payload.cached}`);
        console.log(`  - Total MS:    ${msg.payload.ms}ms`);
        console.log(`  - Code length: ${msg.payload.code?.length} characters`);

        if (onTimelineEvent) onTimelineEvent("ready", totalMs, msg.payload);

        ws.close();
        resolve({
          ok: true,
          mode: "confused",
          scores,
          startedAt: startedTime - startTime,
          readyAt: totalMs,
          payload: msg.payload,
          ws,
        });
      }

      if (msg.type === "redesign:failed") {
        cleanup();
        const failTime = Date.now() - startTime;
        console.log(`\n✔ [${sessionLabel}] Received redesign:failed at +${formatTime(failTime)}`);
        console.log(`  - Reason: ${msg.payload?.reason}`);

        if (onTimelineEvent) onTimelineEvent("failed", failTime, msg.payload);

        ws.close();
        resolve({
          ok: true,
          mode: "broken",
          reason: msg.payload?.reason,
          failTime,
          payload: msg.payload,
        });
      }
    });
  });
}

// ── MODE: CONFUSED ───────────────────────────────────────────────────
async function runConfusedMode() {
  printHeader("confused");
  console.log("Connecting to", URL, "with Origin", ORIGIN);

  const result = await runConfusedSession({
    sessionLabel: "confused-run",
    isBroken: false,
  });

  if (result.ok && result.payload?.code) {
    console.log("\n--- CONFUSED TIMELINE ---");
    console.log(`- Time of redesign:started: +${formatTime(result.startedAt)}`);
    console.log(`- Time of redesign:ready:   +${formatTime(result.readyAt)}`);
    console.log(`- Pipeline total ms:        ${result.payload.ms}ms`);
    console.log(`- Cached:                   ${result.payload.cached}`);
    console.log(`- Scores logged:            ${result.scores.length} updates (peak: ${Math.max(...result.scores, 0)})`);
    console.log("\n✔ PASS: Confused session successfully triggered and completed redesign.");
    return true;
  } else {
    console.error("\n✘ FAIL: Confused session failed to receive valid redesign:ready.");
    return false;
  }
}

// ── MODE: BROKEN ─────────────────────────────────────────────────────
async function runBrokenMode() {
  printHeader("broken");
  console.log("Connecting to", URL, "with Origin", ORIGIN);

  const result = await runConfusedSession({
    sessionLabel: "broken-run",
    isBroken: true,
  });

  if (result.ok && result.reason === "snapshot_timeout") {
    console.log("\n--- BROKEN TIMELINE ---");
    console.log(`- Failure time:   +${formatTime(result.failTime)}`);
    console.log(`- Failure reason: ${result.reason}`);
    console.log("\n✔ PASS: snapshot_timeout correctly triggered redesign:failed.");
    return true;
  } else {
    console.error(`\n✘ FAIL: Expected redesign:failed with reason 'snapshot_timeout', got: ${result.reason || result.error}`);
    return false;
  }
}

// ── MODE: TWICE ──────────────────────────────────────────────────────
async function runTwiceMode() {
  printHeader("twice");
  console.log(`Connecting to ${URL}. Configured cooldown wait: ${COOLDOWN_MS}ms.`);

  console.log("\n>>> STAGE 1: Cold Redesign Run (Cache Miss Expected) <<<");
  const run1 = await runConfusedSession({
    sessionLabel: "run-1-cold",
    isBroken: false,
  });

  if (!run1.ok || !run1.payload?.code) {
    console.error("✘ FAIL: Run 1 did not complete successfully.");
    return false;
  }

  const run1Cached = run1.payload.cached;
  const run1Ms = run1.payload.ms;
  console.log(`✔ Run 1 Complete: cached = ${run1Cached}, latency = ${run1Ms}ms`);

  // Wait for trigger cooldown
  const waitMs = COOLDOWN_MS + 200;
  console.log(`\n>>> Waiting ${waitMs}ms for trigger cooldown (REDESIGN_COOLDOWN_MS=${COOLDOWN_MS})... <<<`);
  await new Promise((r) => setTimeout(r, waitMs));

  console.log("\n>>> STAGE 2: Warm Redesign Run (Cache Hit Expected) <<<");
  const run2 = await runConfusedSession({
    sessionLabel: "run-2-warm",
    isBroken: false,
  });

  if (!run2.ok || !run2.payload?.code) {
    console.error("✘ FAIL: Run 2 did not complete successfully.");
    return false;
  }

  const run2Cached = run2.payload.cached;
  const run2Ms = run2.payload.ms;
  console.log(`✔ Run 2 Complete: cached = ${run2Cached}, latency = ${run2Ms}ms`);

  console.log("\n=======================================================");
  console.log("  TWICE MODE COMPARISON TIMELINE");
  console.log("=======================================================");
  console.log(`- Run 1 (Cold): cached = ${run1Cached} | total = ${run1Ms}ms`);
  console.log(`- Cooldown:     waited ${waitMs}ms`);
  console.log(`- Run 2 (Warm): cached = ${run2Cached} | total = ${run2Ms}ms`);

  if (run2Cached === true) {
    console.log("\n✔ PASS: Run 2 was served from cache with reduced latency.");
    return true;
  } else {
    console.error("\n✘ FAIL: Run 2 was not marked as cached (cached: false).");
    return false;
  }
}

// ── Main Execution ───────────────────────────────────────────────────
async function main() {
  let success = false;

  switch (MODE) {
    case "calm":
      success = await runCalmMode();
      break;
    case "confused":
      success = await runConfusedMode();
      break;
    case "broken":
      success = await runBrokenMode();
      break;
    case "twice":
      success = await runTwiceMode();
      break;
    default:
      console.error(`✘ Unknown mode '${MODE}'. Allowed modes: calm, confused, broken, twice`);
      process.exit(1);
  }

  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error("✘ Unhandled simulator exception:", err);
  process.exit(1);
});
