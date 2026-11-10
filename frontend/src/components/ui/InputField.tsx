import { InputHTMLAttributes, forwardRef } from 'react'
import clsx from 'clsx'

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
}

const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  ({ label, error, hint, className, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        <label className="label-base">
          {label}
          {props.required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        <input
          ref={ref}
          className={clsx(
            'input-base',
            error && 'border-red-400 focus:ring-red-400',
            props.disabled && 'bg-slate-50 cursor-not-allowed opacity-70',
            className
          )}
          {...props}
        />
        {hint && !error && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
        {error && <p className="error-text">{error}</p>}
      </div>
    )
  }
)
InputField.displayName = 'InputField'
export default InputField
