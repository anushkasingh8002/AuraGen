import { FormData } from '../../types/form.types'
import { InputField, SelectField, TextareaField, FormSection } from '../ui'

const LOAN_TYPES = [
  { value: 'personal',   label: 'Personal Loan' },
  { value: 'home',       label: 'Home Mortgage' },
  { value: 'auto',       label: 'Auto Loan' },
  { value: 'business',   label: 'Business Loan' },
  { value: 'student',    label: 'Student Loan' },
  { value: 'refinance',  label: 'Refinance' },
]

const LOAN_TERMS = [
  { value: '12',  label: '12 months (1 year)' },
  { value: '24',  label: '24 months (2 years)' },
  { value: '36',  label: '36 months (3 years)' },
  { value: '60',  label: '60 months (5 years)' },
  { value: '84',  label: '84 months (7 years)' },
  { value: '120', label: '120 months (10 years)' },
  { value: '180', label: '180 months (15 years)' },
  { value: '360', label: '360 months (30 years)' },
]

const COLLATERAL_TYPES = [
  { value: 'none',     label: 'None (Unsecured)' },
  { value: 'property', label: 'Real Estate / Property' },
  { value: 'vehicle',  label: 'Vehicle' },
  { value: 'savings',  label: 'Savings Account' },
  { value: 'other',    label: 'Other Assets' },
]

interface Props {
  data: FormData['loan']
  errors: Record<string, string>
  onChange: (field: keyof FormData['loan'], value: string) => void
}

export default function LoanDetailsSection({ data, errors, onChange }: Props) {
  const hasCollateral = data.collateral && data.collateral !== 'none'

  return (
    <FormSection
      title="Loan Details"
      description="Tell us about the loan you are applying for"
      icon="🏦"
    >
      <SelectField
        label="Loan Type" required value={data.loanType}
        onChange={(e) => onChange('loanType', e.target.value)}
        options={LOAN_TYPES} placeholder="Select loan type"
        error={errors['loan.loanType']}
      />
      <InputField
        label="Loan Amount ($)" required type="number" value={data.loanAmount}
        onChange={(e) => onChange('loanAmount', e.target.value)}
        placeholder="25000" min={1000}
        error={errors['loan.loanAmount']}
      />
      <SelectField
        label="Repayment Term" required value={data.loanTerm}
        onChange={(e) => onChange('loanTerm', e.target.value)}
        options={LOAN_TERMS} placeholder="Select term"
        error={errors['loan.loanTerm']}
      />
      <SelectField
        label="Collateral" value={data.collateral}
        onChange={(e) => onChange('collateral', e.target.value)}
        options={COLLATERAL_TYPES} placeholder="Select collateral type"
      />
      {hasCollateral && (
        <InputField
          label="Estimated Collateral Value ($)" type="number" value={data.collateralValue}
          onChange={(e) => onChange('collateralValue', e.target.value)}
          placeholder="50000"
        />
      )}
      <InputField
        label="Existing Monthly Debt Payments ($)" type="number" value={data.existingDebts}
        onChange={(e) => onChange('existingDebts', e.target.value)}
        placeholder="800" hint="Total of all current loan and credit card payments"
      />
      <TextareaField
        label="Purpose of Loan" required value={data.purpose}
        onChange={(e) => onChange('purpose', e.target.value)}
        placeholder="Describe how you plan to use this loan..."
        error={errors['loan.purpose']}
        className="md:col-span-2"
      />
    </FormSection>
  )
}
