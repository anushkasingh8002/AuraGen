export type FieldInputType =
  | 'text'
  | 'number'
  | 'email'
  | 'tel'
  | 'date'
  | 'time'
  | 'url'
  | 'password'
  | 'checkbox'
  | 'textarea'
  | 'select'

export interface UIInstructionField {
  id: string
  label: string
  type: FieldInputType
  placeholder?: string
  helperText?: string
  required?: boolean
  options?: Array<{ label: string; value: string }>
}

export interface UIInstructionStep {
  step: number
  title: string
  description?: string
  fields: UIInstructionField[]
}

export interface UIInstructions {
  version: string
  mode: 'simplified_wizard' | 'adaptive_focus'
  reason: string
  frictionField?: string
  cognitiveLoadScore?: number
  steps: UIInstructionStep[]
  suggestedDefaults?: Record<string, string>
}

export type UIMode = 'complex' | 'simplified'

export interface RedesignEventPayload {
  requestId?: string
  instructions?: UIInstructions
  componentId?: string
  code?: string
  componentCode?: string
  reason?: string
  score?: number
  friction?: { field?: string | null; score?: number }
}
