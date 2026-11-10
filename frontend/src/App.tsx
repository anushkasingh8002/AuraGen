// Commit 3 App — form state wired up, no AI features yet
import { useFormState } from './hooks/useFormState'
import LoanApplicationForm from './components/form/LoanApplicationForm'

function App() {
  const formState = useFormState()

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-aura-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-aura-500 to-aura-700 flex items-center justify-center shadow-sm">
              <span className="text-white text-sm font-bold">A</span>
            </div>
            <div>
              <span className="font-semibold text-slate-800 text-lg">Infotact Portal</span>
              <span className="text-xs text-slate-400 ml-2">Financial Services</span>
            </div>
          </div>
          <span className="text-xs font-medium text-aura-600 bg-aura-50 border border-aura-200 rounded-full px-3 py-1">
            ✨ AuraGen Enabled
          </span>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8">
        <LoanApplicationForm {...formState} />
      </main>
    </div>
  )
}

export default App
