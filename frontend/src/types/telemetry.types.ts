export interface TelemetrySnapshot {
  cognitiveLoadScore: number  // 0–100 composite score
  cursorVelocity: number      // px/ms — erratic movement indicator
  hesitationScore: number     // 0–100 — idle-over-field accumulation
  rageClickCount: number      // rapid repeated clicks in a window
  errorRetryCount: number     // invalid-field blur retries
  activeField: string | null  // currently focused field key
  sessionDuration: number     // ms since session start
}

export interface FrictionPayload {
  sessionId: string
  snapshot: TelemetrySnapshot
  formSection: string
  timestamp: number
}
