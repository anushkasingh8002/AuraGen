import { FormData } from '../types/form.types'

/**
 * Flattens the nested FormData structure into a unified key-value object
 * for the AI module and simplified wizards while preserving values.
 */
export function flattenFormData(formData: FormData): Record<string, string> {
  const flat: Record<string, string> = {}

  // Personal
  Object.entries(formData.personal).forEach(([key, val]) => {
    flat[key] = String(val || '')
  })
  // Synthesize fullName if firstName/lastName exist
  const first = formData.personal.firstName || ''
  const last = formData.personal.lastName || ''
  flat.fullName = [first, last].filter(Boolean).join(' ')

  // Employment
  Object.entries(formData.employment).forEach(([key, val]) => {
    flat[key] = String(val || '')
  })

  // Loan
  Object.entries(formData.loan).forEach(([key, val]) => {
    flat[key] = String(val || '')
  })

  // Assets & Liabilities
  Object.entries(formData.assets).forEach(([key, val]) => {
    flat[key] = String(val || '')
  })

  return flat
}

/**
 * Immutably merges flat values from a simplified wizard back into the master FormData state.
 * Guaranteed to preserve previously entered values in sections not touched by the simplified UI.
 */
export function mergeFlatIntoFormData(
  current: FormData,
  flatUpdates: Record<string, string | boolean | undefined>
): FormData {
  const next: FormData = {
    personal: { ...current.personal },
    employment: { ...current.employment },
    loan: { ...current.loan },
    assets: { ...current.assets },
    agreeToTerms: current.agreeToTerms,
    agreeToCredit: current.agreeToCredit,
  }

  // Handle fullName decomposition if updated
  if (typeof flatUpdates.fullName === 'string' && flatUpdates.fullName.trim() !== '') {
    const parts = flatUpdates.fullName.trim().split(/\s+/)
    next.personal.firstName = parts[0] || ''
    next.personal.lastName = parts.slice(1).join(' ') || next.personal.lastName || ''
  }

  // Map each incoming update to its target section
  Object.entries(flatUpdates).forEach(([key, value]) => {
    if (value === undefined || key === 'fullName') return

    const strVal = String(value)

    if (key in next.personal) {
      (next.personal as unknown as Record<string, string>)[key] = strVal
    } else if (key in next.employment) {
      (next.employment as unknown as Record<string, string>)[key] = strVal
    } else if (key in next.loan) {
      (next.loan as unknown as Record<string, string>)[key] = strVal
    } else if (key in next.assets) {
      (next.assets as unknown as Record<string, string>)[key] = strVal
    } else if (key === 'agreeToTerms') {
      next.agreeToTerms = Boolean(value)
    } else if (key === 'agreeToCredit') {
      next.agreeToCredit = Boolean(value)
    }
  })

  return next
}

/**
 * Builds the form schema descriptor used for AI DOM snapshot requests.
 */
export function buildFormSchema() {
  return {
    formId: 'loan-application-v1',
    title: 'Comprehensive Financial Loan Application',
    sections: [
      {
        id: 'personal',
        title: 'Personal Information',
        fields: [
          { id: 'firstName', label: 'First Name', required: true },
          { id: 'lastName', label: 'Last Name', required: true },
          { id: 'dateOfBirth', label: 'Date of Birth', required: true },
          { id: 'ssn', label: 'Social Security Number', required: true, sensitive: true },
          { id: 'email', label: 'Email Address', required: true },
          { id: 'phone', label: 'Phone Number', required: true },
          { id: 'address', label: 'Street Address', required: true },
          { id: 'city', label: 'City', required: true },
          { id: 'state', label: 'State', required: true },
          { id: 'zipCode', label: 'ZIP Code', required: true },
        ],
      },
      {
        id: 'employment',
        title: 'Employment & Income',
        fields: [
          { id: 'employmentStatus', label: 'Employment Status', required: true },
          { id: 'employerName', label: 'Employer Name' },
          { id: 'jobTitle', label: 'Job Title' },
          { id: 'yearsEmployed', label: 'Years Employed' },
          { id: 'monthlyIncome', label: 'Monthly Net Income', required: true },
          { id: 'otherIncome', label: 'Other Monthly Income' },
        ],
      },
      {
        id: 'loan',
        title: 'Loan Details',
        fields: [
          { id: 'loanType', label: 'Loan Type', required: true },
          { id: 'loanAmount', label: 'Requested Amount', required: true },
          { id: 'loanTerm', label: 'Loan Term', required: true },
          { id: 'purpose', label: 'Loan Purpose', required: true },
        ],
      },
      {
        id: 'assets',
        title: 'Assets & Liabilities',
        fields: [
          { id: 'checkingBalance', label: 'Checking Account Balance' },
          { id: 'savingsBalance', label: 'Savings Account Balance' },
          { id: 'creditCardDebt', label: 'Total Credit Card Debt' },
          { id: 'mortgageBalance', label: 'Remaining Mortgage' },
        ],
      },
    ],
  }
}
