import type { ReactNode } from 'react'

interface PageShellProps {
  /** Whether the page's primary data is still loading. When true, renders the skeleton. */
  loading?: boolean
  /** Error from the page's primary query. When non-null, renders an error banner. */
  error?: Error | null
  /**
   * Custom skeleton to show while loading. If omitted and `loading` is true,
   * a default 3-card pulse skeleton is rendered.
   */
  skeleton?: ReactNode
  children: ReactNode
}

function DefaultSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-xl"
            style={{ backgroundColor: 'var(--bg-surface)' }}
          />
        ))}
      </div>
      <div
        className="h-64 rounded-xl"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      />
    </div>
  )
}

/**
 * PageShell wraps every page with the standard outer container (`p-6 space-y-6
 * animate-fade-in`) and handles top-level loading and error states.
 *
 * - If `loading` is true, renders `skeleton` (or a default 3-card pulse skeleton).
 * - If `error` is non-null (and not loading), renders a brief error banner.
 * - Otherwise renders `children` as-is.
 */
export default function PageShell({ loading, error, skeleton, children }: PageShellProps) {
  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {loading ? (
        skeleton ?? <DefaultSkeleton />
      ) : error ? (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            backgroundColor: 'rgba(248,113,113,0.08)',
            borderColor: 'var(--accent-red, #F87171)',
            color: 'var(--accent-red, #F87171)',
            fontFamily: 'Outfit, sans-serif',
          }}
        >
          {error.message || 'Something went wrong. Please refresh the page.'}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
