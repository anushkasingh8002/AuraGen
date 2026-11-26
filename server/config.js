// server/config.js
// ─────────────────────────────────────────────────────────────────────
// Central, frozen configuration object.
// Every tuneable value lives here so nothing is scattered across files.
// Fails fast if a required secret is missing (unless we are in mock mode).
// ─────────────────────────────────────────────────────────────────────

import "dotenv/config"; // loads .env into process.env on import

// ── helpers ──────────────────────────────────────────────────────────

/** Parse a boolean-ish env var. "true" / "1" → true, everything else → false. */
const bool = (v) => v === "true" || v === "1";

/** Parse an integer env var with a default. */
const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
};

// ── build config ─────────────────────────────────────────────────────

const MOCK_LLM = bool(process.env.MOCK_LLM);

// If we are NOT mocking the LLM, the key is mandatory.
if (!MOCK_LLM && !process.env.OPENAI_API_KEY) {
  console.error(
    "[FATAL] OPENAI_API_KEY is not set and MOCK_LLM is not enabled.\n" +
      "Set OPENAI_API_KEY in your .env file or start with MOCK_LLM=true."
  );
  process.exit(1);
}

/**
 * Immutable application config.
 * Destructure what you need: `import cfg from "./config.js"; cfg.PORT`
 */
const config = Object.freeze({
  /** HTTP / WS listen port */
  PORT: int(process.env.PORT, 4000),

  /** Origins the WebSocket server will accept (array of strings) */
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim()),

  /** OpenAI API key — only used by the LangChain chain module */
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",

  /** Cognitive-load-score threshold that may trigger a redesign */
  CLS_THRESHOLD: int(process.env.CLS_THRESHOLD, 70),

  /** How long (ms) the score must stay above threshold before we act */
  CLS_SUSTAIN_MS: int(process.env.CLS_SUSTAIN_MS, 3000),

  /** Minimum gap (ms) between two redesign attempts for the same session */
  REDESIGN_COOLDOWN_MS: int(process.env.REDESIGN_COOLDOWN_MS, 60_000),

  /** How long compiled components live in the cache (seconds) */
  CACHE_TTL_SECONDS: int(process.env.CACHE_TTL_SECONDS, 3600),

  /** Max time to wait for the LLM to respond (ms) */
  LLM_TIMEOUT_MS: int(process.env.LLM_TIMEOUT_MS, 8000),

  /** Max output tokens for generated React component */
  MAX_OUTPUT_TOKENS: int(process.env.MAX_OUTPUT_TOKENS, 1200),

  /** Speculative pre-warm when CLS is rising (>= 80% threshold) */
  PREWARM_ENABLED: process.env.PREWARM_ENABLED !== "false",

  /** When true, skip real OpenAI calls and return canned output */
  MOCK_LLM,
});

export default config;

