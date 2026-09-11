import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useFilterStore } from '../store/filterStore'
import { useChartRange } from '../hooks/useChartRange'
import KpiCard from '../components/common/KpiCard'
import ScenarioSelector from '../components/common/ScenarioSelector'
import DateRangePicker from '../components/common/DateRangePicker'
import ChartWrapper from '../components/common/ChartWrapper'
import TradingViewChart, { type TradingViewSeries } from '../components/charts/TradingViewChart'
import EChartsWrapper from '../components/charts/EChartsWrapper'
import type { EChartsOption } from 'echarts'
import { useChartTheme } from '../hooks/useChartTheme'
import { fmtEur, fmtNum } from '../lib/format'
import { toSeriesPoints } from '../lib/series'
import PageShell from '../components/common/PageShell'

const TARGET_YEARS = [2025, 2030, 2040, 2050]

export default function ForecastPage() {
  const t = useChartTheme()
  const scenario = useFilterStore((s) => s.scenario)
  const dateRange = useFilterStore((s) => s.dateRange)

  // chartRange follows dateRange but lets chart-zoom override it so the
  // backend can refetch at higher resolution. See ElectricityPage for the
  // same pattern + during-render reset.
  const { chartRange, handleVisibleRangeChange } = useChartRange(dateRange)

  const { data: statsData, isLoading: statsLoading, error: statsError } = useQuery({
    queryKey: ['annual-stats', scenario],
    queryFn: () => api.annualStats(scenario),
    enabled: !!scenario,
  })

  const { data: forecastData, isLoading: forecastLoading, error: forecastError } = useQuery({
    queryKey: ['forecast-da', chartRange.start, chartRange.end, scenario],
    queryFn: () => api.forecastDa(chartRange.start, chartRange.end, scenario),
    enabled: !!scenario,
  })

  // KPI helpers: find index by year
  function statForYear(year: number, arr?: number[]): number | undefined {
    if (!statsData || !arr) return undefined
    const idx = statsData.years.indexOf(year)
    return idx >= 0 ? arr[idx] : undefined
  }

  const kpiCards = [
    {
      title: 'Avg DA 2025',
      value: fmtEur(statForYear(2025, statsData?.avg_da)),
      unit: 'EUR/MWh',
    },
    {
      title: 'Avg DA 2030',
      value: fmtEur(statForYear(2030, statsData?.avg_da)),
      unit: 'EUR/MWh',
    },
    {
      title: 'Avg DA 2040',
      value: fmtEur(statForYear(2040, statsData?.avg_da)),
      unit: 'EUR/MWh',
    },
    {
      title: 'Avg DA 2050',
      value: fmtEur(statForYear(2050, statsData?.avg_da)),
      unit: 'EUR/MWh',
    },
    {
      title: 'BESS 4h Rev 2030',
      value: fmtNum(statForYear(2030, statsData?.bess_4h), 1),
      unit: 'k€/MW/y',
    },
  ]

  // DA Forecast chart series. Memoized: an unmemoized series array gets a
  // new identity on every render, which makes TradingViewChart tear down
  // and rebuild all series and snap the zoom back via fitContent().
  const forecastSeries: TradingViewSeries[] = useMemo(() => {
    if (!forecastData) return []
    const series: TradingViewSeries[] = []

    // Actual prices (may be null for future)
    const actualPoints = toSeriesPoints(forecastData.datetime, forecastData.price_actual)
    if (actualPoints.length > 0) {
      series.push({
        data: actualPoints,
        color: t.series[1],
        lineWidth: 1,
        title: 'Actual',
        type: 'line',
      })
    }

    // Predicted prices
    const predictedPoints = toSeriesPoints(forecastData.datetime, forecastData.price_predicted)
    if (predictedPoints.length > 0) {
      series.push({
        data: predictedPoints,
        color: t.series[0],
        lineWidth: 1,
        title: 'Predicted',
        type: 'line',
      })
    }
    return series
  }, [forecastData, t])

  // Annual statistics ECharts bar chart
  const annualStatsOption: EChartsOption = useMemo(() => ({
    color: [t.series[1], t.series[0]],
    legend: { data: ['Avg DA price', 'Daily spread'], top: 4 },
    xAxis: {
      type: 'category',
      data: statsData?.years?.map(String) ?? [],
      axisLabel: { ...t.axisLabel, rotate: 45 },
      axisLine: { lineStyle: { color: t.border } },
    },
    yAxis: {
      type: 'value',
      name: 'EUR/MWh',
      nameTextStyle: t.nameTextStyle,
      axisLabel: t.axisLabel,
      splitLine: t.splitLine,
    },
    series: [
      {
        name: 'Avg DA price',
        type: 'bar',
        barMaxWidth: 14,
        data: statsData?.avg_da?.map((v) => ({
          value: v,
          // error bars via markLine not natively supported in bar, show as itemStyle
          itemStyle: { color: t.series[1] },
        })) ?? [],
      },
      {
        name: 'Daily spread',
        type: 'bar',
        barMaxWidth: 14,
        data: statsData?.spread ?? [],
        itemStyle: { color: t.series[0] },
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const items = params as { seriesName: string; value: number; color: string; dataIndex: number }[]
        const year = statsData?.years?.[items[0]?.dataIndex ?? 0] ?? ''
        const std = statsData?.std_da?.[items[0]?.dataIndex ?? 0]
        const lines = items.map(
          (p) => `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${fmtNum(Number(p.value), 1)} EUR/MWh</b>`,
        )
        if (std != null) {
          lines.push(`<span style="color:${t.muted}">± Std Dev: ${fmtNum(std, 1)} EUR/MWh</span>`)
        }
        return `<div style="${t.tooltipCss}"><b>${year}</b><br/>${lines.join('<br/>')}</div>`
      },
    },
    grid: { top: 48, right: 20, bottom: 56, left: 60, containLabel: true },
  }), [statsData, t])

  // BESS Revenue chart
  const bessRevenueOption: EChartsOption = useMemo(() => ({
    color: [t.series[0], t.series[1], t.series[2], t.series[3], t.series[4]],
    legend: {
      data: ['BESS 2h DA', 'BESS 4h DA', 'BESS 8h DA', 'ID3 2h', 'aFRR Energy'],
      top: 4,
    },
    xAxis: {
      type: 'category',
      data: statsData?.years?.map(String) ?? [],
      axisLabel: { ...t.axisLabel, rotate: 45 },
      axisLine: { lineStyle: { color: t.border } },
    },
    yAxis: {
      type: 'value',
      name: 'k€/MW/y',
      nameTextStyle: t.nameTextStyle,
      // API values are already k€/MW/y: no scaling here.
      axisLabel: {
        ...t.axisLabel,
        formatter: (v: number) => fmtNum(v, 0),
      },
      splitLine: t.splitLine,
    },
    series: [
      {
        name: 'BESS 2h DA',
        type: 'bar',
        barMaxWidth: 10,
        data: statsData?.bess_2h ?? [],
        itemStyle: { color: t.series[0] },
      },
      {
        name: 'BESS 4h DA',
        type: 'bar',
        barMaxWidth: 10,
        data: statsData?.bess_4h ?? [],
        itemStyle: { color: t.series[1] },
      },
      {
        name: 'BESS 8h DA',
        type: 'bar',
        barMaxWidth: 10,
        data: statsData?.bess_8h ?? [],
        itemStyle: { color: t.series[2] },
      },
      {
        name: 'ID3 2h',
        type: 'bar',
        barMaxWidth: 10,
        data: statsData?.bess_id3 ?? [],
        itemStyle: { color: t.series[3] },
      },
      {
        name: 'aFRR Energy',
        type: 'bar',
        barMaxWidth: 10,
        data: statsData?.bess_afrr ?? [],
        itemStyle: { color: t.series[4] },
      },
    ],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: unknown) => {
        const items = params as { seriesName: string; value: number; color: string; dataIndex: number }[]
        const year = statsData?.years?.[items[0]?.dataIndex ?? 0] ?? ''
        const lines = items.map(
          (p) =>
            `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${fmtNum(Number(p.value), 1)} k€/MW/y</b>`,
        )
        return `<div style="${t.tooltipCss}"><b>${year}</b><br/>${lines.join('<br/>')}</div>`
      },
    },
    grid: { top: 56, right: 20, bottom: 56, left: 70, containLabel: true },
  }), [statsData, t])

  // Export data for forecast
  const forecastExport =
    forecastData?.datetime.map((dt, i) => ({
      datetime: dt,
      price_actual: forecastData.price_actual[i] ?? '',
      price_predicted: forecastData.price_predicted[i] ?? '',
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
            Price forecast
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {statsData?.years?.length
              ? `DA, ID3 and balancing market forecasts ${statsData.years[0]}–${statsData.years[statsData.years.length - 1]}`
              : 'DA, ID3 and balancing market forecasts'}
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
          {/* KPI row: 5 cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {kpiCards.map(({ title, value, unit }, i) => (
              <KpiCard
                key={title}
                title={title}
                value={value}
                unit={unit}
                loading={statsLoading}
                staggerIndex={i}
              />
            ))}
          </div>

          {/* DA forecast chart: TradingView */}
          <ChartWrapper
            title="DA price forecast"
            subtitle="EUR/MWh: Actual (amber) vs Predicted (blue)"
            loading={forecastLoading}
            error={forecastError as Error | null}
            height={380}
            exportData={forecastExport}
            exportFilename={`da_forecast_${scenario}`}
          >
            {forecastSeries.length > 0 ? (
              <TradingViewChart
                series={forecastSeries}
                height={380}
                onVisibleRangeChange={handleVisibleRangeChange}
              />
            ) : (
              <div
                className="flex items-center justify-center"
                style={{ height: 380, color: 'var(--text-muted)' }}
              >
                No data for selected range
              </div>
            )}
          </ChartWrapper>

          {/* Annual stats + BESS Revenue */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartWrapper
              title="Annual statistics"
              subtitle="Avg DA price + Daily spread (EUR/MWh)"
              loading={statsLoading}
              error={statsError as Error | null}
              height={320}
              exportData={
                statsData?.years?.map((y, i) => ({
                  year: y,
                  avg_da: statsData.avg_da[i],
                  std_da: statsData.std_da[i],
                  spread: statsData.spread[i],
                })) ?? []
              }
              exportFilename={`annual_stats_${scenario}`}
            >
              <EChartsWrapper option={annualStatsOption} height={320} />
            </ChartWrapper>

            <ChartWrapper
              title="BESS revenue"
              subtitle="EUR/MW/year: by duration and market"
              loading={statsLoading}
              error={statsError as Error | null}
              height={320}
              exportData={
                statsData?.years?.map((y, i) => ({
                  year: y,
                  bess_2h: statsData.bess_2h[i],
                  bess_4h: statsData.bess_4h[i],
                  bess_8h: statsData.bess_8h[i],
                  bess_id3: statsData.bess_id3[i],
                  bess_afrr: statsData.bess_afrr[i],
                })) ?? []
              }
              exportFilename={`bess_revenue_${scenario}`}
            >
              <EChartsWrapper option={bessRevenueOption} height={320} />
            </ChartWrapper>
          </div>

          {/* Summary note */}
          <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif' }}>
            Scenario: <span style={{ color: 'var(--accent-primary)' }}>{scenario}</span>.
            Target years shown: {TARGET_YEARS.join(', ')}.
            BESS revenue = daily top-N discharge hours minus bottom-N charge hours × 365.
          </p>
        </>
      )}
    </PageShell>
  )
}
