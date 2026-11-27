import { FormData } from '../../types/form.types'
import { InputField, SelectField, FormSection } from '../ui'

const US_STATES = [
  { value: 'AL', label: 'Alabama' },   { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },   { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },   { value: 'IL', label: 'Illinois' },
  { value: 'MA', label: 'Massachusetts' }, { value: 'MI', label: 'Michigan' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NY', label: 'New York' },
  { value: 'OH', label: 'Ohio' },       { value: 'PA', label: 'Pennsylvania' },
  { value: 'TX', label: 'Texas' },      { value: 'WA', label: 'Washington' },
  { value: 'Other', label: 'Other' },
]

const MARITAL_STATUS = [
  { value: 'single',   label: 'Single' },
  { value: 'married',  label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed',  label: 'Widowed' },
]

interface Props {
  data: FormData['personal']
  errors: Record<string, string>
  onChange: (field: keyof FormData['personal'], value: string) => void
}

export default function PersonalInfoSection({ data, errors, onChange }: Props) {
  return (
    <FormSection
      title="Personal Information"
      description="Your basic identity and contact details"
      icon="👤"
    >
      <InputField
        label="First Name" required value={data.firstName}
        onChange={(e) => onChange('firstName', e.target.value)}
        placeholder="John" error={errors['personal.firstName']}
      />
      <InputField
        label="Last Name" required value={data.lastName}
        onChange={(e) => onChange('lastName', e.target.value)}
        placeholder="Doe" error={errors['personal.lastName']}
      />
      <InputField
        label="Date of Birth" required type="date" value={data.dateOfBirth}
        onChange={(e) => onChange('dateOfBirth', e.target.value)}
        error={errors['personal.dateOfBirth']}
      />
      <InputField
        label="Social Security Number" required type="password" value={data.ssn}
        onChange={(e) => onChange('ssn', e.target.value)}
        placeholder="XXX-XX-XXXX"
        hint="Encrypted with AES-256 bank-grade security"
        error={errors['personal.ssn']}
      />
      <InputField
        label="Email Address" required type="email" value={data.email}
        onChange={(e) => onChange('email', e.target.value)}
        placeholder="john@example.com" error={errors['personal.email']}
      />
      <InputField
        label="Phone Number" required type="tel" value={data.phone}
        onChange={(e) => onChange('phone', e.target.value)}
        placeholder="(555) 000-0000" error={errors['personal.phone']}
      />
      <InputField
        label="Street Address" required value={data.address}
        onChange={(e) => onChange('address', e.target.value)}
        placeholder="123 Main St" error={errors['personal.address']}
        className="md:col-span-2"
      />
      <InputField
        label="City" required value={data.city}
        onChange={(e) => onChange('city', e.target.value)}
        placeholder="New York" error={errors['personal.city']}
      />
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          label="State" required value={data.state}
          onChange={(e) => onChange('state', e.target.value)}
          options={US_STATES} placeholder="Select state"
          error={errors['personal.state']}
        />
        <InputField
          label="ZIP Code" required value={data.zipCode}
          onChange={(e) => onChange('zipCode', e.target.value)}
          placeholder="10001" error={errors['personal.zipCode']}
        />
      </div>
      <SelectField
        label="Marital Status" value={data.maritalStatus}
        onChange={(e) => onChange('maritalStatus', e.target.value)}
        options={MARITAL_STATUS} placeholder="Select status"
      />
      <InputField
        label="Number of Dependents" type="number" value={data.dependents}
        onChange={(e) => onChange('dependents', e.target.value)}
        placeholder="0" min={0}
      />
    </FormSection>
  )
}
