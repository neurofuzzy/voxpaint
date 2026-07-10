import * as Toast from '@radix-ui/react-toast'
import { useEffect, useState } from 'react'
import { subscribeToast } from './toastBus'

type ToastItem = { id: number; message: string }

let nextId = 0

export function ToastRegion() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => subscribeToast((message) => setToasts((prev) => [...prev, { id: nextId++, message }])), [])

  return (
    <Toast.Provider swipeDirection="right" duration={3200}>
      {toasts.map((t) => (
        <Toast.Root
          key={t.id}
          onOpenChange={(open) => {
            if (!open) setToasts((prev) => prev.filter((x) => x.id !== t.id))
          }}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 shadow-lg"
        >
          <Toast.Description>{t.message}</Toast.Description>
        </Toast.Root>
      ))}
      <Toast.Viewport className="fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2 outline-none" />
    </Toast.Provider>
  )
}
