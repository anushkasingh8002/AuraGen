import { FormData } from '../../types/form.types'
import { InputField, SelectField, FormSection } from '../ui'

const EMPLOYMENT_STATUS = [
  { value: 'full-time',     label: 'Full-Time Employed' },
  { value: 'part-time',     label: 'Part-Time Employed' },
  { value: 'self-employed', label: 'Self-Employed' },
  { value: 'unemployed',    label: 'Unemployed' },
  { value: 'retired',       label: 'Retired' },
  { value: 'student',       label: 'Student' },
]

interface Props {
  data: FormData['employment']
  errors: Record<string, string>
  onChange: (field: keyof FormData['employment'], value: string) => void
}

export default function EmploymentSection({ data, errors, onChange }: Props) {
  const isEmployed = ['full-time', 'part-time', 'self-employed'].includes(
    data.employmentStatus
  )

  return (
    <FormSection
      title="Employment & Income"
      description="Your current employment situation and income sources"
      icon="💼"
    >
      <SelectField
        label="Employment Status" required value={data.employmentStatus}
        onChange={(e) => onChange('employmentStatus', e.target.value)}
        options={EMPLOYMENT_STATUS} placeholder="Select status"
        error={errors['employment.employmentStatus']}
        className="md:col-span-2"
      />
      {isEmployed && (
        <>
          <InputField
            label="Employer Name" value={data.employerName}
            onChange={(e) => onChange('employerName', e.target.value)}
            placeholder="Acme Corporation"
          />
          <InputField
            label="Job Title" value={data.jobTitle}
            onChange={(e) => onChange('jobTitle', e.target.value)}
            placeholder="Software Engineer"
          />
          <InputField
            label="Years at Current Employer" type="number" value={data.yearsEmployed}
            onChange={(e) => onChange('yearsEmployed', e.target.value)}
            placeholder="3" min={0}
          />
        </>
      )}
      <InputField
        label="Gross Monthly Income ($)" required type="number" value={data.monthlyIncome}
        onChange={(e) => onChange('monthlyIncome', e.target.value)}
        placeholder="5000" error={errors['employment.monthlyIncome']}
      />
      <InputField
        label="Other Monthly Income ($)" type="number" value={data.otherIncome}
        onChange={(e) => onChange('otherIncome', e.target.value)}
        placeholder="0" hint="Rental, freelance, dividends, etc."
      />
      {parseFloat(data.otherIncome) > 0 && (
        <InputField
          label="Source of Other Income" value={data.otherIncomeSource}
          onChange={(e) => onChange('otherIncomeSource', e.target.value)}
          placeholder="Rental property" className="md:col-span-2"
        />
      )}
    </FormSection>
  )
}
