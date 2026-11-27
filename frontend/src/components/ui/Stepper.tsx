import clsx from 'clsx'

interface StepperProps {
  steps: string[]
  currentStep: number
  onStepClick?: (stepIndex: number) => void
  className?: string
}

export default function Stepper({ steps, currentStep, onStepClick, className }: StepperProps) {
  return (
    <div className={clsx('w-full flex items-center justify-between', className)}>
      {steps.map((label, idx) => {
        const stepNum = idx + 1
        const isDone = stepNum < currentStep
        const isCurrent = stepNum === currentStep

        return (
          <div key={label} className="flex-1 flex items-center">
            <button
              type="button"
              disabled={!onStepClick || stepNum > currentStep}
              onClick={() => onStepClick?.(stepNum)}
              className={clsx(
                'flex items-center gap-2 group text-left cursor-pointer disabled:cursor-default',
                stepNum > currentStep && 'opacity-60'
              )}
            >
              <div
                className={clsx(
                  'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-200',
                  isDone && 'bg-emerald-500 text-white',
                  isCurrent && 'bg-aura-600 text-white ring-4 ring-aura-100',
                  !isDone && !isCurrent && 'bg-slate-200 text-slate-500'
                )}
              >
                {isDone ? '✓' : stepNum}
              </div>
              <span
                className={clsx(
                  'text-xs font-medium hidden sm:inline-block',
                  isCurrent ? 'text-aura-700 font-semibold' : 'text-slate-600'
                )}
              >
                {label}
              </span>
            </button>
            {idx < steps.length - 1 && (
              <div
                className={clsx(
                  'flex-1 h-0.5 mx-2 rounded transition-colors duration-300',
                  stepNum < currentStep ? 'bg-emerald-400' : 'bg-slate-200'
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
