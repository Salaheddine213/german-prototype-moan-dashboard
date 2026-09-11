import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useFilterStore } from '../store/filterStore'
import { useChartTheme } from '../hooks/useChartTheme'
import { fmtNum } from '../lib/format'
import KpiCard from '../components/common/KpiCard'
import DateRangePicker from '../components/common/DateRangePicker'
import ChartWrapper from '../components/common/ChartWrapper'
import TradingViewChart, { type TradingViewSeries } from '../components/charts/TradingViewChart'
import type { UTCTimestamp } from 'lightweight-charts'
import PageShell from '../components/common/PageShell'

const SERIES_LABELS: Record<string, string> = {
  gas_ttf: 'Gas TTF',
  co2_eua: 'CO2 EUA',
  coal_api2: 'Coal API2 (USD/t)',
  coal_eur_mwh: 'Coal API2 (EUR/MWh_th)',
  eur_usd: 'EUR/USD',
  gas_marginal: 'Gas marginal',
  coal_marginal: 'Coal marginal',
}

const SERIES_UNITS: Record<string, string> = {
  gas_ttf: 'EUR/MWh',
  co2_eua: 'EUR/ton',
  coal_api2: 'USD/ton',
  coal_eur_mwh: 'EUR/MWh_th',
  eur_usd: 'USD/EUR',
  gas_marginal: 'EUR/MWh',
  coal_marginal: 'EUR/MWh',
}

function formatValue(value: number | string | null | undefined, key: string): string {
  if (value == null) return '—'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (key.includes('eur_usd')) return fmtNum(num, 4)
  return fmtNum(num, 2)
}

