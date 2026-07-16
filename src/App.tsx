import { useEffect } from 'react'
import { MainLayout } from '@/components/layout/MainLayout'
import { HelpDialog } from '@/components/onboarding/HelpDialog'
import { InterfaceTour } from '@/components/onboarding/InterfaceTour'
import { SplashDialog } from '@/components/onboarding/SplashDialog'
import { ToastRegion } from '@/components/ui/ToastRegion'
import { showToast } from '@/components/ui/toastBus'
import { useAppStore } from '@/store/useAppStore'
import { restoreAutosave, wireAutosave } from '@/store/wireAutosave'

function App() {
  useEffect(() => {
    restoreAutosave()
    const unsubscribe = wireAutosave()
    return unsubscribe
  }, [])

  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.lastError && state.lastError !== prev.lastError) showToast(state.lastError)
      }),
    [],
  )

  return (
    <div className="h-screen w-screen overflow-hidden">
      <MainLayout />
      <ToastRegion />
      <SplashDialog />
      <HelpDialog />
      <InterfaceTour />
    </div>
  )
}

export default App
