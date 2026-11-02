'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { CheckCircle2, X, XCircle } from 'lucide-react'

type ToastKind = 'success' | 'error'
interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return context
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), [])
  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = Date.now() + Math.random()
      setToasts((current) => [...current, { id, kind, message }])
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000)
    },
    [dismiss],
  )
  const api = useMemo<ToastApi>(
    () => ({ success: (message) => push('success', message), error: (message) => push('error', message) }),
    [push],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className='fixed top-20 right-4 z-[70] flex w-full max-w-sm flex-col gap-2' aria-live='polite'>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === 'error' ? 'alert' : 'status'}
            className={`flex items-start gap-3 rounded-lg border bg-white p-4 shadow-lg border-l-4 ${
              toast.kind === 'error' ? 'border-l-red-500' : 'border-l-green-500'
            }`}
          >
            {toast.kind === 'error' ? (
              <XCircle className='h-5 w-5 shrink-0 text-red-500' />
            ) : (
              <CheckCircle2 className='h-5 w-5 shrink-0 text-green-500' />
            )}
            <p className='flex-1 text-sm text-gray-700'>{toast.message}</p>
            <button
              type='button'
              onClick={() => dismiss(toast.id)}
              className='text-gray-400 hover:text-gray-600 cursor-pointer'
              aria-label='Cerrar aviso'
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
