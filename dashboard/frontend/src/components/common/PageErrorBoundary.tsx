import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Human label for the boundary (e.g. page name) - surfaced in the fallback. */
  label?: string
}

interface State {
  error: Error | null
}

/**
 * Catches render errors below this boundary so a single failing chart or
 * unexpected `undefined.foo` doesn't blank out the whole page. The user
 * sees a contained warning panel and can refresh that section without a
 * full reload. Wrap each lazy-routed page in one.
 *
 * React 19 still requires a class component for error boundaries - there
 * is no hook equivalent.
 */
export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the stack so it shows up in the dev console / production
    // monitoring; the UI displays only the message.
    console.error(`[${this.props.label ?? 'page'}] caught error:`, error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="p-8">
        <div
          className="rounded-xl border p-6 max-w-2xl mx-auto"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
          }}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={24} style={{ color: 'var(--accent-red)' }} />
            <div className="flex-1">
              <h2
                className="text-base font-semibold mb-1"
                style={{ color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}
              >
                Something went wrong on this {this.props.label ?? 'page'}.
              </h2>
              <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
                {error.message || 'An unexpected error occurred while rendering.'}
              </p>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Other pages still work - pick one from the sidebar, or retry below.
              </p>
              <button
                onClick={this.reset}
                className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg border transition-colors"
                style={{
                  borderColor: 'var(--border-default)',
                  color: 'var(--text-primary)',
                  backgroundColor: 'var(--bg-elevated)',
                }}
              >
                <RotateCw size={12} />
                Retry
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }
}
