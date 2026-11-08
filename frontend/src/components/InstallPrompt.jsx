import { X } from 'lucide-react'
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'

const DISMISSED_KEY = 'betuveto_install_dismissed'

// Captured at module scope, not inside the component: beforeinstallprompt can
// fire while the app is still on the "Betöltés..." screen (a slow API cold
// start), before InstallPrompt (which only renders in the loaded-game branch)
// has ever mounted. Module-level state survives that and any later
// mount/unmount across App's render branches.
let capturedPrompt = null
let onCaptured = null

// iOS Safari never fires beforeinstallprompt, so this component naturally
// stays invisible there — no browser sniffing needed.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    capturedPrompt = e
    onCaptured?.(e)
  })
  window.addEventListener('appinstalled', () => {
    capturedPrompt = null
    onCaptured?.(null)
  })
}

function InstallPrompt() {
  const { t } = useTranslation()
  const [deferredPrompt, setDeferredPrompt] = useState(capturedPrompt)
  const [visible, setVisible] = useState(
    !!capturedPrompt && !localStorage.getItem(DISMISSED_KEY)
  )

  useEffect(() => {
    onCaptured = (e) => {
      if (e && !localStorage.getItem(DISMISSED_KEY)) {
        setDeferredPrompt(e)
        setVisible(true)
      } else {
        setDeferredPrompt(null)
        setVisible(false)
      }
    }
    return () => { onCaptured = null }
  }, [])

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    capturedPrompt = null
    setDeferredPrompt(null)
    setVisible(false)
  }, [deferredPrompt])

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, '1')
    setVisible(false)
  }, [])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 z-50 bg-game-surface border-2 border-game-border rounded-full shadow-elev-2 px-4 py-2 flex items-center justify-center gap-3">
      <span className="text-sm font-semibold text-game-primary whitespace-nowrap">{t('install.prompt')}</span>
      <button
        onClick={handleInstall}
        className="text-sm font-semibold bg-game-button text-game-on-secondary px-3 py-1 rounded-full hover:bg-game-button-hover transition-colors whitespace-nowrap"
      >
        {t('install.install')}
      </button>
      <button
        onClick={handleDismiss}
        aria-label={t('install.dismissAriaLabel')}
        className="text-game-muted hover:text-game-primary text-lg leading-none"
      >
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

export default InstallPrompt
