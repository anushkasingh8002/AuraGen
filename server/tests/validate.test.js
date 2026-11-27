// server/tests/validate.test.js
// ─────────────────────────────────────────────────────────────────────
// Unit tests for the AST security validator (allow-list approach).
// At least 14 cases covering valid code, every forbidden pattern,
// structural requirements, and edge cases.
//
// RUN:  npm test
// ─────────────────────────────────────────────────────────────────────

import { validate } from "../ast/validate.js";

// ── helpers ──────────────────────────────────────────────────────────

/** A minimal valid wizard component that passes all checks. */
const VALID_WIZARD = `
import React, { useState } from "react";
import { Button, Input, Card, ProgressBar } from "@/ui";

export default function Wizard({ initialValues = {}, onChange, onSubmit, onCancel }) {
  const [step, setStep] = useState(1);
  const [values, setValues] = useState({ name: initialValues.name || "" });

  return (
    <Card>
      <ProgressBar current={step} total={2} />
      {step === 1 && (
        <Input id="name" value={values.name} onChange={(e) => {
          const next = { ...values, name: e.target.value };
          setValues(next);
          if (onChange) onChange(next);
        }} />
      )}
      {step === 2 && <div><strong>Name:</strong> {values.name}</div>}
      {step > 1 && <Button onClick={() => setStep(s => s - 1)}>Back</Button>}
      {step < 2
        ? <Button onClick={() => setStep(s => s + 1)}>Next</Button>
        : <Button onClick={() => onSubmit(values)}>Submit</Button>}
      <button type="button" onClick={onCancel}>Back to full form</button>
    </Card>
  );
}
`;

// =====================================================================
//  1. Valid code passes
// =====================================================================

describe("Valid component", () => {
  test("minimal wizard passes validation", () => {
    const result = validate(VALID_WIZARD);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.ast).toBeDefined();
  });

  test("arrow function default export also passes", () => {
    const code = `
import React, { useState } from "react";
import { Card } from "@/ui";

const Wizard = ({ initialValues = {} }) => {
  const [v, setV] = useState(initialValues);
  return <Card>{JSON.stringify(v)}</Card>;
};

export default Wizard;
`;
    const result = validate(code);
    expect(result.ok).toBe(true);
  });
});

// =====================================================================
//  2. Syntax errors
// =====================================================================

