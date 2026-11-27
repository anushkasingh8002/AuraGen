import { useEffect, useRef, useCallback, useState } from 'react'
import { TelemetrySnapshot, FrictionPayload } from '../types/telemetry.types'
import { getSocket } from '../lib/socket'

// ── Constants ────────────────────────────────────────────────────────────────
const EMIT_INTERVAL_MS      = 500   // how often we sample & emit
const RAGE_CLICK_WINDOW_MS  = 600   // window to detect rage clicks
const RAGE_CLICK_THRESHOLD  = 3     // clicks in window = rage
const HIGH_LOAD_THRESHOLD   = 65    // score that triggers AI morph
const MOUSE_HISTORY_WINDOW  = 300   // ms of cursor history to keep

interface Options {
  sessionId: string
  formSection: string
  enabled?: boolean
  onHighCognitiveLoad?: (snap: TelemetrySnapshot) => void
}

export function useFrictionEngine({
  sessionId,
  formSection,
  enabled = true,
  onHighCognitiveLoad,
}: Options) {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>({
    cognitiveLoadScore: 0,
    cursorVelocity: 0,
    hesitationScore: 0,
    rageClickCount: 0,
    errorRetryCount: 0,
    activeField: null,
    sessionDuration: 0,
  })

  // Mutable refs — no re-render on change
  const mouseHistory    = useRef<{ x: number; y: number; ts: number }[]>([])
  const clickTimestamps = useRef<number[]>([])
  const hesitationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hesitation      = useRef(0)
  const rageClicks      = useRef(0)
  const errorRetries    = useRef(0)
  const activeField     = useRef<string | null>(null)
  const sessionStart    = useRef(Date.now())
  const emitTimer       = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastScore       = useRef(0)

  // ── Signal collectors ───────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: MouseEvent) => {
    const now = Date.now()
    mouseHistory.current.push({ x: e.clientX, y: e.clientY, ts: now })
    mouseHistory.current = mouseHistory.current.filter((p) => now - p.ts < MOUSE_HISTORY_WINDOW)

    // Reset hesitation decay timer on movement
    if (hesitationTimer.current) clearTimeout(hesitationTimer.current)
    hesitationTimer.current = setTimeout(() => {
      // Cursor stopped — accumulate hesitation
      hesitation.current = Math.min(hesitation.current + 15, 100)
    }, 1500)
  }, [])

  const handleClick = useCallback(() => {
    const now = Date.now()
    clickTimestamps.current.push(now)
    clickTimestamps.current = clickTimestamps.current.filter(
      (t) => now - t < RAGE_CLICK_WINDOW_MS
    )
    if (clickTimestamps.current.length >= RAGE_CLICK_THRESHOLD) {
      rageClicks.current += 1
      clickTimestamps.current = []
    }
  }, [])

  const handleFocus = useCallback((e: FocusEvent) => {
    const target = e.target as HTMLElement
    activeField.current =
      target.getAttribute('name') || target.getAttribute('id') || 'field'
  }, [])

  const handleBlur = useCallback((e: FocusEvent) => {
    const target = e.target as HTMLInputElement
    if (target.validity && !target.validity.valid) {
      errorRetries.current += 1
    }
    activeField.current = null
  }, [])

  // ── Cognitive Load Score formula ────────────────────────────────────────────
  // velocity_factor:    erratic/high px speed → up to 40 pts
  // hesitation_factor:  idle accumulation → up to 30 pts
  // rage_click_factor:  rage bursts → 25 pts each, capped 40
  // retry_factor:       invalid field retries → 10 pts each, capped 20

  const computeScore = useCallback((): number => {
    const h = mouseHistory.current
    let velocity = 0
    if (h.length >= 2) {
      const a = h[0], b = h[h.length - 1]
      const dt = b.ts - a.ts
      if (dt > 0) {
        velocity = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / dt
      }
    }

    const velocityFactor   = velocity > 2 ? Math.min((velocity - 2) * 10, 40) : velocity < 0.1 ? 20 : 0
    const hesitationFactor = Math.min(hesitation.current * 0.3, 30)
    const rageFactor       = Math.min(rageClicks.current * 25, 40)
    const retryFactor      = Math.min(errorRetries.current * 10, 20)

    return Math.min(Math.round(velocityFactor + hesitationFactor + rageFactor + retryFactor), 100)
  }, [])

  // ── Emit loop ───────────────────────────────────────────────────────────────
  const emitSnapshot = useCallback(() => {
    const h = mouseHistory.current
    let velocity = 0
    if (h.length >= 2) {
      const a = h[0], b = h[h.length - 1]
      const dt = b.ts - a.ts
      if (dt > 0) velocity = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2) / dt
    }

    const score = computeScore()
    const snap: TelemetrySnapshot = {
      cognitiveLoadScore: score,
      cursorVelocity:     parseFloat(velocity.toFixed(3)),
      hesitationScore:    Math.round(hesitation.current),
      rageClickCount:     Math.round(rageClicks.current),
      errorRetryCount:    errorRetries.current,
      activeField:        activeField.current,
      sessionDuration:    Date.now() - sessionStart.current,
    }

    setSnapshot(snap)

    // Delta-gate: only emit if score changed ≥5 or is high
    if (Math.abs(score - lastScore.current) >= 5 || score >= HIGH_LOAD_THRESHOLD) {
      const payload: FrictionPayload = {
        sessionId,
        snapshot: snap,
        formSection,
        timestamp: Date.now(),
      }
      try { getSocket().emit('telemetry:friction', payload) } catch { /* not connected yet */ }
      lastScore.current = score

      if (score >= HIGH_LOAD_THRESHOLD) onHighCognitiveLoad?.(snap)
    }

    // Decay signals over time
    hesitation.current  = Math.max(0, hesitation.current - 2)
    rageClicks.current  = Math.max(0, rageClicks.current - 0.1)
  }, [computeScore, sessionId, formSection, onHighCognitiveLoad])

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return
    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('click',    handleClick)
    document.addEventListener('focusin',  handleFocus)
    document.addEventListener('focusout', handleBlur)
    emitTimer.current = setInterval(emitSnapshot, EMIT_INTERVAL_MS)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('click',    handleClick)
      document.removeEventListener('focusin',  handleFocus)
      document.removeEventListener('focusout', handleBlur)
      if (emitTimer.current)   clearInterval(emitTimer.current)
      if (hesitationTimer.current) clearTimeout(hesitationTimer.current)
    }
  }, [enabled, handleMouseMove, handleClick, handleFocus, handleBlur, emitSnapshot])

  const reset = useCallback(() => {
    hesitation.current = 0
    rageClicks.current = 0
    errorRetries.current = 0
    lastScore.current = 0
    mouseHistory.current = []
    clickTimestamps.current = []
  }, [])

  return { snapshot, reset }
}
