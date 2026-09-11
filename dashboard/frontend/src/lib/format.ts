/**
 * Number formatting shared across pages - German locale style:
 * European notation (dot thousands, comma decimals: 1.000,35).
 * Placeholder glyph for missing data.
 */
const MISSING = '—'

const formatters = new Map<number, Intl.NumberFormat>()

function deFormat(decimals: number): Intl.NumberFormat {
  let nf = formatters.get(decimals)
  if (!nf) {
    nf = new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })
    formatters.set(decimals, nf)
  }
  return nf
}

/** Generic number in German style, e.g. fmtNum(1234.5) → "1.234,5". */
export function fmtNum(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v)) return MISSING
  return deFormat(decimals).format(v)
}

/** Euro amount (number only - unit is rendered separately). */
export function fmtEur(v: number | null | undefined, decimals = 1): string {
  return fmtNum(v, decimals)
}

/** Percentage with sign, max one decimal per house style: "+1,6%". */
export function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null || isNaN(v)) return MISSING
  const sign = v > 0 ? '+' : ''
  return `${sign}${deFormat(decimals).format(v)}%`
}
