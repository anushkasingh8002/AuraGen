// scripts/latency.js
// ─────────────────────────────────────────────────────────────────────
// Latency benchmark harness for AuraGen redesign pipeline (Step 11).
//
// Runs the confused simulation N times (default: 20) against the server:
//   - Run 1 uses a fresh cache key (unique formId per batch) -> Cold run
//   - Runs 2..N reuse the same formId + schema -> Warm cache runs
//
// Outputs:
//   - Per-run table: run | cached | snapshotMs | generateMs | validateMs | compileMs | totalMs
//   - Summary stats (min, median, p95) for Cold and Warm separately
//   - Markdown table ready for reporting: Metric | Target | Measured
//
// Usage:
//   node scripts/latency.js                 (connects to ws://localhost:4000)
//   node scripts/latency.js --spawn         (starts an isolated server automatically)
//   node scripts/latency.js --runs 20
// ─────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import http from "node:http";
import WebSocket from "ws";

// ── CLI Arguments ────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getFlagValue(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const TOTAL_RUNS = parseInt(getFlagValue("--runs", "20"), 10);
const SHOULD_SPAWN = args.includes("--spawn");
const NO_PREWARM = args.includes("--no-prewarm");
const PORT = getFlagValue("--port", process.env.PORT || "4000");
const WS_URL = process.env.WS_URL || `ws://127.0.0.1:${PORT}`;
const ORIGIN = process.env.ORIGIN || "http://localhost:3000";
const BATCH_FORM_ID = getFlagValue("--form-id", `loan-form-lat-${Date.now()}`);

const sampleValues = {
  fullName: "Rajesh Sharma",
  annualIncome: "750000",
  aadhaarNumber: "9876 5432 1098",
  panNumber: "ABCDE1234F",
  employmentType: "Salaried",
  loanAmount: "500000",
};

function makeSchema(formId) {
  return {
    formId,
    title: "Fast Personal Loan Application",
    fields: [
      { id: "fullName", label: "Full Name", type: "text", required: true },
      { id: "annualIncome", label: "Annual Income", type: "number", required: true },
      { id: "aadhaarNumber", label: "Aadhaar Number", type: "text", sensitive: true, required: true },
      { id: "panNumber", label: "PAN", type: "text", sensitive: true, required: true },
      {
        id: "employmentType",
        label: "Employment Type",
        type: "select",
        options: ["Salaried", "Self-Employed", "Business"],
        required: true,
      },
      { id: "loanAmount", label: "Desired Loan Amount", type: "number", required: true },
    ],
  };
}

// ── Statistics Helpers ───────────────────────────────────────────────
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return Math.round(sorted[base] + rest * (sorted[base + 1] - sorted[base]));
  }
  return sorted[base];
}

function summarizeStats(values) {
  if (values.length === 0) {
    return { count: 0, min: 0, median: 0, p95: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    min: sorted[0],
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

// ── Server Spawn Helper (optional --spawn) ───────────────────────────
function waitForHealth(port, timeoutMs = 10000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    function ping() {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      });
      req.on("error", retry);
      req.setTimeout(500, () => {
        req.destroy();
        retry();
      });
    }
    function retry() {
      if (Date.now() - t0 > timeoutMs) {
        return reject(new Error(`Timeout waiting for server on port ${port}`));
      }
      setTimeout(ping, 200);
    }
    ping();
  });
}

