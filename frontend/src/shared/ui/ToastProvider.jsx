import { useCallback, useMemo, useRef, useState } from 'react'
import { ActionIcon, Text } from '@mantine/core'
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleX,
  IconInfoCircle,
  IconX as IconClose,
} from '@tabler/icons-react'
import { ToastContext } from './toastContext'
import './ToastProvider.css'

const TOAST_TTL_MS = 4500

const toastIcons = {
  success: IconCheck,
  error: IconCircleX,
  warning: IconAlertTriangle,
  info: IconInfoCircle,
}

function createToastId(type) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timeoutsRef = useRef({})

  const removeToast = useCallback((id) => {
    window.clearTimeout(timeoutsRef.current[id])
    delete timeoutsRef.current[id]
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  const addToast = useCallback((toast) => {
    const type = toast?.type || 'info'
    const id = createToastId(type)
    const nextToast = {
      id,
      type,
      title: toast?.title || '',
      message: toast?.message || '',
    }

    setToasts((prev) => [nextToast, ...prev].slice(0, 5))
    timeoutsRef.current[id] = window.setTimeout(() => removeToast(id), TOAST_TTL_MS)
    return id
  }, [removeToast])

  const api = useMemo(() => ({
    show: addToast,
    success: (title, message) => addToast({ type: 'success', title, message }),
    error: (title, message) => addToast({ type: 'error', title, message }),
    warning: (title, message) => addToast({ type: 'warning', title, message }),
    info: (title, message) => addToast({ type: 'info', title, message }),
  }), [addToast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => {
          const Icon = toastIcons[toast.type] || IconInfoCircle
          return (
            <div key={toast.id} className={`toast-card toast-card--${toast.type}`} role="status">
              <span className="toast-icon" aria-hidden="true">
                <Icon size={18} stroke={2.2} />
              </span>
              <div className="toast-content">
                {toast.title && <Text fw={700} size="sm">{toast.title}</Text>}
                {toast.message && <Text size="sm" c="dimmed">{toast.message}</Text>}
              </div>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label="Закрыть уведомление"
                onClick={() => removeToast(toast.id)}
              >
                <IconClose size={16} />
              </ActionIcon>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
