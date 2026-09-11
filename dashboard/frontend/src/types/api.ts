export interface CommodityPoint {
  date: string
  value: number
}

export interface CommoditiesResponse {
  gas_ttf: CommodityPoint[]
  co2_eua: CommodityPoint[]
  coal_api2: CommodityPoint[]
  coal_eur_mwh: CommodityPoint[]  // Coal API2 in thermal terms (EUR/MWh_th)
  eur_usd: CommodityPoint[]
  gas_marginal?: CommodityPoint[]
  coal_marginal?: CommodityPoint[]
}

export interface CommodityKpiResponse {
  [key: string]: number | string
  // gas_ttf_latest, gas_ttf_change, gas_ttf_date, etc.
}

export interface ElectricityHistoricalResponse {
  da_prices: { timestamp: string; value: number }[]
  supply: {
    timestamp: string
    load?: number
    pv?: number
    wind_onshore?: number
    wind_offshore?: number
    exchange?: number
  }[]
}

export interface DurationCurveResponse {
  sorted_prices: number[]
  negative_hours: number
  peak_hours: number
  total_hours: number
}

export interface DurationCurvesResponse {
  years: number[]
  curves: Record<string, [number, number][]>  // year → list of [pct_of_hours, price]
  stats: Record<string, { total_hours: number; negative_hours: number; peak_hours: number }>
}

export interface HeatmapResponse {
  hours: number[]
  months: number[]
  values: (number | null)[][]  // null = no data for that (hour, month) cell
}

export interface MetricsResponse {
  training: {
    mae: number
    rmse: number
    r2: number
    correlation: number
    samples: number
  }
  validation: {
    mae: number
    rmse: number
    r2: number
    correlation: number
    samples: number
  }
  price_bands: {
    name: string
    count: number
    pct: number
    mae: number
    correlation: number
  }[]
  bess: {
    capture_rate: number
    spearman: number
    spread_mae: number
  }
  weights: {
    lightgbm: number
    catboost: number
  }
  feature_importance: {
    name: string
    importance: number
  }[]
  features: string[]
}

export interface PredictionsResponse {
  datetime: string[]
  actual: number[]
  predicted: number[]
  residuals: number[]
}

export interface CorrelationMatrixResponse {
  features: string[]
  matrix: number[][]
}

export interface PriceDistribution {
  year: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
  mean: number
  std: number
  kde_x: number[]
  kde_y: number[]
}

export interface PriceDistributionsResponse {
  years: number[]
  distributions: PriceDistribution[]
}

export interface ScenariosListResponse {
  scenarios: string[]
}

export interface ScenarioDataResponse {
  years: number[]
  scenario: string
  solar_pv_gw: number[]
  wind_on_gw: number[]
  wind_off_gw: number[]
  bess_gw: number[]
  bess_gwh: number[]
  gas_price: number[]
  co2_price: number[]
  demand_twh: number[]
  power_base: number[]
  must_run: number[]
  nuclear: number[]
}

export interface DAForecastResponse {
  datetime: string[]
  price_actual: (number | null)[]
  price_predicted: (number | null)[]
}

export interface ID3ImbalanceResponse {
  datetime: string[]
  da_price: (number | null)[]
  id3_price: (number | null)[]
  afrr_up: (number | null)[]
  afrr_down: (number | null)[]
  imb_long: (number | null)[]
  imb_short: (number | null)[]
  reg_state: (number | null)[]
}

export interface AnnualStatsResponse {
  years: number[]
  avg_da: number[]
  std_da: number[]
  spread: number[]
  negative_hours: number[]
  peak_hours: number[]
  bess_2h: number[]
  bess_4h: number[]
  bess_8h: number[]
  bess_id3: number[]
  bess_afrr: number[]
  afrr_cap_rev: number[]
  fcr_cap_rev: number[]
  solar_capture: number[]
  solar_rev: number[]
  wind_rev: number[]
  demand_twh: number[]
}

export interface AncillaryCapacityResponse {
  datetime: string[]
  afrr_cap_up: (number | null)[]
  afrr_cap_down: (number | null)[]
  fcr_cap_price: (number | null)[]
  afrr_vol_up: (number | null)[]
  afrr_vol_down: (number | null)[]
  fcr_vol: (number | null)[]
  data_source?: ('historical' | 'forecast')[]
}

export interface DataStatusSource {
  table: string
  source: string
  latest_data_utc: string
  last_ingest_utc: string | null
  lag_hours: number
  rows_total: number
  status: 'fresh' | 'warn' | 'stale'
}

export interface DataStatusResponse {
  as_of_utc: string
  sources: DataStatusSource[]
  summary: { fresh: number; warn: number; stale: number }
}

export interface ImbalancePricesResponse {
  timestamp: string[]
  afrr_energy_up: (number | null)[]
  afrr_energy_down: (number | null)[]
  imb_long: (number | null)[]
  imb_short: (number | null)[]
}

export interface AncillaryRevenueResponse {
  years: number[]
  afrr_cap_revenue: number[]
  fcr_cap_revenue: number[]
  afrr_energy_revenue: number[]
}

export interface RegulationStatesResponse {
  states: {
    state: number
    label: string
    count: number
    percentage: number
  }[]
  year: number
  total_intervals: number
}

export interface HealthResponse {
  status: string
  data_mode: string
  data_loaded: boolean
  last_model: string | null
  last_forecast: string | null
  scenarios: string[]
  db_tables: Record<string, number>
}
