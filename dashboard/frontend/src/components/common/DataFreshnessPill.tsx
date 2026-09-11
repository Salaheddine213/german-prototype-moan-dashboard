import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Database, ChevronRight } from 'lucide-react'
import { api } from '../../api/client'
import type { DataStatusSource } from '../../types/api'

interface Props {
  /** When false, render a single-row dot with no labels (collapsed sidebar). */
  expanded: boolean
}

/** Reserved status colors (good / warning / serious) - theme-aware via CSS vars. */
const STATUS_COLORS = {
  fresh: 'var(--accent-green)',
  warn: 'var(--accent-amber)',
  stale: 'var(--accent-red)',
} as const

/**
 * Sidebar-friendly data-freshness summary. Reads /api/data-status (which
 * pulls from the upstream provenance table) and surfaces fresh/warn/stale
 * counts. Click to expand the per-source breakdown.
 *
 * Most demo sources are generated at the demo end-date; in live mode the
 * German ingestion pipeline may lag by 1-30 days. Showing this prominently
 * stops users from reading 25-day-old prices as 'now'.
 */
export default function DataFreshnessPill({ expanded }: Props) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['data-status'],
    queryFn: () => api.dataStatus(),
    // Refresh every 5 min - provenance won't move faster than that.
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  })

  const summary = data?.summary
  // Worst-case dot colour drives the headline indicator.
  const worst: 'fresh' | 'warn' | 'stale' = summary
    ? summary.stale > 0
      ? 'stale'
      : summary.warn > 0
        ? 'warn'
        : 'fresh'
    : 'fresh'
  const dotColor = STATUS_COLORS[worst]

  if (!expanded) {
    return (
      <div
        className="flex items-center justify-center py-2"
        title={summary ? `Data: ${summary.stale}/${summary.warn}/${summary.fresh} stale/warn/fresh` : 'Loading…'}
      >
        <span
          className="block w-2 h-2 rounded-full"
          style={{ backgroundColor: isLoading ? 'var(--text-muted)' : dotColor }}
        />
      </div>
    )
  }

  return (
    <div className="px-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors"
        style={{
          color: 'var(--text-muted)',
          backgroundColor: open ? 'var(--bg-elevated)' : 'transparent',
        }}
      >
        <Database size={12} />
        <span style={{ color: 'var(--text-secondary)' }}>Data</span>
        <span className="ml-auto flex items-center gap-1.5">
          {summary && (
            <>
              <FreshnessCounts summary={summary} />
            </>
          )}
          <ChevronRight
            size={11}
            style={{
              transform: open ? 'rotate(90deg)' : 'rotate(0)',
              transition: 'transform 0.15s',
            }}
          />
        </span>
      </button>
      {open && data && <SourceBreakdown sources={data.sources} />}
    </div>
  )
}

function FreshnessCounts({ summary }: { summary: { fresh: number; warn: number; stale: number } }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px]"
      style={{ fontFamily: 'JetBrains Mono, monospace' }}
    >
      {summary.stale > 0 && <Pill color={STATUS_COLORS.stale} count={summary.stale} />}
      {summary.warn > 0 && <Pill color={STATUS_COLORS.warn} count={summary.warn} />}
      {summary.fresh > 0 && <Pill color={STATUS_COLORS.fresh} count={summary.fresh} />}
    </span>
  )
}

function Pill({ color, count }: { color: string; count: number }) {
  return (
    <span style={{ color, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <span
        style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color }}
      />
      {count}
    </span>
  )
}

function SourceBreakdown({ sources }: { sources: DataStatusSource[] }) {
  return (
    <div
      className="mt-1 px-2 py-2 rounded-lg max-h-64 overflow-y-auto"
      style={{ backgroundColor: 'var(--bg-elevated)' }}
    >
      {sources.map((s) => (
        <div
          key={`${s.table}:${s.source}`}
          className="flex items-center gap-2 py-1 text-[10px]"
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: '50%',
              flexShrink: 0,
              backgroundColor: STATUS_COLORS[s.status as keyof typeof STATUS_COLORS] ?? STATUS_COLORS.stale,
            }}
          />
          <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {s.source}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {formatLag(s.lag_hours)}
          </span>
        </div>
      ))}
    </div>
  )
}

function formatLag(hours: number): string {
  if (hours < 24) return `${Math.round(hours)}h`
  const days = hours / 24
  if (days < 30) return `${Math.round(days)}d`
  return `${Math.round(days / 30)}mo`
}
