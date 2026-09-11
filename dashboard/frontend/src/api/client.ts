import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

const BASE = '/api'

async function fetchJson<T>(
  path: string,
  params?: Record<string, string | number | boolean>,
): Promise<T> {
  const qs = params
    ? '?' +
      new URLSearchParams(
        Object.fromEntries(
          Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .map(([k, v]) => [k, String(v)]),
        ),
      ).toString()
    : ''
  const res = await fetch(path + qs, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error((detail as { detail?: string }).detail || `API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  health: () => fetchJson<import('../types/api').HealthResponse>(`${BASE}/health`),

  dataStatus: () =>
    fetchJson<import('../types/api').DataStatusResponse>(`${BASE}/data-status`),

  commodities: (start: string, end: string, includeMarginal = false, maxPoints = 5000) =>
    fetchJson<import('../types/api').CommoditiesResponse>(`${BASE}/commodities`, {
      start,
      end,
      include_marginal: includeMarginal,
      max_points: maxPoints,
    }),

  commodityKpi: () =>
    fetchJson<import('../types/api').CommodityKpiResponse>(`${BASE}/commodities/kpi`),

  electricityHistorical: (start: string, end: string, maxPoints = 5000, resolution = 'auto') =>
    fetchJson<import('../types/api').ElectricityHistoricalResponse>(
      `${BASE}/electricity/historical`,
      { start, end, max_points: maxPoints, resolution },
    ),

  durationCurve: (year: number) =>
    fetchJson<import('../types/api').DurationCurveResponse>(
      `${BASE}/electricity/duration-curve`,
      { year },
    ),

  durationCurves: () =>
    fetchJson<import('../types/api').DurationCurvesResponse>(
      `${BASE}/electricity/duration-curves`,
    ),

  heatmap: (year: number) =>
    fetchJson<import('../types/api').HeatmapResponse>(`${BASE}/electricity/heatmap`, { year }),

  mlMetrics: () => fetchJson<import('../types/api').MetricsResponse>(`${BASE}/ml/metrics`),

  mlPredictions: (set: string, maxPoints = 5000) =>
    fetchJson<import('../types/api').PredictionsResponse>(`${BASE}/ml/predictions`, {
      set,
      max_points: maxPoints,
    }),

  correlationMatrix: () =>
    fetchJson<import('../types/api').CorrelationMatrixResponse>(`${BASE}/ml/correlation-matrix`),

  priceDistributions: (source: string, scenario?: string) =>
    fetchJson<import('../types/api').PriceDistributionsResponse>(
      `${BASE}/ml/price-distributions`,
      { source, scenario: scenario || '' },
    ),

  scenariosList: () =>
    fetchJson<import('../types/api').ScenariosListResponse>(`${BASE}/scenarios/list`),

  scenario: (scenario: string) =>
    fetchJson<import('../types/api').ScenarioDataResponse>(`${BASE}/scenarios`, { scenario }),

  forecastDa: (start: string, end: string, scenario: string, maxPoints = 10000, resolution = 'auto') =>
    fetchJson<import('../types/api').DAForecastResponse>(`${BASE}/forecast/da`, {
      start,
      end,
      scenario,
      max_points: maxPoints,
      resolution,
    }),

  forecastId3: (start: string, end: string, scenario: string, maxPoints = 10000) =>
    fetchJson<import('../types/api').ID3ImbalanceResponse>(`${BASE}/forecast/id3-imbalance`, {
      start,
      end,
      scenario,
      max_points: maxPoints,
    }),

  annualStats: (scenario: string) =>
    fetchJson<import('../types/api').AnnualStatsResponse>(`${BASE}/forecast/annual-stats`, {
      scenario,
    }),

  imbalancePrices: (start: string, end: string, maxPoints = 8000) =>
    fetchJson<import('../types/api').ImbalancePricesResponse>(
      `${BASE}/ancillary/imbalance-prices`,
      { start, end, max_points: maxPoints },
    ),

  ancillaryCapacity: (start: string, end: string, scenario: string | null = null, maxPoints = 5000) =>
    fetchJson<import('../types/api').AncillaryCapacityResponse>(`${BASE}/ancillary/capacity`, {
      start,
      end,
      ...(scenario ? { scenario } : {}),
      max_points: maxPoints,
    }),

  ancillaryRevenue: (scenario: string) =>
    fetchJson<import('../types/api').AncillaryRevenueResponse>(`${BASE}/ancillary/revenue`, {
      scenario,
    }),

  regulationStates: (year: number, scenario: string) =>
    fetchJson<import('../types/api').RegulationStatesResponse>(
      `${BASE}/ancillary/regulation-states`,
      { year, scenario },
    ),
}
