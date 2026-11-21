// scripts/gen-audit.js
// ─────────────────────────────────────────────────────────────────────
// Standalone audit script for the Code-Gen Agent.
//
// HOW TO RUN:
//   node scripts/gen-audit.js
//
// WHAT IT DOES:
//   Calls generate() 20 times with a sample schema, measuring duration,
//   verifying that code is non-empty, and checking that no accidental
//   markdown fences (```) remain.
// ─────────────────────────────────────────────────────────────────────

import { generate } from "../server/agent/chain.js";
import config from "../server/config.js";

const sampleSchema = {
  formId: "personal-loan-application",
  title: "Personal Loan Application",
  fields: [
    { id: "fullName", label: "Full Name", type: "text", required: true },
    { id: "email", label: "Email Address", type: "email", required: true },
    { id: "phone", label: "Phone Number", type: "tel", required: true },
    {
      id: "panNumber",
      label: "PAN Number",
      type: "text",
      required: true,
      sensitive: true,
    },
    { id: "monthlyIncome", label: "Monthly Income", type: "number", required: true },
    { id: "loanAmount", label: "Requested Loan Amount", type: "number", required: true },
    {
      id: "bankAccount",
      label: "Bank Account Number",
      type: "text",
      sensitive: true,
    },
  ],
};

const sampleFriction = {
  field: "monthlyIncome",
  score: 82,
};

const sampleValues = {
  fullName: "Jane Doe",
  email: "jane.doe@example.com",
  phone: "555-0199",
  panNumber: "[MASKED]",
  monthlyIncome: "",
  loanAmount: "25000",
  bankAccount: "[MASKED]",
};

async function runAudit() {
  console.log("=========================================================");
  console.log("  AuraGen Code-Gen Agent Audit (20 Iterations)");
  console.log(`  Mode: ${config.MOCK_LLM ? "MOCK_LLM (offline)" : "LIVE OpenAI (gpt-4o)"}`);
  console.log("=========================================================\n");

  const results = [];
  const totalRuns = 20;

  for (let i = 1; i <= totalRuns; i++) {
    const startTime = Date.now();
    let code = "";
    let error = null;

    try {
      code = await generate({
        friction: sampleFriction,
        schema: sampleSchema,
        values: sampleValues,
      });
    } catch (err) {
      error = err.message;
    }

    const durationMs = Date.now() - startTime;
    const isNonEmpty = typeof code === "string" && code.trim().length > 0;
    const hasFences = isNonEmpty && (code.startsWith("```") || code.includes("```jsx"));
    const isValid = isNonEmpty && !hasFences && !error;

    results.push({
      run: i,
      durationMs,
      length: code.length,
      hasFences,
      isValid,
      error,
    });

    const statusPill = isValid ? "✔ PASS" : "✘ FAIL";
    console.log(
      `  [#${String(i).padStart(2, "0")}] ${statusPill}  Time: ${String(
        durationMs
      ).padStart(4)}ms  Length: ${String(code.length).padStart(4)} chars  Fences: ${
        hasFences ? "YES (bad)" : "NONE (good)"
      }`
    );
  }

  // ── Summary statistics ──────────────────────────────────────────────
  const passCount = results.filter((r) => r.isValid).length;
  const avgDuration = Math.round(
    results.reduce((sum, r) => sum + r.durationMs, 0) / results.length
  );
  const fenceCount = results.filter((r) => r.hasFences).length;

  console.log("\n---------------------------------------------------------");
  console.log(`  Audit Completed: ${passCount}/${totalRuns} successful`);
  console.log(`  Average Latency: ${avgDuration}ms per generation`);
  console.log(`  Markdown Fences Detected: ${fenceCount}`);
  console.log("---------------------------------------------------------\n");

  if (passCount === totalRuns) {
    console.log("✔ ALL 20 GENERATIONS PASSED CODE CONTRACT");
    process.exit(0);
  } else {
    console.error("✘ SOME RUNS FAILED AUDIT");
    process.exit(1);
  }
}

runAudit();
