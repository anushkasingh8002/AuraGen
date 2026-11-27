import { ReactNode } from 'react'
import clsx from 'clsx'

interface FormSectionProps {
  title: string
  description?: string
  children: ReactNode
  className?: string
  icon?: string
}

export default function FormSection({
  title,
  description,
  children,
  className,
  icon,
}: FormSectionProps) {
  return (
    <div className={clsx('form-card mb-6', className)}>
      <div className="mb-5 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          {icon && (
            <div className="w-9 h-9 rounded-lg bg-aura-50 border border-aura-100 flex items-center justify-center text-lg flex-shrink-0">
              {icon}
            </div>
          )}
          <div>
            <h3 className="text-base font-semibold text-slate-800">{title}</h3>
            {description && (
              <p className="text-sm text-slate-500 mt-0.5">{description}</p>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </div>
  )
}
