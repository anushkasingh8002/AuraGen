import clsx from 'clsx'

interface ProgressBarProps {
  current: number
  total: number
  className?: string
}

export default function ProgressBar({ current, total, className }: ProgressBarProps) {
  const percentage = Math.min(Math.max(Math.round((current / total) * 100), 0), 100)

  return (
    <div className={clsx('w-full space-y-1', className)}>
      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-aura-600 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex justify-between text-[11px] text-slate-400 font-medium">
        <span>Step {current} of {total}</span>
        <span>{percentage}% completed</span>
      </div>
    </div>
  )
}
