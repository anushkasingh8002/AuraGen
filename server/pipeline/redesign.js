// server/pipeline/redesign.js
// ─────────────────────────────────────────────────────────────────────
// Redesign pipeline and delivery orchestrator.
//
// RESPONSIBILITIES
//   1. Guard against concurrent redesign runs per session.
//   2. Request DOM snapshot from the browser and mask sensitive fields.
//   3. Compute cache key and query the LRU cache (with single-flight protection).
//   4. If cache miss: generate React wizard code via LLM, validate AST,
//      retry once with feedback if validation fails, and compile to CommonJS.
//   5. Record microsecond timing marks across all stages.
//   6. Deliver the compiled component to the browser via redesign:ready.
//   7. Track componentId-to-cacheKey mapping to evict bad components on render error.
// ─────────────────────────────────────────────────────────────────────

import { performance } from "node:perf_hooks";

import defaultLog from "../safety/logger.js";
import defaultConfig from "../config.js";
import { send as defaultSend } from "../ws/send.js";
import { requestSnapshot as defaultRequestSnapshot } from "../agent/snapshot.js";
import { maskValues as defaultMaskValues } from "../agent/mask.js";
import {
  generate as defaultGenerate,
  PROMPT_VERSION as DEFAULT_PROMPT_VERSION,
} from "../agent/chain.js";
import { validate as defaultValidate } from "../ast/validate.js";
import { compile as defaultCompile } from "../ast/compile.js";
import {
  cache as defaultCache,
  makeKey as defaultMakeKey,
  schemaHash as defaultSchemaHash,
} from "../cache/cache.js";
import { ValidationError, CompileError } from "../safety/errors.js";

/** Map tracking componentId (SHA-256 hash) -> cacheKey for render error eviction */
const componentToKeyMap = new Map();

/**
 * Evict a component from cache by its componentId (hash).
 * Called when browser reports render:result with ok: false.
 *
 * @param {string} componentId
 * @param {object} [cacheInstance]
 * @returns {boolean} whether an entry was evicted
 */
export function evictComponent(componentId, cacheInstance = defaultCache) {
  const key = componentToKeyMap.get(componentId);
  if (key) {
    componentToKeyMap.delete(componentId);
    if (typeof cacheInstance.delete === "function") {
      return cacheInstance.delete(key);
    }
    if (typeof cacheInstance.store?.delete === "function") {
      return cacheInstance.store.delete(key);
    }
  }
  return false;
}

/**
 * Orchestrate the redesign pipeline for a frustrated session.
 *
 * @param {object} session – active session object
 * @param {{ field: string|null, score: number }} friction – trigger friction context
 * @param {object} [deps] – injected dependencies for testability
 */
