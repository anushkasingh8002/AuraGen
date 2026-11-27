import { useState } from 'react'
import type { UIInstructionField, UIInstructions } from '../../types/ai.types'
import {
  Button,
  InputField as Input,
  Card,
  ProgressBar,
  SelectField,
  TextareaField,
} from '../ui'

interface DynamicUIInstructionRendererProps {
  instructions: UIInstructions
  initialValues?: Record<string, string>
  onChange?: (values: Record<string, string>) => void
  onSubmit?: (values: Record<string, string>) => void
  onCancel?: () => void
}

function isFieldValid(field: UIInstructionField, value: string | undefined) {
  if (field.required && (field.type === 'checkbox'
    ? value !== 'true'
    : !value?.trim())) {
    return false
  }
  if (field.type === 'email' && value?.trim()) {
    return /^\S+@\S+\.\S+$/.test(value)
  }
  return true
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
  const [errors, setErrors] = useState<Record<string, string>>({})

  const steps = instructions.steps || []
  const totalSteps = steps.length + 1
  const activeStep = steps[currentStepIndex]
  const isReviewStep = currentStepIndex >= steps.length
  const reviewFields = steps.flatMap((step) => step.fields)

  const handleFieldChange = (fieldId: string, value: string) => {
    const updated = { ...values, [fieldId]: value }
    setValues(updated)
    setErrors((previous) => {
      const next = { ...previous }
      delete next[fieldId]
      return next
    })
    onChange?.(updated)
  }

  const handleNext = () => {
    if (activeStep) {
      const invalidFields = activeStep.fields.filter(
        (field) => !isFieldValid(field, values[field.id])
      )
      if (invalidFields.length > 0) {
        setErrors((previous) => ({
          ...previous,
          ...Object.fromEntries(invalidFields.map((field) => [
            field.id,
            field.type === 'email' && values[field.id]
              ? 'Enter a valid email address'
              : `${field.label} is required`,
          ])),
        }))
        return
      }
    }

    if (currentStepIndex < totalSteps - 1) {
      setCurrentStepIndex((previous) => previous + 1)
    }
  }

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((previous) => previous - 1)
    }
  }

  const handleSubmit = () => onSubmit?.(values)

  return (
    <Card className="max-w-xl mx-auto p-6 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Adaptive AI Optimization Active
          </div>
          <p className="text-xs text-slate-400 mt-1">{instructions.reason}</p>
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

      {!isReviewStep && activeStep && (
        <div className="space-y-4 py-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{activeStep.title}</h2>
            {activeStep.description && (
              <p className="text-sm text-slate-500 mt-1">{activeStep.description}</p>
            )}
          </div>

          <div className="space-y-4 pt-2">
            {activeStep.fields.map((field, index) => {
              if (field.type === 'checkbox') {
                return (
                  <div key={field.id}>
                    <label className="flex items-start gap-3 text-sm text-slate-700">
                      <input
                        id={field.id}
                        name={field.id}
                        type="checkbox"
                        checked={values[field.id] === 'true'}
                        required={field.required}
                        onChange={(event) =>
                          handleFieldChange(field.id, String(event.target.checked))
                        }
                        className="mt-1"
                      />
                      <span>
                        {field.label}
                        {field.helperText && (
                          <span className="block text-xs text-slate-500 mt-1">
                            {field.helperText}
                          </span>
                        )}
                      </span>
                    </label>
                    {errors[field.id] && (
                      <p className="error-text mt-1">{errors[field.id]}</p>
                    )}
                  </div>
                )
              }

              if (field.type === 'select') {
                return (
                  <SelectField
                    key={field.id}
                    id={field.id}
                    name={field.id}
                    label={field.label}
                    options={field.options ?? []}
                    value={values[field.id] || ''}
                    hint={field.helperText}
                    error={errors[field.id]}
                    required={field.required}
                    placeholder={`Select ${field.label.toLowerCase()}`}
                    onChange={(event) => handleFieldChange(field.id, event.target.value)}
                  />
                )
              }

              if (field.type === 'textarea') {
                return (
                  <TextareaField
                    key={field.id}
                    id={field.id}
                    name={field.id}
                    label={field.label}
                    placeholder={field.placeholder}
                    value={values[field.id] || ''}
                    hint={field.helperText}
                    error={errors[field.id]}
                    required={field.required}
                    autoFocus={index === 0}
                    onChange={(event) => handleFieldChange(field.id, event.target.value)}
                  />
                )
              }

              return (
                <Input
                  key={field.id}
                  id={field.id}
                  name={field.id}
                  label={field.label}
                  type={field.type}
                  placeholder={field.placeholder}
                  value={values[field.id] || ''}
                  hint={field.helperText}
                  error={errors[field.id]}
                  autoFocus={index === 0}
                  required={field.required}
                  onChange={(event) => handleFieldChange(field.id, event.target.value)}
                />
              )
            })}
          </div>
        </div>
      )}

      {isReviewStep && (
        <div className="space-y-4 py-2">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Review & Confirm</h2>
            <p className="text-sm text-slate-500 mt-1">
              Review every field before submitting. Sensitive fields are kept in the original form.
            </p>
          </div>

          <div className="max-h-[28rem] overflow-y-auto bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm divide-y divide-slate-100">
            {reviewFields.map((field) => (
              <div key={field.id} className="flex justify-between gap-4 py-2 first:pt-0 last:pb-0">
                <span className="text-slate-500">{field.label}</span>
                <span className="font-semibold text-slate-800 text-right break-all">
                  {field.type === 'checkbox'
                    ? values[field.id] === 'true' ? 'Yes' : 'No'
                    : values[field.id] || '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-slate-100">
        {currentStepIndex > 0 ? (
          <Button variant="secondary" onClick={handleBack}>← Back</Button>
        ) : <div />}

        {!isReviewStep ? (
          <Button variant="primary" onClick={handleNext}>Continue →</Button>
        ) : (
          <Button variant="primary" onClick={handleSubmit}>
            Submit Application ✓
          </Button>
        )}
      </div>
    </Card>
  )
}
