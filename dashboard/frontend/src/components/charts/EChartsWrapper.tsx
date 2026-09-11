// Use the ESM variant: lib/core.js is CJS and Vite's CJS-default interop
// occasionally surfaces the module-namespace object instead of the
// default export, which makes React render fail with
// "Element type is invalid: ... but got: object". The ESM variant
// always resolves the default export cleanly.
import ReactEChartsCore from 'echarts-for-react/esm/core'
import * as echarts from 'echarts/core'
import {
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
} from 'echarts/charts'
import {
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components'
// ECharts 6 split grid.containLabel out into a separate feature so it can
// be tree-shaken. We rely on it across every chart's grid config, so opt
// into the legacy behaviour explicitly. Alternative: migrate every chart
// to grid.outerBounds, but that's a larger change.
import { LegacyGridContainLabel } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import { useMemo } from 'react'
import { FONT_MONO, FONT_SANS, type ChartTheme } from '../../lib/echarts-theme'
import { useChartTheme } from '../../hooks/useChartTheme'

// Register only the parts of ECharts that the dashboard actually uses,
// trimming the bundle from the full ~1.1 MB monolith down to ~650 KB.
// If you add a new chart type or option (e.g. dataZoom), import it from
// echarts/charts or echarts/components and add it to the use() list.
echarts.use([
  LineChart,
  BarChart,
  ScatterChart,
  PieChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  MarkLineComponent,
  AxisPointerComponent,
  LegacyGridContainLabel,
  CanvasRenderer,
])

interface EChartsWrapperProps {
  option: EChartsOption
  height?: number | string
  loading?: boolean
  className?: string
  style?: React.CSSProperties
}

function themeOverrides(t: ChartTheme): Partial<EChartsOption> {
  return {
    backgroundColor: 'transparent',
    color: [...t.series],
    tooltip: {
      backgroundColor: t.elevated,
      borderColor: t.border,
      textStyle: { color: t.text, fontFamily: FONT_MONO, fontSize: 12 },
      extraCssText: 'box-shadow: 0 4px 20px rgba(4,8,24,0.35); border-radius: 8px;',
    },
    legend: {
      textStyle: { color: t.muted, fontFamily: FONT_SANS, fontSize: 12 },
      inactiveColor: t.border,
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: {
      top: 40,
      right: 20,
      bottom: 40,
      left: 60,
      containLabel: true,
    },
  }
}

function mergeDeep<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target } as T
  for (const key in source) {
    const src = source[key]
    const tgt = target[key]
    if (src && typeof src === 'object' && !Array.isArray(src) && tgt && typeof tgt === 'object') {
      result[key] = mergeDeep(tgt as object, src as object) as T[typeof key]
    } else if (src !== undefined) {
      result[key] = src as T[typeof key]
    }
  }
  return result
}

export default function EChartsWrapper({
  option,
  height = 300,
  loading = false,
  className = '',
  style,
}: EChartsWrapperProps) {
  const theme = useChartTheme()
  const mergedOption = useMemo(
    () => mergeDeep(themeOverrides(theme) as EChartsOption, option),
    [option, theme],
  )

  return (
    <ReactEChartsCore
      echarts={echarts}
      option={mergedOption}
      style={{ height, width: '100%', ...style }}
      className={className}
      showLoading={loading}
      loadingOption={{
        color: theme.accent,
        textColor: theme.muted,
        maskColor: theme.mode === 'dark' ? 'rgba(10, 15, 34, 0.8)' : 'rgba(238, 241, 250, 0.8)',
        text: 'Loading...',
      }}
      opts={{ renderer: 'canvas' }}
      notMerge
    />
  )
}
