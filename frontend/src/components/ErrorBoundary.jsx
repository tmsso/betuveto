import { Component } from 'react'
import i18n from '../i18n/index.js'
import { captureError } from '../observability.js'

/**
 * Top-level safety net (ROADMAP 12.3). Without it, any exception thrown while rendering
 * unmounts the whole React tree and the player is left with a blank page and no way
 * back. A class component because React still has no hook equivalent of
 * componentDidCatch. Copy comes from the global i18n instance rather than
 * useTranslation(), which a class component can't call.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    console.error('Render error caught by ErrorBoundary:', error)
    captureError(error, { componentStack: info?.componentStack })
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center p-6 bg-game-paper text-game-primary font-sans">
        <div className="max-w-sm text-center space-y-4">
          <h1 className="text-2xl font-bold">{i18n.t('crash.title')}</h1>
          <p>{i18n.t('crash.body')}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2 rounded-lg bg-game-secondary text-white font-semibold"
          >
            {i18n.t('crash.reload')}
          </button>
        </div>
      </div>
    )
  }
}
