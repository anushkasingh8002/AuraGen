// server/pipeline/redesign.js
// ─────────────────────────────────────────────────────────────────────
// Redesign pipeline, speculative pre-warming, safety guards, & delivery.
// ─────────────────────────────────────────────────────────────────────

import { performance } from "node:perf_hooks";

import defaultLog from "../safety/logger.js";
import defaultConfig from "../config.js";
import { send as defaultSend } from "../ws/send.js";
import { requestSnapshot as defaultRequestSnapshot } from "../agent/snapshot.js";
import {
  isFieldSensitive,
  maskValues as defaultMaskValues,
  sanitizeSchema,
  sanitizeValues,
} from "../agent/mask.js";
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
import { llmBreaker as defaultBreaker } from "../safety/breaker.js";
import {
  sessionRedesignLimiter as defaultSessionLimiter,
  globalLlmLimiter as defaultGlobalLimiter,
} from "../safety/rateLimit.js";
import { ValidationError, CompileError, toReason } from "../safety/errors.js";

const MAX_KEY_MAP_ENTRIES = 200;

/** Bounded map tracking componentId (SHA-256 hash) -> cacheKey for eviction */
const componentToKeyMap = new Map();

function trackComponentKey(componentId, key) {
  if (componentToKeyMap.has(componentId)) {
    componentToKeyMap.delete(componentId);
  } else if (componentToKeyMap.size >= MAX_KEY_MAP_ENTRIES) {
    const oldest = componentToKeyMap.keys().next().value;
    if (oldest !== undefined) componentToKeyMap.delete(oldest);
  }
  componentToKeyMap.set(componentId, key);
}

/**
 * Evict a component from cache by its componentId (hash).
 * When `session` is provided, requires that the session actually received
 * that componentId to prevent unauthenticated cross-session cache busting.
 *
 * @param {string} componentId
 * @param {object} [cacheInstance]
 * @param {object} [session]
 * @returns {boolean} whether an entry was evicted
 */
