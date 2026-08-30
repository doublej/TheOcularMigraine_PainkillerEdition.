type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  message: string
  type: ToastType
}

let toasts = $state<Toast[]>([])
let nextId = 0

export function getToasts() {
  return toasts
}

export function dismissToast(id: number) {
  toasts = toasts.filter(t => t.id !== id)
}

/** Errors stay until tapped — `duration` is ignored for them. They are the app's only failure channel. */
export function showToast(message: string, type: ToastType = 'info', duration = 2500) {
  const id = nextId++
  toasts = [...toasts, { id, message, type }]
  if (type === 'error') return
  setTimeout(() => dismissToast(id), duration)
}