export default function CommoditiesPage() {
  const t = useChartTheme()
  const dateRange = useFilterStore((s) => s.dateRange)
  const [showMarginal, setShowMarginal] = useState(false)
  // Coal defaults to thermal terms (EUR/MWh_th) so it reads on the same
  // scale as Gas TTF; the raw USD/ton quote stays one toggle away.
  const [activeSeriesKeys, setActiveSeriesKeys] = useState<Set<string>>(
    new Set(['gas_ttf', 'co2_eua', 'coal_eur_mwh']),
  )

  const { data: kpiData, isLoading: kpiLoading } = useQuery({
    queryKey: ['commodity-kpi'],
    queryFn: () => api.commodityKpi(),
  })

  const { data: commodityData, isLoading: chartLoading, error: chartError } = useQuery({
    queryKey: ['commodities', dateRange.start, dateRange.end, showMarginal],
    queryFn: () => api.commodities(dateRange.start, dateRange.end, showMarginal),
  })

  // Series → palette slot, fixed order of appearance in the chart/toggles.
  // coal_marginal keeps t.red (loss-making leg), the rest cycle t.series.
  const seriesColors: Record<string, string> = useMemo(
    () => ({
      gas_ttf: t.series[1],
      co2_eua: t.series[0],
      coal_api2: t.series[3],
      coal_eur_mwh: t.series[4],
      eur_usd: t.series[2],
      gas_marginal: t.series[5],
      coal_marginal: t.red,
    }),
    [t],
  )

  // Build chart series. Memoized so re-renders don't hand TradingViewChart
  // a fresh array identity, which would rebuild the chart and reset zoom.
  const chartSeries: TradingViewSeries[] = useMemo(() => {
    if (!commodityData) return []
    const seriesKeys = ['gas_ttf', 'co2_eua', 'coal_api2', 'coal_eur_mwh', 'eur_usd']
    if (showMarginal) seriesKeys.push('gas_marginal', 'coal_marginal')

    const series: TradingViewSeries[] = []
    seriesKeys.forEach((key) => {
      if (!activeSeriesKeys.has(key)) return
      const raw = commodityData[key as keyof typeof commodityData] as
        | { date: string; value: number }[]
        | undefined
      if (!raw || raw.length === 0) return

      const data = raw
        .map((p) => ({
          time: (new Date(p.date).getTime() / 1000) as UTCTimestamp,
          value: p.value,
        }))
        .sort((a, b) => a.time - b.time)

      series.push({
        data,
        color: seriesColors[key],
        lineWidth: 2,
        title: SERIES_LABELS[key],
        type: 'line',
        unit: SERIES_UNITS[key],
        // EUR/USD is a sub-unit ratio; everything else is a price in 2dp.
        decimals: key === 'eur_usd' ? 4 : 2,
      })
    })
    return series
  }, [commodityData, showMarginal, activeSeriesKeys, seriesColors])

  // KPI cards
  const kpiCards = [
    { key: 'gas_ttf', title: 'Gas TTF', unit: 'EUR/MWh' },
    { key: 'co2_eua', title: 'CO2 EUA', unit: 'EUR/ton' },
    { key: 'coal_eur_mwh', title: 'Coal API2', unit: 'EUR/MWh_th' },
    { key: 'coal_api2', title: 'Coal API2', unit: 'USD/ton' },
    { key: 'gas_marginal', title: 'Gas marginal', unit: 'EUR/MWh' },
    { key: 'coal_marginal', title: 'Coal marginal', unit: 'EUR/MWh' },
  ]

  function toggleSeries(key: string) {
    setActiveSeriesKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        if (next.size > 1) next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Export data: build a merged date→row lookup so each row in the CSV
  // has matched values. Each series may have different LTTB-sampled dates,
  // so we cannot zip by index. Instead we union all dates and emit one row
  // per date with nulls for missing series values.
  const exportData = (() => {
    if (!commodityData) return []
    const seriesKeys = ['gas_ttf', 'co2_eua', 'coal_api2', 'coal_eur_mwh', 'eur_usd'] as const
    type SeriesKey = (typeof seriesKeys)[number]

    // Build a date → value map for each series
    const byDate: Record<string, Partial<Record<SeriesKey, number>>> = {}
    for (const key of seriesKeys) {
      const raw = commodityData[key] as { date: string; value: number }[] | undefined
      if (!raw) continue
      for (const p of raw) {
        if (!byDate[p.date]) byDate[p.date] = {}
        byDate[p.date][key] = p.value
      }
    }

    // Emit one row per date, sorted ascending
    return Object.keys(byDate)
      .sort()
      .map((date) => ({
        date,
        gas_ttf: byDate[date].gas_ttf ?? '',
        co2_eua: byDate[date].co2_eua ?? '',
        coal_api2: byDate[date].coal_api2 ?? '',
        coal_eur_mwh: byDate[date].coal_eur_mwh ?? '',
        eur_usd: byDate[date].eur_usd ?? '',
      }))
  })()

  return (
    <PageShell>
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-bold"
            style={{ color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}
          >
            Commodity markets
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Fuel & carbon prices driving German electricity marginal costs
          </p>
        </div>
        <DateRangePicker />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpiCards.map(({ key, title, unit }, i) => (
          <KpiCard
            key={key}
            title={title}
            value={formatValue(kpiData?.[`${key}_latest`], key)}
            change={
              kpiData?.[`${key}_change`] != null
                ? parseFloat(String(kpiData[`${key}_change`]))
                : undefined
            }
            unit={unit}
            asOf={kpiData?.[`${key}_date`] as string | undefined}
            loading={kpiLoading}
            staggerIndex={i}
          />
        ))}
      </div>

      {/* Series toggles */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Series:
        </span>
        {Object.entries(SERIES_LABELS).map(([key, label]) => {
          const isMarginal = key.includes('marginal')
          if (isMarginal && !showMarginal) return null
          const active = activeSeriesKeys.has(key)
          return (
            <button
              key={key}
              onClick={() => toggleSeries(key)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all duration-200"
              style={{
                borderColor: active ? seriesColors[key] : 'var(--border-default)',
                backgroundColor: active ? `${seriesColors[key]}22` : 'transparent',
                color: active ? seriesColors[key] : 'var(--text-muted)',
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: active ? seriesColors[key] : 'var(--text-muted)' }}
              />
              {label}
            </button>
          )
        })}

        {/* Marginal cost toggle */}
        <button
          onClick={() => {
            setShowMarginal(!showMarginal)
            if (!showMarginal) {
              setActiveSeriesKeys((prev) => new Set([...prev, 'gas_marginal', 'coal_marginal']))
            } else {
              setActiveSeriesKeys((prev) => {
                const next = new Set(prev)
                next.delete('gas_marginal')
                next.delete('coal_marginal')
                return next
              })
            }
          }}
          className="ml-2 px-2.5 py-1 rounded-full text-xs border transition-all duration-200"
          style={{
            borderColor: showMarginal ? 'var(--accent-primary)' : 'var(--border-default)',
            backgroundColor: showMarginal ? `${t.accent}26` : 'transparent',
            color: showMarginal ? 'var(--accent-primary)' : 'var(--text-muted)',
          }}
        >
          {showMarginal ? 'Hide' : 'Show'} marginal costs
        </button>
      </div>

      {/* Main chart */}
      <ChartWrapper
        title="Commodity price history"
        subtitle={`${SERIES_UNITS.gas_ttf} / ${SERIES_UNITS.co2_eua} / ${SERIES_UNITS.coal_api2}`}
        loading={chartLoading}
        error={chartError as Error | null}
        height={380}
        exportData={exportData}
        exportFilename="commodities"
      >
        <TradingViewChart series={chartSeries} height={380} />
      </ChartWrapper>

      {/* Summary note */}
      <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'Outfit, sans-serif' }}>
        Coal EUR/MWh_th = Coal_USD / 6.978 / EUR_USD (25.12 GJ/ton LHV, daily EUR/USD
        forward-filled), shown by default so coal reads on the same energy scale as Gas TTF.
        Gas marginal cost = (Gas TTF · 1.108 + CO2 · 0.202) / 0.58: TTF is per MWh_HHV but
        plant efficiency is reported on LHV; the 1.108 factor converts HHV→LHV before applying
        58% LHV efficiency and 202 kg CO2/MWh_LHV (IPCC NCV).
        Coal marginal cost = (Coal EUR/MWh_th + CO2 · 0.335) / 0.46 (46% efficiency,
        335 kg CO2/MWh_th). CO2 legs use the most recent settle (forward-filled).
      </p>
    </PageShell>
  )
}
