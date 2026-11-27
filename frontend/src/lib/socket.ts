
import { reconnectDelay, sendEnvelope } from './socketTransport.js'

export type Socket = {
  connected: boolean
  on(event: string, callback: (...args: any[]) => void): Socket
  off(event: string, callback: (...args: any[]) => void): Socket
  emit(event: string, data?: unknown): boolean
  disconnect(): void
}

type MessageEnvelope = {
  type: string
  sessionId?: string
  payload?: unknown
}

class AuraWebSocket implements Socket {
  connected = false

  private ws: WebSocket | null = null
  private listeners = new Map<string, Set<(...args: any[]) => void>>()
  private manuallyClosed = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private readonly url = (
    import.meta.env.VITE_WS_URL ||
    import.meta.env.VITE_SOCKET_URL ||
    'ws://localhost:4000'
  ).replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')

  constructor() {
    this.connect()
  }

  private notify(event: string, ...args: any[]) {
    this.listeners.get(event)?.forEach((callback) => callback(...args))
  }

  private connect() {
    if (this.manuallyClosed) return

    try {
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        this.connected = true
        this.reconnectAttempts = 0
        console.info('[AuraGen] WebSocket connected')
        this.notify('connect')
      }

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data) as MessageEnvelope

          if (typeof message.type === 'string') {
            this.notify(message.type, message.payload ?? {})
            this.notify('message', message)
          }
        } catch {
          console.warn('[AuraGen] Invalid WebSocket message')
        }
      }

      this.ws.onerror = () => {
        this.notify('connect_error', new Error('WebSocket connection error'))
      }

      this.ws.onclose = (event: CloseEvent) => {
        this.connected = false
        this.notify('disconnect', event.reason || 'Connection closed')

        if (!this.manuallyClosed) {
          this.scheduleReconnect()
        }
      }
    } catch (error) {
      this.notify('connect_error', error)
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    if (this.manuallyClosed || this.reconnectTimer !== null) return

    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, reconnectDelay(this.reconnectAttempts))
  }

  on(event: string, callback: (...args: any[]) => void): Socket {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }

    this.listeners.get(event)!.add(callback)
    return this
  }

  off(event: string, callback: (...args: any[]) => void): Socket {
    this.listeners.get(event)?.delete(callback)
    return this
  }

  emit(event: string, data: unknown = {}): boolean {
    return sendEnvelope(this.ws, event, data, WebSocket.OPEN)
  }

  disconnect() {
    this.manuallyClosed = true
    this.connected = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.ws?.close()
    this.ws = null
  }
}

let socket: AuraWebSocket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = new AuraWebSocket()
  }

  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}
