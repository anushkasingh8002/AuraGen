// jest.config.js
// ─────────────────────────────────────────────────────────────────────
// Jest configuration for ES-module project.
// Run with: node --experimental-vm-modules node_modules/.bin/jest
// ─────────────────────────────────────────────────────────────────────

export default {
  // No transform — our source is native ESM already.
  transform: {},

  // Where to find test files.
  testMatch: ["**/server/tests/**/*.test.js"],
};

