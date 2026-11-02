'use client'

import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel?: string
  destructive?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// Confirmación antes de una acción que no se puede deshacer (borrar).
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Quien lo usa suele armar el texto con el elemento a borrar y lo vacía al cerrar. Mientras dura la animación de
  // salida se sigue mostrando el último texto, para que no parpadee un "¿Seguro que querés eliminar undefined?".
  const [shown, setShown] = useState({ title, description, confirmLabel })
  useEffect(() => {
    if (open) setShown({ title, description, confirmLabel })
  }, [open, title, description, confirmLabel])

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !loading && onCancel()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{shown.title}</DialogTitle>
          <DialogDescription>{shown.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button
            type='button'
            onClick={onCancel}
            disabled={loading}
            className='px-4 py-2 rounded border text-sm text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50'
          >
            Cancelar
          </button>
          <button
            type='button'
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 rounded text-sm text-white flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {loading && <LoaderCircle className='animate-spin' size={16} />}
            {shown.confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
