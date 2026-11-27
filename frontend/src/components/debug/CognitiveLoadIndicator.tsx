import clsx from 'clsx'
import { TelemetrySnapshot } from '../../types/telemetry.types'
import { useSocketConnection } from '../../hooks/useSocketConnection'

interface Props {
  snapshot: TelemetrySnapshot
  visible?: boolean
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
      <div
        className={clsx('h-full rounded-full transition-all duration-300', color)}
        style={{ width: `${Math.min(value, 100)}%` }}
      />
    </div>
  )
}

export default function CognitiveLoadIndicator({ snapshot, visible = true }: Props) {
  const { status } = useSocketConnection()
  if (!visible) return null

  const score = snapshot.cognitiveLoadScore
  const level = score < 40 ? 'Low' : score < 65 ? 'Medium' : 'High ⚠️'
  const scoreColor =
    score < 40 ? 'text-emerald-600' : score < 65 ? 'text-amber-600' : 'text-red-600'
  const barColor =
    score < 40 ? 'bg-emerald-400' : score < 65 ? 'bg-amber-400' : 'bg-red-500'

  return (
    <div className="fixed bottom-4 right-4 w-72 bg-white rounded-2xl shadow-xl border border-slate-200 p-4 z-50 text-xs pointer-events-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <span className="font-bold text-slate-500 uppercase tracking-wide">AuraGen Debug</span>
        <div
          className={clsx(
            'w-2 h-2 rounded-full',
            status === 'connected' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-300'
          )}
          title={`Socket: ${status}`}
        />
      </div>

      {/* Score */}
      <div className="mb-3">
        <div className="flex justify-between mb-1">
          <span className="text-slate-500">Cognitive Load Score</span>
          <span className={clsx('font-bold', scoreColor)}>{score} · {level}</span>
        </div>
        <Bar value={score} color={barColor} />
      </div>

      {/* Signal grid */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Velocity',    value: `${snapshot.cursorVelocity.toFixed(2)} px/ms` },
          { label: 'Hesitation',  value: snapshot.hesitationScore },
          { label: 'Rage Clicks', value: Math.round(snapshot.rageClickCount) },
          { label: 'Retries',     value: snapshot.errorRetryCount },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-50 rounded-lg p-2">
            <div className="text-slate-400">{label}</div>
            <div className="font-semibold text-slate-700 mt-0.5">{value}</div>
          </div>
        ))}
      </div>

      {snapshot.activeField && (
        <div className="mt-2 text-slate-400">
          Field: <span className="font-medium text-aura-600">{snapshot.activeField}</span>
        </div>
      )}
    </div>
  )
}
