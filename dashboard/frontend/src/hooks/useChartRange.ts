import { useState, useCallback } from 'react'

type DateRange = { start: string; end: string }

/**
 * Tracks a chart zoom range that follows the global dateRange but lets
 * TradingViewChart zoom/pan events override it for higher-resolution fetches.
 *
 * Uses the during-render reset pattern so state resets synchronously when
 * dateRange changes (useEffect would cause a stale render first).
 *
 * handleVisibleRangeChange only triggers a re-fetch on a meaningful zoom-in
 * (≥30% narrower) or pan beyond the current envelope - programmatic setData
 * events that mirror the existing range are ignored.
 */
export function useChartRange(dateRange: DateRange) {
  const [chartRange, setChartRange] = useState(dateRange)
  const [trackedDateRange, setTrackedDateRange] = useState(dateRange)

  if (
    trackedDateRange.start !== dateRange.start ||
    trackedDateRange.end !== dateRange.end
  ) {
    setTrackedDateRange(dateRange)
    setChartRange(dateRange)
  }

  const handleVisibleRangeChange = useCallback((start: string, end: string) => {
    setChartRange((prev) => {
      if (prev.start === start && prev.end === end) return prev
      const newStart = Date.parse(start)
      const newEnd = Date.parse(end)
      const prevStart = Date.parse(prev.start)
      const prevEnd = Date.parse(prev.end)
      if (!Number.isFinite(newStart) || !Number.isFinite(newEnd)) return prev
      const newSpan = newEnd - newStart
      const prevSpan = prevEnd - prevStart
      const zoomedIn = newSpan < prevSpan * 0.7
      const pannedOut =
        newStart < prevStart - prevSpan * 0.1 || newEnd > prevEnd + prevSpan * 0.1
      return zoomedIn || pannedOut ? { start, end } : prev
    })
  }, [])

  return { chartRange, handleVisibleRangeChange }
}
