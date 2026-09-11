import { Outlet, useLocation } from 'react-router-dom'
import { useEffect } from 'react'
import { format, subDays } from 'date-fns'
import Sidebar from './Sidebar'
import { useFilterStore, DEFAULT_RANGE_DAYS } from '../../store/filterStore'

const PAGE_LABELS: Record<string, string> = {
  '/commodities': 'Commodities',
  '/electricity': 'Electricity',
  '/ml': 'ML performance',
  '/scenarios': 'Assumptions',
  '/forecast': 'Forecast',
  '/ancillary': 'Ancillary markets',
}

const APP_TITLE = 'Market Analytics'

export default function Layout() {
  const location = useLocation()
  const theme = useFilterStore((s) => s.theme)
  const dateRangeEnd = useFilterStore((s) => s.dateRange.end)
  const setDateRange = useFilterStore((s) => s.setDateRange)
  const pageLabel = PAGE_LABELS[location.pathname] ?? 'Dashboard'

  // Apply theme class to document
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'light')
    if (theme === 'dark') root.classList.add('dark')
    else if (theme === 'light') root.classList.add('light')
    // 'system' = no class, relies on prefers-color-scheme
  }, [theme])

  // Slide the date range end to today when the tab regains focus after the
  // day has turned (e.g. dashboard left open overnight). Only updates end -
  // start is left alone so the window width the user last saw is preserved.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const today = format(new Date(), 'yyyy-MM-dd')
      if (dateRangeEnd >= today) return
      setDateRange(format(subDays(new Date(), DEFAULT_RANGE_DAYS), 'yyyy-MM-dd'), today)
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [dateRangeEnd, setDateRange])

  return (
    <div
      className="flex w-full min-h-screen"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <Sidebar />

      <div className="flex flex-col flex-1 min-w-0">
        {/* TopBar */}
        <header
          className="flex items-center px-6 py-3 border-b shrink-0"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-default)',
            height: '52px',
          }}
        >
          <nav
            className="flex items-center gap-2 text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>{APP_TITLE} / DE</span>
            <span style={{ color: 'var(--border-bright)' }}>/</span>
            <span style={{ color: 'var(--text-primary)' }} className="font-medium">
              {pageLabel}
            </span>
          </nav>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
