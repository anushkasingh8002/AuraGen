import type { FormData } from '../types/form.types'
import type {
  FieldInputType,
  UIInstructionField,
  UIInstructions,
} from '../types/ai.types'

export interface FormSchemaField {
  id: string
  label: string
  type: string
  section?: string
  required?: boolean
  sensitive?: boolean
  placeholder?: string
  helperText?: string
  options?: Array<string | { label: string; value: string }>
}

export interface FormSchemaSection {
  id: string
  title: string
  description?: string
  fields: FormSchemaField[]
}

export interface FormSchema {
  formId?: string
  title?: string
  sections?: FormSchemaSection[]
  fields?: FormSchemaField[]
}

const SENSITIVE_FIELD_ID_PARTS = [
  'pan',
  'aadhaar',
  'ssn',
  'socialsecurity',
  'ifsc',
  'password',
  'secret',
  'token',
  'cvv',
  'otp',
  'passport',
  'license',
  'routing',
  'iban',
  'swift',
  'tin',
  'ein',
  'pin',
]

const INPUT_TYPES = new Set<FieldInputType>([
  'text',
  'number',
  'email',
  'tel',
  'date',
  'time',
  'url',
  'password',
  'checkbox',
  'select',
  'textarea',
])

function isSensitiveField(field: FormSchemaField): boolean {
  const hasSensitiveIdentifier = (value: string) => {
    const normalized = value
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase()
    const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean)
    const accountIndex = tokens.indexOf('account')
    const cardIndex = tokens.indexOf('card')
    const accountSuffixes = ['number', 'no', 'id', 'identifier']
    const cardSuffixes = [
      'number', 'no', 'cvv', 'cvc', 'pin', 'security', 'verification',
    ]

    return (
      tokens.some((token) => SENSITIVE_FIELD_ID_PARTS.includes(token)) ||
      normalized.replace(/[^a-z0-9]/g, '').includes('socialsecurity') ||
      (accountIndex >= 0 &&
        (!tokens[accountIndex + 1] ||
          accountSuffixes.includes(tokens[accountIndex + 1]))) ||
      (cardIndex >= 0 &&
        (!tokens[cardIndex + 1] || cardSuffixes.includes(tokens[cardIndex + 1])))
    )
  }

  return (
    field.sensitive === true ||
    field.type === 'password' ||
    hasSensitiveIdentifier(field.id) ||
    hasSensitiveIdentifier(field.label)
  )
}

function getSchemaSections(schema: FormSchema): FormSchemaSection[] {
  if (Array.isArray(schema.sections)) {
    const sections = schema.sections.map((section) => ({
      ...section,
      fields: [...section.fields],
    }))
    const knownFields = new Set(
      sections.flatMap((section) => section.fields.map((field) => field.id))
    )

    for (const field of schema.fields ?? []) {
      if (knownFields.has(field.id)) continue

      const sectionId = field.section || 'application'
      let section = sections.find((candidate) => candidate.id === sectionId)
      if (!section) {
        section = {
          id: sectionId,
          title: sectionId === 'application'
            ? schema.title || 'Application'
            : sectionId.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' '),
          fields: [],
        }
        sections.push(section)
      }
      section.fields.push(field)
      knownFields.add(field.id)
    }

    return sections
  }

  const groups = new Map<string, FormSchemaField[]>()
  for (const field of schema.fields ?? []) {
    const sectionId = field.section || 'application'
    const sectionFields = groups.get(sectionId) ?? []
    sectionFields.push(field)
    groups.set(sectionId, sectionFields)
  }

  return Array.from(groups, ([id, fields]) => ({
    id,
    title: id === 'application'
      ? schema.title || 'Application'
      : id.replace(/([A-Z])/g, ' $1').replace(/[-_]/g, ' '),
    fields,
  }))
}

function normalizeOptions(
  options: FormSchemaField['options']
): UIInstructionField['options'] {
  if (!options) return undefined

  return options.map((option) =>
    typeof option === 'string'
      ? { label: option, value: option }
      : { label: option.label, value: option.value }
  )
}

export function sanitizeFormSchema(schema: FormSchema): FormSchema {
  const sections = getSchemaSections(schema).map((section) => ({
    ...section,
    fields: section.fields.filter((field) => !isSensitiveField(field)),
  }))
  const fields = (schema.fields ?? sections.flatMap((section) => section.fields))
    .filter((field) => !isSensitiveField(field))
    .map((field) => ({ ...field }))

  return { ...schema, sections, fields }
}

export function buildSafeSnapshot(
  formData: FormData,
  formSchema: FormSchema = buildFormSchema()
): { schema: FormSchema; values: Record<string, string> } {
  const schema = sanitizeFormSchema(formSchema)
  const localValues = flattenFormData(formData)
  const values: Record<string, string> = {}

  for (const field of schema.fields ?? []) {
    if (
      !isSensitiveField(field) &&
      Object.prototype.hasOwnProperty.call(localValues, field.id)
    ) {
      values[field.id] = localValues[field.id]
    }
  }

  return { schema, values }
}

