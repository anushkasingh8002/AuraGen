import { SelectHTMLAttributes } from 'react'
import clsx from 'clsx'

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  error?: string
  hint?: string
  options: { value: string; label: string }[]
  placeholder?: string
}

export default function SelectField({
  label,
  error,
  hint,
  options,
  placeholder,
  className,
  ...props
}: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="label-base" htmlFor={props.id}>
        {label}
        {props.required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <select
        className={clsx(
          'input-base appearance-none cursor-pointer',
          error && 'border-red-400 focus:ring-red-400',
          className
        )}
        {...props}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint && !error && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