// ── Single Confused Session ──────────────────────────────────────────
function runSingleConfusedIteration(runNumber, formId) {
  const schema = makeSchema(formId);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { origin: ORIGIN } });
    let batchInterval = null;
    let failTimeout = null;
    let triggerSentStartedAt = 0;

    function cleanup() {
      if (batchInterval) clearInterval(batchInterval);
      if (failTimeout) clearTimeout(failTimeout);
    }

    failTimeout = setTimeout(() => {
      cleanup();
      if (ws.readyState === WebSocket.OPEN) ws.close();
      reject(new Error(`Run ${runNumber} timed out after 25s`));
    }, 25_000);

    ws.on("error", (err) => {
      cleanup();
      reject(new Error(`Run ${runNumber} WebSocket error: ${err.message}`));
    });

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "session:start",
        payload: { formId },
      }));
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "session:ready") {
        const sendConfusedBatch = () => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const now = Date.now();
          const events = [];
          for (let i = 0; i < 20; i++) {
            events.push({
              k: "move",
              v: i % 2 === 0 ? 5.0 : 0.1,
              t: now - 380 + i * 18,
            });
          }
          events.push({ k: "click", f: "annualIncome", rage: true, inert: false, t: now - 150 });
          events.push({ k: "click", f: "annualIncome", rage: true, inert: false, t: now - 100 });
          events.push({ k: "click", f: "annualIncome", rage: true, inert: false, t: now - 80 });
          events.push({ k: "click", f: "annualIncome", rage: false, inert: true, t: now - 60 });
          events.push({ k: "click", f: "annualIncome", rage: false, inert: true, t: now - 40 });
          events.push({ k: "error", f: "annualIncome", t: now - 120 });
          events.push({ k: "focus", f: "annualIncome", t: now - 9500 });

          ws.send(JSON.stringify({ type: "telemetry:batch", payload: events }));
        };

        // Fire immediately, then every 400ms until trigger fires
        sendConfusedBatch();
        batchInterval = setInterval(sendConfusedBatch, 400);
      }

      if (msg.type === "redesign:started") {
        triggerSentStartedAt = Date.now();
        if (batchInterval) clearInterval(batchInterval);
      }

      if (msg.type === "snapshot:request") {
        const requestId = msg.payload.requestId;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "snapshot:response",
            payload: { requestId, schema, values: sampleValues },
          }));
        }
      }

      if (msg.type === "redesign:failed") {
        cleanup();
        ws.close();
        reject(new Error(`Run ${runNumber} received redesign:failed: ${msg.payload?.reason}`));
      }

      if (msg.type === "redesign:ready") {
        cleanup();
        const clientElapsedMs = triggerSentStartedAt ? Date.now() - triggerSentStartedAt : msg.payload.ms;
        const timings = msg.payload.timings || {};
        const row = {
          run: runNumber,
          cached: Boolean(msg.payload.cached),
          snapshotMs: timings.snapshotMs ?? 0,
          generateMs: timings.generateMs ?? 0,
          validateMs: timings.validateMs ?? 0,
          compileMs: timings.compileMs ?? 0,
          totalMs: timings.totalMs ?? msg.payload.ms ?? clientElapsedMs,
          clientRttMs: clientElapsedMs,
        };
        ws.close();
        resolve(row);
      }
    });
  });
}