export function buildUIInstructionsFromSchema(
  schema: FormSchema,
  reason: string,
  hotField?: string
): UIInstructions {
  const safeSchema = sanitizeFormSchema(schema)
  const steps = getSchemaSections(safeSchema)
    .map((section) => ({
      title: section.title,
      description: section.description,
      fields: section.fields
        .filter((field) => !isSensitiveField(field))
        .map((field): UIInstructionField => ({
          id: field.id,
          label: field.label || field.id,
          type: INPUT_TYPES.has(field.type as FieldInputType)
            ? field.type as FieldInputType
            : 'text',
          placeholder: field.placeholder,
          helperText: field.helperText,
          required: field.required,
          options: normalizeOptions(field.options),
        })),
    }))
    .filter((step) => step.fields.length > 0)
    .map((step, index) => ({ step: index + 1, ...step }))

  return {
    version: '1.0',
    mode: 'simplified_wizard',
    reason,
    frictionField: hotField && !SENSITIVE_FIELD_ID_PARTS.some(
      (part) => hotField.toLowerCase().replace(/[^a-z0-9]/g, '').includes(part)
    )
      ? hotField
      : undefined,
    steps,
  }
}

/**
 * Flattens the nested form state into values for the local simplified UI.
 * The returned values stay in the browser until an explicit form submission.
 */
export function flattenFormData(formData: FormData): Record<string, string> {
  const flat: Record<string, string> = {}

  for (const section of [
    formData.personal,
    formData.employment,
    formData.loan,
    formData.assets,
  ]) {
    Object.entries(section).forEach(([key, value]) => {
      flat[key] = String(value ?? '')
    })
  }

  Object.entries(formData.additionalFields).forEach(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(flat, key)) {
      flat[key] = value
    }
  })

  flat.fullName = [
    formData.personal.firstName,
    formData.personal.lastName,
  ].filter(Boolean).join(' ')
  flat.agreeToTerms = String(formData.agreeToTerms)
  flat.agreeToCredit = String(formData.agreeToCredit)

  return flat
}

function assignStringField(target: object, key: string, value: string): void {
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    Object.assign(target, { [key]: value })
  }
}

/**
 * Immutably merges simplified-form edits while retaining untouched original
 * fields, including sensitive values that are never part of redesign data.
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
    additionalFields: { ...current.additionalFields },
    agreeToTerms: current.agreeToTerms,
    agreeToCredit: current.agreeToCredit,
  }

  const currentFullName = [
    current.personal.firstName,
    current.personal.lastName,
  ].filter(Boolean).join(' ')
  const updatedFullName = flatUpdates.fullName
  const hasFullNameChange = (
    typeof updatedFullName === 'string' &&
    updatedFullName.trim() !== '' &&
    updatedFullName !== currentFullName
  )
  if (hasFullNameChange && typeof updatedFullName === 'string') {
    const parts = updatedFullName.trim().split(/\s+/)
    next.personal.firstName = parts[0] || ''
    next.personal.lastName = parts.slice(1).join(' ')
  }

  Object.entries(flatUpdates).forEach(([key, value]) => {
    if (value === undefined || key === 'fullName') return
    if (hasFullNameChange && (key === 'firstName' || key === 'lastName')) return

    if (key === 'agreeToTerms' || key === 'agreeToCredit') {
      const checked = value === true || value === 'true'
      if (key === 'agreeToTerms') next.agreeToTerms = checked
      else next.agreeToCredit = checked
      return
    }

    const stringValue = String(value)
    const knownField = [
      next.personal,
      next.employment,
      next.loan,
      next.assets,
    ].some((section) => Object.prototype.hasOwnProperty.call(section, key))

    if (knownField) {
      assignStringField(next.personal, key, stringValue)
      assignStringField(next.employment, key, stringValue)
      assignStringField(next.loan, key, stringValue)
      assignStringField(next.assets, key, stringValue)
    } else {
      next.additionalFields[key] = stringValue
    }
  })

  return next
}

/**
 * The local application schema is complete. A sanitized copy is sent for
 * redesign so sensitive field identifiers and values never leave the browser.
 */
