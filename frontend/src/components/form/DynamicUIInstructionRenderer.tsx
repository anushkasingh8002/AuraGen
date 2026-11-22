import { useState } from 'react'
import { UIInstructions } from '../../types/ai.types'
import { Button, InputField as Input, Card, ProgressBar, SelectField } from '../ui'

interface DynamicUIInstructionRendererProps {
  instructions: UIInstructions
  initialValues?: Record<string, string>
  onChange?: (values: Record<string, string>) => void
  onSubmit?: (values: Record<string, string>) => void
  onCancel?: () => void
}

export default function DynamicUIInstructionRenderer({
  instructions,
  initialValues = {},
  onChange,
  onSubmit,
  onCancel,
}: DynamicUIInstructionRendererProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({
    ...instructions.suggestedDefaults,
    ...initialValues,
  })

  const steps = instructions.steps || []
  const totalSteps = steps.length + 1 // +1 for final confirmation step
  const activeStep = steps[currentStepIndex]
  const isReviewStep = currentStepIndex === steps.length

  const handleFieldChange = (fieldId: string, val: string) => {
    const updated = { ...values, [fieldId]: val }
    setValues(updated)
    if (onChange) onChange(updated)
  }

  const handleNext = () => {
    if (currentStepIndex < totalSteps - 1) {
      setCurrentStepIndex((prev) => prev + 1)
    }
  }

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1)
    }
  }

  const handleSubmit = (e?: React.FormEvent) => {
    if (e && e.preventDefault) e.preventDefault()
    if (onSubmit) onSubmit(values)
  }

  return (
    <Card className="max-w-xl mx-auto p-6 sm:p-8 space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Adaptive AI Optimization Active
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {instructions.reason || 'Form rearranged into bite-sized steps to minimize cognitive load.'}
          </p>
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-500 hover:text-slate-800 underline font-medium self-start sm:self-center cursor-pointer"
        >
          ← Return to full form
        </button>
      </div>

      <ProgressBar current={currentStepIndex + 1} total={totalSteps} />

      {/* Step fields */}
      {!isReviewStep && activeStep && (
        <div className="space-y-4 py-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{activeStep.title}</h2>
            {activeStep.description && (
              <p className="text-sm text-slate-500 mt-1">{activeStep.description}</p>
            )}
          </div>

          <div className="space-y-4 pt-2">
            {activeStep.fields.map((field, idx) => {
              if (field.type === 'select' && field.options) {
                return (
                  <SelectField
                    key={field.id}
                    label={field.label}
                    options={field.options}
                    value={values[field.id] || ''}
                    hint={field.helperText}
                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                  />
                )
              }

              return (
                <Input
                  key={field.id}
                  label={field.label}
                  type={field.type}
                  placeholder={field.placeholder}
                  value={values[field.id] || ''}
                  hint={field.helperText}
                  autoFocus={idx === 0}
                  required={field.required}
                  onChange={(e) => handleFieldChange(field.id, e.target.value)}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Final Review & Confirm step */}
      {isReviewStep && (
        <div className="space-y-4 py-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Review & Confirm</h2>
            <p className="text-sm text-slate-500 mt-1">
              Confirm your details. All information entered in this flow has been saved.
            </p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-2 divide-y divide-slate-100">
            {Object.entries(values)
              .filter(([, v]) => Boolean(v))
              .slice(0, 8)
              .map(([key, val]) => (
                <div key={key} className="flex justify-between py-1.5 first:pt-0 last:pb-0">
                  <span className="text-slate-500 capitalize">
                    {key.replace(/([A-Z])/g, ' $1')}
                  </span>
                  <span className="font-semibold text-slate-800">{String(val)}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        {currentStepIndex > 0 ? (
          <Button variant="secondary" onClick={handleBack}>
            ← Back
          </Button>
        ) : (
          <div />
        )}

        <div>
          {!isReviewStep ? (
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
