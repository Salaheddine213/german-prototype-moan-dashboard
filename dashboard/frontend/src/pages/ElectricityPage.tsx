import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { subDays, format } from 'date-fns'
import { api } from '../api/client'
import { useFilterStore } from '../store/filterStore'
import { useChartRange } from '../hooks/useChartRange'
import KpiCard from '../components/common/KpiCard'
import DateRangePicker from '../components/common/DateRangePicker'
import ChartWrapper from '../components/common/ChartWrapper'
import TradingViewChart, { type TradingViewSeries } from '../components/charts/TradingViewChart'
import EChartsWrapper from '../components/charts/EChartsWrapper'
import type { UTCTimestamp } from 'lightweight-charts'
import type { EChartsOption } from 'echarts'
import { useChartTheme } from '../hooks/useChartTheme'
import { mixHex, type ChartTheme } from '../lib/echarts-theme'
import { fmtNum } from '../lib/format'
import PageShell from '../components/common/PageShell'

const CURRENT_YEAR = new Date().getFullYear()
const FALLBACK_YEAR_OPTIONS = Array.from(
  { length: CURRENT_YEAR - 2022 + 1 },
  (_, i) => 2022 + i,
)

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function YearSelector({
  value,
  onChange,
  options,
}: {
  value: number
  onChange: (y: number) => void
  options: number[]
}) {
  return (
    <select
      name="year"
      aria-label="Year"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="px-2 py-1 text-xs rounded-lg border"
      style={{
        backgroundColor: 'var(--bg-elevated)',
        borderColor: 'var(--border-default)',
        color: 'var(--text-primary)',
        fontFamily: 'JetBrains Mono, monospace',
      }}
    >
      {options.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  )
}

const SUPPLY_LABELS: Record<string, string> = {
  load: 'Load',
  pv: 'Solar PV',
  wind_onshore: 'Wind onshore',
  wind_offshore: 'Wind offshore',
}

type OverlayKey = 'load' | 'pv' | 'wind_onshore' | 'wind_offshore'

// Years are ordered, so they get a sequential single-hue ramp (subdued for
// old, saturated for recent); the latest year is drawn separately in amber.
function yearColor(yearIdx: number, total: number, t: ChartTheme): string {
  if (total <= 1) return t.seq.to
  return mixHex(t.seq.from, t.seq.to, yearIdx / (total - 1))
}

export default function ElectricityPage() {
  const t = useChartTheme()
  const dateRange = useFilterStore((s) => s.dateRange)
  const [activeOverlays, setActiveOverlays] = useState<Set<OverlayKey>>(new Set())

  // Overlay colors, one t.series slot each, distinct from the DA price line
  // (t.series[1]) so no two series in the main chart share a slot.
  const SUPPLY_COLORS: Record<OverlayKey, string> = useMemo(
    () => ({
      load: t.series[0],
      pv: t.series[4],
      wind_onshore: t.series[5],
      wind_offshore: t.series[2],
    }),
    [t],
  )

  // chartRange tracks the user's current zoom on the historical chart.
  // It defaults to (and resets with) the global dateRange but is overridden
  // by visible-range-change events from TradingViewChart, which trigger a
  // refetch at whichever resolution the backend auto-selects for the new
  // span. Without this, the user gets daily granularity even after zooming
  // to a one-week window.
  // Reset zoom-tracked range when the global dateRange changes. Uses the
  // during-render reset pattern (React 19 / react-hooks/set-state-in-effect
  // disallows useEffect(() => setX(prop)).
  const { chartRange, handleVisibleRangeChange } = useChartRange(dateRange)

  const kpiStart = useMemo(() => format(subDays(new Date(), 30), 'yyyy-MM-dd'), [])
  const kpiEnd = useMemo(() => format(new Date(), 'yyyy-MM-dd'), [])

  const { data: kpiHistData, isLoading: kpiLoading } = useQuery({
    queryKey: ['electricity-kpi-hist', kpiStart, kpiEnd],
    queryFn: () => api.electricityHistorical(kpiStart, kpiEnd, 5000),
  })


  // Main chart data - resolution=auto so the backend picks 15min/hourly/daily
  // based on chartRange span. Zoom in narrows the span; the backend bumps
  // resolution; the chart re-renders at finer granularity.
  const { data: chartData, isLoading: chartLoading, error: chartError } = useQuery({
    queryKey: ['electricity-historical', chartRange.start, chartRange.end],
    queryFn: () => api.electricityHistorical(chartRange.start, chartRange.end, 8000),
  })

  // Duration curves - one per historical year, plotted on a shared
  // "% of hours within year" X axis so partial and full years overlay.
  const {
    data: durationCurvesData,
    isLoading: durationLoading,
    error: durationError,
  } = useQuery({
    queryKey: ['duration-curves'],
    queryFn: () => api.durationCurves(),
  })

  // Year options for the heatmap come from the years the backend actually
  // reports (demo data spans 2022+, live data may start earlier/later).
  const yearOptions = durationCurvesData?.years?.length
    ? durationCurvesData.years
    : FALLBACK_YEAR_OPTIONS
  const defaultYear = yearOptions[yearOptions.length - 1] ?? CURRENT_YEAR
  const [heatmapYear, setHeatmapYear] = useState(defaultYear)
  // Keep the selector in sync when data (and thus available years) arrives,
  // without fighting the user's explicit selection. Mutual-exclusion guard
  // (like useChartRange) so the during-render reset only fires once.
  const [heatmapYearTouched, setHeatmapYearTouched] = useState(false)
  if (!heatmapYearTouched && heatmapYear !== defaultYear) {
    setHeatmapYear(defaultYear)
  }

  // Heatmap
  const { data: heatmapData, isLoading: heatmapLoading, error: heatmapError } = useQuery({
    queryKey: ['heatmap', heatmapYear],
    queryFn: () => api.heatmap(heatmapYear),
  })

  // Compute KPIs from last 30 days
  const kpis = useMemo(() => {
    const prices = kpiHistData?.da_prices ?? []
    if (!prices.length) return null

    // Timestamps are UTC, so "today" must be the UTC date - the local date
    // mismatches for a few hours around local midnight.
    const today = new Date().toISOString().slice(0, 10)
    const todayPrices = prices
      .filter((p) => p.timestamp.startsWith(today))
      .map((p) => p.value)

    const monthValues = prices.map((p) => p.value)
    const latest = prices[prices.length - 1]?.value ?? null
    const avgMonth = monthValues.length
      ? monthValues.reduce((a, b) => a + b, 0) / monthValues.length
      : null
    const maxToday = todayPrices.length ? Math.max(...todayPrices) : null
    const minToday = todayPrices.length ? Math.min(...todayPrices) : null
    const negHours =
      durationCurvesData?.stats?.[String(defaultYear)]?.negative_hours ??
      durationCurvesData?.stats?.[String(CURRENT_YEAR)]?.negative_hours ??
      null

    return { latest, avgMonth, maxToday, minToday, negHours }
  }, [kpiHistData, durationCurvesData, defaultYear])

  // Build main chart series
  const chartSeries: TradingViewSeries[] = useMemo(() => {
    const series: TradingViewSeries[] = []
    if (!chartData) return series

    // DA price - primary line
    const daPrices = chartData.da_prices
      .map((p) => ({
        time: (new Date(p.timestamp).getTime() / 1000) as UTCTimestamp,
        value: p.value,
      }))
      .sort((a, b) => a.time - b.time)

    if (daPrices.length > 0) {
      series.push({
        data: daPrices,
        color: t.series[1],
        lineWidth: 2,
        title: 'DA price',
        type: 'line',
      })
    }

    // Overlay series (area)
    const supplyMap: Record<OverlayKey, (s: NonNullable<typeof chartData>['supply'][number]) => number | undefined> = {
      load: (s) => s.load,
      pv: (s) => s.pv,
      wind_onshore: (s) => s.wind_onshore,
      wind_offshore: (s) => s.wind_offshore,
    }

    for (const key of Array.from(activeOverlays)) {
      const getter = supplyMap[key]
      const data = chartData.supply
        .filter((s) => getter(s) != null)
        .map((s) => ({
          time: (new Date(s.timestamp).getTime() / 1000) as UTCTimestamp,
          value: getter(s) as number,
        }))
        .sort((a, b) => a.time - b.time)

      if (data.length > 0) {
        series.push({
          data,
          color: SUPPLY_COLORS[key],
          lineWidth: 1,
          title: SUPPLY_LABELS[key],
          type: 'area',
          topColor: `${SUPPLY_COLORS[key]}33`,
          bottomColor: 'transparent',
        })
      }
    }

    return series
  }, [chartData, activeOverlays, t, SUPPLY_COLORS])

  // Duration curves - one ECharts line series per year, with a
  // chronological color ramp so the year drift is readable directly
  // off the chart (oldest = cool blue, newest = warm copper). The
  // latest year is drawn on top with extra weight.
  const durationOption: EChartsOption = useMemo(() => {
    if (!durationCurvesData?.years.length) return {}
    const { years, curves, stats } = durationCurvesData
    const latestYear = years[years.length - 1]

    const series = years.map((year, i) => {
      const isLatest = year === latestYear
      const color = isLatest ? t.amber : yearColor(i, years.length, t)
      return {
        name: String(year),
        type: 'line' as const,
        data: curves[String(year)],
        symbol: 'none' as const,
        smooth: false,
        itemStyle: { color },
        lineStyle: {
          width: isLatest ? 2.5 : 1.5,
          color,
          opacity: isLatest ? 1 : 0.85,
        },
        z: isLatest ? 10 : i,
      }
    })

    return {
      grid: { top: 30, right: 16, bottom: 60, left: 70, containLabel: false },
      legend: {
        data: years.map(String).reverse(),  // newest first in legend
        top: 0,
        right: 16,
        textStyle: t.axisLabel,
        itemWidth: 16,
        itemHeight: 2,
      },
      xAxis: {
        type: 'value',
        name: '% of hours',
        nameLocation: 'middle',
        nameGap: 30,
        min: 0,
        max: 100,
        axisLine: t.axisLine,
        axisLabel: { ...t.axisLabel, formatter: '{value}%' },
        splitLine: t.splitLine,
      },
      yAxis: {
        type: 'value',
        name: 'EUR/MWh',
        nameLocation: 'middle',
        nameGap: 50,
        axisLine: t.axisLine,
        axisLabel: t.axisLabel,
        splitLine: t.splitLine,
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = params as { seriesName: string; value: [number, number]; color: string }[]
          if (!arr?.length) return ''
          const pct = arr[0].value[0]
          const lines = [...arr]
            .sort((a, b) => Number(b.seriesName) - Number(a.seriesName))
            .map((p) => {
              const yr = p.seriesName
              const s = stats[yr]
              const tail = s ? ` <span style="color:${t.muted}">(neg ${s.negative_hours}h, peak ${s.peak_hours}h)</span>` : ''
              return `<span style="color:${p.color}">●</span> <b>${yr}</b>: ${fmtNum(p.value[1], 2)} EUR/MWh${tail}`
            })
          return `<div style="${t.tooltipCss}"><b>${fmtNum(pct, 1)}%</b> of hours<br/>${lines.join('<br/>')}</div>`
        },
      },
      series,
      // Zero line for visual reference of negative-price tail.
      markLine: undefined,
    }
  }, [durationCurvesData, t])

  // Heatmap ECharts option
  const heatmapOption: EChartsOption = useMemo(() => {
    if (!heatmapData) return {}

    const { hours, months, values } = heatmapData
    // values[hour_idx][month_idx]
    const data: [number, number, number][] = []
    hours.forEach((_h, hi) => {
      months.forEach((_m, mi) => {
        const v = values[hi]?.[mi]
        if (v != null) data.push([mi, hi, Math.round(v * 10) / 10])
      })
    })

    const allVals = data.map((d) => d[2])
    const minVal = Math.min(...allVals)
    const maxVal = Math.max(...allVals)

    return {
      grid: { top: 10, right: 20, bottom: 60, left: 50, containLabel: true },
      xAxis: {
        type: 'category',
        data: months.map((m) => MONTH_NAMES[m - 1] ?? String(m)),
        axisLabel: { color: t.faint, fontFamily: 'Outfit, sans-serif', fontSize: 11 },
        axisLine: t.axisLine,
      },
      yAxis: {
        type: 'category',
        data: hours.map((h) => `${String(h).padStart(2, '0')}:00`),
        axisLabel: { color: t.faint, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
        axisLine: t.axisLine,
      },
      visualMap: {
        min: minVal,
        max: maxVal,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        textStyle: { color: t.faint, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 },
        inRange: {
          color: [t.accent, t.grid, t.red],
        },
      },
      tooltip: {
        formatter: (params: unknown) => {
          const p = params as { data: [number, number, number] }
          const [mi, hi, val] = p.data
          const monthName = MONTH_NAMES[months[mi] - 1] ?? String(months[mi])
          const hour = hours[hi]
          return `${monthName}, ${String(hour).padStart(2, '0')}:00<br/>Avg: <b>${fmtNum(val, 1)} EUR/MWh</b>`
        },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: false },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.5)' },
          },
        },
      ],
    }
  }, [heatmapData, t])

  function toggleOverlay(key: OverlayKey) {
    setActiveOverlays((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Export data for main chart
  const exportData = useMemo(
    () =>
      chartData?.da_prices.map((p) => ({
        timestamp: p.timestamp,
        da_price: p.value,
      })) ?? [],
    [chartData],
  )

  return (
    <PageShell>
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-bold"
            style={{ color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}
          >
            Electricity market
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Historical DA prices, supply mix and load data for Germany
          </p>
        </div>
        <DateRangePicker />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard
          title="Latest DA price"
          value={fmtNum(kpis?.latest, 2)}
          unit="EUR/MWh"
          loading={kpiLoading}
          staggerIndex={0}
        />
        <KpiCard
          title="Avg price (30d)"
          value={fmtNum(kpis?.avgMonth, 2)}
          unit="EUR/MWh"
          loading={kpiLoading}
          staggerIndex={1}
        />
        <KpiCard
          title="Max today"
          value={fmtNum(kpis?.maxToday, 2)}
          unit="EUR/MWh"
          loading={kpiLoading}
          staggerIndex={2}
        />
        <KpiCard
          title="Min today"
          value={fmtNum(kpis?.minToday, 2)}
          unit="EUR/MWh"
          loading={kpiLoading}
          staggerIndex={3}
        />
        <KpiCard
          title={`Negative hours (${defaultYear})`}
          value={kpis?.negHours != null ? String(kpis.negHours) : '—'}
          unit="h"
          loading={kpiLoading}
          staggerIndex={4}
        />
      </div>

      {/* Overlay toggles */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Overlay:
        </span>
        {(Object.keys(SUPPLY_LABELS) as OverlayKey[]).map((key) => {
          const active = activeOverlays.has(key)
          const color = SUPPLY_COLORS[key]
          return (
            <button
              key={key}
              onClick={() => toggleOverlay(key)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all duration-200"
              style={{
                borderColor: active ? color : 'var(--border-default)',
                backgroundColor: active ? `${color}22` : 'transparent',
                color: active ? color : 'var(--text-muted)',
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: active ? color : 'var(--text-muted)' }}
              />
              {SUPPLY_LABELS[key]}
            </button>
          )
        })}
      </div>

      {/* Main time-series chart */}
      <ChartWrapper
        title="DA price history"
        subtitle="EUR/MWh · hourly"
        loading={chartLoading}
        error={chartError as Error | null}
        height={380}
        exportData={exportData}
        exportFilename="da_price_history"
      >
        <TradingViewChart
          series={chartSeries}
          height={380}
          onVisibleRangeChange={handleVisibleRangeChange}
        />
      </ChartWrapper>

      {/* Duration curve + Heatmap */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Duration curve */}
        <ChartWrapper
          title="Price duration curve"
          subtitle="Sorted hours descending"
          loading={durationLoading}
          error={durationError as Error | null}
          height={320}
          exportData={
            durationCurvesData
              ? durationCurvesData.years.flatMap((y) =>
                  (durationCurvesData.curves[String(y)] ?? []).map(([pct, price]) => ({
                    year: y,
                    pct_of_hours: pct,
                    price_eur_mwh: price,
                  })),
                )
              : []
          }
          exportFilename="duration_curves_by_year"
        >
          <EChartsWrapper option={durationOption} height={290} />
        </ChartWrapper>

        {/* Heatmap */}
        <ChartWrapper
          title="Price heatmap"
          subtitle="Avg EUR/MWh by hour × month"
          loading={heatmapLoading}
          error={heatmapError as Error | null}
          height={320}
          exportFilename={`heatmap_${heatmapYear}`}
        >
          <div className="flex items-center justify-between mb-2">
            <div />
            <YearSelector
              value={heatmapYear}
              onChange={(y) => {
                setHeatmapYearTouched(true)
                setHeatmapYear(y)
              }}
              options={yearOptions}
            />
          </div>
          <EChartsWrapper option={heatmapOption} height={280} />
        </ChartWrapper>
      </div>
    </PageShell>
  )
}
