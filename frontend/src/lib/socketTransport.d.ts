export interface SocketTransport {
  readyState: number
  send(data: string): void
}

export function sendEnvelope(
  socket: SocketTransport | null,
  type: string,
  payload: unknown,
  openState: number
): boolean

export function reconnectDelay(attempt: number): number
