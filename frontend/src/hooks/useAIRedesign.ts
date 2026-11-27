import { useState, useEffect, useCallback } from 'react'
import { UIInstructions, UIMode, RedesignEventPayload } from '../types/ai.types'
import { FormData } from '../types/form.types'
import { flattenFormData, mergeFlatIntoFormData, buildFormSchema } from '../lib/formDataBridge'
import { getSocket } from '../lib/socket'

interface UseAIRedesignOptions {
  formData: FormData
  setFormData: React.Dispatch<React.SetStateAction<FormData>>
  sessionId?: string
  currentFormSection?: string
}

export function useAIRedesign({
  formData,
  setFormData,
  sessionId = 'session-default',
  currentFormSection = 'personal',
}: UseAIRedesignOptions) {
  const [uiMode, setUiMode] = useState<UIMode>('complex')
  const [instructions, setInstructions] = useState<UIInstructions | null>(null)
  const [isAiOptimizing, setIsAiOptimizing] = useState(false)
  const [redesignNotice, setRedesignNotice] = useState<string | null>(null)

  // Sync flat values back into central form data immutably
  const handleValuesChange = useCallback(
    (flatValues: Record<string, string>) => {
      setFormData((prev) => mergeFlatIntoFormData(prev, flatValues))
    },
    [setFormData]
  )

  // Switch back to the complex full form
  const cancelRedesign = useCallback(() => {
    setUiMode('complex')
    setRedesignNotice('Returned to full multi-section form. All progress preserved.')
    setTimeout(() => setRedesignNotice(null), 4000)
  }, [])

  // Trigger simplified UI with explicit instructions
  const activateSimplifiedUI = useCallback(
    (aiInstructions: UIInstructions) => {
      setInstructions(aiInstructions)
      setUiMode('simplified')
      setRedesignNotice(
        `AI simplified form activated: ${aiInstructions.reason || 'Optimized for focus'}`
      )
      setTimeout(() => setRedesignNotice(null), 5000)
    },
    []
  )

  // Provide realistic simulated AI instructions for offline/mock demo
  const triggerSimulatedRedesign = useCallback(
    (customReason?: string, hotField?: string) => {
      setIsAiOptimizing(true)
      setTimeout(() => {
        const fieldName = hotField || 'financial figures'
        const reason =
          customReason ||
          `Detected hesitation while filling ${fieldName}. Switched to step-by-step guidance.`

        const mockInstructions: UIInstructions = {
          version: '1.0',
          mode: 'simplified_wizard',
          reason,
          frictionField: hotField,
          steps: [
            {
              step: 1,
              title: 'Your Full Legal Name',
              description: 'We need your official identity details to check eligibility.',
              fields: [
                {
                  id: 'fullName',
                  label: 'Legal Full Name',
                  type: 'text',
                  placeholder: 'e.g. Jane Doe',
                  required: true,
                  helperText: 'As it appears on your official documents.',
                },
                {
                  id: 'email',
                  label: 'Email Address',
                  type: 'email',
                  placeholder: 'jane@example.com',
                  required: true,
                  helperText: 'For sending loan approval updates.',
                },
              ],
            },
            {
              step: 2,
              title: 'Monthly Income',
              description: 'Enter your approximate take-home pay each month after tax.',
              fields: [
                {
                  id: 'monthlyIncome',
                  label: 'Monthly Net Income ($)',
                  type: 'number',
                  placeholder: 'e.g. 5000',
                  required: true,
                  helperText: 'Take-home pay after taxes and deductions.',
                },
                {
                  id: 'employmentStatus',
                  label: 'Employment Status',
                  type: 'select',
                  options: [
                    { label: 'Employed Full-Time', value: 'Full-time' },
                    { label: 'Employed Part-Time', value: 'Part-time' },
                    { label: 'Self-Employed / Contractor', value: 'Self-employed' },
                    { label: 'Retired', value: 'Retired' },
                    { label: 'Other', value: 'Other' },
                  ],
                },
              ],
            },
            {
              step: 3,
              title: 'Requested Loan Amount',
              description: 'How much financing would you like to borrow?',
              fields: [
                {
                  id: 'loanAmount',
                  label: 'Loan Amount ($)',
                  type: 'number',
                  placeholder: 'e.g. 20000',
                  required: true,
                  helperText: 'Standard terms from 12 to 60 months.',
                },
                {
                  id: 'purpose',
                  label: 'Loan Purpose',
                  type: 'text',
                  placeholder: 'e.g. Debt Consolidation, Home Improvement',
                  helperText: 'Helps us offer the lowest available interest rates.',
                },
              ],
            },
          ],
        }

        setIsAiOptimizing(false)
        activateSimplifiedUI(mockInstructions)
      }, 400)
    },
    [activateSimplifiedUI]
  )

  // Listen to WebSocket server messages
  useEffect(() => {
    const socket = getSocket()

    // Announce session start
    socket.emit('session:start', {
      sessionId,
      formId: 'loan-application-v1',
      section: currentFormSection,
    })

    // 1. Respond to snapshot requests from AI agent
    const handleSnapshotRequest = (data: { requestId: string; reason?: string }) => {
      const flat = flattenFormData(formData)
      const schema = buildFormSchema()

      socket.emit('snapshot:response', {
        requestId: data.requestId,
        schema,
        values: flat,
      })
    }

    // 2. Handle incoming redesign instructions from AI
    const handleUIRedesign = (payload: RedesignEventPayload) => {
      setIsAiOptimizing(false)
      if (payload?.instructions) {
        activateSimplifiedUI(payload.instructions)
      } else if (payload?.componentCode) {
        triggerSimulatedRedesign(payload?.reason || 'AI agent generated simplified wizard')
      }
    }

    socket.on('snapshot:request', handleSnapshotRequest)
    socket.on('ui:instructions', handleUIRedesign)
    socket.on('redesign:ready', handleUIRedesign)
    socket.on('ai:redesign', handleUIRedesign)

    return () => {
      socket.off('snapshot:request', handleSnapshotRequest)
      socket.off('ui:instructions', handleUIRedesign)
      socket.off('redesign:ready', handleUIRedesign)
      socket.off('ai:redesign', handleUIRedesign)
    }
  }, [formData, sessionId, currentFormSection, activateSimplifiedUI, triggerSimulatedRedesign])

  return {
    uiMode,
    instructions,
    isAiOptimizing,
    redesignNotice,
    flattenedValues: flattenFormData(formData),
    handleValuesChange,
    cancelRedesign,
    activateSimplifiedUI,
    triggerSimulatedRedesign,
  }
}
