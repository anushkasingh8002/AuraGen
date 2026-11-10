import { useState, useCallback } from 'react'
import { FormData, initialFormData } from '../types/form.types'

export function useFormState() {
  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [errors, setErrors]     = useState<Record<string, string>>({})
  const [currentStep, setCurrentStep] = useState(1)

  const updateField = useCallback(<S extends keyof FormData>(
    section: S,
    field: keyof FormData[S],
    value: string | boolean
  ) => {
    setFormData((prev) => ({
      ...prev,
      [section]: { ...(prev[section] as object), [field]: value },
    }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[`${String(section)}.${String(field)}`]
      return next
    })
  }, [])

  const updateTopLevel = useCallback(
    (field: 'agreeToTerms' | 'agreeToCredit', value: boolean) => {
      setFormData((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const validateStep = useCallback(
    (step: number): boolean => {
      const e: Record<string, string> = {}
      if (step === 1) {
        if (!formData.personal.firstName)  e['personal.firstName']  = 'First name is required'
        if (!formData.personal.lastName)   e['personal.lastName']   = 'Last name is required'
        if (!formData.personal.dateOfBirth) e['personal.dateOfBirth'] = 'Date of birth is required'
        if (!formData.personal.ssn)        e['personal.ssn']        = 'SSN is required'
        if (!formData.personal.email)      e['personal.email']      = 'Email is required'
        else if (!/\S+@\S+\.\S+/.test(formData.personal.email))
          e['personal.email'] = 'Invalid email address'
        if (!formData.personal.phone)   e['personal.phone']   = 'Phone is required'
        if (!formData.personal.address) e['personal.address'] = 'Address is required'
        if (!formData.personal.city)    e['personal.city']    = 'City is required'
        if (!formData.personal.state)   e['personal.state']   = 'State is required'
        if (!formData.personal.zipCode) e['personal.zipCode'] = 'ZIP code is required'
      }
      if (step === 2) {
        if (!formData.employment.employmentStatus)
          e['employment.employmentStatus'] = 'Employment status is required'
        if (!formData.employment.monthlyIncome)
          e['employment.monthlyIncome'] = 'Monthly income is required'
      }
      if (step === 3) {
        if (!formData.loan.loanType)   e['loan.loanType']   = 'Loan type is required'
        if (!formData.loan.loanAmount) e['loan.loanAmount'] = 'Loan amount is required'
        if (!formData.loan.loanTerm)   e['loan.loanTerm']   = 'Loan term is required'
        if (!formData.loan.purpose)    e['loan.purpose']    = 'Purpose is required'
      }
      setErrors(e)
      return Object.keys(e).length === 0
    },
    [formData]
  )

  const nextStep = useCallback(() => {
    if (validateStep(currentStep)) setCurrentStep((s) => Math.min(s + 1, 5))
  }, [currentStep, validateStep])

  const prevStep = useCallback(() => setCurrentStep((s) => Math.max(s - 1, 1)), [])
  const goToStep = useCallback((step: number) => setCurrentStep(step), [])

  return { formData, errors, currentStep, updateField, updateTopLevel, nextStep, prevStep, goToStep }
}

export type FormStateReturn = ReturnType<typeof useFormState>
