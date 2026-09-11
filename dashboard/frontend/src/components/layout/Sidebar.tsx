import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  TrendingUp,
  Zap,
  Brain,
  Settings2,
  LineChart,
  Shield,
  Sun,
  Moon,
  Monitor,
  ChevronRight,
} from 'lucide-react'
import { useFilterStore } from '../../store/filterStore'
import DataFreshnessPill from '../common/DataFreshnessPill'
import BirdviewMark from './BirdviewMark'

const NAV_ITEMS = [
  { icon: TrendingUp, label: 'Commodities', path: '/commodities' },
  { icon: Zap, label: 'Electricity', path: '/electricity' },
  { icon: Brain, label: 'ML performance', path: '/ml' },
  { icon: Settings2, label: 'Assumptions', path: '/scenarios' },
  { icon: LineChart, label: 'Forecast', path: '/forecast' },
  { icon: Shield, label: 'Ancillary', path: '/ancillary' },
]

const THEMES = [
  { icon: Sun, value: 'light' as const, label: 'Light' },
  { icon: Monitor, value: 'system' as const, label: 'System' },
  { icon: Moon, value: 'dark' as const, label: 'Dark' },
]

export default function Sidebar() {
  const [expanded, setExpanded] = useState(false)
  const theme = useFilterStore((s) => s.theme)
  const setTheme = useFilterStore((s) => s.setTheme)

  return (
    <aside
      className="flex flex-col shrink-0 border-r transition-all duration-300"
      style={{
        width: expanded ? '224px' : '64px',
        backgroundColor: 'var(--bg-surface)',
        borderColor: 'var(--border-default)',
        minHeight: '100vh',
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-3 px-4 py-5 border-b"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <div
          className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ backgroundColor: 'var(--accent-primary)', color: '#ffffff' }}
        >
          <BirdviewMark size={17} />
        </div>
        {expanded && (
          <div className="overflow-hidden">
            <div
              className="text-sm font-bold tracking-wide leading-none"
              style={{ color: 'var(--text-primary)', fontFamily: 'Outfit, sans-serif' }}
            >
              Market Analytics
            </div>
            <div
              className="text-xs mt-0.5"
              style={{ color: 'var(--accent-primary)', fontFamily: 'JetBrains Mono, monospace' }}
            >
              DE
            </div>
          </div>
        )}
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-center w-full py-2 transition-colors"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--accent-primary)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)')}
        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <ChevronRight
          size={14}
          className="transition-transform duration-300"
          style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Nav items */}
      <nav className="flex-1 flex flex-col gap-1 px-2 py-2">
        {NAV_ITEMS.map(({ icon: Icon, label, path }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              [
                'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 relative group',
                isActive ? 'active-nav' : '',
              ].join(' ')
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--bg-elevated)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            })}
            title={!expanded ? label : undefined}
          >
            {({ isActive }) => (
              <>
                {/* Active indicator */}
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                    style={{ backgroundColor: 'var(--accent-primary)' }}
                  />
                )}
                <Icon
                  size={18}
                  strokeWidth={isActive ? 2.5 : 2}
                  style={{ color: isActive ? 'var(--accent-primary)' : undefined }}
                  className="shrink-0"
                />
                {expanded && (
                  <span
                    className="text-sm font-medium whitespace-nowrap"
                    style={{ fontFamily: 'Outfit, sans-serif' }}
                  >
                    {label}
                  </span>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Data freshness - surfaces ingestion lag from /api/data-status. */}
      <div
        className="px-2 py-2 border-t"
        style={{ borderColor: 'var(--border-default)' }}
      >
        <DataFreshnessPill expanded={expanded} />
      </div>

      {/* Theme toggle */}
      <div
        className="px-2 py-3 border-t"
        style={{ borderColor: 'var(--border-default)' }}
      >
        {expanded ? (
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ backgroundColor: 'var(--bg-elevated)' }}
          >
            {THEMES.map(({ icon: Icon, value, label }) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                title={label}
                className="flex-1 flex items-center justify-center py-2 transition-all duration-200"
                style={{
                  backgroundColor:
                    theme === value ? 'var(--bg-hover)' : 'transparent',
                  color: theme === value ? 'var(--accent-primary)' : 'var(--text-muted)',
                }}
              >
                <Icon size={14} />
              </button>
            ))}
          </div>
        ) : (
          <button
            onClick={() => {
              const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'
              setTheme(next)
            }}
            className="flex items-center justify-center w-full py-2 rounded-lg transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title="Toggle theme"
          >
            {theme === 'dark' ? (
              <Moon size={16} />
            ) : theme === 'light' ? (
              <Sun size={16} />
            ) : (
              <Monitor size={16} />
            )}
          </button>
        )}
      </div>
    </aside>
  )
}