describe("Syntax errors", () => {
  test("missing closing JSX tag produces readable error with location", () => {
    const code = `
import React from "react";
export default function Foo({ initialValues }) {
  return <div>unclosed;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/syntax error/i);
    expect(result.errors[0]).toMatch(/line/i);
  });
});

// =====================================================================
//  3. Export requirements
// =====================================================================

describe("Export requirements", () => {
  test("two default exports are rejected", () => {
    const code = `
import React from "react";
export default function A({ initialValues }) { return <div />; }
export default function B({ initialValues }) { return <div />; }
`;
    // This is actually a syntax error in strict mode, but babel may still parse it.
    const result = validate(code);
    expect(result.ok).toBe(false);
  });

  test("no default export is rejected", () => {
    const code = `
import React from "react";
export function Wizard({ initialValues }) { return <div />; }
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /default export/i.test(e))).toBe(true);
  });

  test("default export of a non-function is rejected", () => {
    const code = `
import React from "react";
const x = 42;
export default x;
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /function component/i.test(e))).toBe(true);
  });
});

// =====================================================================
//  4. Import restrictions
// =====================================================================

describe("Import restrictions", () => {
  test("allowed import of @/ui passes", () => {
    const result = validate(VALID_WIZARD);
    expect(result.ok).toBe(true);
  });

  test("import of lodash is rejected", () => {
    const code = `
import React from "react";
import _ from "lodash";
export default function W({ initialValues }) { return <div>{_.get(initialValues, "x")}</div>; }
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /lodash/.test(e))).toBe(true);
  });

  test("import of unknown component from @/ui is rejected", () => {
    const code = `
import React from "react";
import { Button, Modal } from "@/ui";
export default function W({ initialValues }) { return <Button />; }
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Modal/.test(e))).toBe(true);
  });
});

// =====================================================================
//  5. Forbidden identifiers
// =====================================================================

describe("Forbidden identifiers", () => {
  test("eval is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) { eval("alert(1)"); return <div />; }
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /eval/.test(e))).toBe(true);
  });

  test("fetch is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) { fetch("/api"); return <div />; }
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /fetch/.test(e))).toBe(true);
  });

  test("document access is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) { document.cookie; return <div />; }
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /document/.test(e))).toBe(true);
  });

  test("window access is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) { window.location.href = "evil"; return <div />; }
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /window/.test(e))).toBe(true);
  });

  test("setTimeout is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) { setTimeout(() => {}, 0); return <div />; }
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /setTimeout/.test(e))).toBe(true);
  });

  test("Function constructor is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  const f = Function("return this")();
  return <div />;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /Function/.test(e))).toBe(true);
  });
});

// =====================================================================
//  6. Constructor escape trick
// =====================================================================

describe("Constructor sandbox escape", () => {
  test(".constructor access is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  const fn = (() => {}).constructor("return this")();
  return <div />;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /constructor/.test(e))).toBe(true);
  });

  test(".__proto__ access is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  const p = {}.__proto__;
  return <div />;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /__proto__/.test(e))).toBe(true);
  });

  test("computed [\"constructor\"] is also rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  const fn = (() => {})["constructor"]("return this")();
  return <div />;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /constructor/.test(e))).toBe(true);
  });
});

// =====================================================================
//  7. JSX security
// =====================================================================

describe("JSX security", () => {
  test("dangerouslySetInnerHTML is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  return <div dangerouslySetInnerHTML={{ __html: "<img onerror='alert(1)' />" }} />;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /dangerouslySetInnerHTML/.test(e))).toBe(true);
  });

  test("inline string event handler (onClick=\"...\") is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  return <button onClick="alert('xss')">Click</button>;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /inline string event handler/i.test(e))).toBe(true);
  });

  test("<script> element is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  return <script>alert(1)</script>;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /<script>/.test(e))).toBe(true);
  });

  test("<iframe> element is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  return <iframe src="https://evil.com" />;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /iframe/.test(e))).toBe(true);
  });

  test("forbidden elements <object>, <embed>, <link>, <meta>, <style> are rejected", () => {
    for (const tag of ["object", "embed", "link", "meta", "style"]) {
      const code = `
import React from "react";
export default function W({ initialValues }) {
  return <${tag} />;
}
`;
      const result = validate(code);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => new RegExp(`<${tag}>`, "i").test(e))).toBe(true);
    }
  });
});

// =====================================================================
//  8. Dynamic import and require
// =====================================================================

describe("Dynamic import / require", () => {
  test("dynamic import() is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  import("./evil.js");
  return <div />;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /dynamic import/i.test(e))).toBe(true);
  });

  test("require() is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  const fs = require("fs");
  return <div />;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /require/i.test(e))).toBe(true);
  });
});

// =====================================================================
//  9. Dangerous URL schemes and tagged templates
// =====================================================================

describe("URL schemes and templates", () => {
  test("javascript: URL is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  return <a href="javascript:alert(1)">click</a>;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /javascript:/i.test(e))).toBe(true);
  });

  test("tagged template expression is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  const x = String.raw\`hello\`;
  return <div>{x}</div>;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /tagged template/i.test(e))).toBe(true);
  });

  test("concatenated string with javascript: is rejected", () => {
    const code = `
import React from "react";
export default function W({ initialValues }) {
  const url = "java" + "script:alert(1)";
  return <a href={url}>click</a>;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /javascript:/i.test(e))).toBe(true);
  });
});

// =====================================================================
//  10. initialValues reference
// =====================================================================

describe("initialValues requirement", () => {
  test("component reading props.initialValues passes", () => {
    const code = `
import React from "react";
import { Card } from "@/ui";
export default function W(props) {
  return <Card>{props.initialValues?.name}</Card>;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(true);
  });

  test("component that ignores initialValues produces an error", () => {
    const code = `
import React from "react";
export default function W() {
  return <div>Hello</div>;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => /initialValues/i.test(e))
    ).toBe(true);
  });
});

// =====================================================================
//  11. Size and depth limits
// =====================================================================

describe("Size limits", () => {
  test("code over 20 KB is rejected", () => {
    const bigCode = `
import React from "react";
export default function W({ initialValues }) {
  return <div>${"x".repeat(21_000)}</div>;
}
`;
    const result = validate(bigCode);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /size limit/i.test(e))).toBe(true);
  });
});

// =====================================================================
//  12. Multiple errors returned at once
// =====================================================================

describe("Error aggregation", () => {
  test("code with multiple violations returns ALL errors", () => {
    const code = `
import React from "react";
import _ from "lodash";
export default function W({ initialValues }) {
  eval("x");
  fetch("/api");
  document.cookie;
  return <div dangerouslySetInnerHTML={{ __html: "" }} />;
}
`;
    const result = validate(code);
    expect(result.ok).toBe(false);
    // Should have errors for: lodash import, eval, fetch, document, dangerouslySetInnerHTML
    expect(result.errors.length).toBeGreaterThanOrEqual(5);
  });
});