// ── Main Benchmark Runner ────────────────────────────────────────────
async function main() {
  let serverProc = null;
  let serverLogs = [];

  if (SHOULD_SPAWN) {
    const prewarmFlag = NO_PREWARM ? "false" : (process.env.PREWARM_ENABLED || "true");
    console.log(`Spawning isolated AuraGen server on port ${PORT} (PREWARM_ENABLED=${prewarmFlag})...`);
    serverProc = spawn("node", ["server/index.js"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT,
        PREWARM_ENABLED: prewarmFlag,
        NODE_ENV: "development",
      },
    });
    serverProc.stdout.on("data", (chunk) => serverLogs.push(chunk.toString()));
    serverProc.stderr.on("data", (chunk) => serverLogs.push(chunk.toString()));
    await waitForHealth(PORT);
  }

  try {
    console.log("==========================================================================");
    console.log(`  AuraGen Latency Benchmark (${TOTAL_RUNS} runs, formId=${BATCH_FORM_ID})`);
    console.log(`  Target: ${WS_URL}`);
    console.log("==========================================================================\n");

    const rows = [];
    for (let i = 1; i <= TOTAL_RUNS; i++) {
      const row = await runSingleConfusedIteration(i, BATCH_FORM_ID);
      rows.push(row);
      process.stdout.write(
        `  Run ${String(row.run).padStart(2)}/${TOTAL_RUNS} | cached=${String(row.cached).padEnd(5)} | total=${String(row.totalMs).padStart(4)}ms\n`
      );
    }

    console.log("\n=== PER-RUN LATENCY TABLE ===");
    console.log("| Run | Cached | snapshotMs | generateMs | validateMs | compileMs | totalMs |");
    console.log("|---:|:---|---:|---:|---:|---:|---:|");
    for (const r of rows) {
      console.log(
        `| ${String(r.run).padStart(3)} | ${String(r.cached).padEnd(6)} | ${String(r.snapshotMs).padStart(10)} | ${String(r.generateMs).padStart(10)} | ${String(r.validateMs).padStart(10)} | ${String(r.compileMs).padStart(9)} | ${String(r.totalMs).padStart(7)} |`
      );
    }

    const coldRows = rows.filter((r) => !r.cached);
    const warmRows = rows.filter((r) => r.cached);

    const coldStats = summarizeStats(coldRows.map((r) => r.totalMs));
    const warmStats = summarizeStats(warmRows.map((r) => r.totalMs));

    console.log("\n=== COLD vs WARM SUMMARY (ms) ===");
    console.log(
      `Cold (n=${coldStats.count}): min=${coldStats.min}ms, median=${coldStats.median}ms, p95=${coldStats.p95}ms`
    );
    console.log(
      `Warm (n=${warmStats.count}): min=${warmStats.min}ms, median=${warmStats.median}ms, p95=${warmStats.p95}ms`
    );

    if (coldRows.length > 0) {
      const firstCold = coldRows[0];
      const pct = (part) =>
        firstCold.totalMs > 0 ? `${Math.round((part / firstCold.totalMs) * 100)}%` : "0%";
      console.log("\n=== COLD STAGE BREAKDOWN (Run #1) ===");
      console.log(`- snapshotMs : ${firstCold.snapshotMs}ms (${pct(firstCold.snapshotMs)})`);
      console.log(`- generateMs : ${firstCold.generateMs}ms (${pct(firstCold.generateMs)})`);
      console.log(`- validateMs : ${firstCold.validateMs}ms (${pct(firstCold.validateMs)})`);
      console.log(`- compileMs  : ${firstCold.compileMs}ms (${pct(firstCold.compileMs)})`);
      console.log(`- totalMs    : ${firstCold.totalMs}ms`);
    }

    console.log("\n=== REPORT MARKDOWN TABLE ===");
    console.log("| Metric | Target | Measured |");
    console.log("|:---|:---|:---|");
    console.log(`| Cold Cache Redesign (min / median / p95) | < 2000 ms (aspirational) | ${coldStats.count > 0 ? `${coldStats.min} / ${coldStats.median} / ${coldStats.p95} ms` : "N/A (pre-warmed before trigger)"} |`);
    console.log(`| Warm Cache Redesign (min / median / p95) | < 2000 ms | ${warmStats.min} / ${warmStats.median} / ${warmStats.p95} ms |`);

    // Output JSON summary marker for programmatic comparison
    console.log("\nJSON_SUMMARY:" + JSON.stringify({
      totalRuns: rows.length,
      cold: coldStats,
      warm: warmStats,
      coldBreakdown: coldRows[0] || null,
      warmSample: warmRows[0] || null,
    }));

    // Print cache/redesign stats if spawned
    let bgColdPrewarm = null;
    if (SHOULD_SPAWN) {
      const joined = serverLogs.join("");
      const llmCalls = joined.match(/"event":"codegen:/g)?.length ?? 0;
      const prewarmEvents = joined.match(/"event":"prewarm_/g)?.length ?? 0;
      for (const line of joined.split(/\r?\n/)) {
        if (line.includes('"event":"prewarm_timing"')) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.cached === false) {
              bgColdPrewarm = parsed;
              break;
            }
          } catch {}
        }
      }
      if (bgColdPrewarm) {
        console.log("\n=== BACKGROUND PRE-WARM COLD BUILD (Run #1 while rising) ===");
        console.log(
          `snapshotMs=${bgColdPrewarm.snapshotMs}ms, generateMs=${bgColdPrewarm.generateMs}ms, validateMs=${bgColdPrewarm.validateMs}ms, compileMs=${bgColdPrewarm.compileMs}ms, totalMs=${bgColdPrewarm.totalMs}ms`
        );
      }
      console.log(`\nServer instrumentation: codegen events=${llmCalls}, prewarm events=${prewarmEvents}`);
    }
  } finally {
    if (serverProc) {
      serverProc.kill();
    }
  }
}

main().catch((err) => {
  console.error("\n✘ Latency benchmark failed:", err.message);
  process.exit(1);
});
