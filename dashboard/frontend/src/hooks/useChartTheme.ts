import { useEffect, useMemo, useState } from 'react'
import { useFilterStore } from '../store/filterStore'
import { getChartTheme, type ChartTheme, type ThemeMode } from '../lib/echarts-theme'

function systemMode(): ThemeMode {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** The theme actually in effect ('system' resolved via prefers-color-scheme). */
export function useResolvedTheme(): ThemeMode {
  const theme = useFilterStore((s) => s.theme)
  const [system, setSystem] = useState<ThemeMode>(systemMode)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setSystem(systemMode())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return theme === 'system' ? system : theme
}

/**
 * Chart style tokens for the active theme. Canvas renderers can't read CSS
 * variables, so charts take their colors from here and re-render when the
 * theme changes.
 */
export function useChartTheme(): ChartTheme {
  const mode = useResolvedTheme()
  return useMemo(() => getChartTheme(mode), [mode])
}
