// server/tests/compile.test.js
// ─────────────────────────────────────────────────────────────────────
// Unit tests for the Babel JSX to CommonJS compiler.
//
// RUN:  node --experimental-vm-modules node_modules/jest/bin/jest.js server/tests/compile.test.js
// ─────────────────────────────────────────────────────────────────────

import vm from "vm";
import { compile } from "../ast/compile.js";
import { validate } from "../ast/validate.js";
import { mockComponentCode } from "../agent/mockComponent.js";

const SAMPLE_WIZARD = `
import React, { useState } from "react";
import { Button, Input, Card, ProgressBar } from "@/ui";

export default function LoanWizard({ initialValues = {}, onChange, onSubmit, onCancel }) {
  const [step, setStep] = useState(1);
  const [values, setValues] = useState({
    monthlyIncome: initialValues.monthlyIncome || "",
  });

  return (
    <Card>
      <ProgressBar current={step} total={2} />
      {step === 1 && (
        <Input
          id="monthlyIncome"
          value={values.monthlyIncome}
          onChange={(e) => {
            const next = { ...values, monthlyIncome: e.target.value };
            setValues(next);
            if (onChange) onChange(next);
          }}
        />
      )}
      {step === 2 && <div>Review: {values.monthlyIncome}</div>}
      {step > 1 && <Button onClick={() => setStep((s) => s - 1)}>Back</Button>}
      {step < 2 ? (
        <Button onClick={() => setStep((s) => s + 1)}>Next</Button>
      ) : (
        <Button onClick={() => onSubmit(values)}>Submit</Button>
      )}
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </Card>
  );
}
`;

describe("Babel Compiler", () => {
  test("compiles sample wizard into plain JavaScript without JSX or import statements", () => {
    const validated = validate(SAMPLE_WIZARD);
    expect(validated.ok).toBe(true);

    const result = compile(validated.ast, SAMPLE_WIZARD);
    expect(result.ok).toBe(true);
    expect(typeof result.js).toBe("string");
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);

    // No JSX tags or import statements should remain
    expect(result.js).not.toMatch(/<Card/);
    expect(result.js).not.toMatch(/<ProgressBar/);
    expect(result.js).not.toMatch(/<Input/);
    expect(result.js).not.toMatch(/<Button/);
    expect(result.js).not.toMatch(/\bimport\s+/);

    // Uses React.createElement
    expect(result.js).toMatch(/createElement/);
  });

  test("output exports component via exports.default or module.exports.default", () => {
    const result = compile(null, SAMPLE_WIZARD);
    expect(result.ok).toBe(true);
    const hasDefaultExport =
      result.js.includes("exports.default") ||
      result.js.includes("module.exports.default");
    expect(hasDefaultExport).toBe(true);
  });

  test("compiling the same input twice returns the exact same sha256 hash", () => {
    const res1 = compile(null, SAMPLE_WIZARD);
    const res2 = compile(null, SAMPLE_WIZARD);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.hash).toBe(res2.hash);
    expect(res1.bytes).toBe(res2.bytes);
    expect(res1.js).toBe(res2.js);
  });

  test("vm harness: runs compiled JS in a sandbox and executes the default export function", () => {
    const result = compile(null, SAMPLE_WIZARD);
    expect(result.ok).toBe(true);

    // Stub environment: React and @/ui
    const stubReact = {
      createElement: (type, props, ...children) => ({
        type,
        props: props || {},
        children,
      }),
      useState: (init) => [init, () => {}],
      useEffect: () => {},
    };

    const stubUI = {
      Button: (props) => ({ type: "Button", props }),
      Input: (props) => ({ type: "Input", props }),
      Card: (props) => ({ type: "Card", props }),
      ProgressBar: (props) => ({ type: "ProgressBar", props }),
      Select: (props) => ({ type: "Select", props }),
      Stepper: (props) => ({ type: "Stepper", props }),
    };

    const fakeRequire = (moduleName) => {
      if (moduleName === "react") return stubReact;
      if (moduleName === "@/ui") return stubUI;
      throw new Error(`Unexpected require call: ${moduleName}`);
    };

    const moduleObj = { exports: {} };
    const sandbox = {
      module: moduleObj,
      exports: moduleObj.exports,
      require: fakeRequire,
    };

    const context = vm.createContext(sandbox);
    vm.runInContext(result.js, context);

    const ExportedComponent =
      moduleObj.exports.default || sandbox.exports.default;

    expect(typeof ExportedComponent).toBe("function");

    // Call the component to verify it renders without error using stubs
    const rendered = ExportedComponent({
      initialValues: { monthlyIncome: "50000" },
    });
    expect(rendered).toBeDefined();
    expect(rendered.type).toBe(stubUI.Card);
  });

  test("compiles mockComponentCode cleanly", () => {
    const result = compile(null, mockComponentCode);
    expect(result.ok).toBe(true);
    expect(result.js).not.toMatch(/\bimport\s+/);
    expect(result.js).toMatch(/createElement/);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("gracefully handles invalid code or Babel errors without throwing", () => {
    const invalidAst = { type: "InvalidNodeType" };
    const result = compile(invalidAst, null);

    expect(result.ok).toBe(false);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("gracefully handles empty inputs", () => {
    const result = compile(null, "");
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/No AST or code provided/i);
  });
});
