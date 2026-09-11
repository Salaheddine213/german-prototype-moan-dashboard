import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { UTCTimestamp } from 'lightweight-charts'
import { api } from '../api/client'
import { useFilterStore } from '../store/filterStore'
import KpiCard from '../components/common/KpiCard'
import ScenarioSelector from '../components/common/ScenarioSelector'
import DateRangePicker from '../components/common/DateRangePicker'
import ChartWrapper from '../components/common/ChartWrapper'
import TradingViewChart, { type TradingViewSeries } from '../components/charts/TradingViewChart'
import EChartsWrapper from '../components/charts/EChartsWrapper'
import type { EChartsOption } from 'echarts'
import { useChartTheme } from '../hooks/useChartTheme'
import type { ChartTheme } from '../lib/echarts-theme'
import { fmtEur, fmtNum } from '../lib/format'
import { toSeriesPoints } from '../lib/series'
import PageShell from '../components/common/PageShell'

// State labels and colors for regulation donut
function getStateConfig(t: ChartTheme): Record<number, { label: string; color: string }> {
  return {
    [-1]: { label: 'Down reg', color: t.series[0] },
    [0]: { label: 'No reg', color: t.muted },
    [1]: { label: 'Up reg', color: t.series[1] },
    [2]: { label: 'Mixed', color: t.series[3] },
  }
}


