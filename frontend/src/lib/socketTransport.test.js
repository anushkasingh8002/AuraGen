import { jest } from '@jest/globals'
import { reconnectDelay, sendEnvelope } from './socketTransport.js'

describe('native WebSocket transport helpers', () => {
  test('reports disconnected sends without dropping them silently', () => {
    const transport = {
      readyState: 2,
      send: jest.fn(),
    }

    expect(sendEnvelope(transport, 'wizard:submit', { name: 'Ada' }, 1)).toBe(false)
    expect(transport.send).not.toHaveBeenCalled()
  })

  test('sends messages using the backend envelope when the socket is open', () => {
    const transport = {
      readyState: 1,
      send: jest.fn(),
    }

    expect(sendEnvelope(transport, 'session:start', { formId: 'demo' }, 1)).toBe(true)
    expect(transport.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'session:start',
        payload: { formId: 'demo' },
      })
    )
  })

  test('keeps reconnecting with capped exponential backoff', () => {
    expect(reconnectDelay(1)).toBe(1000)
    expect(reconnectDelay(2)).toBe(2000)
    expect(reconnectDelay(5)).toBe(16000)
    expect(reconnectDelay(6)).toBe(30000)
    expect(reconnectDelay(10)).toBe(30000)
  })
})
