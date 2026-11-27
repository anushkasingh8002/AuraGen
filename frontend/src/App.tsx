import { useEffect, useRef, useState } from 'react'
import { useFormState } from './hooks/useFormState'
import { useFrictionEngine } from './hooks/useFrictionEngine'
import { useAIRedesign } from './hooks/useAIRedesign'
import LoanApplicationForm from './components/form/LoanApplicationForm'
import DynamicUIInstructionRenderer from './components/form/DynamicUIInstructionRenderer'
import CognitiveLoadIndicator from './components/debug/CognitiveLoadIndicator'
import { useSocketConnection } from './hooks/useSocketConnection'
import { mergeFlatIntoFormData } from './lib/formDataBridge'

const SECTION_NAMES: Record<number, string> = {
  1: 'personal',
  2: 'employment',
  3: 'loan',
  4: 'assets',
  5: 'review',
}

function App() {
  const formState = useFormState()
  const { formData, setFormData, currentStep } = formState
  const { status: socketStatus, socket, emit } = useSocketConnection()
  const [showDebug, setShowDebug] = useState(true)
  const [submissionStatus, setSubmissionStatus] = useState('')
  const submissionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!socket) return

    const handleSubmitAck = (payload: { ok?: boolean }) => {
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current)
        submissionTimeoutRef.current = null
      }
      setSubmissionStatus(
        payload?.ok === true
          ? 'Application received by the demo backend. No data is persisted.'
          : 'The backend did not confirm the application.'
      )
    }

    socket.on('submit:ack', handleSubmitAck)
    return () => {
      socket.off('submit:ack', handleSubmitAck)
      if (submissionTimeoutRef.current) {
        clearTimeout(submissionTimeoutRef.current)
        submissionTimeoutRef.current = null
      }
    }
  }, [socket])

  // Current active section name for telemetry
  const activeSection = SECTION_NAMES[currentStep] || 'general'

  // AI Redesign & Data Bridge hook
  const {
    uiMode,
    instructions,
    isAiOptimizing,
    redesignNotice,
    flattenedValues,
    handleValuesChange,
    cancelRedesign,
    triggerSimulatedRedesign,
  } = useAIRedesign({
    formData,
    setFormData,
    sessionId: 'session-live',
    currentFormSection: activeSection,
  })

  // Friction Engine Telemetry hook
 const { snapshot } = useFrictionEngine({
  sessionId: 'session-live',
  formSection: activeSection,
  enabled: uiMode === 'complex',
})

  const handleSubmit = (finalValues?: Record<string, string>) => {
    const completeFormData = finalValues
      ? mergeFlatIntoFormData(formData, finalValues)
      : formData

    if (finalValues) {
      setFormData(completeFormData)
    }

    if (socketStatus !== 'connected' || !socket?.connected) {
      setSubmissionStatus('Cannot submit while the backend connection is unavailable.')
      return
    }

    setSubmissionStatus('Submitting application…')
    if (!emit('wizard:submit', completeFormData)) {
      setSubmissionStatus('The application could not be sent because the connection was lost.')
      return
    }

    if (submissionTimeoutRef.current) clearTimeout(submissionTimeoutRef.current)
    submissionTimeoutRef.current = setTimeout(() => {
      submissionTimeoutRef.current = null
      setSubmissionStatus(
        'No submission confirmation was received. The backend may have received the application; verify before retrying.'
      )
    }, 10000)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-aura-50 text-slate-800">
      {/* Top Navigation Bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-aura-500 to-aura-700 flex items-center justify-center shadow-md">
              <span className="text-white text-base font-bold">A</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-lg tracking-tight">Infotact Portal</span>
                <span className="text-[10px] font-semibold bg-aura-100 text-aura-800 px-2 py-0.5 rounded-full">
                  v1.0
                </span>
              </div>
              <p className="text-xs text-slate-400">Self-Healing Financial Services</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Quick action button to trigger AI simplification demo */}
            {uiMode === 'complex' ? (
              <button
                type="button"
                onClick={() => triggerSimulatedRedesign()}
                disabled={isAiOptimizing}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-aura-50 text-aura-700 border border-aura-200 hover:bg-aura-100 transition-colors shadow-2xs"
                title="Simulate receiving AI UI instructions to simplify the form"
              >
                <span>✨</span>
                <span>{isAiOptimizing ? 'Optimizing...' : 'Simulate AI Redesign'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={cancelRedesign}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
              >
                <span>←</span>
                <span>View Full Form</span>
              </button>
            )}

            {/* Toggle Debug Overlay */}
            <button
              type="button"
              onClick={() => setShowDebug((prev) => !prev)}
              className="text-xs px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {showDebug ? 'Hide Debug' : 'Show Debug'}
            </button>

            <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  socketStatus === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
                }`}
              />
              Socket: {socketStatus}
            </span>
          </div>
        </div>
      </header>

      {/* Redesign Notification Toast */}
      {redesignNotice && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="bg-aura-600 text-white px-4 py-3 rounded-xl shadow-lg flex items-center justify-between text-sm animate-slideDown">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <span>{redesignNotice}</span>
            </div>
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded text-white font-medium">
              Data Preserved 100%
            </span>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {submissionStatus && (
          <p className="mb-4 text-sm text-slate-600" role="status" aria-live="polite">
            {submissionStatus}
          </p>
        )}
        {uiMode === 'simplified' ? (
          instructions ? (
            <DynamicUIInstructionRenderer
              instructions={instructions}
              initialValues={flattenedValues}
              onChange={handleValuesChange}
              onSubmit={handleSubmit}
              onCancel={cancelRedesign}
            />
          ) : (
            <p className="text-center text-slate-500" role="status">
              Preparing the simplified form…
            </p>
          )
        ) : (
          <LoanApplicationForm {...formState} onSubmit={() => handleSubmit()} />
        )}
      </main>

      {/* Dev telemetry HUD / indicator */}
      <CognitiveLoadIndicator snapshot={snapshot} visible={showDebug} />
    </div>
  )
}

export default App
