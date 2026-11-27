import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000', {
      transports: ['websocket'],
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })
    socket.on('connect',       () => console.info('[AuraGen] Socket connected:', socket?.id))
    socket.on('disconnect', (r) => console.warn('[AuraGen] Socket disconnected:', r))
    socket.on('connect_error', (e) => console.warn('[AuraGen] Socket error:', e.message))
  }
  return socket
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
}
