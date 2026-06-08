import { getWebSocketUrl } from '../model/constants'

const listeners = new Set()
let socket = null
let reconnectTimer = null
let reconnectAttempt = 0
let reconnectPausedUntil = 0

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
  const now = Date.now()
  const baseDelay = Math.min(60000, 1000 * (2 ** Math.min(reconnectAttempt, 6)))
  const jitter = Math.round(Math.random() * 600)
  const delay = Math.max(reconnectPausedUntil - now, baseDelay + jitter)
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
    reconnectPausedUntil = 0
  })

  socket.addEventListener('message', (message) => {
    try {
      notify(JSON.parse(message.data))
    } catch {
      // ignore malformed realtime events
    }
  })

  socket.addEventListener('close', (event) => {
    if (event.code === 1008 || event.code === 1011) {
      reconnectPausedUntil = Date.now() + 60000
    }
    scheduleReconnect()
  })
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
