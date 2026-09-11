import { useEffect, useRef, useState } from 'react'
import {
  createChart,
  LineSeries,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  ColorType,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts'
import { useChartTheme } from '../../hooks/useChartTheme'
import { FONT_MONO } from '../../lib/echarts-theme'
import { fmtNum } from '../../lib/format'

export interface TradingViewSeries {
  data: { time: UTCTimestamp; value: number }[]
  color?: string
  lineWidth?: number
  title?: string
  type?: 'line' | 'area'
  topColor?: string
  bottomColor?: string
  /** Solid (default), Dashed for forecast / projected portions. */
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  /** Decimal places for the hover tooltip - overrides the chart's default. */
  decimals?: number
  /** Unit suffix shown after the value in the tooltip (e.g. 'EUR/MWh'). */
  unit?: string
}

interface TradingViewChartProps {
  series: TradingViewSeries[]
  height?: number
  className?: string
  fitContent?: boolean
  /**
   * Called (debounced) whenever the user pans/zooms the chart and
   * the visible time range changes. Receives the new range as ISO
   * date strings so callers can refetch at the appropriate resolution.
   */
  onVisibleRangeChange?: (start: string, end: string) => void
  /**
   * Decimal places for series values shown in the hover tooltip. Use 4
   * for sub-unit metrics (e.g. EUR/USD), default 2 covers most prices.
   */
  tooltipDecimals?: number
  /**
   * Optional unit label appended to each value in the hover tooltip.
   */
  tooltipUnit?: string
  /** Set false to hide the hover-value tooltip altogether. */
  showTooltip?: boolean
}

interface TooltipRow {
  title: string
  value: number
  color: string
  decimals: number
  unit: string
}

interface TooltipState {
  visible: boolean
  x: number
  y: number
  /** Container width at the time of the crosshair event, captured here
   * so the JSX can decide left-vs-right alignment without touching refs
   * during render (React 19 react-hooks/refs disallows that). */
  containerWidth: number
  date: string
  rows: TooltipRow[]
}

export default function TradingViewChart({
  series,
  height = 300,
  className = '',
  fitContent = true,
  onVisibleRangeChange,
  tooltipDecimals = 2,
  tooltipUnit = '',
  showTooltip = true,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const theme = useChartTheme()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seriesRefs = useRef<ISeriesApi<any>[]>([])
  // Mirrors the latest series array so the crosshair callback (registered
  // once per chart instance) can read up-to-date colors / titles without
  // re-subscribing on every render. Same pattern for tooltip defaults so
  // changing them doesn't tear down and rebuild the chart.
  const seriesMetaRef = useRef<TradingViewSeries[]>(series)
  const tooltipDefaultsRef = useRef({ decimals: tooltipDecimals, unit: tooltipUnit })
  useEffect(() => {
    seriesMetaRef.current = series
  }, [series])
  useEffect(() => {
    tooltipDefaultsRef.current = { decimals: tooltipDecimals, unit: tooltipUnit }
  }, [tooltipDecimals, tooltipUnit])
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false, x: 0, y: 0, containerWidth: 0, date: '', rows: [],
  })
  const onRangeRef = useRef(onVisibleRangeChange)
  useEffect(() => {
    onRangeRef.current = onVisibleRangeChange
  }, [onVisibleRangeChange])

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        fontFamily: FONT_MONO,
        fontSize: 11,
        // Attribution moved to the README per the lightweight-charts
        // license; the on-canvas logo renders as a broken glyph on navy.
        attributionLogo: false,
      },
      localization: {
        // House style: comma decimals (1.000,35).
        locale: 'de-DE',
        priceFormatter: (p: number) => fmtNum(p, 2),
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
      },
    })

    chartRef.current = chart

    // Subscribe to crosshair - also drives the inline hover tooltip,
    // which reads each series's value at the crosshair time and renders
    // them next to the cursor. param.seriesData is a Map keyed by the
    // ISeriesApi instances we pushed into seriesRefs.
    chart.subscribeCrosshairMove((param) => {
      const point = param.point
      const inside =
        point &&
        point.x >= 0 &&
        point.y >= 0 &&
        containerRef.current &&
        point.x <= containerRef.current.clientWidth &&
        point.y <= containerRef.current.clientHeight

      if (!inside || !point || !param.time) {
        setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev))
        return
      }

      const seriesArr = seriesRefs.current
      const meta = seriesMetaRef.current
      const rows: TooltipRow[] = []
      seriesArr.forEach((s, i) => {
        const point = param.seriesData.get(s) as { value?: number } | undefined
        if (!point || typeof point.value !== 'number') return
        const m = meta[i]
        if (!m?.title) return
        rows.push({
          title: m.title,
          value: point.value,
          color: m.color ?? 'var(--accent-primary)',
          decimals: m.decimals ?? tooltipDefaultsRef.current.decimals,
          unit: m.unit ?? tooltipDefaultsRef.current.unit,
        })
      })
      if (rows.length === 0) {
        setTooltip((prev) => (prev.visible ? { ...prev, visible: false } : prev))
        return
      }

      const ts = (param.time as number) * 1000
      const date = new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
      setTooltip({
        visible: true,
        x: point.x,
        y: point.y,
        containerWidth: containerRef.current?.clientWidth ?? 0,
        date,
        rows,
      })
    })

    // Visible-range subscription (debounced) for dynamic-resolution refetch.
    // The handler reads from onRangeRef so the latest callback identity is
    // used without restarting the subscription on every re-render.
    //
    // CRITICAL: lightweight-charts fires this event on every setData call,
    // not just user interaction. Without filtering, a refetch → setData →
    // range event → refetch loop will run until React 19's perf buffer
    // overflows and the page hangs ("DataCloneError: out of memory").
    // We filter by suppressing events whose range is essentially identical
    // to the last one we fired - a 1% deadband relative to the span.
    let rangeTimer: ReturnType<typeof setTimeout> | null = null
    let lastFired: { from: number; to: number } | null = null
    const handleRange = (range: { from: unknown; to: unknown } | null) => {
      const cb = onRangeRef.current
      if (!cb || !range || typeof range.from !== 'number' || typeof range.to !== 'number') return
      const from = range.from as number
      const to = range.to as number
      if (lastFired) {
        const span = to - from
        if (
          Math.abs(from - lastFired.from) < span * 0.01 &&
          Math.abs(to - lastFired.to) < span * 0.01
        ) {
          return
        }
      }
      if (rangeTimer) clearTimeout(rangeTimer)
      rangeTimer = setTimeout(() => {
        lastFired = { from, to }
        const startIso = new Date(from * 1000).toISOString().slice(0, 10)
        const endIso = new Date(to * 1000).toISOString().slice(0, 10)
        cb(startIso, endIso)
      }, 400)
    }
    chart.timeScale().subscribeVisibleTimeRangeChange(handleRange)

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      if (rangeTimer) clearTimeout(rangeTimer)
      chart.timeScale().unsubscribeVisibleTimeRangeChange(handleRange)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [height])

  // Re-skin the existing chart instance whenever the theme flips -
  // applyOptions preserves zoom/pan state, unlike a teardown-rebuild.
  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: theme.faint },
      grid: {
        vertLines: { color: theme.grid, style: LineStyle.Dotted },
        horzLines: { color: theme.grid, style: LineStyle.Dotted },
      },
      crosshair: {
        vertLine: { color: theme.accent, labelBackgroundColor: theme.elevated },
        horzLine: { color: theme.accent, labelBackgroundColor: theme.elevated },
      },
      rightPriceScale: { borderColor: theme.border },
      timeScale: { borderColor: theme.border },
    })
  }, [theme])

  // Update series data
  useEffect(() => {
    if (!chartRef.current) return

    // Remove old series
    seriesRefs.current.forEach((s) => {
      try {
        chartRef.current?.removeSeries(s)
      } catch {
        // ignore
      }
    })
    seriesRefs.current = []

    const lineStyleEnum = {
      solid: LineStyle.Solid,
      dashed: LineStyle.Dashed,
      dotted: LineStyle.Dotted,
    } as const

    series.forEach((s, i) => {
      if (!chartRef.current) return

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let newSeries: ISeriesApi<any>
      const ls = lineStyleEnum[s.lineStyle ?? 'solid']
      // Fixed-order categorical slot when the caller didn't pin a color.
      const fallback = theme.series[i % theme.series.length]
      const color = s.color ?? fallback

      if (s.type === 'area') {
        newSeries = chartRef.current.addSeries(AreaSeries, {
          lineColor: color,
          topColor: s.topColor ?? `${color}33`,
          bottomColor: s.bottomColor ?? 'transparent',
          lineWidth: (s.lineWidth ?? 2) as 1 | 2 | 3 | 4,
          lineStyle: ls,
          title: s.title,
        })
      } else {
        newSeries = chartRef.current.addSeries(LineSeries, {
          color,
          lineWidth: (s.lineWidth ?? 2) as 1 | 2 | 3 | 4,
          lineStyle: ls,
          title: s.title,
        })
      }

      newSeries.setData(s.data)
      seriesRefs.current.push(newSeries)
    })

    if (fitContent && seriesRefs.current.length > 0) {
      chartRef.current.timeScale().fitContent()
    }
  }, [series, fitContent, theme])

  // Decide left/right alignment from the captured container width
  // (no ref reads during render - React 19 disallows that).
  const tooltipOnRight = tooltip.containerWidth > 0 && tooltip.x > tooltip.containerWidth * 0.65
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
      />
      {showTooltip && tooltip.visible && (
        <div
          style={{
            position: 'absolute',
            // Flip left ↔ right anchor when the cursor crosses 65% of width
            // so the tooltip stays fully on-canvas at the right edge.
            left: tooltipOnRight ? undefined : tooltip.x + 12,
            right: tooltipOnRight ? tooltip.containerWidth - tooltip.x + 12 : undefined,
            top: Math.max(8, tooltip.y - 8),
            pointerEvents: 'none',
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 8,
            padding: '6px 10px',
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: 'var(--text-primary)',
            boxShadow: 'var(--shadow-card)',
            whiteSpace: 'nowrap',
            zIndex: 10,
          }}
        >
          <div style={{ color: 'var(--text-muted)', marginBottom: 3 }}>{tooltip.date}</div>
          {tooltip.rows.map((r) => (
            <div
              key={r.title}
              style={{ display: 'flex', alignItems: 'center', gap: 6, lineHeight: 1.5 }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: r.color,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--text-secondary)' }}>{r.title}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-primary)', fontWeight: 600 }}>
                {fmtNum(r.value, r.decimals)}{r.unit ? ` ${r.unit}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
