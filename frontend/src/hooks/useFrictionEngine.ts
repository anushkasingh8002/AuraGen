
import { useEffect, useRef, useCallback, useState } from 'react'
import { TelemetrySnapshot } from '../types/telemetry.types'
import { getSocket } from '../lib/socket'

const EMIT_INTERVAL_MS = 500
const MOUSE_SAMPLE_INTERVAL_MS = 100
const RAGE_CLICK_WINDOW_MS = 600
const RAGE_CLICK_THRESHOLD = 3

const MAX_QUEUED_EVENTS = 1000
const MAX_BATCH_SIZE = 200
const SENSITIVE_FIELD_ID_PARTS = [
  'ssn', 'socialsecurity', 'password', 'account', 'card', 'cvv',
  'otp', 'passport', 'license', 'routing', 'iban', 'pin', 'secret',
]

type TelemetryEvent = {
  k: 'move' | 'click' | 'error' | 'focus' | 'blur' | 'input'
  v?: number
  t: number
  f?: string
  rage?: boolean
  inert?: boolean
}

interface Options {
  sessionId: string
  formSection: string
  enabled?: boolean
}

function getFieldId(target: EventTarget | null): string | undefined {
  if (!(target instanceof HTMLElement)) return undefined

  const field = target.closest(
    'input, select, textarea, button, [role="button"]'
  ) as HTMLElement | null

  if (!field) return undefined

  const id = field.getAttribute('name') || field.id

  // Send field identifiers only, never field values.
  if (!id || id.length > 100) return undefined

  const normalizedId = id.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (SENSITIVE_FIELD_ID_PARTS.some((part) => normalizedId.includes(part))) {
    return undefined
  }

  return id
}

