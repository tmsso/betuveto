import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

// The game has no offline mode (every guess is server-validated), so rather
// than let a dropped connection surface as a generic "Hiba történt..." error,
// tell the player plainly what's going on and what to do about it.
function OfflineNotice() {
  const { t } = useTranslation()
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== 'undefined' && !navigator.onLine
  )

  useEffect(() => {
    const goOnline = () => setIsOffline(false)
    const goOffline = () => setIsOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!isOffline) return null

  return (
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-50 bg-yellow-100 text-yellow-800 text-sm font-semibold text-center py-2 px-4 border-b-2 border-yellow-300"
    >
      {t('offline')}
    </div>
  )
}

export default OfflineNotice