export function evictComponent(componentId, cacheInstance = defaultCache, session = null) {
  if (!componentId || typeof componentId !== "string") return false;

  if (session?.deliveredComponents instanceof Set && !session.deliveredComponents.has(componentId)) {
    return false;
  }

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

function resolveDeps(deps = {}) {
  return {
    log: deps.log ?? defaultLog,
    config: deps.config ?? defaultConfig,
    send: deps.send ?? defaultSend,
    requestSnapshot: deps.requestSnapshot ?? defaultRequestSnapshot,
    maskValues: deps.maskValues ?? defaultMaskValues,
    generate: deps.generate ?? defaultGenerate,
    PROMPT_VERSION: deps.PROMPT_VERSION ?? DEFAULT_PROMPT_VERSION,
    validate: deps.validate ?? defaultValidate,
    compile: deps.compile ?? defaultCompile,
    cache: deps.cache ?? defaultCache,
    makeKey: deps.makeKey ?? defaultMakeKey,
    schemaHash: deps.schemaHash ?? defaultSchemaHash,
    breaker: deps.breaker ?? defaultBreaker,
    sessionLimiter: deps.sessionLimiter ?? defaultSessionLimiter,
    globalLimiter: deps.globalLimiter ?? defaultGlobalLimiter,
  };
}

function prepareContext({ session, snapshot, friction, maskValues, makeKey, schemaHash, PROMPT_VERSION }) {
  const originalSchema = snapshot.schema ?? {};
  const schema = sanitizeSchema(originalSchema);
  const values = sanitizeValues(originalSchema, snapshot.values ?? {});
  const maskedValues = maskValues(schema, values);
  const safeFriction = {
    score: Number.isFinite(friction?.score) ? friction.score : 0,
    field: isFieldSensitive(friction?.field, originalSchema)
      ? null
      : friction?.field ?? null,
  };

  const formId = session.formId || schema.formId || "form";
  const sHash = schemaHash(schema);
  const key = makeKey({
    formId,
    field: safeFriction.field,
    schemaHash: sHash,
    promptVersion: PROMPT_VERSION,
  });

  return { schema, maskedValues, safeFriction, key };
}

function createComponentBuilder({
  session,
  friction,
  schema,
  maskedValues,
  generate,
  validate,
  compile,
  send,
  log,
  breaker,
  globalLimiter,
  signal,
  emitProgress = true,
}) {
  return async function buildComponent() {
    let lastProgressSent = 0;
    let totalTokens = 0;

    const onToken = emitProgress
      ? (chunk) => {
          totalTokens += typeof chunk === "string" ? chunk.length : 1;
          const now = Date.now();
          if (now - lastProgressSent >= 250) {
            lastProgressSent = now;
            send(session, "redesign:progress", { tokens: totalTokens });
          }
        }
      : undefined;

    // Bind exact validated code string to validation result to prevent bypass
    let earlyValEntry = null;
    let earlyValidateMs = 0;

    const trackValidate = (candidate) => {
      const tv0 = performance.now();
      const res = validate(candidate);
      earlyValidateMs += Math.round(performance.now() - tv0);
      if (res?.ok) {
        earlyValEntry = { code: candidate, res };
      }
      return res;
    };

    const invokeLlm = async (feedback) => {
      globalLimiter.consume("global");
      return breaker.execute(() =>
        generate(
          { friction, schema, values: maskedValues },
          { onToken, signal, feedback, validate: trackValidate }
        )
      );
    };

    const tGen0 = performance.now();
    let code = await invokeLlm(undefined);
    const generateMs = Math.max(
      0,
      Math.round(performance.now() - tGen0) - earlyValidateMs
    );

    const tVal0 = performance.now();
    let valResult =
      earlyValEntry && earlyValEntry.code === code
        ? earlyValEntry.res
        : validate(code);

    if (!valResult.ok) {
      log.warn("unsafe_code_rejected", {
        sessionId: session.id,
        attempt: 1,
        errorCount: valResult.errors.length,
        errors: valResult.errors,
      });

      earlyValEntry = null;
      const feedback = valResult.errors.join("\n");
      code = await invokeLlm(feedback);

      valResult =
        earlyValEntry && earlyValEntry.code === code
          ? earlyValEntry.res
          : validate(code);

      if (!valResult.ok) {
        log.error("unsafe_code_rejected", {
          sessionId: session.id,
          attempt: 2,
          errorCount: valResult.errors.length,
          errors: valResult.errors,
        });
        throw new ValidationError(
          "Generated component failed AST validation after retry",
          valResult.errors
        );
      }
    }
    const validateMs = earlyValidateMs + Math.round(performance.now() - tVal0);

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
  };
}

/**
 * Speculatively pre-warm the cache when friction is rising (>= 80% threshold).
 * Uses cache.getOrCreate() single-flight so concurrent or subsequent startRedesign()
 * calls never duplicate LLM work. Never emits redesign:started, ready, or failed.
 */
export async function prewarmRedesign(session, friction, deps = {}) {
  const {
    log,
    config,
    send,
    requestSnapshot,
    maskValues,
    generate,
    PROMPT_VERSION,
    validate,
    compile,
    cache,
    makeKey,
    schemaHash,
    breaker,
    globalLimiter,
  } = resolveDeps(deps);

  if (config.PREWARM_ENABLED === false || session.redesigning || session.prewarming) {
    return;
  }

  session.prewarming = true;
  const t0 = performance.now();

  try {
    const tSnap0 = performance.now();
    const snapshot = await requestSnapshot(session, "prewarm", 2000);
    const snapshotMs = Math.round(performance.now() - tSnap0);

    if (session.redesigning || session.socket?.readyState > 1) {
      return;
    }

    const { schema, maskedValues, safeFriction, key } = prepareContext({
      session,
      snapshot,
      friction,
      maskValues,
      makeKey,
      schemaHash,
      PROMPT_VERSION,
    });

    const wasCached = cache.has(key);
    const builder = createComponentBuilder({
      session,
      friction: safeFriction,
      schema,
      maskedValues,
      generate,
      validate,
      compile,
      send,
      log,
      breaker,
      globalLimiter,
      signal: session.abortController?.signal,
      emitProgress: false,
    });

    const result = await cache.getOrCreate(key, builder);
    trackComponentKey(result.hash, key);

    const totalMs = Math.round(performance.now() - t0);
    log.info("prewarm_timing", {
      sessionId: session.id,
      componentId: result.hash,
      snapshotMs,
      generateMs: wasCached ? 0 : (result.timings?.generateMs ?? 0),
      validateMs: wasCached ? 0 : (result.timings?.validateMs ?? 0),
      compileMs: wasCached ? 0 : (result.timings?.compileMs ?? 0),
      totalMs,
      cached: wasCached,
    });

    return result;
  } catch (err) {
    log.warn("prewarm:error", {
      sessionId: session?.id,
      errorName: err.name,
      message: err.message,
    });
    return undefined;
  } finally {
    session.prewarming = false;
  }
}

/**
 * Orchestrate the redesign pipeline for a frustrated session.
 */
export async function startRedesign(session, friction, deps = {}) {
  const {
    log,
    send,
    requestSnapshot,
    maskValues,
    generate,
    PROMPT_VERSION,
    validate,
    compile,
    cache,
    makeKey,
    schemaHash,
    breaker,
    sessionLimiter,
    globalLimiter,
  } = resolveDeps(deps);

  if (session.redesigning) {
    log.warn("redesign:already_running", { sessionId: session.id });
    return;
  }

  session.redesigning = true;
  const t0 = performance.now();

  try {
    // 0. Per-session rate limit check (max 3 redesigns / 10 min)
    sessionLimiter.consume(session.id);

    // 1. Notify browser that redesign has started
    const safeFriction = {
      score: Number.isFinite(friction?.score) ? friction.score : 0,
      field: null,
    };
    send(session, "redesign:started", { friction: safeFriction });

    // 2. Request DOM snapshot from browser (timeout: 2000ms)
    const tSnapshot0 = performance.now();
    const snapshot = await requestSnapshot(session, "redesign", 2000);
    const snapshotMs = Math.round(performance.now() - tSnapshot0);

    // 3. Compute deterministic cache key (values are NEVER included)
    const {
      schema,
      maskedValues,
      safeFriction: safeFrictionFromSchema,
      key,
    } = prepareContext({
      session,
      snapshot,
      friction,
      maskValues,
      makeKey,
      schemaHash,
      PROMPT_VERSION,
    });

    const wasCached = cache.has(key);
    const wasInFlight = Boolean(cache.inFlight?.has(key));

    // 4. Component builder for cache misses
    const buildComponent = createComponentBuilder({
      session,
      friction: safeFrictionFromSchema,
      schema,
      maskedValues,
      generate,
      validate,
      compile,
      send,
      log,
      breaker,
      globalLimiter,
      signal: session.abortController?.signal,
      emitProgress: true,
    });

    // 5. Query or join single-flight build
    const result = await cache.getOrCreate(key, buildComponent);

    trackComponentKey(result.hash, key);

    if (!(session.deliveredComponents instanceof Set)) {
      session.deliveredComponents = new Set();
    }
    session.deliveredComponents.add(result.hash);

    const totalMs = Math.round(performance.now() - t0);

    const stageGenerateMs = wasCached ? 0 : (result.timings?.generateMs ?? 0);
    const stageValidateMs = wasCached ? 0 : (result.timings?.validateMs ?? 0);
    const stageCompileMs = wasCached ? 0 : (result.timings?.compileMs ?? 0);

    log.info("redesign_timing", {
      sessionId: session.id,
      componentId: result.hash,
      snapshotMs,
      generateMs: stageGenerateMs,
      validateMs: stageValidateMs,
      compileMs: stageCompileMs,
      totalMs,
      cached: wasCached,
      coalesced: wasInFlight,
    });

    send(session, "redesign:ready", {
      componentId: result.hash,
      version: 1,
      code: result.js,
      friction: safeFrictionFromSchema,
      ms: totalMs,
      cached: wasCached,
      timings: {
        snapshotMs,
        generateMs: stageGenerateMs,
        validateMs: stageValidateMs,
        compileMs: stageCompileMs,
        totalMs,
      },
    });

    session.lastRedesignAt = Date.now();
    return result;
  } catch (err) {
    const reason = toReason(err);
    try {
      send(session, "redesign:failed", { reason });
    } catch (sendErr) {
      log.warn("redesign:failed_send_error", {
        sessionId: session?.id,
        error: sendErr.message,
      });
    }

    log.error("redesign:error", {
      sessionId: session?.id,
      errorName: err.name,
      reason,
      message: err.message,
    });
    throw err;
  } finally {
    session.redesigning = false;
  }
}
