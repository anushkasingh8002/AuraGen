export function sendEnvelope(socket, type, payload, openState) {
  if (!socket || socket.readyState !== openState) return false

  socket.send(JSON.stringify({ type, payload }))
  return true
}

export function reconnectDelay(attempt) {
  return Math.min(1000 * (2 ** (attempt - 1)), 30000)
}
