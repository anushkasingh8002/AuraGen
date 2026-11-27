import { TextareaHTMLAttributes } from 'react'
import clsx from 'clsx'

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  error?: string
  hint?: string
}

export default function TextareaField({
  label,
  error,
  hint,
  className,
  ...props
}: TextareaFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="label-base">
        {label}
        {props.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <textarea
        className={clsx(
          'input-base resize-none',
          error && 'border-red-400 focus:ring-red-400',
          className
        )}
        rows={3}
        {...props}
      />
      {hint && !error && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