export function useFrictionEngine({
  sessionId,
  formSection,
  enabled = true,
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

  const eventQueue = useRef<TelemetryEvent[]>([])
  const mouseHistory = useRef<{ x: number; y: number; ts: number }[]>([])
  const clickTimestamps = useRef<number[]>([])
  const activeField = useRef<string | null>(null)
  const rageClicks = useRef(0)
  const errorRetries = useRef(0)
  const lastMouseSample = useRef(0)
  const lastMousePosition = useRef<{ x: number; y: number; ts: number } | null>(
    null
  )
  const lastInputAt = useRef(Date.now())
  const sessionStart = useRef(Date.now())
  const lastServerScore = useRef(0)


  // Add a raw event to the bounded queue.
  const queueEvent = useCallback((event: TelemetryEvent) => {
    eventQueue.current.push(event)

    if (eventQueue.current.length > MAX_QUEUED_EVENTS) {
      eventQueue.current.splice(
        0,
        eventQueue.current.length - MAX_QUEUED_EVENTS
      )
    }
  }, [])

  useEffect(() => {
    if (!enabled) return

    const socket = getSocket()
    sessionStart.current = Date.now()

    // The backend associates telemetry with the current WebSocket session.
    // sessionId and formSection are intentionally not sent in the event batch.
    void sessionId
    void formSection

    const handleMouseMove = (event: MouseEvent) => {
      const now = Date.now()

      if (now - lastMouseSample.current < MOUSE_SAMPLE_INTERVAL_MS) return

      lastMouseSample.current = now

      const previous = lastMousePosition.current

      if (previous) {
        const dt = now - previous.ts

        if (dt > 0) {
          const distance = Math.sqrt(
            (event.clientX - previous.x) ** 2 +
            (event.clientY - previous.y) ** 2
          )

          const velocity = distance / dt

          mouseHistory.current.push({
            x: event.clientX,
            y: event.clientY,
            ts: now,
          })

          queueEvent({
            k: 'move',
            v: Number(velocity.toFixed(3)),
            t: now,
          })
        }
      }

      lastMousePosition.current = {
        x: event.clientX,
        y: event.clientY,
        ts: now,
      }
    }

    const handleClick = (event: MouseEvent) => {
      const now = Date.now()
      const target = event.target as HTMLElement | null
      const field = getFieldId(target)

      clickTimestamps.current.push(now)
      clickTimestamps.current = clickTimestamps.current.filter(
        (timestamp) => now - timestamp <= RAGE_CLICK_WINDOW_MS
      )

      let isRageClick = false

      if (clickTimestamps.current.length >= RAGE_CLICK_THRESHOLD) {
        isRageClick = true
        rageClicks.current += 1
        clickTimestamps.current = []
      }

      const inertElement = target?.closest(
        '[disabled], [aria-disabled="true"]'
      )

      queueEvent({
        k: 'click',
        t: now,
        f: field,
        rage: isRageClick,
        inert: Boolean(inertElement),
      })
    }

    const handleFocus = (event: FocusEvent) => {
      const now = Date.now()
      const field = getFieldId(event.target)

      activeField.current = field || null
      lastInputAt.current = now

      queueEvent({
        k: 'focus',
        t: now,
        f: field,
      })
    }

    const handleBlur = (event: FocusEvent) => {
      const now = Date.now()
      const target = event.target as HTMLInputElement
      const field = getFieldId(event.target)

      if (target.validity && !target.validity.valid) {
        errorRetries.current += 1

        queueEvent({
          k: 'error',
          t: now,
          f: field,
        })
      }

      queueEvent({
        k: 'blur',
        t: now,
        f: field,
      })

      activeField.current = null
    }

    const handleInput = (event: Event) => {
      const now = Date.now()
      const field = getFieldId(event.target)

      lastInputAt.current = now

      // Never transmit the actual input value.
      queueEvent({
        k: 'input',
        t: now,
        f: field,
      })
    }

    // Backend is the source of truth for cognitive-load score.
    const handleScoreUpdate = (payload: {
      score?: number
      parts?: { V?: number; H?: number; R?: number; E?: number }
    }) => {
      if (
        typeof payload?.score !== 'number' ||
        !Number.isFinite(payload.score)
      ) {
        return
      }

      const score = Math.max(0, Math.min(100, payload.score))

      setSnapshot((previous) => {
        const updated: TelemetrySnapshot = {
          ...previous,
          cognitiveLoadScore: score,
          cursorVelocity: previous.cursorVelocity,
          hesitationScore: Math.round((payload.parts?.H ?? 0) * 100),
        }

        // Trigger only when the server score crosses the high-load threshold.

        return updated
      })

      // Allow another high-load notification after the score recovers.
      if (score < 60) {
        lastServerScore.current = 0
      } else {
        lastServerScore.current = score
      }
    }

    // Send queued events in backend-compatible batches.
    const flushEvents = () => {
      if (!socket.connected) return

      const batch = eventQueue.current.slice(0, MAX_BATCH_SIZE)
      if (socket.emit('telemetry:batch', batch)) {
        eventQueue.current.splice(0, batch.length)
      }
    }

    const updateLocalSnapshot = () => {
      const now = Date.now()
      const previous = lastMousePosition.current

      const velocity = previous
        ? Math.max(0, Number(
            (
             Math.sqrt(
  (previous.x - (mouseHistory.current[mouseHistory.current.length - 1]?.x ?? previous.x)) ** 2 +
  (previous.y - (mouseHistory.current[mouseHistory.current.length - 1]?.y ?? previous.y)) ** 2
) / Math.max(now - previous.ts, 1)
).toFixed(3)
))
: 0

      const idleDuration = activeField.current
        ? Math.min(now - lastInputAt.current, 15000)
        : 0

      setSnapshot((previousSnapshot) => ({
        ...previousSnapshot,
        cursorVelocity: velocity,
        hesitationScore: Math.round((idleDuration / 15000) * 100),
        rageClickCount: rageClicks.current,
        errorRetryCount: errorRetries.current,
        activeField: activeField.current,
        sessionDuration: now - sessionStart.current,
      }))
    }

    // Register listeners.
    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('click', handleClick)
    document.addEventListener('focusin', handleFocus)
    document.addEventListener('focusout', handleBlur)
    document.addEventListener('input', handleInput)

    socket.on('score:update', handleScoreUpdate)

    const emitTimer = setInterval(() => {
      flushEvents()
      updateLocalSnapshot()
    }, EMIT_INTERVAL_MS)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('click', handleClick)
      document.removeEventListener('focusin', handleFocus)
      document.removeEventListener('focusout', handleBlur)
      document.removeEventListener('input', handleInput)

      socket.off('score:update', handleScoreUpdate)

      clearInterval(emitTimer)
    }
  }, [enabled, queueEvent, sessionId, formSection])

  const reset = useCallback(() => {
    eventQueue.current = []
    mouseHistory.current = []
    clickTimestamps.current = []
    activeField.current = null
    rageClicks.current = 0
    errorRetries.current = 0
    lastServerScore.current = 0
    lastInputAt.current = Date.now()
    sessionStart.current = Date.now()
    lastMousePosition.current = null

    setSnapshot({
      cognitiveLoadScore: 0,
      cursorVelocity: 0,
      hesitationScore: 0,
      rageClickCount: 0,
      errorRetryCount: 0,
      activeField: null,
      sessionDuration: 0,
    })
  }, [])

  return { snapshot, reset }
}
