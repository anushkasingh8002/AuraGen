// server/agent/mockComponent.js
// ─────────────────────────────────────────────────────────────────────
// Deterministic sample React wizard component.
//
// WHY a mock component?
//   Enables full offline development, deterministic unit testing, and
//   cost-free validation pipeline benchmarking without hitting OpenAI.
// ─────────────────────────────────────────────────────────────────────

export const mockComponentCode = `import React, { useState } from "react";
import { Button, Input, Card, ProgressBar } from "@/ui";

export default function SimplifiedLoanWizard({
  initialValues = {},
  onChange,
  onSubmit,
  onCancel,
}) {
  const [step, setStep] = useState(1);
  const [values, setValues] = useState({
    fullName: initialValues.fullName || "",
    monthlyIncome: initialValues.monthlyIncome || "",
    loanAmount: initialValues.loanAmount || "",
  });

  const totalSteps = 4;

  const updateField = (field, val) => {
    const next = { ...values, [field]: val };
    setValues(next);
    if (onChange) onChange(next);
  };

  const handleNext = () => setStep((s) => Math.min(s + 1, totalSteps));
  const handleBack = () => setStep((s) => Math.max(s - 1, 1));

  const handleSubmit = (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (onSubmit) onSubmit(values);
  };

  return (
    <Card className="max-w-lg mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center text-sm text-gray-500">
        <span>Step {step} of {totalSteps}</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-blue-600 hover:underline cursor-pointer"
        >
          Back to full form
        </button>
      </div>

      <ProgressBar current={step} total={totalSteps} />

      {step === 1 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Your Full Name</h2>
          <p className="text-sm text-gray-600">
            Please enter your legal name as it appears on your identity document.
          </p>
          <Input
            id="fullName"
            label="Legal Full Name"
            value={values.fullName}
            onChange={(e) => updateField("fullName", e.target.value)}
          />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Monthly Net Income</h2>
          <p className="text-sm text-gray-600">
            Enter your approximate take-home pay each month after tax.
          </p>
          <Input
            id="monthlyIncome"
            type="number"
            label="Monthly Income ($)"
            value={values.monthlyIncome}
            onChange={(e) => updateField("monthlyIncome", e.target.value)}
          />
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Requested Loan Amount</h2>
          <p className="text-sm text-gray-600">
            How much would you like to borrow?
          </p>
          <Input
            id="loanAmount"
            type="number"
            label="Loan Amount ($)"
            value={values.loanAmount}
            onChange={(e) => updateField("loanAmount", e.target.value)}
          />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-gray-900">Review & Confirm</h2>
          <p className="text-sm text-gray-600">
            Check your details below before submitting.
          </p>
          <div className="bg-gray-50 p-4 rounded-lg text-sm space-y-2">
            <div><strong>Full Name:</strong> {values.fullName || "—"}</div>
            <div><strong>Monthly Income:</strong> \${values.monthlyIncome || "0"}</div>
            <div><strong>Loan Amount:</strong> \${values.loanAmount || "0"}</div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center pt-4 border-t border-gray-100">
        {step > 1 ? (
          <Button variant="secondary" onClick={handleBack}>
            Back
          </Button>
        ) : <div />}
        <div>
          {step < totalSteps ? (
            <Button variant="primary" onClick={handleNext}>
              Continue
            </Button>
          ) : (
            <Button variant="primary" onClick={handleSubmit}>
              Submit Application
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
`;

export default mockComponentCode;