export function buildFormSchema(): FormSchema {
  const stateOptions = [
    ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['CA', 'California'],
    ['CO', 'Colorado'], ['FL', 'Florida'], ['GA', 'Georgia'], ['IL', 'Illinois'],
    ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['NJ', 'New Jersey'],
    ['NY', 'New York'], ['OH', 'Ohio'], ['PA', 'Pennsylvania'],
    ['TX', 'Texas'], ['WA', 'Washington'], ['Other', 'Other'],
  ].map(([value, label]) => ({ value, label }))
  const field = (
    id: string,
    label: string,
    type: string,
    options?: FormSchemaField['options'],
    required = false
  ): FormSchemaField => ({ id, label, type, options, required })

  const sections: FormSchemaSection[] = [
    {
      id: 'personal',
      title: 'Personal Information',
      fields: [
        field('firstName', 'First Name', 'text', undefined, true),
        field('lastName', 'Last Name', 'text', undefined, true),
        field('dateOfBirth', 'Date of Birth', 'date', undefined, true),
        { ...field('ssn', 'Social Security Number', 'password', undefined, true), sensitive: true },
        field('email', 'Email Address', 'email', undefined, true),
        field('phone', 'Phone Number', 'tel', undefined, true),
        field('address', 'Street Address', 'text', undefined, true),
        field('city', 'City', 'text', undefined, true),
        field('state', 'State', 'select', stateOptions, true),
        field('zipCode', 'ZIP Code', 'text', undefined, true),
        field('maritalStatus', 'Marital Status', 'select', [
          ['single', 'Single'], ['married', 'Married'],
          ['divorced', 'Divorced'], ['widowed', 'Widowed'],
        ].map(([value, label]) => ({ value, label }))),
        field('dependents', 'Number of Dependents', 'number'),
      ],
    },
    {
      id: 'employment',
      title: 'Employment & Income',
      fields: [
        field('employmentStatus', 'Employment Status', 'select', [
          ['full-time', 'Full-Time Employed'], ['part-time', 'Part-Time Employed'],
          ['self-employed', 'Self-Employed'], ['unemployed', 'Unemployed'],
          ['retired', 'Retired'], ['student', 'Student'],
        ].map(([value, label]) => ({ value, label })), true),
        field('employerName', 'Employer Name', 'text'),
        field('jobTitle', 'Job Title', 'text'),
        field('yearsEmployed', 'Years at Current Employer', 'number'),
        field('monthlyIncome', 'Gross Monthly Income', 'number', undefined, true),
        field('otherIncome', 'Other Monthly Income', 'number'),
        field('otherIncomeSource', 'Source of Other Income', 'text'),
      ],
    },
    {
      id: 'loan',
      title: 'Loan Details',
      fields: [
        field('loanType', 'Loan Type', 'select', [
          ['personal', 'Personal Loan'], ['home', 'Home Mortgage'],
          ['auto', 'Auto Loan'], ['business', 'Business Loan'],
          ['student', 'Student Loan'], ['refinance', 'Refinance'],
        ].map(([value, label]) => ({ value, label })), true),
        field('loanAmount', 'Loan Amount', 'number', undefined, true),
        field('loanTerm', 'Repayment Term', 'select', [
          '12', '24', '36', '60', '84', '120', '180', '360',
        ].map((value) => ({ value, label: `${value} months` })), true),
        field('collateral', 'Collateral', 'select', [
          ['none', 'None (Unsecured)'], ['property', 'Real Estate / Property'],
          ['vehicle', 'Vehicle'], ['savings', 'Savings Account'],
          ['other', 'Other Assets'],
        ].map(([value, label]) => ({ value, label }))),
        field('collateralValue', 'Estimated Collateral Value', 'number'),
        field('existingDebts', 'Existing Monthly Debt Payments', 'number'),
        field('purpose', 'Purpose of Loan', 'textarea', undefined, true),
      ],
    },
    {
      id: 'assets',
      title: 'Assets & Liabilities',
      fields: [
        field('checkingBalance', 'Checking Account Balance', 'number'),
        field('savingsBalance', 'Savings Account Balance', 'number'),
        field('investmentValue', 'Investment Portfolio Value', 'number'),
        field('propertyValue', 'Real Estate Value', 'number'),
        field('vehicleValue', 'Vehicle Value', 'number'),
        field('creditCardDebt', 'Credit Card Debt', 'number'),
        field('studentLoanDebt', 'Student Loan Balance', 'number'),
        field('mortgageBalance', 'Mortgage Balance', 'number'),
        field('otherLiabilities', 'Other Liabilities', 'number'),
      ],
    },
    {
      id: 'confirmations',
      title: 'Confirmations',
      fields: [
        {
          ...field('agreeToTerms', 'I agree to the terms and conditions', 'checkbox', undefined, true),
          helperText: 'I certify that the information provided is true and agree to the Terms and Conditions and Privacy Policy.',
        },
        {
          ...field('agreeToCredit', 'I authorize a credit check', 'checkbox', undefined, true),
          helperText: 'I authorize a consumer credit report to be obtained in connection with this application.',
        },
      ],
    },
  ]

  const fields = sections.flatMap((section) =>
    section.fields.map((schemaField) => ({
      ...schemaField,
      section: section.id,
    }))
  )

  return {
    formId: 'loan-application-v1',
    title: 'Comprehensive Financial Loan Application',
    sections,
    fields,
  }
}
