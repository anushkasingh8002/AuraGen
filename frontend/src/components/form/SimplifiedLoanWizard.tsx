import { useState } from 'react'
import { Button, InputField as Input, Card, ProgressBar } from '../ui'

interface SimplifiedLoanWizardProps {
  initialValues?: Record<string, string>
  onChange?: (values: Record<string, string>) => void
  onSubmit?: (values: Record<string, string>) => void
  onCancel?: () => void
  reason?: string
}

export default function SimplifiedLoanWizard({
  initialValues = {},
  onChange,
  onSubmit,
  onCancel,
  reason = 'Simplified for higher clarity based on real-time focus feedback',
}: SimplifiedLoanWizardProps) {
  const [step, setStep] = useState(1)
  const [values, setValues] = useState<Record<string, string>>({
    fullName: initialValues.fullName || '',
    email: initialValues.email || '',
    monthlyIncome: initialValues.monthlyIncome || '',
    loanAmount: initialValues.loanAmount || '',
    loanType: initialValues.loanType || 'Personal',
    purpose: initialValues.purpose || '',
    employmentStatus: initialValues.employmentStatus || 'Full-time',
  })

  const totalSteps = 4

  const updateField = (field: string, val: string) => {
    const next = { ...values, [field]: val }
    setValues(next)
    if (onChange) onChange(next)
  }

  const handleNext = () => setStep((s) => Math.min(s + 1, totalSteps))
  const handleBack = () => setStep((s) => Math.max(s - 1, 1))

  const handleSubmit = (e?: React.FormEvent) => {
    if (e && e.preventDefault) e.preventDefault()
    if (onSubmit) onSubmit(values)
  }

  return (
    <Card className="max-w-xl mx-auto p-6 sm:p-8 space-y-6 animate-fadeIn">
      {/* AI Context Badge & Cancel Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-aura-50 text-aura-700 border border-aura-200">
            <span className="w-1.5 h-1.5 rounded-full bg-aura-500 animate-pulse" />
            AI Adaptive Wizard Active
          </div>
          <p className="text-xs text-slate-400 mt-1">{reason}</p>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-800 underline font-medium self-start sm:self-center cursor-pointer"
        >
          ← Return to full form
        </button>
      </div>

      <ProgressBar current={step} total={totalSteps} />

      {/* Step 1: Identity */}
      {step === 1 && (
        <div className="space-y-4 py-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Let's start with your name</h2>
            <p className="text-sm text-slate-500 mt-1">
              Please enter your legal name as it appears on official government IDs.
            </p>
          </div>

          <Input
            label="Legal Full Name"
            placeholder="e.g. Jane Doe"
            value={values.fullName}
            onChange={(e) => updateField('fullName', e.target.value)}
            hint="We automatically match this with your personal profile."
            autoFocus
          />

          <Input
            label="Email Address"
            type="email"
            placeholder="jane@example.com"
            value={values.email}
            onChange={(e) => updateField('email', e.target.value)}
            hint="We will send real-time loan progress to this address."
          />
        </div>
      )}

      {/* Step 2: Income & Employment */}
      {step === 2 && (
        <div className="space-y-4 py-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Income & Employment</h2>
            <p className="text-sm text-slate-500 mt-1">
              Clear income details help us fast-track your approval rate.
            </p>
          </div>

          <Input
            label="Monthly Take-Home Income ($)"
            type="number"
            placeholder="e.g. 5500"
            value={values.monthlyIncome}
            onChange={(e) => updateField('monthlyIncome', e.target.value)}
            hint="Net monthly earnings after tax."
            autoFocus
          />

          <div className="flex flex-col gap-1">
            <label className="label-base">Employment Status</label>
            <select
              className="input-base bg-white"
              value={values.employmentStatus}
              onChange={(e) => updateField('employmentStatus', e.target.value)}
            >
              <option value="Full-time">Employed Full-time</option>
              <option value="Part-time">Employed Part-time</option>
              <option value="Self-employed">Self-employed / Contractor</option>
              <option value="Retired">Retired</option>
              <option value="Other">Other</option>
            </select>
          </div>
        </div>
      )}

      {/* Step 3: Loan Request */}
      {step === 3 && (
        <div className="space-y-4 py-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Requested Loan Amount</h2>
            <p className="text-sm text-slate-500 mt-1">
              How much financing are you looking to secure today?
            </p>
          </div>

          <Input
            label="Loan Amount ($)"
            type="number"
            placeholder="e.g. 25000"
            value={values.loanAmount}
            onChange={(e) => updateField('loanAmount', e.target.value)}
            hint="Minimum $1,000 up to $100,000."
            autoFocus
          />

          <Input
            label="Primary Purpose"
            placeholder="e.g. Debt Consolidation, Home Renovation"
            value={values.purpose}
            onChange={(e) => updateField('purpose', e.target.value)}
          />
        </div>
      )}

      {/* Step 4: Summary & Confirm */}
      {step === 4 && (
        <div className="space-y-4 py-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Review & Confirm</h2>
            <p className="text-sm text-slate-500 mt-1">
              All your information has been preserved. Review your key details below.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-2.5">
            <div className="flex justify-between py-1 border-b border-slate-200">
              <span className="text-slate-500">Full Name</span>
              <span className="font-semibold text-slate-800">{values.fullName || '—'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200">
              <span className="text-slate-500">Contact Email</span>
              <span className="font-semibold text-slate-800">{values.email || '—'}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200">
              <span className="text-slate-500">Monthly Net Income</span>
              <span className="font-semibold text-slate-800">
                {values.monthlyIncome ? `$${Number(values.monthlyIncome).toLocaleString()}` : '—'}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200">
              <span className="text-slate-500">Requested Amount</span>
              <span className="font-semibold text-aura-600">
                {values.loanAmount ? `$${Number(values.loanAmount).toLocaleString()}` : '—'}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Loan Purpose</span>
              <span className="font-semibold text-slate-800">{values.purpose || 'Personal'}</span>
            </div>
          </div>

          <p className="text-xs text-slate-400 italic">
            ✓ Data entered here automatically preserves and syncs with your complete loan profile.
          </p>
        </div>
      )}

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        {step > 1 ? (
          <Button variant="secondary" onClick={handleBack}>
            ← Back
          </Button>
        ) : (
          <div />
        )}

        <div>
          {step < totalSteps ? (
            <Button variant="primary" onClick={handleNext}>
              Continue →
            </Button>
          ) : (
            <Button variant="primary" onClick={() => handleSubmit()}>
              Submit Application ✓
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
