import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { api } from '../../api/client'
import { useFilterStore } from '../../store/filterStore'

interface ScenarioSelectorProps {
  className?: string
}

export default function ScenarioSelector({ className = '' }: ScenarioSelectorProps) {
  const scenario = useFilterStore((s) => s.scenario)
  const setScenario = useFilterStore((s) => s.setScenario)

  const { data } = useQuery({
    queryKey: ['scenarios-list'],
    queryFn: () => api.scenariosList(),
  })

  // Auto-select the first scenario once the list loads. This must happen in
  // an effect, not during render: writing to the shared zustand store while
  // rendering synchronously notifies every other subscribed component and
  // trips React's "cannot update a component while rendering a different
  // component" warning. Reading the current scenario via getState() keeps
  // the effect keyed on the fetched list only, so it can't loop.
  const fetchedScenarios = data?.scenarios
  useEffect(() => {
    if (fetchedScenarios?.length && !useFilterStore.getState().scenario) {
      setScenario(fetchedScenarios[0])
    }
  }, [fetchedScenarios, setScenario])

  const scenarios = fetchedScenarios ?? []

  return (
    <div className={`relative ${className}`}>
      <select
        id="scenario-selector"
        name="scenario"
        aria-label="Forecast scenario"
        value={scenario}
        onChange={(e) => setScenario(e.target.value)}
        className="appearance-none pl-3 pr-8 py-1.5 text-xs rounded-lg border transition-colors cursor-pointer"
        style={{
          backgroundColor: 'var(--bg-elevated)',
          borderColor: 'var(--border-default)',
          color: 'var(--text-primary)',
          fontFamily: 'Outfit, sans-serif',
        }}
        disabled={scenarios.length === 0}
      >
        {scenarios.length === 0 && (
          <option value="">Loading scenarios...</option>
        )}
        {scenarios.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <ChevronDown
        size={12}
        className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
        style={{ color: 'var(--text-muted)' }}
      />
    </div>
  )
}
