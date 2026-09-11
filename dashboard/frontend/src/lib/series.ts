import type { UTCTimestamp } from 'lightweight-charts'

export interface SeriesPoint {
  time: UTCTimestamp
  value: number
}

/**
 * Zip ISO datetimes with values into sorted lightweight-charts points,
 * dropping null/NaN values. Backend timestamps are strict ISO-8601 UTC.
 */
export function toSeriesPoints(
  datetimes: string[],
  values: (number | null | undefined)[],
): SeriesPoint[] {
  const out: SeriesPoint[] = []
  for (let i = 0; i < datetimes.length; i++) {
    const v = values[i]
    if (v == null || Number.isNaN(v)) continue
    out.push({ time: (new Date(datetimes[i]).getTime() / 1000) as UTCTimestamp, value: v })
  }
  return out.sort((a, b) => a.time - b.time)
}
