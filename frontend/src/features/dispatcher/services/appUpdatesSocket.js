import { getWebSocketUrl } from '../model/constants'

const listeners = new Set()
let socket = null
let reconnectTimer = null
let reconnectAttempt = 0

function notify(event) {
  listeners.forEach((listener) => {
    try {
      listener(event)
    } catch {
      // keep one broken listener from stopping realtime updates
    }
  })
}

function scheduleReconnect() {
  if (reconnectTimer) return
  const delay = Math.min(10000, 1000 + reconnectAttempt * 1000)
  reconnectAttempt += 1
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null
    connectAppUpdatesSocket()
  }, delay)
}

export function connectAppUpdatesSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket
  }

  try {
    socket = new WebSocket(getWebSocketUrl('/ws/updates'))
  } catch {
    scheduleReconnect()
    return null
  }

  socket.addEventListener('open', () => {
    reconnectAttempt = 0
  })

  socket.addEventListener('message', (message) => {
    try {
      notify(JSON.parse(message.data))
    } catch {
      // ignore malformed realtime events
    }
  })

  socket.addEventListener('close', scheduleReconnect)
  socket.addEventListener('error', () => {
    socket?.close()
  })

  return socket
}

export function addAppUpdateListener(listener) {
  listeners.add(listener)
  connectAppUpdatesSocket()
  return () => {
    listeners.delete(listener)
  }
}
