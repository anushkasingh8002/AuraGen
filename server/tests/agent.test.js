// server/tests/agent.test.js
// ─────────────────────────────────────────────────────────────────────
// Unit tests for the Code-Gen Agent modules:
//   - mask.js
//   - snapshot.js
//   - chain.js (prompt formatting & fence stripping)
//
// RUN:  npm test
// ─────────────────────────────────────────────────────────────────────

import { maskValues, isFieldSensitive } from "../agent/mask.js";
import {
  requestSnapshot,
  resolveSnapshot,
  SnapshotTimeoutError,
  clearPendingSnapshots,
} from "../agent/snapshot.js";
import {
  stripCodeFences,
  buildHumanMessage,
  generate,
} from "../agent/chain.js";
import { mockComponentCode } from "../agent/mockComponent.js";

// =====================================================================
//  1. mask.js tests
// =====================================================================

describe("maskValues", () => {
  const schema = {
    fields: [
      { id: "fullName", type: "text" },
      { id: "userNotes", type: "text", sensitive: true },
      { id: "custom_pan_num", type: "text" },
    ],
  };

  test("masks fields with sensitive names case-insensitively", () => {
    const values = {
      fullName: "Alice Smith",
      my_pan_card: "ABCDE1234F",
      aadhaarNumber: "1234-5678-9012",
      user_ssn: "000-12-3456",
      bankAccountNo: "9876543210",
      bank_ifsc_code: "HDFC0001234",
      cardCVV: "999",
      creditCardNumber: "4111222233334444",
      userPassword: "secretPassword",
      oneTimeOtp: "654321",
    };

    const masked = maskValues(schema, values);

    expect(masked.fullName).toBe("Alice Smith");
    expect(masked.my_pan_card).toBe("[MASKED]");
    expect(masked.aadhaarNumber).toBe("[MASKED]");
    expect(masked.user_ssn).toBe("[MASKED]");
    expect(masked.bankAccountNo).toBe("[MASKED]");
    expect(masked.bank_ifsc_code).toBe("[MASKED]");
    expect(masked.cardCVV).toBe("[MASKED]");
    expect(masked.creditCardNumber).toBe("[MASKED]");
    expect(masked.userPassword).toBe("[MASKED]");
    expect(masked.oneTimeOtp).toBe("[MASKED]");
  });

  test("masks fields flagged sensitive: true in schema even without matching ID", () => {
    const values = {
      fullName: "Bob",
      userNotes: "Highly private personal medical note",
    };

    const masked = maskValues(schema, values);
    expect(masked.fullName).toBe("Bob");
    expect(masked.userNotes).toBe("[MASKED]");
  });

  test("never mutates the input values object", () => {
    const values = {
      fullName: "Charlie",
      ssn: "123-45-6789",
    };
    const valuesCopy = { ...values };

    const masked = maskValues(schema, values);

    expect(values).toEqual(valuesCopy);
    expect(masked).not.toBe(values);
    expect(values.ssn).toBe("123-45-6789");
    expect(masked.ssn).toBe("[MASKED]");
  });

  test("handles empty/null values gracefully", () => {
    expect(maskValues(null, null)).toEqual({});
    expect(maskValues({}, {})).toEqual({});
    expect(maskValues(null, { pan: "" })).toEqual({ pan: "" });
  });
});

// =====================================================================
//  2. snapshot.js tests
// =====================================================================

describe("snapshot.js", () => {
  afterEach(() => {
    clearPendingSnapshots();
  });

  test("resolves when matching snapshot:response is received", async () => {
    let sentEnvelope = null;
    const mockSession = {
      id: "sess-123",
      socket: {
        readyState: 1, // OPEN
        send: (str) => {
          sentEnvelope = JSON.parse(str);
        },
      },
    };

    const promise = requestSnapshot(mockSession, "test_reason", 1000);

    expect(sentEnvelope).not.toBeNull();
    expect(sentEnvelope.type).toBe("snapshot:request");
    expect(sentEnvelope.sessionId).toBe("sess-123");
    expect(sentEnvelope.payload.reason).toBe("test_reason");
    const requestId = sentEnvelope.payload.requestId;
    expect(typeof requestId).toBe("string");

    // Simulate browser responding with snapshot:response
    const resolved = resolveSnapshot(requestId, {
      schema: { formId: "form-A" },
      values: { name: "Test" },
    });
    expect(resolved).toBe(true);

    const snapshot = await promise;
    expect(snapshot.schema.formId).toBe("form-A");
    expect(snapshot.values.name).toBe("Test");
  });

  test("rejects with SnapshotTimeoutError when browser does not respond", async () => {
    const mockSession = {
      id: "sess-timeout",
      socket: {
        readyState: 1,
        send: () => {},
      },
    };

    // Very short timeout for the test
    const promise = requestSnapshot(mockSession, "test_timeout", 50);

    await expect(promise).rejects.toThrow(SnapshotTimeoutError);
  });
});

// =====================================================================
//  3. chain.js helper & mock generation tests
// =====================================================================

describe("chain.js", () => {
  test("stripCodeFences removes markdown wrapping", () => {
    expect(stripCodeFences("```jsx\nexport default function Foo() {}\n```")).toBe(
      "export default function Foo() {}"
    );
    expect(stripCodeFences("```javascript\nconst a = 1;\n```")).toBe("const a = 1;");
    expect(stripCodeFences("```\nconst b = 2;\n```")).toBe("const b = 2;");
    expect(stripCodeFences("  const c = 3;  ")).toBe("const c = 3;");
  });

  test("buildHumanMessage includes friction, schema, values, and optional feedback", () => {
    const ctx = {
      friction: { field: "income", score: 85 },
      schema: { id: "test-form" },
      values: { income: "[MASKED]" },
    };

    const withoutFeedback = buildHumanMessage(ctx);
    expect(withoutFeedback).toContain("USER FRICTION CONTEXT:");
    expect(withoutFeedback).toContain('"field": "income"');
    expect(withoutFeedback).not.toContain("Your previous output was rejected");

    const withFeedback = buildHumanMessage(ctx, "Import from 'axios' is forbidden");
    expect(withFeedback).toContain("Your previous output was rejected for these reasons:");
    expect(withFeedback).toContain("Import from 'axios' is forbidden");
  });

  test("generate() in MOCK_LLM mode returns clean mockComponentCode without fences", async () => {
    const tokens = [];
    const code = await generate(
      {
        friction: { field: "email", score: 75 },
        schema: { id: "test-schema" },
        values: {},
      },
      {
        onToken: (t) => tokens.push(t),
      }
    );

    expect(typeof code).toBe("string");
    expect(code.length).toBeGreaterThan(100);
    expect(code.startsWith("```")).toBe(false);
    expect(code.endsWith("```")).toBe(false);
    expect(code).toContain("export default function SimplifiedLoanWizard");
    expect(tokens.length).toBeGreaterThan(0);
  });
});