export default function AncillaryPage() {
  const t = useChartTheme()
  const scenario = useFilterStore((s) => s.scenario)
  const dateRange = useFilterStore((s) => s.dateRange)
  const [selectedYear, setSelectedYear] = useState<number>(2025)
  // BESS revenue stacking is misleading by default - the same MW can't
  // simultaneously earn aFRR cap, FCR cap, AND aFRR energy. 'split-mw'
  // assumes the operator co-deploys (the upper-bound), 'best-market'
  // shows the realistic single-strategy revenue per year.
  const [revenueMode, setRevenueMode] = useState<'split-mw' | 'best-market'>('split-mw')

  // Capacity prices come from DuckDB historical first; the scenario-driven
  // forecast file only fills in the future tail. So this query runs even
  // before the scenario is selected - historical prices need no scenario.
  const { data: capacityData, isLoading: capacityLoading, error: capacityError } = useQuery({
    queryKey: ['ancillary-capacity', dateRange.start, dateRange.end, scenario],
    queryFn: () => api.ancillaryCapacity(dateRange.start, dateRange.end, scenario || null),
  })

  const { data: revenueData, isLoading: revenueLoading, error: revenueError } = useQuery({
    queryKey: ['ancillary-revenue', scenario],
    queryFn: () => api.ancillaryRevenue(scenario),
    enabled: !!scenario,
  })

  const { data: regStates, isLoading: regLoading, error: regError } = useQuery({
    queryKey: ['regulation-states', selectedYear, scenario],
    queryFn: () => api.regulationStates(selectedYear, scenario),
    enabled: !!scenario,
  })

  // KPI helpers
  function latestCapacity(arr?: (number | null)[]): number | undefined {
    if (!arr || arr.length === 0) return undefined
    // Walk from the tail to skip trailing nulls - the latest *actual* price.
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = arr[i]
      if (v != null) return v
    }
    return undefined
  }

  function revenueForYear(year: number, arr?: number[]): number | undefined {
    if (!revenueData || !arr) return undefined
    const idx = revenueData.years.indexOf(year)
    return idx >= 0 ? arr[idx] : undefined
  }

  const kpiCards = [
    {
      title: 'aFRR cap price (latest)',
      value: fmtEur(latestCapacity(capacityData?.afrr_cap_up), 2),
      unit: 'EUR/MW/h',
    },
    {
      title: 'FCR cap price (latest)',
      value: fmtEur(latestCapacity(capacityData?.fcr_cap_price), 2),
      unit: 'EUR/MW/h',
    },
    {
      title: 'aFRR cap rev 2030',
      value: fmtNum(revenueForYear(2030, revenueData?.afrr_cap_revenue), 1),
      unit: 'k€/MW/y',
    },
    {
      title: 'FCR cap rev 2030',
      value: fmtNum(revenueForYear(2030, revenueData?.fcr_cap_revenue), 1),
      unit: 'k€/MW/y',
    },
  ]

  // Capacity prices: split each metric into solid (historical) + dashed
  // (forecast) sub-series so the boundary is readable on the chart. The
  // last historical point is repeated as the first forecast point so the
  // dashed line picks up cleanly where the solid one ends (no visual gap).
  // Memoized so re-renders don't rebuild the chart and reset zoom.
  const capacitySeries: TradingViewSeries[] = useMemo(() => {
    if (!capacityData || capacityData.datetime.length === 0) return []
    const sources = capacityData.data_source ?? []
    const lastHistIdx = sources.lastIndexOf('historical')

    const toPoints = (arr: (number | null)[], range: 'historical' | 'forecast'): { time: UTCTimestamp; value: number }[] => {
      const out: { time: UTCTimestamp; value: number }[] = []
      for (let i = 0; i < capacityData.datetime.length; i++) {
        const v = arr[i]
        if (v == null || isNaN(v)) continue
        const src = sources[i] ?? 'historical'
        const include =
          range === 'historical'
            ? src === 'historical'
            // For 'forecast' include the last historical point as a bridge so
            // the dashed line connects to the solid one at the boundary.
            : src === 'forecast' || i === lastHistIdx
        if (!include) continue
        out.push({
          time: (new Date(capacityData.datetime[i]).getTime() / 1000) as UTCTimestamp,
          value: v,
        })
      }
      return out.sort((a, b) => a.time - b.time)
    }

    const series: TradingViewSeries[] = []
    const metrics: { key: keyof typeof capacityData; color: string; title: string }[] = [
      { key: 'afrr_cap_up', color: t.series[1], title: 'aFRR cap up' },
      { key: 'afrr_cap_down', color: t.series[0], title: 'aFRR cap down' },
      { key: 'fcr_cap_price', color: t.series[3], title: 'FCR cap' },
    ]
    for (const { key, color, title } of metrics) {
      const arr = capacityData[key] as (number | null)[]
      const hist = toPoints(arr, 'historical')
      const fcst = toPoints(arr, 'forecast')
      if (hist.length) series.push({ data: hist, color, lineWidth: 1, title, type: 'line', lineStyle: 'solid' })
      if (fcst.length) series.push({ data: fcst, color, lineWidth: 1, title: `${title} (forecast)`, type: 'line', lineStyle: 'dashed' })
    }
    return series
  }, [capacityData, t])

  // 15-min imbalance + aFRR energy prices - historical-only, no scenario.
  const { data: imbData, isLoading: imbLoading, error: imbError } = useQuery({
    queryKey: ['imbalance-prices', dateRange.start, dateRange.end],
    queryFn: () => api.imbalancePrices(dateRange.start, dateRange.end),
  })

  const imbalanceSeries: TradingViewSeries[] = useMemo(() => {
    if (!imbData || imbData.timestamp.length === 0) return []
    return [
      { data: toSeriesPoints(imbData.timestamp, imbData.afrr_energy_up), color: t.red, lineWidth: 1, title: 'aFRR energy up', type: 'line' as const },
      { data: toSeriesPoints(imbData.timestamp, imbData.afrr_energy_down), color: t.series[5], lineWidth: 1, title: 'aFRR energy down', type: 'line' as const },
      { data: toSeriesPoints(imbData.timestamp, imbData.imb_short), color: t.amber, lineWidth: 1, title: 'Imb short', type: 'line' as const },
      { data: toSeriesPoints(imbData.timestamp, imbData.imb_long), color: t.series[2], lineWidth: 1, title: 'Imb long', type: 'line' as const },
    ]
  }, [imbData, t])

  // Annual revenue stacked bar
  const revenueOption: EChartsOption = useMemo(() => ({
    color: [t.series[2], t.series[3], t.series[5]],
    legend: {
      data: ['aFRR capacity', 'FCR capacity', 'aFRR energy'],
      top: 4,
    },
    xAxis: {
      type: 'category',
      data: revenueData?.years?.map(String) ?? [],
      axisLabel: { ...t.axisLabel, rotate: 45 },
      axisLine: { lineStyle: { color: t.border } },
    },
    yAxis: {
      type: 'value',
      name: 'k€/MW/y',
      nameTextStyle: t.nameTextStyle,
      axisLabel: {
        ...t.axisLabel,
        formatter: (v: number) => fmtNum(v, 0),
      },
      splitLine: t.splitLine,
    },
    series: [
      {
        name: 'aFRR capacity',
        type: 'bar',
        stack: revenueMode === 'split-mw' ? 'revenue' : undefined,
        barMaxWidth: 20,
        data: revenueData?.afrr_cap_revenue ?? [],
        itemStyle: { color: t.series[2] },
      },
      {
        name: 'FCR capacity',
        type: 'bar',
        stack: revenueMode === 'split-mw' ? 'revenue' : undefined,
        barMaxWidth: 20,
        data: revenueData?.fcr_cap_revenue ?? [],
        itemStyle: { color: t.series[3] },
      },
      {
        name: 'aFRR energy',
        type: 'bar',
        stack: revenueMode === 'split-mw' ? 'revenue' : undefined,
        barMaxWidth: 20,
        data: revenueData?.afrr_energy_revenue ?? [],
        itemStyle: { color: t.series[5] },
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const items = params as { seriesName: string; value: number; color: string; dataIndex: number }[]
        const year = revenueData?.years?.[items[0]?.dataIndex ?? 0] ?? ''
        const total = items.reduce((s, p) => s + Number(p.value || 0), 0)
        const lines = items.map(
          (p) =>
            `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${fmtNum(Number(p.value), 1)} k€/MW/y</b>`,
        )
        lines.push(`<b>Total: ${fmtNum(total, 1)} k€/MW/y</b>`)
        return `<div style="${t.tooltipCss}"><b>${year}</b><br/>${lines.join('<br/>')}</div>`
      },
    },
    grid: { top: 48, right: 20, bottom: 56, left: 70, containLabel: true },
  }), [revenueData, revenueMode, t])

  // State labels and colors for regulation donut, keyed to the active theme
  const stateConfig = useMemo(() => getStateConfig(t), [t])

  // Regulation states donut chart
  const donutData = useMemo(() =>
    regStates?.states?.map((s) => ({
      name: stateConfig[s.state]?.label ?? `State ${s.state}`,
      value: s.count,
      itemStyle: { color: stateConfig[s.state]?.color ?? t.muted },
    })) ?? [],
    [regStates, stateConfig, t],
  )

  const regulationOption: EChartsOption = useMemo(() => ({
    legend: {
      orient: 'vertical',
      right: 10,
      top: 'center',
      textStyle: { color: t.muted, fontFamily: 'Outfit, sans-serif', fontSize: 12 },
    },
    series: [
      {
        name: 'Regulation state',
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['40%', '50%'],
        avoidLabelOverlap: true,
        label: {
          show: true,
          formatter: ((p: { name?: string; percent?: number }) => `${p.name ?? ''}\n${fmtNum(p.percent ?? 0, 1)}%`) as never,
          ...t.axisLabel,
        },
        data: donutData,
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.5)' },
        },
      },
    ],
    tooltip: {
      trigger: 'item',
      formatter: (p: unknown) => {
        const param = p as { name: string; value: number; percent: number; color: string }
        return `<div style="${t.tooltipCss}">
          <span style="color:${param.color}">●</span> <b>${param.name}</b><br/>
          Count: ${param.value.toLocaleString()}<br/>
          Share: <b>${fmtNum(param.percent, 1)}%</b>
        </div>`
      },
    },
  }), [donutData, t])

  // Year options for regulation state selector - derived from the global
  // dateRange so the list always covers the selected data window, plus a
  // sensible future cap so it doesn't grow unboundedly.
  const yearOptions = useMemo(() => {
    const startYear = parseInt(dateRange.start.slice(0, 4), 10)
    const endYear = Math.min(
      Math.max(parseInt(dateRange.end.slice(0, 4), 10), new Date().getFullYear()),
      2050,
    )
    const count = endYear - startYear + 1
    return Array.from({ length: count }, (_, i) => startYear + i)
  }, [dateRange.start, dateRange.end])

  // Export data for capacity
  const capacityExport =
    capacityData?.datetime.map((dt, i) => ({
      datetime: dt,
      afrr_cap_up: capacityData.afrr_cap_up[i],
      afrr_cap_down: capacityData.afrr_cap_down[i],
      fcr_cap_price: capacityData.fcr_cap_price[i],
    })) ?? []

  const noScenario = !scenario

  return (
    <PageShell>
      {/* Page header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-xl font-bold"
            style={{ color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}
          >
            Ancillary markets
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            aFRR and FCR capacity revenues, regulation states and imbalance prices
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ScenarioSelector />
          <DateRangePicker />
        </div>
      </div>

      {noScenario ? (
        <div
          className="flex items-center justify-center rounded-xl border"
          style={{
            height: 200,
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
            color: 'var(--text-muted)',
          }}
        >
          <p className="text-sm" style={{ fontFamily: 'Outfit, sans-serif' }}>
            Select a scenario to view data
          </p>
        </div>
      ) : (
        <>
          {/* KPI row - 4 cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {kpiCards.map(({ title, value, unit }, i) => (
              <KpiCard
                key={title}
                title={title}
                value={value}
                unit={unit}
                loading={capacityLoading || revenueLoading}
                staggerIndex={i}
              />
            ))}
          </div>

          {/* Capacity prices - TradingView. Historical = solid lines from
              DuckDB ts_4hourly; forecast = dashed lines from
              predictions_aFRR_FCR_capacity_4h. Heads-up: the forecast file
              currently emits a daily-aggregated value replicated across all
              6 blocks per day, so its absolute level can be ~10× the
              per-block historical scale. Treat the dashed segment as a
              relative-shape signal until the upstream unit mismatch is
              reconciled. */}
          <ChartWrapper
            title="Capacity prices"
            subtitle="EUR/MW/h · aFRR up/down · FCR (solid: actuals, dashed: forecast)"
            loading={capacityLoading}
            error={capacityError as Error | null}
            height={320}
            exportData={capacityExport}
            exportFilename={`ancillary_capacity_${scenario}`}
          >
            {capacitySeries.length > 0 ? (
              <TradingViewChart series={capacitySeries} height={320} />
            ) : (
              <div
                className="flex items-center justify-center"
                style={{ height: 320, color: 'var(--text-muted)' }}
              >
                No capacity price data for selected range
              </div>
            )}
          </ChartWrapper>

          {/* aFRR energy + imbalance prices - historical-only at 15-min granularity */}
          <ChartWrapper
            title="Imbalance & aFRR energy prices"
            subtitle="EUR/MWh · 15-min prices from the German TSOs (ts_15min)"
            loading={imbLoading}
            error={imbError as Error | null}
            height={320}
            exportData={
              imbData?.timestamp.map((ts, i) => ({
                timestamp: ts,
                afrr_energy_up: imbData.afrr_energy_up[i] ?? '',
                afrr_energy_down: imbData.afrr_energy_down[i] ?? '',
                imb_long: imbData.imb_long[i] ?? '',
                imb_short: imbData.imb_short[i] ?? '',
              })) ?? []
            }
            exportFilename="ancillary_imbalance_prices"
          >
            {imbalanceSeries.length > 0 ? (
              <TradingViewChart series={imbalanceSeries} height={320} />
            ) : (
              <div
                className="flex items-center justify-center"
                style={{ height: 320, color: 'var(--text-muted)' }}
              >
                No imbalance data for selected range
              </div>
            )}
          </ChartWrapper>

          {/* Annual revenue + Regulation states */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartWrapper
              title="Annual ancillary revenue"
              subtitle={
                revenueMode === 'split-mw'
                  ? 'k€/MW/y · stacked, assumes the operator splits MW across all three products'
                  : 'k€/MW/y · side-by-side, single-product strategy per MW'
              }
              loading={revenueLoading}
              error={revenueError as Error | null}
              height={320}
              exportData={
                revenueData?.years?.map((y, i) => ({
                  year: y,
                  afrr_cap: revenueData.afrr_cap_revenue[i],
                  fcr_cap: revenueData.fcr_cap_revenue[i],
                  afrr_energy: revenueData.afrr_energy_revenue[i],
                })) ?? []
              }
              exportFilename={`ancillary_revenue_${scenario}`}
            >
              <div className="flex items-center justify-end gap-1 mb-2">
                {(['split-mw', 'best-market'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setRevenueMode(mode)}
                    className="px-2 py-0.5 text-[10px] rounded-full border transition-colors"
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      borderColor:
                        revenueMode === mode ? 'var(--accent-primary)' : 'var(--border-default)',
                      color: revenueMode === mode ? 'var(--accent-primary)' : 'var(--text-muted)',
                      backgroundColor:
                        revenueMode === mode
                          ? 'color-mix(in srgb, var(--accent-primary) 10%, transparent)'
                          : 'transparent',
                    }}
                    title={
                      mode === 'split-mw'
                        ? 'Stacked: assumes the same MW earns all three products simultaneously (upper bound)'
                        : 'Side-by-side: realistic single-product per MW (mutually exclusive capacity reservation)'
                    }
                  >
                    {mode === 'split-mw' ? 'Split MW' : 'Best market'}
                  </button>
                ))}
              </div>
              <EChartsWrapper option={revenueOption} height={290} />
            </ChartWrapper>

            <ChartWrapper
              title="Regulation states"
              subtitle={`Distribution for ${selectedYear}`}
              loading={regLoading}
              error={regError as Error | null}
              height={320}
            >
              {/* Year selector */}
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Year:
                </span>
                <select
                  id="ancillary-year"
                  name="year"
                  aria-label="Year"
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(Number(e.target.value))}
                  className="appearance-none px-2 py-1 text-xs rounded-lg border transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-default)',
                    color: 'var(--text-primary)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                {regStates?.total_intervals != null && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {regStates.total_intervals.toLocaleString()} intervals
                  </span>
                )}
              </div>
              {donutData.length > 0 ? (
                <EChartsWrapper option={regulationOption} height={270} />
              ) : (
                <div
                  className="flex items-center justify-center"
                  style={{ height: 270, color: 'var(--text-muted)' }}
                >
                  No regulation state data for {selectedYear}
                </div>
              )}
            </ChartWrapper>
          </div>

          {/* Legend for state colors */}
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Regulation states:
            </span>
            {Object.entries(stateConfig).map(([state, { label, color }]) => (
              <div key={state} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </PageShell>
  )
}