// =====================================================================
//  13. Mock component from chain.js should pass
// =====================================================================

describe("Mock component", () => {
  test("mockComponent.js passes validation", async () => {
    const { mockComponentCode } = await import("../agent/mockComponent.js");
    const result = validate(mockComponentCode);

    if (!result.ok) {
      console.log("Mock component validation errors:", result.errors);
    }
    expect(result.ok).toBe(true);
  });
});

// =====================================================================
//  14. Security bypass regression suite (Step 12)
// =====================================================================

describe("Security bypass resistance (allow-list enforcement)", () => {
  const bypassCases = [
    [
      "computed concat constructor",
      'import React from "react"; export default function W({ initialValues }) { return <div>{(() => {})["con" + "structor"]("alert(1)")()}</div>; }',
    ],
    [
      "template literal computed constructor",
      'import React from "react"; export default function W({ initialValues }) { return <div>{(() => {})[`constructor`]("alert(1)")()}</div>; }',
    ],
    [
      "destructured constructor escape",
      'import React from "react"; export default function W({ initialValues }) { const { constructor: F } = (() => {}); return <div>{F("alert(1)")()}</div>; }',
    ],
    [
      "Object.getPrototypeOf async constructor escape",
      'import React from "react"; export default function W({ initialValues }) { const { constructor: AF } = Object.getPrototypeOf(async () => {}); return <div>{AF("alert(1)")()}</div>; }',
    ],
    [
      "JSX spread hiding dangerouslySetInnerHTML",
      'import React from "react"; export default function W({ initialValues }) { const p = { dangerouslySetInnerHTML: { __html: "<img src=x onerror=alert(1)>" } }; return <div {...p} />; }',
    ],
    [
      "JSX spread hiding inline event handler",
      'import React from "react"; export default function W({ initialValues }) { const p = { onClick: "alert(1)" }; return <button {...p}>Hi</button>; }',
    ],
    [
      "dynamic JSX tag rendering script",
      'import React from "react"; export default function W({ initialValues }) { const Tag = "script"; return <Tag>alert(1)</Tag>; }',
    ],
    [
      "split template literal javascript: URL",
      'import React from "react"; export default function W({ initialValues }) { const u = `java${""}script:alert(1)`; return <a href={u}>click</a>; }',
    ],
    [
      "hex-escaped template literal javascript: URL",
      'import React from "react"; export default function W({ initialValues }) { const u = `\\x6aavascript:alert(1)`; return <a href={u}>click</a>; }',
    ],
    [
      "variable concatenation javascript: URL",
      'import React from "react"; export default function W({ initialValues }) { const a = "java"; const b = "script:alert(1)"; return <a href={a + b}>click</a>; }',
    ],
    [
      "getter trap inside object literal",
      'import React from "react"; export default function W({ initialValues }) { const o = { get dangerouslySetInnerHTML() { return { __html: "<svg onload=alert(1)>" }; } }; return <div {...o} />; }',
    ],
    [
      "unblocked global / alert / location / navigator",
      'import React from "react"; export default function W({ initialValues }) { location.href = "https://evil.com"; alert(1); return <div />; }',
    ],
    [
      "Object.getOwnPropertyDescriptor sandbox escape",
      'import React from "react"; export default function W({ initialValues }) { const x = Object.getOwnPropertyDescriptor(Object.getPrototypeOf({}), "constructor").value; return <div>{x("alert(1)")()}</div>; }',
    ],
    [
      "React namespace import introspection",
      'import * as R from "react"; export default function W({ initialValues }) { return <div>{Object.keys(R).join(",")}</div>; }',
    ],
    [
      "shadowed forbidden global parameter",
      'import React from "react"; export default function W({ initialValues, fetch }) { return <div>{fetch ? fetch("/evil") : null}</div>; }',
    ],
    [
      "unrecognized DOM global (webkitRequestFileSystem)",
      'import React from "react"; export default function W({ initialValues }) { return <div>{webkitRequestFileSystem()}</div>; }',
    ],
    [
      "this expression leak",
      'import React from "react"; export default function W({ initialValues }) { return <div>{String(this)}</div>; }',
    ],
  ];

  test.each(bypassCases)("rejects %s", (_label, code) => {
    const result = validate(code);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
