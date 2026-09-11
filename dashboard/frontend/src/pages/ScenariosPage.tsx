import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useFilterStore } from '../store/filterStore'
import ScenarioSelector from '../components/common/ScenarioSelector'
import ChartWrapper from '../components/common/ChartWrapper'
import EChartsWrapper from '../components/charts/EChartsWrapper'
import type { EChartsOption } from 'echarts'
import { useChartTheme } from '../hooks/useChartTheme'
import { fmtNum } from '../lib/format'
import PageShell from '../components/common/PageShell'

export default function ScenariosPage() {
  const scenario = useFilterStore((s) => s.scenario)
  const t = useChartTheme()

  const { data, isLoading, error } = useQuery({
    queryKey: ['scenario', scenario],
    queryFn: () => api.scenario(scenario),
    enabled: !!scenario,
  })

  // Capacity stacked area chart
  const capacityOption: EChartsOption = useMemo(() => ({
    color: [t.series[0], t.series[1], t.series[2], t.series[3]],
    legend: {
      data: ['Solar PV', 'Wind onshore', 'Wind offshore', 'BESS'],
      top: 4,
    },
    xAxis: {
      type: 'category',
      data: data?.years?.map(String) ?? [],
      axisLabel: t.axisLabel,
      axisLine: t.axisLine,
    },
    yAxis: {
      type: 'value',
      name: 'GW',
      nameTextStyle: t.nameTextStyle,
      axisLabel: t.axisLabel,
      splitLine: t.splitLine,
    },
    series: [
      {
        name: 'Solar PV',
        type: 'line',
        stack: 'capacity',
        areaStyle: { opacity: 0.7 },
        data: data?.solar_pv_gw ?? [],
      },
      {
        name: 'Wind onshore',
        type: 'line',
        stack: 'capacity',
        areaStyle: { opacity: 0.7 },
        data: data?.wind_on_gw ?? [],
      },
      {
        name: 'Wind offshore',
        type: 'line',
        stack: 'capacity',
        areaStyle: { opacity: 0.7 },
        data: data?.wind_off_gw ?? [],
      },
      {
        name: 'BESS',
        type: 'line',
        stack: 'capacity',
        areaStyle: { opacity: 0.7 },
        data: data?.bess_gw ?? [],
      },
    ],
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const items = params as { seriesName: string; value: number; color: string; dataIndex?: number }[]
        const year = data?.years?.[items[0]?.dataIndex ?? 0] ?? ''
        const lines = items.map(
          (p) => `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${fmtNum(Number(p.value), 1)} GW</b>`,
        )
        return `<div style="${t.tooltipCss}"><b>${year}</b><br/>${lines.join('<br/>')}</div>`
      },
    },
    grid: { top: 48, right: 20, bottom: 40, left: 60, containLabel: true },
  }), [data, t])

  // Commodity futures chart - dual Y-axis
  const commodityOption: EChartsOption = useMemo(() => ({
    color: [t.series[1], t.series[0]],
    legend: {
      data: ['Gas TTF (EUR/MWh)', 'CO2 EUA (EUR/ton)'],
      top: 4,
    },
    xAxis: {
      type: 'category',
      data: data?.years?.map(String) ?? [],
      axisLabel: t.axisLabel,
      axisLine: t.axisLine,
    },
    yAxis: [
      {
        type: 'value',
        name: 'Gas EUR/MWh',
        nameTextStyle: { ...t.nameTextStyle, color: t.series[1] },
        axisLabel: { ...t.axisLabel, color: t.series[1] },
        splitLine: t.splitLine,
      },
      {
        type: 'value',
        name: 'CO2 EUR/ton',
        nameTextStyle: { ...t.nameTextStyle, color: t.series[0] },
        axisLabel: { ...t.axisLabel, color: t.series[0] },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Gas TTF (EUR/MWh)',
        type: 'line',
        yAxisIndex: 0,
        smooth: true,
        lineStyle: { width: 2, color: t.series[1] },
        itemStyle: { color: t.series[1] },
        data: data?.gas_price ?? [],
      },
      {
        name: 'CO2 EUA (EUR/ton)',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        lineStyle: { width: 2, color: t.series[0] },
        itemStyle: { color: t.series[0] },
        data: data?.co2_price ?? [],
      },
    ],
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const items = params as { seriesName: string; value: number; color: string; dataIndex: number }[]
        const year = data?.years?.[items[0]?.dataIndex ?? 0] ?? ''
        const lines = items.map(
          (p) => `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${fmtNum(Number(p.value), 2)}</b>`,
        )
        return `<div style="${t.tooltipCss}"><b>${year}</b><br/>${lines.join('<br/>')}</div>`
      },
    },
    grid: { top: 48, right: 80, bottom: 40, left: 60, containLabel: true },
  }), [data, t])

  // Export data for table
  const tableData =
    data?.years?.map((year, i) => ({
      year,
      solar_pv: data.solar_pv_gw[i] ?? null,
      wind_on: data.wind_on_gw[i] ?? null,
      wind_off: data.wind_off_gw[i] ?? null,
      bess_gw: data.bess_gw[i] ?? null,
      bess_gwh: data.bess_gwh[i] ?? null,
      gas_ttf: data.gas_price[i] ?? null,
      co2: data.co2_price[i] ?? null,
      demand_twh: data.demand_twh[i] ?? null,
    })) ?? []

  const noScenario = !scenario

  return (
    <PageShell>
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-bold"
            style={{ color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}
          >
            Scenario assumptions
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Capacity, technology and commodity price assumptions to 2050
          </p>
        </div>
        <ScenarioSelector />
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
          {/* Charts row */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <ChartWrapper
              title="Installed capacity (GW)"
              subtitle="Solar PV · Wind on/offshore · BESS (stacked)"
              loading={isLoading}
              error={error as Error | null}
              height={320}
              exportData={tableData}
              exportFilename={`capacity_${scenario}`}
            >
              <EChartsWrapper option={capacityOption} height={320} />
            </ChartWrapper>

            <ChartWrapper
              title="Commodity price assumptions"
              subtitle="Gas TTF EUR/MWh · CO2 EUA EUR/ton"
              loading={isLoading}
              error={error as Error | null}
              height={320}
            >
              <EChartsWrapper option={commodityOption} height={320} />
            </ChartWrapper>
          </div>

          {/* Data table */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div
              className="px-4 py-3 border-b"
              style={{ borderColor: 'var(--border-default)' }}
            >
              <h3
                className="text-sm font-semibold"
                style={{ color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}
              >
                Scenario data table
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {scenario}: sorted by year ascending
              </p>
            </div>

            <div className="overflow-x-auto" style={{ maxHeight: 400 }}>
              {isLoading ? (
                <div
                  className="flex items-center justify-center"
                  style={{ height: 120, color: 'var(--text-muted)' }}
                >
                  <div className="skeleton h-4 w-32 rounded" />
                </div>
              ) : (
                <table className="w-full text-xs" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  <thead
                    style={{
                      position: 'sticky',
                      top: 0,
                      backgroundColor: 'var(--bg-elevated)',
                      zIndex: 10,
                    }}
                  >
                    <tr>
                      {['Year', 'Solar PV GW', 'Wind On GW', 'Wind Off GW', 'BESS GW', 'BESS GWh', 'Gas TTF', 'CO2', 'Demand TWh'].map(
                        (col) => (
                          <th
                            key={col}
                            className="px-3 py-2 text-right first:text-left font-medium"
                            style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)' }}
                          >
                            {col}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.map((row, i) => (
                      <tr
                        key={row.year}
                        style={{
                          backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--bg-elevated)',
                        }}
                      >
                        <td className="px-3 py-1.5 font-semibold" style={{ color: 'var(--accent-primary)' }}>
                          {row.year}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                          {fmtNum(row.solar_pv, 1)}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                          {fmtNum(row.wind_on, 1)}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                          {fmtNum(row.wind_off, 1)}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                          {fmtNum(row.bess_gw, 1)}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-primary)' }}>
                          {fmtNum(row.bess_gwh, 1)}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: t.series[1] }}>
                          {fmtNum(row.gas_ttf, 2)}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: t.series[0] }}>
                          {fmtNum(row.co2, 2)}
                        </td>
                        <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>
                          {fmtNum(row.demand_twh, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </PageShell>
  )
}
