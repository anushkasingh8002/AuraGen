// scripts/gen-audit.js
// ─────────────────────────────────────────────────────────────────────
// Standalone audit script for the Code-Gen Agent.
//
// HOW TO RUN:
//   node scripts/gen-audit.js
//
// WHAT IT DOES:
//   Calls generate() 20 times with a sample schema, measuring duration,
//   verifying that code is non-empty, checking that no accidental
//   markdown fences (```) remain, and running AST validation on each.
// ─────────────────────────────────────────────────────────────────────

import { generate } from "../server/agent/chain.js";
import { validate } from "../server/ast/validate.js";
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
  console.log("  AuraGen Code-Gen Audit + AST Validation (20 Iterations)");
  console.log(`  Mode: ${config.MOCK_LLM ? "MOCK_LLM (offline)" : "LIVE OpenAI (gpt-4o)"}`);
  console.log("=========================================================\n");

  const results = [];
  const totalRuns = 20;

  for (let i = 1; i <= totalRuns; i++) {
    const startTime = Date.now();
    let code = "";
    let genError = null;
    let validationResult = null;

    try {
      code = await generate({
        friction: sampleFriction,
        schema: sampleSchema,
        values: sampleValues,
      });
    } catch (err) {
      genError = err.message;
    }

    const durationMs = Date.now() - startTime;
    const isNonEmpty = typeof code === "string" && code.trim().length > 0;
    const hasFences = isNonEmpty && (code.startsWith("```") || code.includes("```jsx"));

    // Run AST validation on generated code.
    if (isNonEmpty && !genError) {
      validationResult = validate(code);
    }

    const astPassed = validationResult?.ok ?? false;
    const isFullyValid = isNonEmpty && !hasFences && !genError && astPassed;

    results.push({
      run: i,
      durationMs,
      length: code.length,
      hasFences,
      astPassed,
      isFullyValid,
      genError,
      astErrors: validationResult?.errors ?? [],
    });

    const statusPill = isFullyValid ? "✔ PASS" : "✘ FAIL";
    const astLabel = astPassed ? "AST:OK" : `AST:FAIL(${validationResult?.errors?.length ?? 0})`;
    console.log(
      `  [#${String(i).padStart(2, "0")}] ${statusPill}  Time: ${String(
        durationMs
      ).padStart(4)}ms  Len: ${String(code.length).padStart(4)}  Fences: ${
        hasFences ? "YES" : "no "
      }  ${astLabel}`
    );

    // Print first 2 AST errors if validation failed.
    if (!astPassed && validationResult?.errors?.length > 0) {
      for (const err of validationResult.errors.slice(0, 2)) {
        console.log(`         ↳ ${err}`);
      }
      if (validationResult.errors.length > 2) {
        console.log(`         ↳ ... and ${validationResult.errors.length - 2} more`);
      }
    }
  }

  // ── Summary statistics ──────────────────────────────────────────────
  const genPassCount = results.filter((r) => !r.genError && r.length > 0).length;
  const astPassCount = results.filter((r) => r.astPassed).length;
  const fullPassCount = results.filter((r) => r.isFullyValid).length;
  const avgDuration = Math.round(
    results.reduce((sum, r) => sum + r.durationMs, 0) / results.length
  );
  const fenceCount = results.filter((r) => r.hasFences).length;

  console.log("\n---------------------------------------------------------");
  console.log(`  Generation:    ${genPassCount}/${totalRuns} produced non-empty code`);
  console.log(`  AST Validation: ${astPassCount}/${totalRuns} passed security scan`);
  console.log(`  Full Pass:      ${fullPassCount}/${totalRuns} (gen + no fences + AST)`);
  console.log(`  Avg Latency:    ${avgDuration}ms`);
  console.log(`  Fences Found:   ${fenceCount}`);
  console.log(`  Pass Rate:      ${Math.round((astPassCount / totalRuns) * 100)}%`);
  console.log("---------------------------------------------------------\n");

  if (fullPassCount === totalRuns) {
    console.log("✔ ALL 20 GENERATIONS PASSED FULL AUDIT");
  } else if (astPassCount >= Math.floor(totalRuns * 0.9)) {
    console.log(`✔ AST pass rate ${Math.round((astPassCount / totalRuns) * 100)}% — meets 90% target`);
  } else {
    console.error(`✘ AST pass rate ${Math.round((astPassCount / totalRuns) * 100)}% — below 90% target`);
  }

  process.exit(fullPassCount === totalRuns ? 0 : 1);
}

runAudit();
