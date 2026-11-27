import clsx from 'clsx'

interface Step {
  id: number
  label: string
  completed: boolean
  active: boolean
}

interface StepIndicatorProps {
  steps: Step[]
  onStepClick?: (id: number) => void
}

export default function StepIndicator({ steps, onStepClick }: StepIndicatorProps) {
  return (
    <div className="flex items-center mb-8 overflow-x-auto pb-2">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center flex-shrink-0">
          <button
            onClick={() => step.completed && onStepClick?.(step.id)}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all',
              step.active && 'bg-aura-50 text-aura-700',
              step.completed && !step.active && 'text-aura-600 hover:bg-aura-50 cursor-pointer',
              !step.active && !step.completed && 'text-slate-400 cursor-default'
            )}
          >
            <div
              className={clsx(
                'w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                step.completed
                  ? 'bg-aura-600 text-white'
                  : step.active
                  ? 'bg-aura-100 text-aura-700 ring-2 ring-aura-400'
                  : 'bg-slate-200 text-slate-500'
              )}
            >
              {step.completed ? '✓' : step.id}
            </div>
            <span className="hidden sm:block">{step.label}</span>
          </button>
          {index < steps.length - 1 && (
            <div
              className={clsx(
                'w-8 h-0.5 mx-1',
                step.completed ? 'bg-aura-400' : 'bg-slate-200'
              )}
            />
          )}
        </div>
      ))}
    </div>
  )
}
