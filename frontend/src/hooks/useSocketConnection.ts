
import { useEffect, useState, useCallback } from 'react'
import { getSocket, Socket } from '../lib/socket'

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export function useSocketConnection() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [socket, setSocket] = useState<Socket | null>(null)

  useEffect(() => {
    const s = getSocket()
    setSocket(s)

    if (s.connected) setStatus('connected')

    const onConnect = () => setStatus('connected')
    const onDisconnect = () => setStatus('disconnected')
    const onError = () => setStatus('error')

    s.on('connect', onConnect)
    s.on('disconnect', onDisconnect)
    s.on('connect_error', onError)

    return () => {
      s.off('connect', onConnect)
      s.off('disconnect', onDisconnect)
      s.off('connect_error', onError)
    }
  }, [])

  const emit = useCallback(
    (event: string, data: unknown) => {
      return socket?.emit(event, data) ?? false
    },
    [socket]
  )

  const on = useCallback(
    <T,>(event: string, callback: (data: T) => void) => {
      const handler = (data: unknown) => callback(data as T)

      socket?.on(event, handler)

      return () => {
        socket?.off(event, handler)
      }
    },
    [socket]
  )

  return { status, socket, emit, on }
}
