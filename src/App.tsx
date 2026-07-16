import { useEffect } from 'react'
import { MainLayout } from '@/components/layout/MainLayout'
import { HelpDialog } from '@/components/onboarding/HelpDialog'
import { InterfaceTour } from '@/components/onboarding/InterfaceTour'
import { SplashDialog } from '@/components/onboarding/SplashDialog'
import { ToastRegion } from '@/components/ui/ToastRegion'
import { showToast } from '@/components/ui/toastBus'
import { installNativeMenu } from '@/store/nativeMenu'
import { useAppStore } from '@/store/useAppStore'
import { restoreAutosave, wireAutosave } from '@/store/wireAutosave'
import { wireDesktopFileOpen } from '@/store/wireDesktopOpen'

function App() {
  useEffect(() => {
    restoreAutosave()
    const unsubscribeAutosave = wireAutosave()
    let unsubscribeDesktopOpen: (() => void) | undefined
    void wireDesktopFileOpen().then((unlisten) => { unsubscribeDesktopOpen = unlisten })
    void installNativeMenu()
    return () => {
      unsubscribeAutosave()
      unsubscribeDesktopOpen?.()
    }
  }, [])

  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        if (state.lastError && state.lastError !== prev.lastError) showToast(state.lastError)
      }),
    [],
  )

  return (
    // Safe-area padding (relevant in the iOS "Add to Home Screen" standalone app, where our own
    // content — not Safari's chrome — sits under the notch/status bar/home-indicator) insets real
    // UI from those regions; the padding itself shows the near-identical body background
    // (src/index.css), so it still reads as edge-to-edge rather than a letterboxed app.
    <div
      className="h-screen w-screen overflow-hidden"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
      }}
    >
      <MainLayout />
      <ToastRegion />
      <SplashDialog />
      <HelpDialog />
      <InterfaceTour />
    </div>
  )
}

export default App
