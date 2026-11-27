// scripts/verify-simulators.js
// ─────────────────────────────────────────────────────────────────────
// Spawns AuraGen server and executes simulate.js in all 4 modes.
// ─────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import http from "node:http";

const targetMode = process.argv[2] || "all";

function waitForServer(port = 4000, timeoutMs = 10000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    function ping() {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) {
          return resolve();
        }
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
        return reject(new Error("Timeout waiting for server to start"));
      }
      setTimeout(ping, 250);
    }

    ping();
  });
}

function runSim(mode) {
  return new Promise((resolve, reject) => {
    console.log(`\n=======================================================\n>>> RUNNING SIMULATOR: ${mode} <<<\n=======================================================`);
    const child = spawn("node", ["scripts/simulate.js", mode], {
      stdio: "inherit",
      env: {
        ...process.env,
        REDESIGN_COOLDOWN_MS: "5000",
        WS_URL: "ws://127.0.0.1:4000",
      },
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`✔ [${mode}] Exited with code 0 (SUCCESS)`);
        resolve();
      } else {
        console.error(`✘ [${mode}] Exited with code ${code} (FAILURE)`);
        reject(new Error(`Mode ${mode} failed with exit code ${code}`));
      }
    });
  });
}

async function run() {
  console.log("Starting AuraGen server (PORT=4000, REDESIGN_COOLDOWN_MS=5000, MOCK_LLM=true)...");
  const serverProcess = spawn("node", ["server/index.js"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      MOCK_LLM: "true",
      REDESIGN_COOLDOWN_MS: "5000",
      PORT: "4000",
    },
  });

  try {
    await waitForServer(4000);
    console.log("✔ Server is up and responding on http://127.0.0.1:4000/health");

    if (targetMode === "all") {
      await runSim("confused");
      await runSim("broken");
      await runSim("twice");
      await runSim("calm");
      console.log("\n=======================================================");
      console.log("✔ ALL 4 SIMULATOR MODES PASSED SUCCESSFULLY!");
      console.log("=======================================================\n");
    } else {
      await runSim(targetMode);
    }
  } finally {
    console.log("Shutting down test server...");
    serverProcess.kill();
  }
}

run().catch((err) => {
  console.error("Verification failed:", err.message);
  process.exit(1);
});