export async function startRedesign(session, friction, deps = {}) {
  const log = deps.log ?? defaultLog;
  const config = deps.config ?? defaultConfig;
  const send = deps.send ?? defaultSend;
  const requestSnapshot = deps.requestSnapshot ?? defaultRequestSnapshot;
  const maskValues = deps.maskValues ?? defaultMaskValues;
  const generate = deps.generate ?? defaultGenerate;
  const PROMPT_VERSION = deps.PROMPT_VERSION ?? DEFAULT_PROMPT_VERSION;
  const validate = deps.validate ?? defaultValidate;
  const compile = deps.compile ?? defaultCompile;
  const cache = deps.cache ?? defaultCache;
  const makeKey = deps.makeKey ?? defaultMakeKey;
  const schemaHash = deps.schemaHash ?? defaultSchemaHash;

  // ── Concurrency guard: only one redesign per session at a time ─────
  if (session.redesigning) {
    log.warn("redesign:already_running", { sessionId: session.id });
    return;
  }

  session.redesigning = true;
  const t0 = performance.now();

  try {
    // 1. Notify browser that redesign has started
    send(session, "redesign:started", { friction });

    // 2. Request DOM snapshot from browser (timeout: 2000ms)
    const tSnapshot0 = performance.now();
    const snapshot = await requestSnapshot(session, "redesign", 2000);
    const snapshotMs = Math.round(performance.now() - tSnapshot0);

    const schema = snapshot.schema ?? {};
    const values = snapshot.values ?? {};
    const maskedValues = maskValues(schema, values);

    // 3. Compute deterministic cache key (values are NEVER included)
    const formId = session.formId || schema.formId || "form";
    const sHash = schemaHash(schema);
    const key = makeKey({
      formId,
      field: friction.field,
      schemaHash: sHash,
      promptVersion: PROMPT_VERSION,
    });

    const wasCached = cache.has(key);

    // 4. Component builder for cache misses
    async function buildComponent() {
      // Throttle progress token notifications to at most once per 250ms
      let lastProgressSent = 0;
      let totalTokens = 0;

      const onToken = (chunk) => {
        totalTokens += (typeof chunk === "string" ? chunk.length : 1);
        const now = Date.now();
        if (now - lastProgressSent >= 250) {
          lastProgressSent = now;
          send(session, "redesign:progress", { tokens: totalTokens });
        }
      };

      // Generation attempt 1
      const tGen0 = performance.now();
      let code = await generate(
        { friction, schema, values: maskedValues },
        { onToken }
      );
      const generateMs = Math.round(performance.now() - tGen0);

      // Validation
      const tVal0 = performance.now();
      let valResult = validate(code);

      // If validation fails, retry ONCE with feedback
      if (!valResult.ok) {
        log.warn("redesign:validation_failed", {
          sessionId: session.id,
          errorCount: valResult.errors.length,
          errors: valResult.errors,
        });

        const feedback = valResult.errors.join("\n");
        code = await generate(
          { friction, schema, values: maskedValues },
          { onToken, feedback }
        );

        valResult = validate(code);
        if (!valResult.ok) {
          log.error("redesign:validation_retry_failed", {
            sessionId: session.id,
            errorCount: valResult.errors.length,
            errors: valResult.errors,
          });
          throw new ValidationError(
            "Generated component failed AST validation after retry",
            valResult.errors
          );
        }
      }
      const validateMs = Math.round(performance.now() - tVal0);

      // Compilation
      const tComp0 = performance.now();
      const compResult = compile(valResult.ast, code);
      if (!compResult.ok) {
        log.error("redesign:compile_failed", {
          sessionId: session.id,
          errors: compResult.errors,
        });
        throw new CompileError(
          "Failed to compile validated component",
          compResult.errors
        );
      }
      const compileMs = Math.round(performance.now() - tComp0);

      return {
        hash: compResult.hash,
        js: compResult.js,
        bytes: compResult.bytes,
        timings: { generateMs, validateMs, compileMs },
      };
    }

    // 5. Query or build via single-flight cache
    const result = await cache.getOrCreate(key, buildComponent);

    // Map componentId -> key for potential render:result eviction
    componentToKeyMap.set(result.hash, key);

    const totalMs = Math.round(performance.now() - t0);

    // 6. Log structured timing telemetry
    log.info("redesign_timing", {
      sessionId: session.id,
      componentId: result.hash,
      snapshotMs,
      generateMs: result.timings?.generateMs ?? 0,
      validateMs: result.timings?.validateMs ?? 0,
      compileMs: result.timings?.compileMs ?? 0,
      totalMs,
      cached: wasCached,
    });

    // 7. Deliver component to browser
    send(session, "redesign:ready", {
      componentId: result.hash,
      version: 1,
      code: result.js,
      ms: totalMs,
      cached: wasCached,
    });

    session.lastRedesignAt = Date.now();
    return result;
  } catch (err) {
    log.error("redesign:error", {
      sessionId: session.id,
      errorName: err.name,
      message: err.message,
    });
    throw err;
  } finally {
    session.redesigning = false;
  }
}
