import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { format, subDays } from 'date-fns'

interface FilterState {
  dateRange: { start: string; end: string }
  scenario: string
  theme: 'system' | 'dark' | 'light'
  setDateRange: (start: string, end: string) => void
  setScenario: (s: string) => void
  setTheme: (t: 'system' | 'dark' | 'light') => void
}

// Default to the last 60 days so first-paint queries are small. Charts
// that need full history (e.g. Price Duration Curve across all years)
// must opt out and use their own range.
export const DEFAULT_RANGE_DAYS = 60

export const useFilterStore = create<FilterState>()(
  persist(
    (set) => ({
      dateRange: {
        start: format(subDays(new Date(), DEFAULT_RANGE_DAYS), 'yyyy-MM-dd'),
        end: format(new Date(), 'yyyy-MM-dd'),
      },
      scenario: '',
      theme: 'dark',
      setDateRange: (start, end) => set({ dateRange: { start, end } }),
      setScenario: (scenario) => set({ scenario }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      // Only the theme survives reloads - date range and scenario should
      // reset to fresh defaults each session.
      name: 'german-market-ui',
      partialize: (s) => ({ theme: s.theme }),
    },
  ),
)
