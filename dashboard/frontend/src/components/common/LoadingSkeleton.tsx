interface LoadingSkeletonProps {
  variant?: 'card' | 'chart' | 'table'
  className?: string
  rows?: number
}

// Deterministic varied widths per table row: cycled by row index so the
// skeleton looks naturally jagged but stays stable across re-renders.
// (React 19 / react-hooks/purity disallows Math.random() during render.)
const TABLE_ROW_WIDTHS: ReadonlyArray<readonly [string, string, string, string]> = [
  ['82px', '58px', '62px', '70px'],
  ['74px', '52px', '66px', '64px'],
  ['90px', '64px', '54px', '78px'],
  ['68px', '48px', '60px', '56px'],
  ['86px', '56px', '70px', '76px'],
]

export default function LoadingSkeleton({
  variant = 'card',
  className = '',
  rows = 4,
}: LoadingSkeletonProps) {
  if (variant === 'chart') {
    return (
      <div className={`w-full h-full min-h-48 rounded-lg overflow-hidden ${className}`}>
        {/* Chart header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="skeleton h-4 w-32 rounded" />
          <div className="skeleton h-4 w-20 rounded" />
        </div>
        {/* Chart area */}
        <div className="skeleton w-full rounded-lg" style={{ height: 'calc(100% - 48px)', minHeight: '180px' }} />
      </div>
    )
  }

  if (variant === 'table') {
    return (
      <div className={`w-full ${className}`}>
        {/* Table header */}
        <div className="flex gap-4 mb-3">
          <div className="skeleton h-3 w-24 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
          <div className="skeleton h-3 w-16 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
        </div>
        {/* Table rows */}
        {Array.from({ length: rows }).map((_, i) => {
          const widths = TABLE_ROW_WIDTHS[i % TABLE_ROW_WIDTHS.length]
          return (
            <div key={i} className="flex gap-4 py-2 border-b" style={{ borderColor: 'var(--border-default)' }}>
              <div className="skeleton h-3 rounded" style={{ width: widths[0] }} />
              <div className="skeleton h-3 rounded" style={{ width: widths[1] }} />
              <div className="skeleton h-3 rounded" style={{ width: widths[2] }} />
              <div className="skeleton h-3 rounded" style={{ width: widths[3] }} />
            </div>
          )
        })}
      </div>
    )
  }

  // Default: card
  return (
    <div
      className={`rounded-xl p-4 border ${className}`}
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-default)',
      }}
    >
      <div className="skeleton h-3 w-20 mb-3 rounded" />
      <div className="skeleton h-7 w-28 mb-2 rounded" />
      <div className="skeleton h-3 w-16 rounded" />
    </div>
  )
}
