// server/ast/compile.js
// ─────────────────────────────────────────────────────────────────────
// Compiles validated JSX React wizard components into browser-runnable
// CommonJS JavaScript.
//
// WHY VALIDATE BEFORE COMPILE?
//   1. SECURITY: A compiler (like Babel) transforms code without
//      evaluating security rules. It expands syntax (e.g. JSX into
//      React.createElement calls, imports into require calls, optional
//      chaining into member checks) which alters the AST structure.
//      Checking untrusted code BEFORE compilation ensures our security
//      allow-lists inspect the developer/LLM's true semantic intent.
//   2. DEFENSE IN DEPTH: If untrusted input contains sandbox exploits
//      or forbidden APIs, we must reject it immediately at the gate
//      without spending CPU cycles transforming or storing it.
//   3. ACCURATE ERROR REPORTING: Syntax and security violations point
//      to the original line/column of the prompt output, allowing the
//      LLM to self-correct accurately.
// ─────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import { transformFromAstSync } from "@babel/core";
import { parse } from "@babel/parser";

/**
 * Compiles a validated AST or raw JSX code into CommonJS JavaScript.
 *
 * @param {object|null} ast - Babel AST object (optional if code is provided)
 * @param {string} code - Original JSX source code string
 * @returns {{ ok: true, js: string, bytes: number, hash: string } | { ok: false, errors: string[] }}
 */
export function compile(ast, code) {
  try {
    const sourceCode = typeof code === "string" ? code : "";

    if (!sourceCode && !ast) {
      return { ok: false, errors: ["No AST or code provided for compilation."] };
    }

    // Babel transforms AST in-place. If source code is available, re-parsing
    // ensures pure, idempotent compilation with identical SHA-256 hashes
    // on repeated calls.
    let targetAst = ast;
    if (sourceCode) {
      targetAst = parse(sourceCode, {
        sourceType: "module",
        plugins: ["jsx"],
      });
    }

    const result = transformFromAstSync(targetAst, sourceCode, {
      presets: [["@babel/preset-react", { runtime: "classic" }]],
      plugins: ["@babel/plugin-transform-modules-commonjs"],
      babelrc: false,
      configFile: false,
      compact: false,
    });

    if (!result || typeof result.code !== "string") {
      return { ok: false, errors: ["Compilation produced empty output."] };
    }

    const js = result.code;
    const bytes = Buffer.byteLength(js, "utf8");
    const hash = crypto.createHash("sha256").update(js, "utf8").digest("hex");

    return {
      ok: true,
      js,
      bytes,
      hash,
    };
  } catch (err) {
    return {
      ok: false,
      errors: [err.message || "Unknown compilation error"],
    };
  }
}
