import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type {
  UIInstructions,
  UIMode,
  RedesignEventPayload,
} from '../types/ai.types'
import type { FormData } from '../types/form.types'
import {
  flattenFormData,
  mergeFlatIntoFormData,
  buildFormSchema,
  buildSafeSnapshot,
  buildUIInstructionsFromSchema,
  type FormSchema,
} from '../lib/formDataBridge'
import { getSocket } from '../lib/socket'

interface UseAIRedesignOptions {
  formData: FormData
  setFormData: React.Dispatch<React.SetStateAction<FormData>>
  formSchema?: FormSchema
  sessionId?: string
  currentFormSection?: string
}

function createSchemaInstructions(
  schema: FormSchema,
  reason: string,
  hotField?: string
) {
  return buildUIInstructionsFromSchema(schema, reason, hotField)
}

export function useAIRedesign({
  formData,
  setFormData,
  formSchema,
  sessionId = 'session-default',
  currentFormSection = 'personal',
}: UseAIRedesignOptions) {
  const activeFormSchema = useMemo(
    () => formSchema ?? buildFormSchema(),
    [formSchema]
  )
  const [uiMode, setUiMode] = useState<UIMode>('complex')
  const [instructions, setInstructions] = useState<UIInstructions | null>(null)
  const [isAiOptimizing, setIsAiOptimizing] = useState(false)
  const [redesignNotice, setRedesignNotice] = useState<string | null>(null)

  const formDataRef = useRef(formData)
  const sectionRef = useRef(currentFormSection)
  const startedSessionRef = useRef<string | null>(null)
  const hotFieldRef = useRef<string | undefined>()
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const simulationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  formDataRef.current = formData
  sectionRef.current = currentFormSection

  const showNotice = useCallback((notice: string, duration: number) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    setRedesignNotice(notice)
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null
      setRedesignNotice(null)
    }, duration)
  }, [])

  const handleValuesChange = useCallback(
    (flatValues: Record<string, string>) => {
      setFormData((previous) => mergeFlatIntoFormData(previous, flatValues))
    },
    [setFormData]
  )

  const cancelRedesign = useCallback(() => {
    if (simulationTimerRef.current) {
      clearTimeout(simulationTimerRef.current)
      simulationTimerRef.current = null
    }
    setUiMode('complex')
    showNotice(
      'Returned to full multi-section form. All progress preserved.',
      4000
    )
  }, [showNotice])

  const activateSimplifiedUI = useCallback((nextInstructions: UIInstructions) => {
    if (simulationTimerRef.current) {
      clearTimeout(simulationTimerRef.current)
      simulationTimerRef.current = null
    }
    setInstructions(nextInstructions)
    setUiMode('simplified')
    showNotice(
      `AI simplified form activated: ${nextInstructions.reason || 'Optimized for focus'}`,
      5000
    )
  }, [showNotice])

  const triggerSimulatedRedesign = useCallback(
    (customReason?: string, hotField?: string) => {
      setIsAiOptimizing(true)

      if (simulationTimerRef.current) clearTimeout(simulationTimerRef.current)
      simulationTimerRef.current = setTimeout(() => {
        simulationTimerRef.current = null
        const reason = customReason ||
          `Detected hesitation while filling ${hotField || 'your application'}. Switched to step-by-step guidance.`
        setIsAiOptimizing(false)
        activateSimplifiedUI(
          createSchemaInstructions(activeFormSchema, reason, hotField)
        )
      }, 400)
    },
    [activateSimplifiedUI, activeFormSchema]
  )

  useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    if (simulationTimerRef.current) clearTimeout(simulationTimerRef.current)
  }, [])

  useEffect(() => {
    const socket = getSocket()

    const startSession = () => {
      if (startedSessionRef.current === sessionId) return

      const sent = socket.emit('session:start', {
        formId: activeFormSchema.formId || 'form',
        section: sectionRef.current,
      })
      if (sent) startedSessionRef.current = sessionId
    }

    const handleSnapshotRequest = (data: { requestId?: string }) => {
      if (typeof data?.requestId !== 'string' || !data.requestId) return
      const snapshot = buildSafeSnapshot(formDataRef.current, activeFormSchema)
      const sent = socket.emit('snapshot:response', {
        requestId: data.requestId,
        ...snapshot,
      })
      if (!sent) {
        setIsAiOptimizing(false)
        showNotice(
          'The snapshot could not be sent because the backend connection was lost.',
          5000
        )
      }
    }

    const handleRedesignStarted = (payload: RedesignEventPayload) => {
      setIsAiOptimizing(true)
      hotFieldRef.current = payload?.friction?.field || undefined
    }

    const handleRedesignReady = (payload: RedesignEventPayload) => {
      if (simulationTimerRef.current) {
        clearTimeout(simulationTimerRef.current)
        simulationTimerRef.current = null
      }
      setIsAiOptimizing(false)

      const hasCompiledResult =
        typeof payload?.code === 'string' &&
        payload.code.length > 0 &&
        typeof payload.componentId === 'string'
      const hasStructuredResult = Boolean(payload?.instructions)
      if (!hasCompiledResult && !hasStructuredResult) return

      // The server's compiled code is never evaluated in the browser. The
      // local form schema is converted into plain, data-only UI instructions.
      const reason = payload.reason ||
        'Sustained friction detected. Your form has been reorganized into guided steps.'
      activateSimplifiedUI(
        createSchemaInstructions(
          activeFormSchema,
          reason,
          payload.friction?.field || hotFieldRef.current
        )
      )
    }

    const handleRedesignFailed = (payload: { reason?: string }) => {
      setIsAiOptimizing(false)
      showNotice(
        `Redesign unavailable (${payload?.reason || 'unknown error'}). Your form data is unchanged.`,
        5000
      )
    }

    const handleConnect = () => startSession()
    const handleDisconnect = () => {
      if (simulationTimerRef.current) {
        clearTimeout(simulationTimerRef.current)
        simulationTimerRef.current = null
      }
      startedSessionRef.current = null
      setIsAiOptimizing(false)
    }

    socket.on('snapshot:request', handleSnapshotRequest)
    socket.on('redesign:started', handleRedesignStarted)
    socket.on('redesign:ready', handleRedesignReady)
    socket.on('redesign:failed', handleRedesignFailed)
    socket.on('ui:instructions', handleRedesignReady)
    socket.on('ai:redesign', handleRedesignReady)
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)

    if (socket.connected) startSession()

    return () => {
      socket.off('snapshot:request', handleSnapshotRequest)
      socket.off('redesign:started', handleRedesignStarted)
      socket.off('redesign:ready', handleRedesignReady)
      socket.off('redesign:failed', handleRedesignFailed)
      socket.off('ui:instructions', handleRedesignReady)
      socket.off('ai:redesign', handleRedesignReady)
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
    }
  }, [sessionId, activeFormSchema, activateSimplifiedUI, showNotice])

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
