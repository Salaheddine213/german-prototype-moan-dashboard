/**
 * Shared chart theming - single source of truth for everything drawn on a
 * canvas (ECharts + lightweight-charts). Values mirror the CSS custom
 * properties in index.css per mode; canvases can't read CSS variables at
 * render time, so the mirror is deliberate. Update both files together.
 *
 * SERIES is a fixed-order categorical palette validated per mode
 * (lightness band, chroma floor, CVD separation, contrast vs surface).
 * Assign colors by slot, never cycle past the end: a 7th series folds
 * into "Other" or gets its own chart.
 */

export type ThemeMode = 'light' | 'dark'

export const FONT_SANS = 'Outfit, sans-serif'
export const FONT_MONO = 'JetBrains Mono, monospace'

interface ChartColors {
  text: string
  muted: string
  faint: string
  border: string
  grid: string
  surface: string
  elevated: string
  accent: string
  amber: string
  green: string
  red: string
  series: readonly [string, string, string, string, string, string]
}

const COLORS: Record<ThemeMode, ChartColors> = {
  dark: {
    text: '#E7ECF7',
    muted: '#9AA6C2',
    faint: '#6A7795',
    border: '#24325C',
    grid: '#182449',
    surface: '#101A36',
    elevated: '#182449',
    accent: '#5B6CFF',
    amber: '#FFB020',
    green: '#4ADE80',
    red: '#F87171',
    series: ['#5B6CFF', '#CC820A', '#0095BB', '#9D7BF4', '#DE4E92', '#1FA06E'],
  },
  light: {
    text: '#14213E',
    muted: '#6A7795',
    faint: '#9AA6C2',
    border: '#D5DCEE',
    grid: '#E7ECF7',
    surface: '#FFFFFF',
    elevated: '#E7ECF7',
    accent: '#3A4FF5',
    amber: '#D97706',
    green: '#16A34A',
    red: '#DC2626',
    series: ['#3A4FF5', '#D97706', '#0891B2', '#7C3AED', '#DB2777', '#0D9488'],
  },
}

export interface ChartTheme extends ChartColors {
  mode: ThemeMode
  seq: { from: string; to: string }
  axisLabel: { color: string; fontFamily: string; fontSize: number }
  axisLine: { lineStyle: { color: string } }
  splitLine: { lineStyle: { color: string; type: 'dashed' } }
  nameTextStyle: { color: string; fontFamily: string; fontSize: number }
  /** Inline CSS for rich-text HTML tooltips built by pages. */
  tooltipCss: string
}

/** Linear interpolation between two hex colors, k in [0, 1]. */
export function mixHex(a: string, b: string, k: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - k) + ((pb >> shift) & 255) * k)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

/**
 * Sequential ramp endpoints per mode (single hue, subdued → saturated),
 * for ordered series like year-over-year curves. Use via
 * mixHex(t.seq.from, t.seq.to, k).
 */
const SEQ: Record<ThemeMode, { from: string; to: string }> = {
  dark: { from: '#3D4870', to: '#93A0FF' },
  light: { from: '#C6CEF5', to: '#2C3ECF' },
}

export function getChartTheme(mode: ThemeMode): ChartTheme {
  const c = COLORS[mode]
  return {
    ...c,
    mode,
    seq: SEQ[mode],
    axisLabel: { color: c.faint, fontFamily: FONT_MONO, fontSize: 11 },
    axisLine: { lineStyle: { color: c.border } },
    splitLine: { lineStyle: { color: c.grid, type: 'dashed' } },
    nameTextStyle: { color: c.faint, fontFamily: FONT_SANS, fontSize: 11 },
    tooltipCss: `font-family:${FONT_MONO};font-size:12px`,
  }
}
