import { ReactNode } from 'react'
import clsx from 'clsx'

interface CardProps {
  className?: string
  children: ReactNode
}

export default function Card({ className, children }: CardProps) {
  return (
    <div
      className={clsx(
        'bg-white border border-slate-100 shadow-xl rounded-2xl p-6 transition-all duration-300',
        className
      )}
    >
      {children}
    </div>
  )
}
